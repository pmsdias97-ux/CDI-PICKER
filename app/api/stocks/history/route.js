import { fetchHistory } from "../../../lib/marketData";
import { isValidTicker, rateLimited } from "../../../lib/apiGuards";

export async function GET(request) {
  const rl = rateLimited(request, "stocks-history", { max: 40, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  const ticker = new URL(request.url).searchParams.get("ticker");
  if (!ticker?.trim() || !isValidTicker(ticker)) {
    return Response.json({ error: "Ticker inválido." }, { status: 400 });
  }

  try {
    const history = await fetchHistory(ticker);
    return Response.json({ ticker: ticker.trim().toUpperCase(), history: history || [] });
  } catch (err) {
    return Response.json({ error: err.message || "Erro ao obter histórico.", history: [] }, { status: 502 });
  }
}
