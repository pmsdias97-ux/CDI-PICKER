import { rateLimited } from "../../../lib/apiGuards";
import { authOwner } from "../../../lib/watchlistAuth";

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

  // Confirma que o portefólio existe (evita comentários órfãos).
  const { data: pf } = await a.supabase.from("portfolios").select("id").eq("id", portfolioId).maybeSingle();
  if (!pf) return Response.json({ error: "Portefólio não encontrado." }, { status: 404 });

  const { data, error } = await a.supabase
    .from("portfolio_comments")
    .insert({ portfolio_id: portfolioId, user_id: a.userId, content })
    .select("id, content, created_at, user_id").maybeSingle();
  if (error || !data) return Response.json({ error: "Não foi possível publicar o comentário." }, { status: 500 });
  return Response.json({ ok: true, comment: data });
}
