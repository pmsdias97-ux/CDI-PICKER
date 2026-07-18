import { rateLimited } from "../../../lib/apiGuards";
import { authOwner } from "../../../lib/watchlistAuth";

// POST { name, pin, id, content } → edita a PRÓPRIA mensagem, só dentro da janela de tempo
// (para corrigir gralhas). user_id vem do servidor; só edita se for do autor e ainda a tempo.
const EDIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutos

export async function POST(request) {
  const rl = rateLimited(request, "chat-edit", { max: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body; try { body = await request.json(); } catch { body = null; }
  const a = await authOwner(body?.name, body?.pin);
  if (a.error) return Response.json({ error: a.error }, { status: a.status });

  const id = String(body?.id || "").trim();
  const content = String(body?.content || "").trim();
  if (!id) return Response.json({ error: "Mensagem inválida." }, { status: 400 });
  if (!content) return Response.json({ error: "Escreve alguma coisa." }, { status: 400 });
  if (content.length > 500) return Response.json({ error: "Mensagem demasiado longa (máx. 500)." }, { status: 400 });

  const { data: msg } = await a.supabase
    .from("chat_messages").select("user_id, created_at").eq("id", id).maybeSingle();
  if (!msg) return Response.json({ error: "Mensagem não encontrada." }, { status: 404 });
  if (msg.user_id !== a.userId) return Response.json({ error: "Só podes editar as tuas mensagens." }, { status: 403 });
  if (Date.now() - new Date(msg.created_at).getTime() > EDIT_WINDOW_MS) {
    return Response.json({ error: "Já não é possível editar esta mensagem." }, { status: 403 });
  }

  const { data, error } = await a.supabase
    .from("chat_messages").update({ content, edited_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", a.userId)
    .select("id, user_id, author_name, content, created_at, edited_at").maybeSingle();
  if (error || !data) return Response.json({ error: "Não foi possível editar." }, { status: 500 });
  return Response.json({ ok: true, message: data });
}
