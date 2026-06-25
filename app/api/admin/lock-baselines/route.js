import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { fetchCloseFresh, fetchQuote } from "../../../lib/marketData";
import { usMarketOpen } from "../../../lib/marketHours";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

export const maxDuration = 60; // ~150 tickers → folga à função

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

  // Fecho regular de cada ticker + SPY. Fallback ao preço ao vivo se o fecho não vier.
  const tickers = [...new Set((pfs || []).flatMap((p) => (p.portfolio_stocks || []).map((s) => s.ticker)))];
  const prices = {};
  let usedClose = 0, usedLive = 0;
  for (const t of tickers) {
    const close = await fetchCloseFresh(t);
    if (Number.isFinite(close)) { prices[t] = close; usedClose++; }
    else {
      const live = await fetchQuote(t);
      if (typeof live === "number") { prices[t] = live; usedLive++; }
    }
  }
  const spyClose = await fetchCloseFresh("SPY");
  const spy = Number.isFinite(spyClose) ? spyClose : await fetchQuote("SPY");

  // dryRun: devolve o que SERIA fixado, sem gravar.
  if (dryRun) {
    const sample = tickers.slice(0, 5).map((t) => ({ ticker: t, close: prices[t] ?? null }));
    const missing = tickers.filter((t) => typeof prices[t] !== "number").length;
    return Response.json({
      ok: true, dryRun: true, tickers: tickers.length, usedClose, usedLive, missing,
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

  const lockedAt = new Date().toISOString();
  const { error: lockErr } = await supabase
    .from("game_settings").update({ baselines_locked_at: lockedAt }).eq("id", 1);
  if (lockErr) return Response.json({ error: lockErr.message }, { status: 500 });

  return Response.json({
    ok: true, tickers: tickers.length, stocksUpdated, missing, usedClose, usedLive,
    spy: typeof spy === "number" ? spy : null, lockedAt,
  });
}
