import { fetchQuote } from "../../../lib/marketData";

export async function GET(request) {
  const ticker = new URL(request.url).searchParams.get("ticker");
  if (!ticker?.trim()) {
    return Response.json({ error: "Ticker em falta." }, { status: 400 });
  }

  try {
    const price = await fetchQuote(ticker);
    if (price == null) {
      return Response.json({ error: "Preço não encontrado para este ticker." }, { status: 404 });
    }
    return Response.json({ ticker: ticker.trim().toUpperCase(), price });
  } catch (err) {
    return Response.json({ error: err.message || "Erro ao obter preço." }, { status: 502 });
  }
}
