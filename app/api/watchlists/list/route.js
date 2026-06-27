import { rateLimited } from "../../../lib/apiGuards";
import { authOwner } from "../../../lib/watchlistAuth";

// Devolve todas as watchlists do utilizador. POST { name, pin }.
export async function POST(request) {
  const rl = rateLimited(request, "wl-list", { max: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body; try { body = await request.json(); } catch { body = null; }
  const a = await authOwner(body?.name, body?.pin);
  if (a.error) return Response.json({ error: a.error }, { status: a.status });

  const { data, error } = await a.supabase.from("watchlists")
    .select("id, list_name, tickers").eq("user_id", a.userId)
    .order("created_at", { ascending: true });
  if (error) return Response.json({ error: "Erro ao obter as listas." }, { status: 500 });

  const lists = (data || []).map(l => ({
    id: l.id, name: l.list_name, tickers: Array.isArray(l.tickers) ? l.tickers : [],
  }));
  return Response.json({ ok: true, lists });
}
