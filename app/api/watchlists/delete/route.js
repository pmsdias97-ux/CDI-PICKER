import { rateLimited } from "../../../lib/apiGuards";
import { authOwner } from "../../../lib/watchlistAuth";

// Apaga uma watchlist do utilizador. POST { name, pin, id }.
export async function POST(request) {
  const rl = rateLimited(request, "wl-del", { max: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body; try { body = await request.json(); } catch { body = null; }
  const a = await authOwner(body?.name, body?.pin);
  if (a.error) return Response.json({ error: a.error }, { status: a.status });

  const id = String(body?.id || "");
  if (!id) return Response.json({ error: "Falta o id da lista." }, { status: 400 });

  const { error } = await a.supabase.from("watchlists")
    .delete().eq("id", id).eq("user_id", a.userId);
  if (error) return Response.json({ error: "Não foi possível apagar a lista." }, { status: 500 });

  return Response.json({ ok: true });
}
