import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

// Renomeia um membro (admin). Atualiza users.telegram_name.
export async function POST(request) {
  const rl = rateLimited(request, "admin-rename", { max: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!checkAdminPassword(body?.password)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const userId = body?.userId;
  const name = String(body?.name || "").trim();
  if (!userId) return Response.json({ error: "userId em falta." }, { status: 400 });
  if (name.length < 2 || name.length > 80) {
    return Response.json({ error: "Nome inválido." }, { status: 400 });
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // Evitar duplicar um nome já usado por outro utilizador.
  const { data: existing } = await supabase
    .from("users").select("id").ilike("telegram_name", name).maybeSingle();
  if (existing && existing.id !== userId) {
    return Response.json({ error: "Já existe um membro com esse nome." }, { status: 409 });
  }

  const { error } = await supabase.from("users").update({ telegram_name: name }).eq("id", userId);
  if (error) return Response.json({ error: "Não foi possível guardar o nome." }, { status: 500 });
  return Response.json({ ok: true });
}
