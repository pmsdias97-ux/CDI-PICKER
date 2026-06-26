import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

// Liberta o nome "José Pinho" (e variantes) para ele poder submeter ao vivo: apaga os
// portefólios de teste com esse nome (+ ações) e repõe has_submitted_portfolio=false.
// Direcionado a nomes específicos (não mexe noutros membros). Protegido por ADMIN_PASSWORD.
const NAMES = ["josé pinho", "jose pinho", "pinho", "zé pinho", "ze pinho", "j. pinho", "j pinho"];

export async function POST(request) {
  const rl = rateLimited(request, "admin-free-jose", { max: 10, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!checkAdminPassword(body?.password)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { data: users, error } = await supabase
    .from("users").select("id").in("telegram_name_lower", NAMES);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const ids = (users || []).map((u) => u.id);
  if (!ids.length) return Response.json({ ok: true, freed: 0, portfolios: 0 });

  const { data: pfs } = await supabase.from("portfolios").select("id").in("user_id", ids);
  const pfIds = (pfs || []).map((p) => p.id);
  if (pfIds.length) {
    await supabase.from("portfolio_stocks").delete().in("portfolio_id", pfIds);
    await supabase.from("portfolios").delete().in("id", pfIds);
  }
  await supabase.from("users").update({ has_submitted_portfolio: false }).in("id", ids);

  return Response.json({ ok: true, freed: ids.length, portfolios: pfIds.length });
}
