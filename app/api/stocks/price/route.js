import { after } from "next/server";
import { fetchQuoteFull, flushQuoteRevalidations } from "../../../lib/marketData";
import { isValidTicker, rateLimited } from "../../../lib/apiGuards";

export async function GET(request) {
  after(() => flushQuoteRevalidations());

  const rl = rateLimited(request, "stocks-price", { max: 60, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  const ticker = new URL(request.url).searchParams.get("ticker");
  if (!ticker?.trim()) {
    return Response.json({ error: "Ticker em falta." }, { status: 400 });
  }
  if (!isValidTicker(ticker)) {
    return Response.json({ error: "Ticker inválido." }, { status: 400 });
  }

  try {
    const quote = await fetchQuoteFull(ticker);
    if (quote == null) {
      return Response.json({ error: "Preço não encontrado para este ticker." }, { status: 404 });
    }
    return Response.json({
      ticker: ticker.trim().toUpperCase(),
      price: quote.price,
      name: quote.name || null,
      exchange: quote.exchange || null,
      currency: quote.currency || null,
    });
  } catch (err) {
    return Response.json({ error: err.message || "Erro ao obter preço." }, { status: 502 });
  }
}
