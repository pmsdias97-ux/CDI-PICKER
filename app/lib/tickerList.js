// Offline-ish fallback for ticker search when Yahoo Finance rate-limits us.
// Two layers:
//   1. A small curated list of popular names, always ranked first.
//   2. The SEC's full list of ~10k US-listed companies (static JSON, no API key),
//      fetched once and cached, so search-by-name works for virtually any US ticker
//      even while Yahoo is blocked.
// Non-US names (e.g. "Galp") won't appear here, but any valid symbol (GALP.LS) can
// still be added manually in the UI.

const CURATED = [
  ["AAPL", "Apple Inc.", "NASDAQ"],
  ["MSFT", "Microsoft Corporation", "NASDAQ"],
  ["GOOGL", "Alphabet Inc. (Google) Class A", "NASDAQ"],
  ["GOOG", "Alphabet Inc. (Google) Class C", "NASDAQ"],
  ["AMZN", "Amazon.com Inc.", "NASDAQ"],
  ["META", "Meta Platforms Inc. (Facebook)", "NASDAQ"],
  ["NVDA", "NVIDIA Corporation", "NASDAQ"],
  ["TSLA", "Tesla Inc.", "NASDAQ"],
  ["BRK.B", "Berkshire Hathaway Inc. Class B", "NYSE"],
  ["JPM", "JPMorgan Chase & Co.", "NYSE"],
  ["V", "Visa Inc.", "NYSE"],
  ["MA", "Mastercard Incorporated", "NYSE"],
  ["JNJ", "Johnson & Johnson", "NYSE"],
  ["WMT", "Walmart Inc.", "NYSE"],
  ["PG", "Procter & Gamble Company", "NYSE"],
  ["HD", "Home Depot Inc.", "NYSE"],
  ["BAC", "Bank of America Corporation", "NYSE"],
  ["KO", "Coca-Cola Company", "NYSE"],
  ["PEP", "PepsiCo Inc.", "NASDAQ"],
  ["COST", "Costco Wholesale Corporation", "NASDAQ"],
  ["DIS", "Walt Disney Company", "NYSE"],
  ["NFLX", "Netflix Inc.", "NASDAQ"],
  ["ADBE", "Adobe Inc.", "NASDAQ"],
  ["CRM", "Salesforce Inc.", "NYSE"],
  ["INTC", "Intel Corporation", "NASDAQ"],
  ["AMD", "Advanced Micro Devices Inc.", "NASDAQ"],
  ["QCOM", "Qualcomm Incorporated", "NASDAQ"],
  ["ORCL", "Oracle Corporation", "NYSE"],
  ["CSCO", "Cisco Systems Inc.", "NASDAQ"],
  ["PFE", "Pfizer Inc.", "NYSE"],
  ["MRK", "Merck & Co. Inc.", "NYSE"],
  ["ABBV", "AbbVie Inc.", "NYSE"],
  ["NKE", "Nike Inc.", "NYSE"],
  ["MCD", "McDonald's Corporation", "NYSE"],
  ["XOM", "Exxon Mobil Corporation", "NYSE"],
  ["CVX", "Chevron Corporation", "NYSE"],
  ["BA", "Boeing Company", "NYSE"],
  ["PYPL", "PayPal Holdings Inc.", "NASDAQ"],
  ["SBUX", "Starbucks Corporation", "NASDAQ"],
  ["UBER", "Uber Technologies Inc.", "NYSE"],
  ["ABNB", "Airbnb Inc.", "NASDAQ"],
  ["SHOP", "Shopify Inc.", "NYSE"],
  ["PLTR", "Palantir Technologies Inc.", "NASDAQ"],
  ["COIN", "Coinbase Global Inc.", "NASDAQ"],
  ["BABA", "Alibaba Group Holding Limited", "NYSE"],
  ["SPOT", "Spotify Technology S.A.", "NYSE"],
  ["AVGO", "Broadcom Inc.", "NASDAQ"],
  ["LLY", "Eli Lilly and Company", "NYSE"],
  ["UNH", "UnitedHealth Group Incorporated", "NYSE"],
  ["JPM", "JPMorgan Chase & Co.", "NYSE"],
  ["IBM", "International Business Machines Corporation", "NYSE"],
  ["SPY", "SPDR S&P 500 ETF Trust", "NYSE Arca"],
  ["QQQ", "Invesco QQQ Trust", "NASDAQ"],
  ["VOO", "Vanguard S&P 500 ETF", "NYSE Arca"],
  ["VTI", "Vanguard Total Stock Market ETF", "NYSE Arca"],
];

