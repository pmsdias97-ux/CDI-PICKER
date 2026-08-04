import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { usMarketOpen } from "../../../lib/marketHours";
import { fetchQuote } from "../../../lib/marketData";

export const maxDuration = 30;

// FECHO DA MINI-ÉPOCA MENSAL ("Campeão do mês"). No ÚLTIMO dia útil do mês, depois do fecho US, grava
// o preço de FECHO (close_price) de cada ticker em competição no período 'YYYY-MM'. A partir daí o mês
// fica FECHADO e o campeão é revelado LOGO (o cliente calcula média de (close/open − 1), espelhado p/
// shorts) — sem esperar pelo baseline do mês seguinte. Simétrico ao weekly-close (que faz o mesmo à 6ª).
//
// Fonte: sp500_ath (o pipeline yfinance, já com o fecho do último pregão). BTC/fora do pipeline → cotação
// ao vivo (a MESMA fonte do cliente). Idempotente: só grava se ainda não houver close_price no período.
// Protegido por CRON_SECRET. ?period=YYYY-MM e ?force=1 permitem forçar/backfill à mão.
const norm = (s) => String(s || "").toUpperCase().replace(/\./g, "-").trim();

// Último dia ÚTIL (2ª–6ª) do mês (recua de Sáb/Dom). Ignora feriados US (raros no fim do mês; nesse caso
// o sp500_ath ainda tem o fecho do último pregão real, por isso o valor gravado continua correto).
function lastWeekdayUTC(y, mo0) {
  const d = new Date(Date.UTC(y, mo0 + 1, 0)); // dia 0 do mês seguinte = último dia deste mês
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return Response.json({ error: "Não autorizado." }, { status: 401 });

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const now = new Date();
  const period = url.searchParams.get("period") || now.toISOString().slice(0, 7); // 'YYYY-MM'

  // Só no ÚLTIMO dia útil do mês (ou depois) — nos outros dias 28–31 salta. O guard de idempotência
  // garante 1 captura por mês, mesmo correndo em vários dias.
  if (!force) {
    const last = lastWeekdayUTC(now.getUTCFullYear(), now.getUTCMonth());
    if (now.getUTCDate() < last.getUTCDate()) return Response.json({ ok: true, period, captured: 0, skipped: "ainda há pregões este mês" });
  }
  // Só DEPOIS do fecho do mercado US (senão gravaria preços intradiários como "fecho").
  if (!force && usMarketOpen(now)) return Response.json({ ok: true, period, captured: 0, skipped: "mercado ainda aberto" });

  let supabase; try { supabase = getSupabaseAdmin(); } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { data: gs } = await supabase.from("game_settings").select("competition_started").eq("id", 1).maybeSingle();
  if (gs?.competition_started !== true) return Response.json({ ok: true, period, captured: 0, skipped: "competição não começou" });

  // Baseline (abertura) deste mês tem de existir (foi capturado no início do mês).
  const { data: rows, error } = await supabase.from("monthly_baselines").select("ticker, price, close_price").eq("period", period);
  if (error) return Response.json({ error: "Falha a ler monthly_baselines." }, { status: 500 });
  if (!rows || !rows.length) return Response.json({ ok: true, period, captured: 0, skipped: "mês sem baseline de abertura" });
  // Idempotência por ticker: se um fecho ficar parcial, um retry completa apenas os ausentes.
  const pendingRows = rows.filter((r) => !(Number(r.close_price) > 0));
  if (!pendingRows.length) return Response.json({ ok: true, period, captured: 0, skipped: "mês já fechado" });

  // Preços de FECHO do sp500_ath.
  const { data: ath, error: athErr } = await supabase.from("sp500_ath").select("symbol, price");
  if (athErr) return Response.json({ error: "Falha a ler sp500_ath." }, { status: 500 });
  const priceMap = new Map();
  for (const r of ath || []) { const p = Number(r.price); if (Number.isFinite(p) && p > 0) priceMap.set(norm(r.symbol), p); }

  const capturedAt = now.toISOString();
  const upserts = []; const skippedTickers = [];
  for (const r of pendingRows) {
    let close = priceMap.get(norm(r.ticker));
    if (!(Number.isFinite(close) && close > 0)) {
      // Fora do sp500_ath (ex.: BTC) → cotação ao vivo (a MESMA fonte do livePrices do cliente).
      try { const q = await fetchQuote(r.ticker); if (Number.isFinite(q) && q > 0) close = q; } catch { /* fica sem fecho */ }
    }
    if (Number.isFinite(close) && close > 0) upserts.push({ period, ticker: r.ticker, price: r.price, close_price: close });
    else skippedTickers.push(r.ticker);
  }
  if (!upserts.length) return Response.json({ ok: true, period, captured: 0, skipped: "sem preços de fecho" });

  const { error: upErr } = await supabase.from("monthly_baselines").upsert(upserts, { onConflict: "period,ticker" });
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

  return Response.json({ ok: true, period, captured: upserts.length, capturedAt, skippedTickers });
}
