import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

export async function POST(request) {
  const rl = rateLimited(request, "admin-delete", { max: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!checkAdminPassword(body?.password)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const portfolioId = body?.portfolioId;
  const userId = body?.userId;
  if (!portfolioId) return Response.json({ error: "portfolioId em falta." }, { status: 400 });

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { error: e1 } = await supabase.from("portfolio_stocks").delete().eq("portfolio_id", portfolioId);
  const { error: e2 } = await supabase.from("portfolios").delete().eq("id", portfolioId);
  if (e1 || e2) return Response.json({ error: "Não foi possível eliminar o portefólio." }, { status: 500 });

  if (userId) {
    await supabase.from("users").update({ has_submitted_portfolio: false }).eq("id", userId);
  }
  return Response.json({ ok: true });
}
