import { fetchQuote } from "../../../lib/marketData";
import { isValidTicker, rateLimited } from "../../../lib/apiGuards";

export async function GET(request) {
  const rl = rateLimited(request, "stocks-prices", { max: 60, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  const raw = new URL(request.url).searchParams.get("tickers") || "";
  const tickers = [...new Set(
    raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
  )].filter(isValidTicker).slice(0, 100);

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
