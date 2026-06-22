import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

export async function POST(request) {
  const rl = rateLimited(request, "admin-settings", { max: 20, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!checkAdminPassword(body?.password)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const s = body?.settings || {};
  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { error } = await supabase.from("game_settings").upsert({
    id: 1,
    submissions_open: s.submissionsOpen !== false,
    game_start_date: s.gameStartDate || null,
    game_end_date: s.gameEndDate || null,
  });
  if (error) return Response.json({ error: "Falha ao guardar definições." }, { status: 500 });
  return Response.json({ ok: true });
}
