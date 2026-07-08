import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

// Últimos comentários que os membros escreveram em perfis de OUTROS membros (para o cartão
// "Últimos comentários" no rail do Ranking). Leitura via service_role (evita RLS/anon + privacidade
// pré-lançamento); só expõe conteúdo/nome (já públicos no mural) + o portefólio-alvo para navegar.
export async function GET() {
  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { data, error } = await supabase
    .from("portfolio_comments")
    .select(
      "id, content, created_at, user_id, portfolio_id," +
      " users!portfolio_comments_user_id_fkey(telegram_name)," +
      " portfolios!portfolio_comments_portfolio_id_fkey(user_id, users!portfolios_user_id_fkey(telegram_name))"
    )
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const comments = [];
  for (const c of data || []) {
    const ownerId = c.portfolios?.user_id;
    if (!ownerId || ownerId === c.user_id) continue; // só comentários em perfis de OUTROS
    comments.push({
      id: c.id,
      content: c.content,
      created_at: c.created_at,
      author: c.users?.telegram_name || "Anónimo",
      targetName: c.portfolios?.users?.telegram_name || "Anónimo",
      portfolioId: c.portfolio_id,
    });
    if (comments.length >= 15) break;
  }
  return Response.json({ comments });
}
