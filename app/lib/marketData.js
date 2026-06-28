import { searchTickerList } from "./tickerList";

// Market data with graceful fallbacks (no API key required):
//   quotes:  Yahoo Finance  ->  CNBC
//   search:  Yahoo Finance  ->  local curated ticker list
// Yahoo rate-limits IPs aggressively (HTTP 429). When that happens we trip a
// circuit breaker that skips Yahoo for a cooldown window, so the app stays fast
// and Yahoo's per-IP block has room to recover.

const CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_FETCH_GAP_MS = 400;
const FETCH_TIMEOUT_MS = 4000; // todo o fetch externo desiste ao fim de 4s (não pendura)
let lastFetchAt = 0;

const YAHOO_COOLDOWN_MS = 5 * 60 * 1000;
let yahooCooldownUntil = 0;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function getCached(key) {
  const entry = CACHE.get(key);
  if (entry && Date.now() - entry.at < (entry.ttl || CACHE_TTL_MS)) return entry.value;
  return null;
}

function setCached(key, value, ttl) {
  CACHE.set(key, { value, at: Date.now(), ttl });
}

async function throttle() {
  const wait = MIN_FETCH_GAP_MS - (Date.now() - lastFetchAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
}

function yahooAvailable() {
  return Date.now() >= yahooCooldownUntil;
}

function tripYahooBreaker() {
  yahooCooldownUntil = Date.now() + YAHOO_COOLDOWN_MS;
}

// Single Yahoo request, no retries — we fail fast to the fallback. A 429 trips
// the breaker so we stop hammering an IP Yahoo is already throttling.
async function yahooJson(url, revalidate) {
  await throttle();
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*" },
    next: revalidate ? { revalidate } : undefined,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 429 || res.status >= 500) {
    tripYahooBreaker();
    throw new Error(`Yahoo Finance HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
  return res.json();
}

// "=" e "^" são válidos no path e o Yahoo exige-os crus (futuros CC=F, índices ^GSPC).
function yfPath(symbol) {
  return encodeURIComponent(symbol).replace(/%3D/g, "=").replace(/%5E/g, "^");
}

async function yahooQuote(symbol) {
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${yfPath(symbol)}`
  );
  url.searchParams.set("range", "1d");
  url.searchParams.set("interval", "1d");
  const data = await yahooJson(url.toString(), 300);
  if (data.chart?.error) throw new Error(data.chart.error.description || "Yahoo error");
  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  const price = meta?.regularMarketPrice;
  if (!Number.isFinite(price)) return null;
  const prevClose = meta?.chartPreviousClose ?? meta?.previousClose;
  // Preço de abertura do dia: meta.regularMarketOpen, ou o candle diário (range=1d).
  let open = meta?.regularMarketOpen;
  if (!Number.isFinite(open)) {
    const opens = result?.indicators?.quote?.[0]?.open;
    if (Array.isArray(opens)) open = [...opens].reverse().find((v) => Number.isFinite(v));
  }
  return {
    price,
    open: Number.isFinite(open) ? open : null,
    name: meta?.longName || meta?.shortName || null,
    exchange: meta?.fullExchangeName || meta?.exchangeName || null,
    currency: meta?.currency || null,
    prevClose: Number.isFinite(prevClose) ? prevClose : null,
  };
}

// Yahoo uses "TICKER.EXCHANGE" (MC.PA); CNBC uses "TICKER-COUNTRY" (MC-FR).
// Map the common Yahoo exchange suffixes to CNBC country codes so European /
// international tickers still resolve via CNBC when Yahoo is rate-limited.
const CNBC_COUNTRY = {
  PA: "FR", AS: "NL", BR: "BE", DE: "DE", F: "DE", MI: "IT", MC: "ES",
  LS: "PT", L: "GB", IL: "GB", SW: "CH", VX: "CH", ST: "SE", HE: "FI",
  CO: "DK", OL: "NO", VI: "AT", IR: "IE", AT: "GR",
};

function cnbcSymbol(symbol) {
  const dot = symbol.lastIndexOf(".");
  if (dot < 0) return symbol; // US tickers: same on both
  const base = symbol.slice(0, dot);
  const suffix = symbol.slice(dot + 1).toUpperCase();
  const country = CNBC_COUNTRY[suffix];
  return country ? `${base}-${country}` : symbol;
}

async function cnbcFetchQuote(sym) {
  const url = new URL(
    "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol"
  );
  url.searchParams.set("symbols", sym);
  url.searchParams.set("output", "json");
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`CNBC HTTP ${res.status}`);
  const data = await res.json();
  const quote = data?.FormattedQuoteResult?.FormattedQuote?.[0];
  if (!quote || quote.code !== 0) return null;
  const price = parseFloat(String(quote.last).replace(/,/g, ""));
  if (!Number.isFinite(price)) return null;
  const change = parseFloat(String(quote.change).replace(/,/g, ""));
  const open = parseFloat(String(quote.open).replace(/,/g, ""));
  return {
    price,
    open: Number.isFinite(open) ? open : null,
    name: quote.name || quote.shortName || null,
    exchange: quote.exchange || quote.exchangeName || null,
    currency: quote.currencyCode || null,
    prevClose: Number.isFinite(change) ? price - change : null,
  };
}

