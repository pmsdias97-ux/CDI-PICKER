import { rateLimited } from "../../../lib/apiGuards";
import { authOwner } from "../../../lib/watchlistAuth";
import { createNotification } from "../../../lib/notify";

// POST { name, pin, content, replyTo? } → publica uma mensagem no chat geral.
// Só quem submeteu (tem PIN); user_id e author_name vêm SEMPRE do servidor. `replyTo` = id da mensagem
// citada (guardamos nome+excerto desnormalizados). @menções a membros geram notificação.
export async function POST(request) {
  const rl = rateLimited(request, "chat-send", { max: 20, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos. Abranda um pouco." }, { status: 429 });

  let body; try { body = await request.json(); } catch { body = null; }
  const a = await authOwner(body?.name, body?.pin);
  if (a.error) return Response.json({ error: a.error }, { status: a.status });

  const content = String(body?.content || "").trim();
  if (!content) return Response.json({ error: "Escreve alguma coisa." }, { status: 400 });
  if (content.length > 500) return Response.json({ error: "Mensagem demasiado longa (máx. 500)." }, { status: 400 });

  const { data: user } = await a.supabase.from("users").select("telegram_name").eq("id", a.userId).maybeSingle();
  const authorName = String(user?.telegram_name || "Anónimo");

  // Resposta (quote): busca a mensagem citada e desnormaliza nome + excerto.
  const row = { user_id: a.userId, author_name: authorName, content };
  const replyTo = String(body?.replyTo || "").trim();
  if (replyTo) {
    const { data: orig } = await a.supabase.from("chat_messages").select("id, author_name, content").eq("id", replyTo).maybeSingle();
    if (orig) { row.reply_to = orig.id; row.reply_to_name = orig.author_name; row.reply_to_excerpt = String(orig.content || "").slice(0, 90); }
  }

  const { data, error } = await a.supabase
    .from("chat_messages").insert(row)
    .select("id, user_id, author_name, content, created_at, edited_at, reply_to, reply_to_name, reply_to_excerpt").maybeSingle();
  if (error || !data) return Response.json({ error: "Não foi possível publicar." }, { status: 500 });

  // @menções → notifica os membros mencionados (pelo nome, com @ à frente; nunca a si próprio).
  try {
    const lc = content.toLowerCase();
    if (lc.includes("@")) {
      const { data: members } = await a.supabase.from("users").select("id, telegram_name").eq("has_submitted_portfolio", true);
      for (const m of members || []) {
        const nm = String(m.telegram_name || "").trim();
        if (!nm || m.id === a.userId) continue;
        if (lc.includes("@" + nm.toLowerCase())) {
          await createNotification(a.supabase, { userId: m.id, type: "mention",
            title: `${authorName} mencionou-te no chat`, body: content.slice(0, 90), link: "chat", actorName: authorName });
        }
      }
    }
  } catch { /* best-effort */ }

  return Response.json({ ok: true, message: data });
}
