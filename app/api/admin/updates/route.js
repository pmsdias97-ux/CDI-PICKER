import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

// Gestão dos updates (recap diário) pelo admin. Protegido por ADMIN_PASSWORD.
// actions: list | save | publish | unpublish | delete. Escreve via service_role.
export async function POST(request) {
  const rl = rateLimited(request, "admin-updates", { max: 60, windowMs: 60_000 });
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
  const day = String(body?.day || "").trim();
  const needDay = () => /^\d{4}-\d{2}-\d{2}$/.test(day);

  if (action === "list") {
    const { data, error } = await supabase
      .from("platform_updates")
      .select("day, draft_lines, body, status, published_at, updated_at")
      .order("day", { ascending: false })
      .limit(90);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ updates: data || [] });
  }

  if (!needDay()) return Response.json({ error: "day inválido." }, { status: 400 });
  const now = new Date().toISOString();

  if (action === "save") {
    const text = String(body?.body ?? "");
    const { error } = await supabase
      .from("platform_updates")
      .upsert({ day, body: text, updated_at: now }, { onConflict: "day" });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }
  if (action === "publish") {
    // "Guardar e publicar" envia o body junto → grava-o também (senão publicaria com body vazio).
    const patch = { status: "published", published_at: now, updated_at: now };
    if ("body" in (body || {})) patch.body = String(body.body ?? "");
    const { error } = await supabase.from("platform_updates").update(patch).eq("day", day);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }
  if (action === "unpublish") {
    const { error } = await supabase
      .from("platform_updates")
      .update({ status: "draft", updated_at: now })
      .eq("day", day);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }
  if (action === "delete") {
    const { error } = await supabase.from("platform_updates").delete().eq("day", day);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }
  return Response.json({ error: "action inválida." }, { status: 400 });
}