const ETF_TICKERS = new Set(["SPY", "QQQ", "VOO", "VTI"]);

function shape(ticker, name, exchange) {
  return {
    ticker,
    name,
    exchange,
    type: ETF_TICKERS.has(ticker) ? "ETF" : "EQUITY",
    currency: "USD",
  };
}

function rank(ticker, name, q) {
  const t = ticker.toLowerCase();
  const n = name.toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (n.startsWith(q)) return 2;
  if (n.includes(q) || t.includes(q)) return 3;
  return -1;
}

function searchCurated(q) {
  const scored = [];
  for (const [ticker, name, exchange] of CURATED) {
    const score = rank(ticker, name, q);
    if (score >= 0) scored.push({ ticker, name, exchange, score });
  }
  scored.sort((a, b) => a.score - b.score || a.ticker.localeCompare(b.ticker));
  return scored.map(({ ticker, name, exchange }) => shape(ticker, name, exchange));
}

// --- SEC full list (lazy, cached) ---
let secIndex = null; // [{ ticker, name }]
let secLoadedAt = 0;
let secLoading = null;
const SEC_TTL_MS = 24 * 60 * 60 * 1000;

function titleCase(s) {
  // SEC titles are often ALL CAPS ("AMAZON COM INC"). Prettify those; leave
  // already-mixed-case titles ("Alphabet Inc.") untouched.
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Inc|Corp|Ltd|Plc|Co|Llc|Sa|Nv|Ag)\b/g, (m) => m);
}

async function loadSecIndex() {
  if (secIndex && Date.now() - secLoadedAt < SEC_TTL_MS) return secIndex;
  if (secLoading) return secLoading;

  secLoading = (async () => {
    const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
      // SEC asks for a descriptive User-Agent with contact info.
      headers: {
        "User-Agent": "conversas-investidores plataformas@conversasdeinvestidores.com",
        Accept: "application/json",
      },
      next: { revalidate: 86400 },
    });
    if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
    const data = await res.json();
    secIndex = Object.values(data).map((v) => ({
      ticker: String(v.ticker || "").toUpperCase(),
      name: titleCase(String(v.title || "")),
    }));
    secLoadedAt = Date.now();
    return secIndex;
  })();

  try {
    return await secLoading;
  } finally {
    secLoading = null;
  }
}

async function searchSec(q) {
  const idx = await loadSecIndex();
  const scored = [];
  for (const { ticker, name } of idx) {
    const score = rank(ticker, name, q);
    if (score >= 0) scored.push({ ticker, name, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.ticker.length - b.ticker.length ||
      a.ticker.localeCompare(b.ticker)
  );
  return scored.slice(0, 12).map(({ ticker, name }) => shape(ticker, name, "US"));
}

// Curated matches first (popular names float to the top), then the full SEC
// universe fills the rest. Falls back to curated-only if the SEC list is down.
export async function searchTickerList(keywords) {
  const q = String(keywords || "").trim().toLowerCase();
  if (!q) return [];

  const curated = searchCurated(q);
  let sec = [];
  try {
    sec = await searchSec(q);
  } catch {
    // SEC list unavailable — curated results still stand.
  }

  const seen = new Set(curated.map((r) => r.ticker));
  const merged = [...curated];
  for (const r of sec) {
    if (!seen.has(r.ticker)) {
      seen.add(r.ticker);
      merged.push(r);
    }
  }
  return merged.slice(0, 8);
}
