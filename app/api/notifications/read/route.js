import { rateLimited } from "../../../lib/apiGuards";
import { authOwner } from "../../../lib/watchlistAuth";

// POST { name, pin, ids? } → marca notificações como lidas. Sem `ids` → marca TODAS as minhas não-lidas.
export async function POST(request) {
  const rl = rateLimited(request, "notif-read", { max: 60, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body; try { body = await request.json(); } catch { body = null; }
  const a = await authOwner(body?.name, body?.pin);
  if (a.error) return Response.json({ error: a.error }, { status: a.status });

  const ids = Array.isArray(body?.ids) ? body.ids.map(String).filter(Boolean) : null;
  // read_at = agora → permite ordenar "quem leu" por recência. Só toca em não-lidas (não sobrescreve).
  const runUpdate = (patch) => {
    let q = a.supabase.from("notifications").update(patch).eq("user_id", a.userId).eq("read", false);
    if (ids && ids.length) q = a.supabase.from("notifications").update(patch).eq("user_id", a.userId).in("id", ids).eq("read", false);
    return q;
  };
  let { error } = await runUpdate({ read: true, read_at: new Date().toISOString() });
  if (error) ({ error } = await runUpdate({ read: true })); // fallback se a coluna read_at ainda não existir
  if (error) return Response.json({ error: "Não foi possível marcar como lidas." }, { status: 500 });
  return Response.json({ ok: true });
}
