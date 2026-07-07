import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

// Moderação do feedback pelo admin. Protegido por ADMIN_PASSWORD. Ao contrário da lista pública,
// AQUI o autor É devolvido (só o admin o vê). actions: list | hide | unhide | delete.
export async function POST(request) {
  const rl = rateLimited(request, "admin-feedback", { max: 60, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!checkAdminPassword(body?.password)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const action = String(body?.action || "list");

  if (action === "list") {
    const { data, error } = await supabase
      .from("member_feedback")
      .select("id, message, author, hidden, created_at") // com author — só admin
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ feedback: data || [] });
  }

  const id = Number(body?.id);
  if (!Number.isInteger(id)) return Response.json({ error: "id inválido." }, { status: 400 });

  if (action === "hide" || action === "unhide") {
    const { error } = await supabase
      .from("member_feedback").update({ hidden: action === "hide" }).eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }
  if (action === "delete") {
    const { error } = await supabase.from("member_feedback").delete().eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }
  return Response.json({ error: "action inválida." }, { status: 400 });
}
