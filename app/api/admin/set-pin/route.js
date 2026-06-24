import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

// Admin define/edita o código de 3 dígitos de um membro (ex.: contas demo sem código).
// Protegido pela ADMIN_PASSWORD. Escreve em member_pins via service_role.
export async function POST(request) {
  const rl = rateLimited(request, "admin-setpin", { max: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!checkAdminPassword(body?.password)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  const userId = String(body?.userId || "").trim();
  const pin = String(body?.pin || "");
  if (!userId) return Response.json({ error: "Falta o utilizador." }, { status: 400 });
  if (!/^\d{3}$/.test(pin)) return Response.json({ error: "O código tem de ter 3 dígitos." }, { status: 400 });

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { error } = await supabase.from("member_pins").upsert({ user_id: userId, pin });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
