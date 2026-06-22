import { fetchQuoteFull } from "../../../lib/marketData";

export async function GET(request) {
  const ticker = new URL(request.url).searchParams.get("ticker");
  if (!ticker?.trim()) {
    return Response.json({ error: "Ticker em falta." }, { status: 400 });
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
