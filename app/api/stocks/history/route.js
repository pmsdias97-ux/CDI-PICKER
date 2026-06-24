import { fetchHistory } from "../../../lib/marketData";
import { isValidTicker, rateLimited } from "../../../lib/apiGuards";

export const maxDuration = 30;

// O histórico só é usado para o benchmark (S&P 500) — restringir a um conjunto
// fixo evita que tickers arbitrários esgotem a quota grátis do Alpha Vantage.
const HISTORY_ALLOWED = new Set(["SPY", "VOO", "IVV", "QQQ", "DIA"]);

export async function GET(request) {
  const rl = rateLimited(request, "stocks-history", { max: 40, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  const ticker = new URL(request.url).searchParams.get("ticker");
  if (!ticker?.trim() || !isValidTicker(ticker)) {
    return Response.json({ error: "Ticker inválido." }, { status: 400 });
  }
  if (!HISTORY_ALLOWED.has(ticker.trim().toUpperCase())) {
    return Response.json({ ticker: ticker.trim().toUpperCase(), history: [] });
  }

  try {
    const history = await fetchHistory(ticker);
    return Response.json({ ticker: ticker.trim().toUpperCase(), history: history || [] });
  } catch (err) {
    return Response.json({ error: err.message || "Erro ao obter histórico.", history: [] }, { status: 502 });
  }
}
