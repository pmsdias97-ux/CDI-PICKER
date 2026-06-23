import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { rateLimited } from "../../../lib/apiGuards";

// Verifica cedo se um nome já tem portefólio submetido, para o utilizador saber
// logo no passo 1 (antes de escolher as ações) e não ter de repetir tudo.
export async function POST(request) {
  const rl = rateLimited(request, "check-name", { max: 40, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  const name = String(body?.name || "").trim();
  if (name.length < 2) return Response.json({ available: true });

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { data, error } = await supabase
    .from("users").select("has_submitted_portfolio").ilike("telegram_name", name).maybeSingle();
  if (error) return Response.json({ error: "Não foi possível verificar o nome." }, { status: 500 });

  return Response.json({ available: !(data?.has_submitted_portfolio === true) });
}
