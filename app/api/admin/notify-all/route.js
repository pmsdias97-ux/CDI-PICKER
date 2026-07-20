import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

// Notificação MANUAL do admin para TODOS os membros (broadcast). Protegido por ADMIN_PASSWORD.
// Faz fan-out: insere 1 linha em `notifications` por membro oficial → cada um tem o seu estado de
// "lido" independente e o sino/lista existentes funcionam sem alterações. type="admin".
export async function POST(request) {
  const rl = rateLimited(request, "admin-notify-all", { max: 20, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!checkAdminPassword(body?.password)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const title = String(body?.title || "").trim().slice(0, 120);
  const text = String(body?.body || "").trim().slice(0, 300) || null;
  // Link opcional: só tokens conhecidos que o app sabe resolver (handleNotifLink); senão, sem link.
  const rawLink = String(body?.link || "").trim();
  const link = /^(ranking|ranking-week|ranking-month|chat|mine|ath|updates)$/.test(rawLink) ? rawLink : null;
  if (!title) return Response.json({ error: "O título é obrigatório." }, { status: 400 });

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // Destinatários = donos de portefólios OFICIAIS (os membros da competição).
  const { data: pfs, error } = await supabase
    .from("portfolios").select("user_id").eq("official", true);
  if (error) return Response.json({ error: "Falha a ler os membros." }, { status: 500 });
  const userIds = [...new Set((pfs || []).map((p) => p.user_id).filter(Boolean))];
  if (!userIds.length) return Response.json({ ok: true, count: 0 });

  // created_at ÚNICO p/ todo o envio → o admin agrupa o broadcast por este instante (mesmo com vários lotes).
  const sentAt = new Date().toISOString();
  const rows = userIds.map((uid) => ({
    user_id: uid, type: "admin", title, body: text, link, actor_name: "Admin", created_at: sentAt,
  }));

  // Insere em lotes (segurança com muitos membros).
  let count = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error: insErr } = await supabase.from("notifications").insert(chunk);
    if (insErr) return Response.json({ error: insErr.message, count }, { status: 500 });
    count += chunk.length;
  }
  return Response.json({ ok: true, count });
}
