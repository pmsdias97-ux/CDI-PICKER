import { rateLimited, checkAdminPassword } from "../../../lib/apiGuards";
import { authOwner } from "../../../lib/watchlistAuth";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

// POST { id, name?, pin?, adminPassword? } → apaga uma mensagem do chat geral.
// Admin (adminPassword válida) apaga qualquer; senão o AUTOR (name+pin) só apaga a SUA.
export async function POST(request) {
  const rl = rateLimited(request, "chat-delete", { max: 40, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body; try { body = await request.json(); } catch { body = null; }
  const id = String(body?.id || "").trim();
  if (!id) return Response.json({ error: "Mensagem inválida." }, { status: 400 });

  // Caminho admin: apaga qualquer mensagem.
  if (body?.adminPassword) {
    if (!checkAdminPassword(body.adminPassword)) return Response.json({ error: "Não autorizado." }, { status: 401 });
    let supabase; try { supabase = getSupabaseAdmin(); } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
    const { error } = await supabase.from("chat_messages").delete().eq("id", id);
    if (error) return Response.json({ error: "Não foi possível apagar." }, { status: 500 });
    return Response.json({ ok: true });
  }

  // Caminho autor: nome + PIN, e só apaga se a mensagem for dele (eq user_id).
  const a = await authOwner(body?.name, body?.pin);
  if (a.error) return Response.json({ error: a.error }, { status: a.status });
  const { error } = await a.supabase
    .from("chat_messages").delete().eq("id", id).eq("user_id", a.userId);
  if (error) return Response.json({ error: "Não foi possível apagar." }, { status: 500 });
  return Response.json({ ok: true });
}
