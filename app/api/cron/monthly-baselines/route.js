import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { usMarketOpen } from "../../../lib/marketHours";

export const maxDuration = 30;

// MINI-ÉPOCA MENSAL ("Campeão do mês"). No 1º dia útil de cada mês (à abertura US) grava o
// preço de INÍCIO DO MÊS de cada ticker em competição, no período 'YYYY-MM'. A rentabilidade
// mensal (calculada no cliente) = média de (preço_atual/baseline_do_mês − 1), espelhada p/ shorts
// — a MESMA fórmula do total, só com o baseline do mês. Justo ao membro.
//
// Fonte dos preços: a tabela sp500_ath (o pipeline yfinance, atualizado à hora) — Supabase→Supabase,
// sem chamadas externas. Idempotente: cada período é capturado UMA vez (guard + PK da tabela).
// Protegido por CRON_SECRET (Authorization: Bearer $CRON_SECRET).
const norm = (s) => String(s || "").toUpperCase().replace(/\./g, "-").trim();

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const now = new Date();
  // Período atual (UTC) — 'YYYY-MM'. ?period= permite forçar um período à mão (com CRON_SECRET).
  const period = url.searchParams.get("period") || now.toISOString().slice(0, 7);

  // Janela de captura: só nos primeiros dias do mês (1–5). Assim, se o dia 1 for fim de semana
  // ou feriado, o 1º dia útil seguinte apanha na mesma. O guard de idempotência garante 1× por mês.
  if (!force && now.getUTCDate() > 5) {
    return Response.json({ ok: true, captured: 0, skipped: "fora da janela de captura (dias 1–5)" });
  }
  // Só com o mercado aberto → os preços do sp500_ath estão frescos (o pipeline corre em pregão).
  if (!force && !usMarketOpen(now)) {
    return Response.json({ ok: true, captured: 0, skipped: "mercado fechado" });
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // A mini-época mensal só faz sentido depois de a competição arrancar (baselines trancados).
  const { data: gs } = await supabase
    .from("game_settings").select("competition_started").eq("id", 1).maybeSingle();
  if (gs?.competition_started !== true) {
    return Response.json({ ok: true, captured: 0, skipped: "competição não começou" });
  }

  // Idempotência: se este período já foi capturado, não repete.
  const { data: existing, error: exErr } = await supabase
    .from("monthly_baselines").select("period").eq("period", period).limit(1);
  if (exErr) return Response.json({ error: "Falha a ler monthly_baselines." }, { status: 500 });
  if (existing && existing.length) {
    return Response.json({ ok: true, period, captured: 0, skipped: "período já capturado" });
  }

  // Tickers em competição = portefólios OFICIAIS de utilizadores que submeteram.
  const { data: rows, error } = await supabase
    .from("portfolios")
    .select("official, users!portfolios_user_id_fkey!inner(has_submitted_portfolio), portfolio_stocks(ticker)");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const tickers = [...new Set(
    (rows || [])
      .filter((r) => r.official === true && r.users?.has_submitted_portfolio)
      .flatMap((r) => (r.portfolio_stocks || []).map((s) => s.ticker))
      .filter(Boolean)
  )];
  if (!tickers.length) return Response.json({ ok: true, period, captured: 0, skipped: "sem tickers" });

  // Preços frescos do sp500_ath (a MESMA fonte dos baselines trancados → escala coerente).
  const { data: ath, error: athErr } = await supabase.from("sp500_ath").select("symbol, price");
  if (athErr) return Response.json({ error: "Falha a ler sp500_ath." }, { status: 500 });
  const priceMap = new Map();
  for (const r of ath || []) {
    const p = Number(r.price);
    if (Number.isFinite(p) && p > 0) priceMap.set(norm(r.symbol), p);
  }

  const capturedAt = now.toISOString();
  const baselines = [];
  const skippedTickers = [];
  for (const ticker of tickers) {
    const p = priceMap.get(norm(ticker)); // guarda o ticker CRU (casa com portfolio_stocks no cliente)
    if (Number.isFinite(p) && p > 0) baselines.push({ period, ticker, price: p, captured_at: capturedAt });
    else skippedTickers.push(ticker); // sem preço no pipeline (ex.: BTC) → cliente cai no preço inicial
  }
  if (!baselines.length) return Response.json({ ok: true, period, captured: 0, skipped: "sem preços" });

  const { error: upErr } = await supabase
    .from("monthly_baselines")
    .upsert(baselines, { onConflict: "period,ticker", ignoreDuplicates: true });
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

  return Response.json({ ok: true, period, captured: baselines.length, skippedTickers });
}
