import { searchSymbols } from "../../../lib/marketData";
import { rateLimited } from "../../../lib/apiGuards";

export const maxDuration = 20;

export async function GET(request) {
  const rl = rateLimited(request, "stocks-search", { max: 90, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos.", results: [] }, { status: 429 });

  const q = (new URL(request.url).searchParams.get("q") || "").slice(0, 60);
  if (!q.trim()) {
    return Response.json({ results: [] });
  }

  try {
    const results = await searchSymbols(q);
    return Response.json({ results });
  } catch (err) {
    return Response.json({ error: err.message || "Erro na pesquisa.", results: [] }, { status: 502 });
  }
}
