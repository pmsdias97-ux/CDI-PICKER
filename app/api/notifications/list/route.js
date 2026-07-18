import { rateLimited } from "../../../lib/apiGuards";
import { authOwner } from "../../../lib/watchlistAuth";

// POST { name, pin } → as MINHAS notificações (últimas 30) + contagem de não-lidas.
// Privado: só via authOwner (name+pin) → service_role filtra por user_id do próprio.
export async function POST(request) {
  const rl = rateLimited(request, "notif-list", { max: 120, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body; try { body = await request.json(); } catch { body = null; }
  const a = await authOwner(body?.name, body?.pin);
  if (a.error) return Response.json({ error: a.error }, { status: a.status });

  const { data } = await a.supabase
    .from("notifications")
    .select("id, type, title, body, link, actor_name, read, created_at")
    .eq("user_id", a.userId)
    .order("created_at", { ascending: false })
    .limit(30);
  const { count } = await a.supabase
    .from("notifications").select("id", { count: "exact", head: true })
    .eq("user_id", a.userId).eq("read", false);

  return Response.json({ ok: true, notifications: data || [], unread: count || 0 });
}
