import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { rateLimited } from "../../../lib/apiGuards";
import { verifyMemberPin } from "../../../lib/pinAuth";

// Recuperação de identidade por nome + código de 3 dígitos (anti-impersonação).
// Verificação no servidor (service_role); o PIN nunca chega ao browser.
export async function POST(request) {
  const rl = rateLimited(request, "recover", { max: 15, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiadas tentativas. Tenta mais tarde." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  const name = String(body?.name || "").trim();
  const pin = String(body?.pin || "");
  if (!name) return Response.json({ error: "Escreve o teu nome." }, { status: 400 });
  if (!/^\d{3}$/.test(pin)) return Response.json({ error: "Escreve o teu código de 3 dígitos." }, { status: 400 });

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { data: user, error } = await supabase
    .from("users").select("id, telegram_name, has_submitted_portfolio").eq("telegram_name_lower", name.toLowerCase()).maybeSingle();
  if (error) return Response.json({ error: "Não foi possível verificar o nome." }, { status: 500 });
  if (!user || user.has_submitted_portfolio !== true) {
    return Response.json({ error: "Não encontrámos um portefólio submetido com esse nome." }, { status: 404 });
  }

  // Verificação do código com bloqueio por conta (fail-closed).
  const r = await verifyMemberPin(supabase, user.id, pin);
  if (r === "locked") return Response.json({ error: "Demasiadas tentativas. Tenta daqui a 15 minutos." }, { status: 429 });
  if (r !== "ok") return Response.json({ error: "Código incorreto." }, { status: 401 });

  return Response.json({ ok: true, name: user.telegram_name });
}
