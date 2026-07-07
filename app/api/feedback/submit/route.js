import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { rateLimited } from "../../../lib/apiGuards";

// Membro envia feedback. O texto fica público (anónimo); o autor é guardado só para o admin
// (moderação), nunca é devolvido ao público. Escrita via service_role (RLS nega o anon).
export async function POST(request) {
  const rl = rateLimited(request, "feedback-submit", { max: 8, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos. Tenta daqui a pouco." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  const message = String(body?.message || "").trim();
  const author = String(body?.name || "").trim().slice(0, 80) || null;
  if (!message) return Response.json({ error: "Escreve o teu feedback." }, { status: 400 });
  if (message.length > 500) return Response.json({ error: "Máximo 500 caracteres." }, { status: 400 });

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { error } = await supabase.from("member_feedback").insert({ message, author });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
