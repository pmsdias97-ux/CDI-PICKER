import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

// Devolve os códigos de 3 dígitos por membro (só admin). Mapa { user_id: pin }.
export async function POST(request) {
  const rl = rateLimited(request, "admin-pins", { max: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!checkAdminPassword(body?.password)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { data, error } = await supabase.from("member_pins").select("user_id, pin");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const pins = {};
  (data || []).forEach((r) => { pins[r.user_id] = r.pin; });
  return Response.json({ ok: true, pins });
}
