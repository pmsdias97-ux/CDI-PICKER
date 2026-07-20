import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

export const maxDuration = 30;

// Gestão das notificações enviadas (admin). Lista os BROADCASTS (type="admin", agrupados por created_at —
// as linhas de um envio partilham o instante) e as AUTOMÁTICAS recentes (individuais). Permite EDITAR o
// texto (um broadcast inteiro por created_at, ou uma individual por id) e ver QUEM LEU. Protegido por ADMIN_PASSWORD.
const LINK_RE = /^(ranking|ranking-week|ranking-month|chat|mine|ath|updates)$/;

export async function POST(request) {
  const rl = rateLimited(request, "admin-notifications", { max: 40, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });
  let body; try { body = await request.json(); } catch { body = null; }
  if (!checkAdminPassword(body?.password)) return Response.json({ error: "Não autorizado." }, { status: 401 });
  let supabase; try { supabase = getSupabaseAdmin(); } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const action = String(body?.action || "list");
  const namesMap = async () => { const { data } = await supabase.from("users").select("id, telegram_name"); return new Map((data || []).map((u) => [u.id, u.telegram_name])); };

  if (action === "list") {
    // Broadcasts (type="admin") agrupados por created_at (= um envio).
    const { data: adm } = await supabase.from("notifications")
      .select("created_at, title, body, link, read").eq("type", "admin")
      .order("created_at", { ascending: false }).limit(6000);
    const groups = new Map();
    for (const r of adm || []) {
      let g = groups.get(r.created_at);
      if (!g) { g = { createdAt: r.created_at, title: r.title, body: r.body, link: r.link, total: 0, read: 0 }; groups.set(r.created_at, g); }
      g.total++; if (r.read) g.read++;
    }
    const broadcasts = [...groups.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 50);

    // Automáticas recentes (individuais, com destinatário).
    const { data: auto } = await supabase.from("notifications")
      .select("id, type, title, body, link, actor_name, user_id, read, created_at").neq("type", "admin")
      .order("created_at", { ascending: false }).limit(40);
    const names = await namesMap();
    const recent = (auto || []).map((r) => ({ id: r.id, type: r.type, title: r.title, body: r.body, link: r.link, actorName: r.actor_name, userName: names.get(r.user_id) || "—", read: r.read, createdAt: r.created_at }));
    return Response.json({ ok: true, broadcasts, recent });
  }

  if (action === "readers") {
    const createdAt = String(body?.createdAt || "");
    if (!createdAt) return Response.json({ error: "Falta o envio." }, { status: 400 });
    let { data, error } = await supabase.from("notifications").select("user_id, read, read_at").eq("type", "admin").eq("created_at", createdAt);
    if (error) ({ data } = await supabase.from("notifications").select("user_id, read").eq("type", "admin").eq("created_at", createdAt)); // sem read_at
    const names = await namesMap();
    const readRows = [], unread = [];
    for (const r of data || []) {
      if (r.read) readRows.push({ name: names.get(r.user_id) || "—", at: r.read_at || null });
      else unread.push(names.get(r.user_id) || "—");
    }
    // Mais RECENTE primeiro (read_at desc); quem leu antes da coluna existir (sem read_at) fica no fim, por nome.
    readRows.sort((a, b) => { if (a.at && b.at) return a.at < b.at ? 1 : -1; if (a.at) return -1; if (b.at) return 1; return a.name.localeCompare(b.name); });
    unread.sort((a, b) => a.localeCompare(b));
    return Response.json({ ok: true, read: readRows.map((r) => r.name), unread });
  }

  if (action === "edit") {
    const title = String(body?.title || "").trim().slice(0, 120);
    const text = String(body?.body || "").trim().slice(0, 300) || null;
    const rawLink = String(body?.link || "").trim();
    const link = LINK_RE.test(rawLink) ? rawLink : null;
    if (!title) return Response.json({ error: "O título é obrigatório." }, { status: 400 });
    const patch = { title, body: text, link };
    if (body?.batchCreatedAt) {
      const { error } = await supabase.from("notifications").update(patch).eq("type", "admin").eq("created_at", String(body.batchCreatedAt));
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ ok: true });
    } else if (body?.id) {
      const { error } = await supabase.from("notifications").update(patch).eq("id", String(body.id));
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Falta o alvo a editar." }, { status: 400 });
  }

  if (action === "delete") {
    if (body?.batchCreatedAt) {
      const { error } = await supabase.from("notifications").delete().eq("type", "admin").eq("created_at", String(body.batchCreatedAt));
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ ok: true });
    } else if (body?.id) {
      const { error } = await supabase.from("notifications").delete().eq("id", String(body.id));
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Falta o alvo a apagar." }, { status: 400 });
  }

  return Response.json({ error: "Ação desconhecida." }, { status: 400 });
}
