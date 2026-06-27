import { getSupabaseAdmin } from "./supabaseAdmin";
import { verifyMemberPin } from "./pinAuth";

// Verifica nome + código de 3 dígitos (mesmo modelo de /api/portfolio/mine) e devolve
// { supabase, userId } se ok, ou { error, status } para a rota responder diretamente.
export async function authOwner(name, pin) {
  name = String(name || "").trim();
  pin = String(pin || "");
  if (!name) return { error: "Falta o nome.", status: 400 };
  if (!/^\d{3}$/.test(pin)) return { error: "Código inválido.", status: 400 };

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return { error: e.message, status: 500 }; }

  const { data: user, error } = await supabase
    .from("users").select("id, has_submitted_portfolio")
    .eq("telegram_name_lower", name.toLowerCase()).maybeSingle();
  if (error) return { error: "Não foi possível verificar o nome.", status: 500 };
  if (!user || user.has_submitted_portfolio !== true) {
    return { error: "Não encontrámos um portefólio com esse nome.", status: 404 };
  }

  const r = await verifyMemberPin(supabase, user.id, pin);
  if (r === "locked") return { error: "Demasiadas tentativas. Tenta daqui a 15 minutos.", status: 429 };
  if (r !== "ok") return { error: "Código incorreto.", status: 401 };

  return { supabase, userId: user.id };
}
