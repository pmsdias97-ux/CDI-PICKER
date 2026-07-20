import { after } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { fetchQuoteFull, flushQuoteRevalidations } from "../../../lib/marketData";
import { isValidTicker, rateLimited } from "../../../lib/apiGuards";
import { isCrypto } from "../../../lib/crypto";
import { usMarketOpen } from "../../../lib/marketHours";

export const maxDuration = 30; // corta de forma limpa se algo demorar

// FONTE DOS PREÇOS: a tabela sp500_ath (pipeline yfinance no GitHub, de minuto a minuto).
// É a MESMA fonte dos baselines trancados → a rentabilidade fica coerente (preço atual e
// preço inicial na mesma escala). O Yahoo/CNBC ao vivo do site dá 429 e desfasa/erra vários
// tickers (ex.: META/BABA/MSFT ficavam com o preço do baseline; o CPRT chegou a vir errado),
// por isso só é usado como recurso para tickers que NÃO estão no pipeline (ex.: BTC).
const norm = (s) => String(s || "").toUpperCase().replace(/\./g, "-").trim();

// Tickers cronicamente instáveis no pipeline yfinance (cotações erradas / negociação esparsa; ex.: ATLN).
// Além do congelamento de fim de semana (que os cobre), são protegidos DURANTE a semana de ticks absurdos.
const UNSTABLE_TICKERS = new Set(["ATLN"]);
const UNSTABLE_DEV = 0.30; // durante a semana, rejeita desvios > 30% da abertura da semana (garbage, não movimento normal)

// 2ª feira (UTC) da semana de uma data — chave dos weekly_baselines.
function weekKey(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay(); t.setUTCDate(t.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return t.toISOString().slice(0, 10);
}
// Pregão da semana terminado? 6ª feira depois do fecho US (16:00 ET) ou fim de semana → sem trading desde o fecho.
function weekTradingDone(now) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", hour12: false }).formatToParts(now || new Date());
  const wd = parts.find((x) => x.type === "weekday")?.value;
  let h = parseInt(parts.find((x) => x.type === "hour")?.value || "0", 10); if (h === 24) h = 0;
  if (wd === "Sat" || wd === "Sun") return true;
  if (wd === "Fri" && h >= 16) return true;
  return false;
}

// Snapshot curto do sp500_ath em memória (evita reler ~600 linhas a cada pedido).
let athSnap = { at: 0, map: null };
const ATH_TTL_MS = 30 * 1000;

async function athMap() {
  if (athSnap.map && Date.now() - athSnap.at < ATH_TTL_MS) return athSnap.map;
  const supabase = getSupabaseAdmin();
  // Resiliente: se a coluna prev_close ainda não existir, lê só symbol+price (sem variação).
  let { data, error } = await supabase.from("sp500_ath").select("symbol, price, prev_close");
  if (error) ({ data } = await supabase.from("sp500_ath").select("symbol, price"));
  const map = new Map();
  for (const r of data || []) {
    const price = Number(r.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const prev = r.prev_close == null ? null : Number(r.prev_close);
    map.set(norm(r.symbol), { price, prev: Number.isFinite(prev) && prev > 0 ? prev : null });
  }
  athSnap = { at: Date.now(), map };
  return map;
}

// Âncora da semana ATUAL (weekly_baselines desse período): { norm(ticker): {open, close} }. O close só
// existe depois do fecho de 6ª. Muda 1×/semana → cache generosa (invalida se a semana mudar).
let weekRefSnap = { at: 0, wk: null, map: null };
const WEEKREF_TTL_MS = 5 * 60 * 1000;
async function weekRefMap(curWk) {
  if (weekRefSnap.map && weekRefSnap.wk === curWk && Date.now() - weekRefSnap.at < WEEKREF_TTL_MS) return weekRefSnap.map;
  const map = new Map();
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("weekly_baselines").select("ticker, price, close_price").eq("period", curWk);
    for (const r of data || []) {
      const open = Number(r.price);
      const close = r.close_price == null ? null : Number(r.close_price);
      map.set(norm(r.ticker), {
        open: Number.isFinite(open) && open > 0 ? open : null,
        close: Number.isFinite(close) && close > 0 ? close : null,
      });
    }
  } catch { /* sem âncora → a guarda não atua */ }
  weekRefSnap = { at: Date.now(), wk: curWk, map };
  return map;
}

