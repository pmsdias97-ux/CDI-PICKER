import { rateLimited } from "../../../lib/apiGuards";
import { authOwner } from "../../../lib/watchlistAuth";
import { createNotification } from "../../../lib/notify";

// POST { name, pin, messageId, emoji } → alterna uma reação a uma mensagem do chat
// (1 por pessoa por emoji por mensagem; a PK garante-o). user_id/user_name vêm SEMPRE do
// servidor (authOwner + BD), nunca do browser. Só emojis da lista permitida. Não se reage à própria.
const ALLOWED = new Set(["❤️", "🔥", "😂"]);

export async function POST(request) {
  const rl = rateLimited(request, "chat-react", { max: 90, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body; try { body = await request.json(); } catch { body = null; }
  const a = await authOwner(body?.name, body?.pin);
  if (a.error) return Response.json({ error: a.error }, { status: a.status });

  const messageId = String(body?.messageId || "").trim();
  const emoji = String(body?.emoji || "");
  if (!messageId) return Response.json({ error: "Mensagem inválida." }, { status: 400 });
  if (!ALLOWED.has(emoji)) return Response.json({ error: "Reação inválida." }, { status: 400 });

  // Não se pode reagir à PRÓPRIA mensagem (autor vem da BD, não do browser).
  const { data: msg } = await a.supabase
    .from("chat_messages").select("user_id").eq("id", messageId).maybeSingle();
  if (!msg) return Response.json({ error: "Mensagem não encontrada." }, { status: 404 });
  if (msg.user_id === a.userId) return Response.json({ error: "Não podes reagir à tua própria mensagem." }, { status: 403 });

  const { data: existing } = await a.supabase
    .from("chat_message_reactions").select("message_id")
    .eq("message_id", messageId).eq("user_id", a.userId).eq("emoji", emoji).maybeSingle();

  if (existing) {
    const { error } = await a.supabase.from("chat_message_reactions")
      .delete().eq("message_id", messageId).eq("user_id", a.userId).eq("emoji", emoji);
    if (error) return Response.json({ error: "Não foi possível remover a reação." }, { status: 500 });
    return Response.json({ ok: true, reacted: false });
  }
  const { data: user } = await a.supabase.from("users").select("telegram_name").eq("id", a.userId).maybeSingle();
  const who = String(user?.telegram_name || "Anónimo");
  const { error } = await a.supabase.from("chat_message_reactions")
    .insert({ message_id: messageId, user_id: a.userId, user_name: who, emoji });
  if (error && error.code !== "23505") return Response.json({ error: "Não foi possível reagir." }, { status: 500 });
  // Notifica o AUTOR da mensagem (só ao adicionar; nunca a si próprio — já garantido acima).
  await createNotification(a.supabase, { userId: msg.user_id, type: "reaction",
    title: `${who} reagiu ${emoji} à tua mensagem`, link: "chat", actorName: who });
  return Response.json({ ok: true, reacted: true });
}
