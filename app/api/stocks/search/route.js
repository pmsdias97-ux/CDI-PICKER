import { searchSymbols } from "../../../lib/marketData";

export async function GET(request) {
  const q = new URL(request.url).searchParams.get("q");
  if (!q?.trim()) {
    return Response.json({ results: [] });
  }

  try {
    const results = await searchSymbols(q);
    return Response.json({ results });
  } catch (err) {
    return Response.json({ error: err.message || "Erro na pesquisa.", results: [] }, { status: 502 });
  }
}
