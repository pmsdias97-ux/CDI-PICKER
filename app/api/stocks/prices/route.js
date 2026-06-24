import { after } from "next/server";
import { fetchQuoteFull, flushQuoteRevalidations } from "../../../lib/marketData";
import { isValidTicker, rateLimited } from "../../../lib/apiGuards";

export async function GET(request) {
  // Let any stale-while-revalidate background refreshes finish after the response.
  after(() => flushQuoteRevalidations());

  const rl = rateLimited(request, "stocks-prices", { max: 60, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  const raw = new URL(request.url).searchParams.get("tickers") || "";
  const tickers = [...new Set(
    raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
  )].filter(isValidTicker).slice(0, 300);

  if (!tickers.length) {
    return Response.json({ prices: {}, changes: {}, errors: {} });
  }

  const prices = {};
  const changes = {}; // variação do dia (preço atual vs fecho anterior)
  const errors = {};

  for (const ticker of tickers) {
    try {
      const q = await fetchQuoteFull(ticker);
      if (q?.price == null) { errors[ticker] = "not_found"; continue; }
      prices[ticker] = q.price;
      if (Number.isFinite(q.prevClose) && q.prevClose > 0) changes[ticker] = q.price / q.prevClose - 1;
    } catch (err) {
      errors[ticker] = err.message || "fetch_failed";
    }
  }

  return Response.json({ prices, changes, errors });
}
