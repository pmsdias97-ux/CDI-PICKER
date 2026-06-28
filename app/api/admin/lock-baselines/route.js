import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { fetchCloseFresh, fetchQuote } from "../../../lib/marketData";
import { usMarketOpen } from "../../../lib/marketHours";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

export const maxDuration = 60; // ~150 tickers → folga à função

// Concorrência limitada (acelera e não rebenta o tempo da função nem martela as APIs).
async function mapPool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}
// Normaliza ticker p/ casar com sp500_ath (BRK.B ↔ BRK-B).
const norm = (s) => String(s || "").toUpperCase().replace(/\./g, "-").trim();

// Fecho regular do ticker; fallback ao preço ao vivo. null se ambos falharem.
async function priceFor(t) {
  const close = await fetchCloseFresh(t);
  if (Number.isFinite(close)) return { px: close, src: "close" };
  const live = await fetchQuote(t);
  if (typeof live === "number") return { px: live, src: "live" };
  return null;
}

// PASSO 1 do arranque: TRANCAR os preços de partida no FECHO de 30 jun (sessão regular).
// Fixa initial_price/current_price de TODOS os portefólios (e o SPY) no fecho regular, e
// marca game_settings.baselines_locked_at. NÃO revela os oficiais (não mexe em
// competition_started) — isso é o passo 2 (start-competition). Protegido por ADMIN_PASSWORD.
//
// Correr a 30 jun DEPOIS do fecho US (~21:00 PT): aí `regularMarketPrice` = fecho de 30 jun.
//   body: { password, dryRun?, force? }
//   - dryRun: busca e devolve os fechos SEM gravar (para validar antes de fixar).
//   - force:  ignora o guard de mercado aberto e permite re-trancar.
export async function POST(request) {
  const rl = rateLimited(request, "admin-lock", { max: 10, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!checkAdminPassword(body?.password)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  const dryRun = body?.dryRun === true;
  const force = body?.force === true;

  // Guard: não trancar com o mercado US ainda aberto (o fecho ainda não está fixado).
  // dryRun pode correr a qualquer hora (não grava).
  if (!dryRun && !force && usMarketOpen(new Date())) {
    return Response.json(
      { error: "O mercado ainda está aberto — tranca após o fecho (~21:00 PT de 30 jun)." },
      { status: 400 }
    );
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // Anti-re-tranca: se já foi trancado e não é força, recusa (evita fixar o fecho errado por engano).
  const { data: gs } = await supabase
    .from("game_settings").select("baselines_locked_at").eq("id", 1).maybeSingle();
  if (!dryRun && !force && gs?.baselines_locked_at) {
    return Response.json(
      { error: `Os preços já foram trancados a ${gs.baselines_locked_at}. Usa força para refazer.` },
      { status: 400 }
    );
  }

  const { data: pfs, error } = await supabase
    .from("portfolios").select("id, portfolio_stocks(ticker)");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const tickers = [...new Set((pfs || []).flatMap((p) => (p.portfolio_stocks || []).map((s) => s.ticker)))];
  const prices = {};
  let usedAth = 0, usedClose = 0, usedLive = 0;

  // 1) Fechos já calculados pelo pipeline (sp500_ath) — instantâneo e sem martelar o Yahoo (que dá 429).
  //    Só usa se RECENTE (≤24h) p/ garantir que é o fecho de 30 jun e não um valor antigo.
  try {
    const { data: ath } = await supabase.from("sp500_ath").select("symbol, price, updated_at");
    const freshAfter = Date.now() - 24 * 3600 * 1000;
    const map = new Map();
    for (const r of ath || []) {
      const p = Number(r.price);
      if (Number.isFinite(p) && p > 0 && r.updated_at && new Date(r.updated_at).getTime() >= freshAfter) {
        map.set(norm(r.symbol), p);
      }
    }
    for (const t of tickers) {
      const p = map.get(norm(t));
      if (p != null) { prices[t] = p; usedAth++; }
    }
  } catch { /* sem ATH → cai tudo para o vivo */ }

  // 2) Os restantes ao vivo (paralelo, concorrência 5) + 2ª passagem aos que ainda faltam.
  const apply = (list, res) => list.forEach((t, i) => {
    const r = res[i];
    if (r) { prices[t] = r.px; if (r.src === "close") usedClose++; else usedLive++; }
  });
  const need = tickers.filter((t) => typeof prices[t] !== "number");
  if (need.length) apply(need, await mapPool(need, 5, priceFor));
  const retry = tickers.filter((t) => typeof prices[t] !== "number");
  if (retry.length) {
    await new Promise((r) => setTimeout(r, 1500));
    apply(retry, await mapPool(retry, 4, priceFor));
  }
  const spyR = await priceFor("SPY");
  const spy = spyR ? spyR.px : null;

  // dryRun: devolve o que SERIA fixado, sem gravar.
  if (dryRun) {
    const sample = tickers.slice(0, 5).map((t) => ({ ticker: t, close: prices[t] ?? null }));
    const missing = tickers.filter((t) => typeof prices[t] !== "number").length;
    return Response.json({
      ok: true, dryRun: true, tickers: tickers.length, usedAth, usedClose, usedLive, missing,
      spy: typeof spy === "number" ? spy : null, sample,
    });
  }

  let stocksUpdated = 0, missing = 0;
  for (const t of tickers) {
    if (typeof prices[t] !== "number") { missing++; continue; }
    const { error: e } = await supabase
      .from("portfolio_stocks").update({ initial_price: prices[t], current_price: prices[t] }).eq("ticker", t);
    if (!e) stocksUpdated++;
  }
  if (typeof spy === "number") {
    await supabase.from("portfolios").update({ spy_initial_price: spy }).neq("id", "00000000-0000-0000-0000-000000000000");
  }

  // Fail-safe: só TRANCA se TODOS os preços vieram (e o SPY). Se faltar, atualiza o que tem mas
  // NÃO marca baselines_locked_at → o Passo 2 (arrancar) fica bloqueado e o admin repete. force ignora.
  if ((missing > 0 || typeof spy !== "number") && !force) {
    return Response.json({
      ok: false, incomplete: true, tickers: tickers.length, stocksUpdated, missing, usedAth, usedClose, usedLive,
      spy: typeof spy === "number" ? spy : null,
      error: `${missing} ação(ões)${typeof spy !== "number" ? " + SPY" : ""} sem preço de fecho. Preços atualizados mas NÃO trancado — repete daqui a pouco (ou usa força).`,
    }, { status: 409 });
  }

  const lockedAt = new Date().toISOString();
  const { error: lockErr } = await supabase
    .from("game_settings").update({ baselines_locked_at: lockedAt }).eq("id", 1);
  if (lockErr) return Response.json({ error: lockErr.message }, { status: 500 });

  return Response.json({
    ok: true, tickers: tickers.length, stocksUpdated, missing, usedAth, usedClose, usedLive,
    spy: typeof spy === "number" ? spy : null, lockedAt,
  });
}
