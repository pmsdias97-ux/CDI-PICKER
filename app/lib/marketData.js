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
let lastFetchAt = 0;

const YAHOO_COOLDOWN_MS = 5 * 60 * 1000;
let yahooCooldownUntil = 0;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function getCached(key) {
  const entry = CACHE.get(key);
  if (entry && Date.now() - entry.at < CACHE_TTL_MS) return entry.value;
  return null;
}

function setCached(key, value) {
  CACHE.set(key, { value, at: Date.now() });
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
  });
  if (res.status === 429 || res.status >= 500) {
    tripYahooBreaker();
    throw new Error(`Yahoo Finance HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
  return res.json();
}

async function yahooQuote(symbol) {
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
  );
  url.searchParams.set("range", "1d");
  url.searchParams.set("interval", "1d");
  const data = await yahooJson(url.toString(), 300);
  if (data.chart?.error) throw new Error(data.chart.error.description || "Yahoo error");
  const meta = data.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (!Number.isFinite(price)) return null;
  return {
    price,
    name: meta?.longName || meta?.shortName || null,
    exchange: meta?.fullExchangeName || meta?.exchangeName || null,
    currency: meta?.currency || null,
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
  });
  if (!res.ok) throw new Error(`CNBC HTTP ${res.status}`);
  const data = await res.json();
  const quote = data?.FormattedQuoteResult?.FormattedQuote?.[0];
  if (!quote || quote.code !== 0) return null;
  const price = parseFloat(String(quote.last).replace(/,/g, ""));
  if (!Number.isFinite(price)) return null;
  return {
    price,
    name: quote.name || quote.shortName || null,
    exchange: quote.exchange || quote.exchangeName || null,
    currency: quote.currencyCode || null,
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

// Returns the full quote object { price, name, exchange, currency } (or null).
export async function fetchQuoteFull(ticker) {
  const symbol = String(ticker || "").trim().toUpperCase();
  if (!symbol) return null;

  const cacheKey = `quote:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached != null) return cached;

  if (yahooAvailable()) {
    try {
      const quote = await yahooQuote(symbol);
      if (quote != null) {
        setCached(cacheKey, quote);
        return quote;
      }
    } catch {
      // fall through to CNBC
    }
  }

  const quote = await cnbcQuote(symbol);
  if (quote != null) setCached(cacheKey, quote);
  return quote;
}

// Convenience wrapper for callers that only need the price.
export async function fetchQuote(ticker) {
  const quote = await fetchQuoteFull(ticker);
  return quote?.price ?? null;
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
