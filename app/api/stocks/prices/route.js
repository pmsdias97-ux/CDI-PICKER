import { fetchQuote } from "../../../lib/marketData";

export async function GET(request) {
  const raw = new URL(request.url).searchParams.get("tickers") || "";
  const tickers = [...new Set(
    raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
  )];

  if (!tickers.length) {
    return Response.json({ prices: {}, errors: {} });
  }

  const prices = {};
  const errors = {};

  for (const ticker of tickers) {
    try {
      const price = await fetchQuote(ticker);
      if (price == null) errors[ticker] = "not_found";
      else prices[ticker] = price;
    } catch (err) {
      errors[ticker] = err.message || "fetch_failed";
    }
  }

  return Response.json({ prices, errors });
}