async function cnbcQuote(symbol) {
  // Try as-is (US tickers). If it doesn't resolve, try the CNBC-format symbol.
  const quote = await cnbcFetchQuote(symbol);
  if (quote != null) return quote;
  const translated = cnbcSymbol(symbol);
  if (translated !== symbol) return cnbcFetchQuote(translated);
  return null;
}

// --- Quotes: stale-while-revalidate --------------------------------------
// Serve cached quotes instantly (even slightly stale) and refresh in the
// background, so users never wait on Yahoo/CNBC and the APIs are hit at most
// once per FRESH window per ticker. Routes should call flushQuoteRevalidations()
// via next/server `after()` so background refreshes complete on serverless.
const QUOTE_FRESH_MS = 60 * 1000;        // within 1 min: serve, no refresh
const QUOTE_MAX_STALE_MS = 10 * 60 * 1000; // up to 10 min: serve stale + revalidate
const quoteInflight = new Map();

// Network only (no cache): Yahoo → CNBC.
async function loadQuote(symbol) {
  if (yahooAvailable()) {
    try {
      const q = await yahooQuote(symbol);
      if (q != null) return q;
    } catch {
      // fall through to CNBC
    }
  }
  return cnbcQuote(symbol);
}

// Deduplicated background/foreground refresh that updates the cache.
function revalidateQuote(symbol) {
  if (quoteInflight.has(symbol)) return quoteInflight.get(symbol);
  const p = (async () => {
    try {
      const q = await loadQuote(symbol);
      if (q != null) CACHE.set(`quote:${symbol}`, { value: q, at: Date.now() });
      return q;
    } finally {
      quoteInflight.delete(symbol);
    }
  })();
  quoteInflight.set(symbol, p);
  return p;
}

// Awaits any in-flight background refreshes. Call from routes via `after()`.
export function flushQuoteRevalidations() {
  return Promise.allSettled([...quoteInflight.values()]);
}

// Returns the full quote object { price, name, exchange, currency } (or null).
export async function fetchQuoteFull(ticker) {
  const symbol = String(ticker || "").trim().toUpperCase();
  if (!symbol) return null;

  const e = CACHE.get(`quote:${symbol}`);
  const age = e ? Date.now() - e.at : Infinity;
  if (e && age < QUOTE_FRESH_MS) return e.value;                 // fresh
  if (e && age < QUOTE_MAX_STALE_MS) { revalidateQuote(symbol); return e.value; } // stale: serve now, refresh in bg

  const fresh = await revalidateQuote(symbol);                   // miss/expired: block
  return fresh != null ? fresh : (e ? e.value : null);
}

// Convenience wrapper for callers that only need the price.
export async function fetchQuote(ticker) {
  const quote = await fetchQuoteFull(ticker);
  return quote?.price ?? null;
}

// Preço de ABERTURA do dia (open), sempre fresco (ignora a cache SWR) — usado no
// arranque oficial para fixar o baseline na abertura de mercado, não num valor antigo.
export async function fetchOpenFresh(ticker) {
  const symbol = String(ticker || "").trim().toUpperCase();
  if (!symbol) return null;
  const q = await loadQuote(symbol);
  return Number.isFinite(q?.open) ? q.open : null;
}

// Preço da sessão REGULAR, sempre fresco (ignora a cache SWR). Atenção: `regularMarketPrice`
// só é o FECHO do dia quando corrido DEPOIS do fecho de mercado — usado no passo 1 do
// arranque (trancar baselines no fecho de 30 jun, à noite). Durante a sessão é intraday.
export async function fetchCloseFresh(ticker) {
  const symbol = String(ticker || "").trim().toUpperCase();
  if (!symbol) return null;
  const q = await loadQuote(symbol);
  return Number.isFinite(q?.price) ? q.price : null;
}

// Daily close history. Returns [{date:'YYYY-MM-DD', close}] ascending, or null.
// Yahoo's chart 429s this IP for history, so we use Alpha Vantage (free key, but
// only 25 req/day) with a long 6h cache. Yahoo is tried first opportunistically.
const AV_HIST_TTL = 6 * 60 * 60 * 1000;

