import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

// Todos os portefólios COM as ações (service_role) — só para o admin autenticado.
// Necessário porque a leitura pública (anon) das ações dos oficiais está fechada
// até a competição arrancar; o admin continua a precisar de ver/exportar tudo.
export async function POST(request) {
  const rl = rateLimited(request, "admin-portfolios", { max: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!checkAdminPassword(body?.password)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { data, error } = await supabase
    .from("portfolios")
    .select(`
      id, user_id, created_at, locked, initial_value, spy_initial_price, official,
      users!portfolios_user_id_fkey ( telegram_name, has_submitted_portfolio ),
      portfolio_stocks ( ticker, company_name, initial_price, current_price, initial_weight, side, currency )
    `);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, portfolios: data || [] });
}
