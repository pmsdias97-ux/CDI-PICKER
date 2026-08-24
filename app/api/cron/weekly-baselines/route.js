import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const maxDuration = 30;

// BASELINE SEMANAL ("Vencedor da Semana N"). O ranking semanal mede a rentabilidade DESDE O FECHO
// do último dia de negociação ANTES de 2ª feira (o "fecho anterior") — ou seja, a SOMA dos retornos
// diários da semana (à 2ª feira o semanal = o diário, porque inclui o salto da abertura). Por isso o
// baseline desta semana = o FECHO da semana ANTERIOR (weekly_baselines[semana-1].close_price, gravado
// à 6ª feira pelo weekly-close). Não lê preços ao vivo — copia o fecho já congelado.
//
// Corre à 2ª feira (janela 2ª–4ª, para feriados). Idempotente (1× por semana). CRON_SECRET. ?force=1.
const norm = (s) => String(s || "").toUpperCase().replace(/\./g, "-").trim();
function weekKey(d){ const t=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())); const dow=t.getUTCDay(); t.setUTCDate(t.getUTCDate()+(dow===0?-6:1-dow)); return t.toISOString().slice(0,10); }
function prevWeek(key){ const t=new Date(key+"T00:00:00Z"); t.setUTCDate(t.getUTCDate()-7); return t.toISOString().slice(0,10); }

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return Response.json({ error: "Não autorizado." }, { status: 401 });

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const now = new Date();
  const period = url.searchParams.get("period") || weekKey(now);

  // A Semana 1 (arranque) é semeada; o jogo ao vivo é da Semana 2 em diante.
  const WEEK_LIVE_FROM = "2026-07-06";
  if (!force && period < WEEK_LIVE_FROM) {
    return Response.json({ ok: true, period, captured: 0, skipped: "semana pré-arranque (antes de WEEK_LIVE_FROM)" });
  }
  // Janela de captura: 2ª a 4ª feira (se a 2ª for feriado, apanha na 3ª/4ª sob a chave da 2ª feira).
  const dow = now.getUTCDay(); // 0=dom, 1=2ª … 6=sáb
  if (!force && (dow < 1 || dow > 3)) {
    return Response.json({ ok: true, period, captured: 0, skipped: "fora da janela de captura (2ª–4ª)" });
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // Só depois de a competição arrancar (baselines trancados).
  const { data: gs } = await supabase
    .from("game_settings").select("competition_started").eq("id", 1).maybeSingle();
  if (gs?.competition_started !== true) {
    return Response.json({ ok: true, period, captured: 0, skipped: "competição não começou" });
  }

  // Idempotência por ticker: uma semente parcial não bloqueia a reparação no retry.
  const { data: existing, error: exErr } = await supabase
    .from("weekly_baselines").select("ticker, price").eq("period", period);
  if (exErr) return Response.json({ error: "Falha a ler weekly_baselines." }, { status: 500 });
  const existingTickers = new Set(
    (existing || []).filter((r) => Number(r.price) > 0).map((r) => r.ticker)
  );

  // Baseline = FECHO da semana ANTERIOR (o fecho antes de 2ª feira → soma dos retornos diários).
  const prev = prevWeek(period);
  const { data: prevRows, error: pErr } = await supabase
    .from("weekly_baselines").select("ticker, close_price").eq("period", prev);
  if (pErr) return Response.json({ error: "Falha a ler a semana anterior." }, { status: 500 });
  const closes = (prevRows || []).filter((r) => Number(r.close_price) > 0);
  if (!closes.length) {
    // Semana anterior ainda sem fecho (ex.: 6ª feira ainda não fechou, ou 1ª semana ao vivo) → tenta
    // no próximo dia da janela. A Semana 2 (1ª ao vivo) é semeada à mão (a Semana 1 não tem fecho).
    return Response.json({ ok: true, period, captured: 0, skipped: `semana anterior (${prev}) sem fecho — retry` });
  }

  const capturedAt = now.toISOString();
  const baselines = closes
    .filter((r) => !existingTickers.has(r.ticker))
    .map((r) => ({ period, ticker: r.ticker, price: Number(r.close_price), captured_at: capturedAt }));

  // BLINDAGEM anti-degradação: o fecho da semana anterior só cobre os tickers que ELA tinha baseline
  // (o close só grava sobre linhas existentes). Se essa semana já vinha incompleta, o buraco propaga-se e
  // agrava-se de semana para semana (165→152→22→1, visto a 2026-08-24). Por isso, PREENCHEMOS os tickers
  // dos membros que ficaram de fora com o `sp500_ath.prev_close` (= fecho do último pregão antes de 2ª, o
  // mesmo valor que o baseline devia ter). Assim o baseline nunca fica incompleto.
  const covered = new Set([...existingTickers, ...baselines.map((b) => b.ticker)].map(norm));
  const { data: pfs } = await supabase
    .from("portfolios").select("user_id, portfolio_stocks(ticker)").eq("official", true);
  const { data: subs } = await supabase
    .from("users").select("id").eq("has_submitted_portfolio", true);
  const okUsers = new Set((subs || []).map((u) => u.id));
  const heldOrig = new Map(); // norm → forma canónica p/ gravar
  for (const p of pfs || []) {
    if (!okUsers.has(p.user_id)) continue;
    for (const s of p.portfolio_stocks || []) { const n = norm(s.ticker); if (!heldOrig.has(n)) heldOrig.set(n, s.ticker); }
  }
  const missing = [...heldOrig].filter(([n]) => !covered.has(n));
  let filled = 0;
  if (missing.length) {
    const { data: ath } = await supabase.from("sp500_ath").select("symbol, prev_close");
    const pc = new Map();
    for (const r of ath || []) { const p = Number(r.prev_close); if (p > 0) pc.set(norm(r.symbol), p); }
    for (const [n, orig] of missing) {
      const p = pc.get(n);
      if (p > 0) { baselines.push({ period, ticker: orig, price: p, captured_at: capturedAt }); filled++; }
    }
  }

  if (!baselines.length) {
    return Response.json({ ok: true, period, prev, captured: 0, covered: existingTickers.size, skipped: "semana completa" });
  }
  const { error: upErr } = await supabase
    .from("weekly_baselines").upsert(baselines, { onConflict: "period,ticker", ignoreDuplicates: true });
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

  return Response.json({ ok: true, period, prev, captured: baselines.length, filledFromPrevClose: filled, covered: existingTickers.size + baselines.length });
}