async function yahooHistory(symbol) {
  if (!yahooAvailable()) return null;
  try {
    const url = new URL(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yfPath(symbol)}`
    );
    url.searchParams.set("range", "1y");
    url.searchParams.set("interval", "1d");
    const data = await yahooJson(url.toString(), 3600);
    const result = data.chart?.result?.[0];
    const ts = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      if (!Number.isFinite(closes[i])) continue;
      out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: closes[i] });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

async function alphaVantageHistory(symbol) {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return null;
  try {
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${key}`;
    const res = await fetch(url, { next: { revalidate: 21600 }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = await res.json();
    const ts = data["Time Series (Daily)"];
    if (!ts) return null; // rate-limited / unknown symbol / API note
    const out = Object.entries(ts)
      .map(([date, v]) => ({ date, close: parseFloat(v["4. close"]) }))
      .filter((o) => Number.isFinite(o.close))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return out.length ? out : null;
  } catch {
    return null;
  }
}

// Maps Alpha Vantage's OVERVIEW "Sector" to the app's PT buckets. Unknown values
// keep a Title-cased version of the raw sector (never "Outros").
function mapAvSector(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return null;
  if (s.includes("TECH")) return "Tecnologia";
  if (s.includes("FINANC")) return "Financeiro";
  if (s.includes("COMMUNIC")) return "Comunicação";
  if (s.includes("CONSUM") || s.includes("TRADE") || s.includes("RETAIL")) return "Consumo";
  if (s.includes("HEALTH") || s.includes("LIFE SCIENCE") || s.includes("PHARMA")) return "Saúde";
  if (s.includes("ENERGY")) return "Energia";
  if (s.includes("INDUSTRI") || s.includes("MANUFACTUR") || s.includes("TRANSPORT")) return "Industrial";
  if (s.includes("REAL ESTATE")) return "Imobiliário";
  if (s.includes("UTILIT")) return "Utilities";
  if (s.includes("MATERIAL")) return "Materiais";
  return s.charAt(0) + s.slice(1).toLowerCase();
}

// Real sector for a ticker via Alpha Vantage OVERVIEW (free, 25/day). Cached 24h
// in-memory; persistence/learning happens in the DB at the route layer.
export async function fetchSector(ticker) {
  const symbol = String(ticker || "").trim().toUpperCase();
  if (!symbol) return null;
  const cacheKey = `sector:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached != null) return cached === "__NONE__" ? null : cached; // cache negativa
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return null;
  try {
    const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
    const res = await fetch(url, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) { setCached(cacheKey, "__NONE__", 30 * 60 * 1000); return null; }
    const data = await res.json();
    const sector = mapAvSector(data?.Sector);
    // Positivo: cache 24h. Sem setor (lixo/desconhecido/limite): cache negativa 30min
    // para não voltar a gastar quota do Alpha Vantage com o mesmo ticker.
    setCached(cacheKey, sector || "__NONE__", sector ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000);
    return sector;
  } catch {
    setCached(cacheKey, "__NONE__", 30 * 60 * 1000);
    return null;
  }
}

export async function fetchHistory(ticker) {
  const symbol = String(ticker || "").trim().toUpperCase();
  if (!symbol) return null;
  const cacheKey = `hist:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached != null) return cached;

  let out = await yahooHistory(symbol);
  if (!out) out = await alphaVantageHistory(symbol);
  if (!out) return null;

  setCached(cacheKey, out, AV_HIST_TTL);
  return out;
}

async function yahooSearch(q) {
  const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
  url.searchParams.set("q", q);
  url.searchParams.set("quotesCount", "8");
  url.searchParams.set("newsCount", "0");
  const data = await yahooJson(url.toString(), 3600);
  return (data.quotes || [])
    .filter((m) => m.symbol)
    .slice(0, 8)
    .map((m) => ({
      ticker: m.symbol,
      name: m.longname || m.shortname || m.symbol,
      exchange: m.exchDisp || m.exchange || "",
      type: m.quoteType || m.typeDisp || "",
      currency: m.currency || "USD",
    }));
}

export async function searchSymbols(keywords) {
  const q = String(keywords || "").trim();
  if (q.length < 1) return [];

  const cacheKey = `search:${q.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let results = [];
  if (yahooAvailable()) {
    try {
      results = await yahooSearch(q);
    } catch {
      // fall through to the local list
    }
  }

  if (!results.length) results = await searchTickerList(q);

  setCached(cacheKey, results);
  return results;
}
