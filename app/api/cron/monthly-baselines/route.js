import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { US_MARKET_HOLIDAYS } from "../../../lib/marketHours";
import {
  findBaselineTargets, isSafeAthWindow, marketDay, normTicker, overlappingWeekPeriod, previousPeriod,
  storedBaseline,
} from "./logic.mjs";

export const maxDuration = 30;

// MINI-ÉPOCA MENSAL ("Campeão do mês"). No 1º dia útil de cada mês (à abertura US) grava o
// preço de INÍCIO DO MÊS de cada ticker em competição, no período 'YYYY-MM'. A rentabilidade
// mensal (calculada no cliente) = média de (preço_atual/baseline_do_mês − 1), espelhada p/ shorts
// — a MESMA fórmula do total, só com o baseline do mês. Justo ao membro.
//
// Fontes, por ordem: abertura semanal reconciliada quando a âncora coincide; sp500_ath assente;
// close_price congelado do mês anterior (cobre tickers fora do pipeline, ex.: BTC). Idempotente POR
// TICKER: tentativas seguintes preenchem ausentes e reconciliam valores divergentes com o semanal.
// Protegido por CRON_SECRET (Authorization: Bearer $CRON_SECRET).
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const now = new Date();
  const market = marketDay(now, US_MARKET_HOLIDAYS);
  const currentPeriod = market.date.slice(0, 7);
  // Período atual em Nova Iorque — 'YYYY-MM'. ?period= permite forçar um período à mão.
  const period = url.searchParams.get("period") || currentPeriod;
  const prev = previousPeriod(period);
  if (!prev) return Response.json({ error: "Período inválido (usa YYYY-MM)." }, { status: 400 });

  // Janela de captura: dias 1–5, num pregão. O cron é agendado antes da abertura US; se chegar
  // atrasado, continua a poder usar as fontes congeladas e completar só os tickers em falta.
  if (!force && market.day > 5) {
    return Response.json({ ok: true, period, captured: 0, skipped: "fora da janela de captura (dias 1–5)" });
  }
  if (!force && market.closed) {
    return Response.json({ ok: true, period, captured: 0, skipped: "sem pregão hoje" });
  }
  // NB: baseline mensal = FECHO do último dia do mês ANTERIOR (o "fecho antes do dia 1") → a rentab.
  // mensal = soma dos retornos diários do mês (dia 1 = igual ao diário). O agendamento é
  // PRÉ-ABERTURA: nessa janela o sp500_ath ainda tem o fecho assente do mês anterior.

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // A mini-época mensal só faz sentido depois de a competição arrancar (baselines trancados).
  const { data: gs } = await supabase
    .from("game_settings").select("competition_started").eq("id", 1).maybeSingle();
  if (gs?.competition_started !== true) {
    return Response.json({ ok: true, captured: 0, skipped: "competição não começou" });
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

  // Linhas atuais: uma captura parcial não bloqueia as tentativas seguintes.
  const { data: existing, error: exErr } = await supabase
    .from("monthly_baselines").select("ticker, price").eq("period", period);
  if (exErr) return Response.json({ error: "Falha a ler monthly_baselines." }, { status: 500 });

  // Se o mês e a semana partilham o mesmo último pregão, o semanal JÁ RECONCILIADO é a
  // autoridade. Assim um retry corrige inclusive linhas positivas capturadas antes do weekly-sync.
  const overlapWeek = overlappingWeekPeriod(period, US_MARKET_HOLIDAYS);
  const weeklyOpen = new Map();
  if (overlapWeek) {
    const { data: weeklyRows, error: weeklyErr } = await supabase
      .from("weekly_baselines").select("ticker, price").eq("period", overlapWeek);
    if (weeklyErr) return Response.json({ error: "Falha a ler o baseline semanal coincidente." }, { status: 500 });
    for (const r of weeklyRows || []) {
      const price = Number(r.price);
      if (Number.isFinite(price) && price > 0) weeklyOpen.set(normTicker(r.ticker), price);
    }
  }

  const targets = findBaselineTargets(tickers, existing, weeklyOpen);
  if (!targets.length) {
    return Response.json({ ok: true, period, captured: 0, covered: tickers.length, totalTickers: tickers.length, skipped: "período completo" });
  }

  // Fallback congelado: FECHO do mês anterior. Cobre tickers fora do pipeline (ex.: BTC).
  const { data: previousRows, error: prevErr } = await supabase
    .from("monthly_baselines").select("ticker, close_price").eq("period", prev);
  if (prevErr) return Response.json({ error: "Falha a ler o fecho mensal anterior." }, { status: 500 });
  const previousClose = new Map();
  for (const r of previousRows || []) {
    const p = Number(r.close_price);
    if (Number.isFinite(p) && p > 0) previousClose.set(normTicker(r.ticker), p);
  }

  // sp500_ath é seguro apenas no período atual antes da abertura US (o pipeline intradiário ainda
  // não arrancou). Backfills e execuções atrasadas usam só fontes congeladas semanais/mensais.
  const allowAthFallback = period === currentPeriod && isSafeAthWindow(period, market, US_MARKET_HOLIDAYS);
  const athPrices = new Map();
  if (allowAthFallback && targets.some((ticker) => !weeklyOpen.has(normTicker(ticker)))) {
    const { data: ath, error: athErr } = await supabase.from("sp500_ath").select("symbol, price");
    if (athErr) return Response.json({ error: "Falha a ler sp500_ath." }, { status: 500 });
    for (const r of ath || []) {
      const p = Number(r.price);
      if (Number.isFinite(p) && p > 0) athPrices.set(normTicker(r.symbol), p);
    }
  }

  const capturedAt = now.toISOString();
  const baselines = [];
  const skippedTickers = [];
  const sources = { weeklyOpen: 0, sp500Ath: 0, previousClose: 0 };
  for (const ticker of targets) {
    const stored = storedBaseline(ticker, weeklyOpen, athPrices, previousClose, allowAthFallback);
    const source = stored?.source;
    const price = stored?.price;
    if (Number.isFinite(price) && price > 0) {
      baselines.push({ period, ticker, price, captured_at: capturedAt });
      sources[source]++;
    } else skippedTickers.push(ticker);
  }
  if (!baselines.length) {
    const covered = (existing || []).filter((r) => Number(r.price) > 0 && tickers.includes(r.ticker)).length;
    return Response.json({ ok: true, period, prev, overlapWeek, captured: 0, covered, totalTickers: tickers.length, skipped: "sem fonte congelada para os tickers em falta", skippedTickers });
  }

  const { error: upErr } = await supabase
    .from("monthly_baselines")
    .upsert(baselines, { onConflict: "period,ticker" });
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

  const tickerSet = new Set(tickers);
  const existingValid = new Set(
    (existing || []).filter((r) => Number(r.price) > 0 && tickerSet.has(r.ticker)).map((r) => r.ticker)
  );
  const inserted = baselines.filter((r) => !existingValid.has(r.ticker)).length;
  return Response.json({
    ok: true, period, prev, overlapWeek, captured: baselines.length,
    inserted, reconciled: baselines.length - inserted,
    covered: existingValid.size + inserted, totalTickers: tickers.length, sources, skippedTickers,
  });
}
