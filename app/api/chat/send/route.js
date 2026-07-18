import { rateLimited } from "../../../lib/apiGuards";
import { authOwner } from "../../../lib/watchlistAuth";

// POST { name, pin, content } → publica uma mensagem no chat geral.
// Só quem submeteu (tem PIN); user_id e author_name vêm SEMPRE do servidor (authOwner + BD), nunca do browser.
export async function POST(request) {
  const rl = rateLimited(request, "chat-send", { max: 20, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos. Abranda um pouco." }, { status: 429 });

  let body; try { body = await request.json(); } catch { body = null; }
  const a = await authOwner(body?.name, body?.pin);
  if (a.error) return Response.json({ error: a.error }, { status: a.status });

  const content = String(body?.content || "").trim();
  if (!content) return Response.json({ error: "Escreve alguma coisa." }, { status: 400 });
  if (content.length > 500) return Response.json({ error: "Mensagem demasiado longa (máx. 500)." }, { status: 400 });

  // Nome canónico da BD (não o do browser) para o author_name congelado.
  const { data: user } = await a.supabase.from("users").select("telegram_name").eq("id", a.userId).maybeSingle();
  const authorName = String(user?.telegram_name || "Anónimo");

  const { data, error } = await a.supabase
    .from("chat_messages")
    .insert({ user_id: a.userId, author_name: authorName, content })
    .select("id, user_id, author_name, content, created_at, edited_at").maybeSingle();
  if (error || !data) return Response.json({ error: "Não foi possível publicar." }, { status: 500 });
  return Response.json({ ok: true, message: data });
}
