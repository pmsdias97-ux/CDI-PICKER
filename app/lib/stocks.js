export async function fetchStockPrice(ticker) {
  const res = await fetch(`/api/stocks/price?ticker=${encodeURIComponent(ticker)}`);
  const data = await res.json();
  if (!res.ok || typeof data.price !== "number") return null;
  return data.price;
}

export async function fetchStockPrices(tickers) {
  const unique = [...new Set(
    tickers.map((t) => String(t || "").trim().toUpperCase()).filter(Boolean)
  )];
  if (!unique.length) return {};

  const res = await fetch(`/api/stocks/prices?tickers=${encodeURIComponent(unique.join(","))}`);
  const data = await res.json();
  if (!res.ok) return {};
  return data.prices || {};
}

export async function searchTickers(query) {
  const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  if (!res.ok) return [];
  return data.results || [];
}