export async function GET(request) {
  // Deixa terminar refreshes SWR em background (só do fallback ao vivo).
  after(() => flushQuoteRevalidations());

  const rl = rateLimited(request, "stocks-prices", { max: 60, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  const raw = new URL(request.url).searchParams.get("tickers") || "";
  const tickers = [...new Set(
    raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
  )].filter(isValidTicker).slice(0, 200);

  if (!tickers.length) {
    return Response.json({ prices: {}, changes: {}, errors: {} });
  }

  const prices = {};
  const changes = {}; // variação do dia (preço atual vs fecho anterior)
  const errors = {};

  // 1) Fonte primária: sp500_ath (rápido, fiável, coerente com os baselines).
  let ath;
  try { ath = await athMap(); } catch { ath = new Map(); }
  const missing = [];
  const needChange = []; // no pipeline com preço, mas sem fecho anterior → variação ao vivo
  for (const ticker of tickers) {
    const a = ath.get(norm(ticker));
    if (a) {
      prices[ticker] = a.price;
      if (a.prev) changes[ticker] = a.price / a.prev - 1;
      else needChange.push(ticker);
    } else {
      missing.push(ticker); // não está no pipeline → recurso ao vivo (poucos: BTC…)
    }
  }

  // 2) Recurso ao vivo só para os que faltam (variação self-consistent da própria cotação).
  for (const ticker of missing) {
    try {
      const q = await fetchQuoteFull(ticker);
      if (q?.price == null) { errors[ticker] = "not_found"; continue; }
      prices[ticker] = q.price;
      if (Number.isFinite(q.prevClose) && q.prevClose > 0) changes[ticker] = q.price / q.prevClose - 1;
    } catch (err) {
      errors[ticker] = err.message || "fetch_failed";
    }
  }

  // 3) Preço fiável do pipeline mas sem prev_close (ex.: ATLN, negociação esparsa) → vai buscar
  // só o FECHO ANTERIOR ao vivo para a variação do dia. Mantém o preço do pipeline (coerente
  // com os baselines); se a fonte ao vivo também falhar, fica sem variação (não rebenta).
  for (const ticker of needChange) {
    try {
      const q = await fetchQuoteFull(ticker);
      if (q && Number.isFinite(q.prevClose) && q.prevClose > 0) {
        changes[ticker] = prices[ticker] / q.prevClose - 1;
      }
    } catch { /* sem variação; o preço já está preenchido */ }
  }

  // 4) GUARDA de fiabilidade (best-effort, nunca rebenta a resposta):
  //  - Semana FECHADA (fim de semana / 6ª pós-fecho): não houve pregão desde o fecho → congela TODOS os
  //    tickers da competição no FECHO OFICIAL (weekly_baselines). Imune a qualquer tick mau do pipeline
  //    ao fim de semana (foi o que estragou o ranking com a ATLN).
  //  - Durante a semana: tickers instáveis (ATLN) são protegidos de desvios absurdos (>30%) da abertura.
  //  - Cripto (BTC…) negoceia 24/7 → fica SEMPRE de fora do congelamento.
  try {
    const now = new Date();
    const curWk = weekKey(now);
    const weekDone = weekTradingDone(now);
    const marketOpen = usMarketOpen(now);
    const wref = await weekRefMap(curWk);
    if (wref.size) {
      for (const ticker of tickers) {
        if (prices[ticker] == null || isCrypto(ticker)) continue;
        const r = wref.get(norm(ticker));
        if (!r) continue;
        if (weekDone && r.close > 0) {
          prices[ticker] = r.close; delete changes[ticker];                 // semana fechada → fecho oficial (todos)
        } else if (UNSTABLE_TICKERS.has(norm(ticker)) && r.open > 0 && (!marketOpen || Math.abs(prices[ticker] / r.open - 1) > UNSTABLE_DEV)) {
          prices[ticker] = r.open; delete changes[ticker];                  // instável, mercado FECHADO (pré-abertura 2ª/fora de horas) OU tick absurdo → âncora (abertura da semana)
        }
      }
    }
  } catch { /* guarda best-effort */ }

  return Response.json({ prices, changes, errors });
}
