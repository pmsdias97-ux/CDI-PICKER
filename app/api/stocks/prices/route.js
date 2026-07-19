import { after } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { fetchQuoteFull, flushQuoteRevalidations } from "../../../lib/marketData";
import { isValidTicker, rateLimited } from "../../../lib/apiGuards";
import { usMarketOpen } from "../../../lib/marketHours";

export const maxDuration = 30; // corta de forma limpa se algo demorar

// Tickers cronicamente instáveis no pipeline yfinance (cotações erradas, sobretudo ao fim de semana /
// fora de horas, e negociação esparsa). Para estes, quando o mercado está FECHADO (ou o preço do
// pipeline destoa absurdamente), servimos a ÂNCORA sã = último fecho/abertura dos weekly_baselines
// (frozen, coerente com os baselines) em vez do preço ao vivo. Evita que um mau tick estrague o ranking.
const UNSTABLE_TICKERS = new Set(["ATLN"]);
const UNSTABLE_DEV = 0.30; // com o mercado aberto, só rejeita desvios > 30% da âncora (garbage, não movimento normal)

// FONTE DOS PREÇOS: a tabela sp500_ath (pipeline yfinance no GitHub, de minuto a minuto).
// É a MESMA fonte dos baselines trancados → a rentabilidade fica coerente (preço atual e
// preço inicial na mesma escala). O Yahoo/CNBC ao vivo do site dá 429 e desfasa/erra vários
// tickers (ex.: META/BABA/MSFT ficavam com o preço do baseline; o CPRT chegou a vir errado),
// por isso só é usado como recurso para tickers que NÃO estão no pipeline (ex.: BTC).
const norm = (s) => String(s || "").toUpperCase().replace(/\./g, "-").trim();

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

// Âncora sã (frozen) para os UNSTABLE_TICKERS: último fecho dos weekly_baselines (ou abertura se a
// semana ainda não fechou). Muda 1×/semana → cache generosa. {norm(ticker): price}.
let unstableSnap = { at: 0, map: null };
const UNSTABLE_TTL_MS = 5 * 60 * 1000;
async function unstableRefMap() {
  if (!UNSTABLE_TICKERS.size) return new Map();
  if (unstableSnap.map && Date.now() - unstableSnap.at < UNSTABLE_TTL_MS) return unstableSnap.map;
  const map = new Map();
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("weekly_baselines").select("ticker, period, price, close_price")
      .in("ticker", [...UNSTABLE_TICKERS]).order("period", { ascending: false });
    for (const r of data || []) {
      const t = norm(r.ticker);
      if (map.has(t)) continue; // já temos o período mais recente deste ticker
      const ref = r.close_price != null ? Number(r.close_price) : Number(r.price);
      if (Number.isFinite(ref) && ref > 0) map.set(t, ref);
    }
  } catch { /* sem âncora → a guarda não atua */ }
  unstableSnap = { at: Date.now(), map };
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

  // 4) GUARDA de tickers instáveis (ex.: ATLN): com o mercado FECHADO, ou preço do pipeline a destoar
  // >30% da âncora sã, servimos a âncora (fecho congelado dos weekly_baselines). Só toca nestes tickers.
  const unstableInReq = tickers.filter((t) => UNSTABLE_TICKERS.has(norm(t)) && prices[t] != null);
  if (unstableInReq.length) {
    let refs; try { refs = await unstableRefMap(); } catch { refs = new Map(); }
    const mktOpen = usMarketOpen(new Date());
    for (const ticker of unstableInReq) {
      const ref = refs.get(norm(ticker));
      if (!(Number.isFinite(ref) && ref > 0)) continue;
      const dev = Math.abs(prices[ticker] / ref - 1);
      if (!mktOpen || dev > UNSTABLE_DEV) {
        prices[ticker] = ref;   // mercado fechado → congela no fecho; ou tick absurdo → rejeita
        delete changes[ticker]; // a variação do dia deixa de fazer sentido
      }
    }
  }

  return Response.json({ prices, changes, errors });
}
