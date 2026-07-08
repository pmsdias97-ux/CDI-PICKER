import { rateLimited } from "../../../lib/apiGuards";
import { authOwner } from "../../../lib/watchlistAuth";

// POST { name, pin, commentId, emoji } → alterna uma reação a um comentário
// (1 por pessoa por emoji por comentário; a PK garante-o). user_id vem SEMPRE do
// servidor (authOwner), nunca do browser. Só emojis da lista permitida.
const ALLOWED = new Set(["❤️", "🔥", "😂"]);

export async function POST(request) {
  const rl = rateLimited(request, "comment-react", { max: 90, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body; try { body = await request.json(); } catch { body = null; }
  const a = await authOwner(body?.name, body?.pin);
  if (a.error) return Response.json({ error: a.error }, { status: a.status });

  const commentId = String(body?.commentId || "").trim();
  const emoji = String(body?.emoji || "");
  if (!commentId) return Response.json({ error: "Comentário inválido." }, { status: 400 });
  if (!ALLOWED.has(emoji)) return Response.json({ error: "Reação inválida." }, { status: 400 });

  const { data: existing } = await a.supabase
    .from("comment_reactions").select("comment_id")
    .eq("comment_id", commentId).eq("user_id", a.userId).eq("emoji", emoji).maybeSingle();

  if (existing) {
    const { error } = await a.supabase.from("comment_reactions")
      .delete().eq("comment_id", commentId).eq("user_id", a.userId).eq("emoji", emoji);
    if (error) return Response.json({ error: "Não foi possível remover a reação." }, { status: 500 });
    return Response.json({ ok: true, reacted: false });
  }
  const { error } = await a.supabase.from("comment_reactions")
    .insert({ comment_id: commentId, user_id: a.userId, emoji });
  if (error && error.code !== "23505") return Response.json({ error: "Não foi possível reagir." }, { status: 500 });
  return Response.json({ ok: true, reacted: true });
}
