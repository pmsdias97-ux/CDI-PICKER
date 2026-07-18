import { rateLimited } from "../../../lib/apiGuards";
import { authOwner } from "../../../lib/watchlistAuth";
import { createNotification } from "../../../lib/notify";

// POST { name, pin, portfolioId, content } → cria um comentário num portefólio.
// Só quem submeteu (tem PIN); user_id vem SEMPRE do servidor (authOwner), nunca do browser.
export async function POST(request) {
  const rl = rateLimited(request, "comment-save", { max: 20, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos. Abranda um pouco." }, { status: 429 });

  let body; try { body = await request.json(); } catch { body = null; }
  const a = await authOwner(body?.name, body?.pin);
  if (a.error) return Response.json({ error: a.error }, { status: a.status });

  const portfolioId = String(body?.portfolioId || "").trim();
  const content = String(body?.content || "").trim();
  if (!portfolioId) return Response.json({ error: "Portefólio inválido." }, { status: 400 });
  if (!content) return Response.json({ error: "Escreve alguma coisa." }, { status: 400 });
  if (content.length > 500) return Response.json({ error: "Comentário demasiado longo (máx. 500)." }, { status: 400 });

  // Confirma que o portefólio existe (evita comentários órfãos). user_id = dono (p/ notificar).
  const { data: pf } = await a.supabase.from("portfolios").select("id, user_id").eq("id", portfolioId).maybeSingle();
  if (!pf) return Response.json({ error: "Portefólio não encontrado." }, { status: 404 });

  const { data, error } = await a.supabase
    .from("portfolio_comments")
    .insert({ portfolio_id: portfolioId, user_id: a.userId, content })
    .select("id, content, created_at, user_id").maybeSingle();
  if (error || !data) return Response.json({ error: "Não foi possível publicar o comentário." }, { status: 500 });

  // Notifica o DONO do perfil (nunca a si próprio).
  if (pf.user_id && pf.user_id !== a.userId) {
    const { data: me } = await a.supabase.from("users").select("telegram_name").eq("id", a.userId).maybeSingle();
    const who = String(me?.telegram_name || "Alguém");
    await createNotification(a.supabase, { userId: pf.user_id, type: "comment",
      title: `${who} comentou no teu perfil`, body: content.slice(0, 90), link: "mine", actorName: who });
  }
  return Response.json({ ok: true, comment: data });
}
