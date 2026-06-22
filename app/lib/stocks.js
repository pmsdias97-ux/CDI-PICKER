export async function fetchStockPrice(ticker) {
  const res = await fetch(`/api/stocks/price?ticker=${encodeURIComponent(ticker)}`);
  const data = await res.json();
  if (!res.ok || typeof data.price !== "number") return null;
  return data.price;
}

// Returns { price, name, exchange, currency } for a ticker, or null if it has
// no quote. Used to resolve the full company name for any ticker, even ones not
// present in the search index.
export async function fetchStockInfo(ticker) {
  const res = await fetch(`/api/stocks/price?ticker=${encodeURIComponent(ticker)}`);
  const data = await res.json();
  if (!res.ok || typeof data.price !== "number") return null;
  return {
    price: data.price,
    name: data.name || null,
    exchange: data.exchange || null,
    currency: data.currency || null,
  };
}

// Devolve { prices, changes } — changes = variação do dia (vs fecho anterior).
export async function fetchStockPrices(tickers) {
  const unique = [...new Set(
    tickers.map((t) => String(t || "").trim().toUpperCase()).filter(Boolean)
  )];
  if (!unique.length) return { prices: {}, changes: {} };

  const res = await fetch(`/api/stocks/prices?tickers=${encodeURIComponent(unique.join(","))}`);
  const data = await res.json();
  if (!res.ok) return { prices: {}, changes: {} };
  return { prices: data.prices || {}, changes: data.changes || {} };
}

// Daily close history [{date,close}] for a ticker (used for the S&P benchmark).
export async function fetchStockHistory(ticker) {
  try {
    const res = await fetch(`/api/stocks/history?ticker=${encodeURIComponent(ticker)}`);
    const data = await res.json();
    if (!res.ok) return [];
    return data.history || [];
  } catch {
    return [];
  }
}

export async function searchTickers(query) {
  const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  if (!res.ok) return [];
  return data.results || [];
}
