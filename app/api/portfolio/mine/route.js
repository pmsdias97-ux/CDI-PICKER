import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { rateLimited, safeEqual } from "../../../lib/apiGuards";

// Devolve as ações do PRÓPRIO portefólio (verificado por nome + código de 3 dígitos).
// Necessário no pré-lançamento, quando as ações dos oficiais estão ocultas ao anon
// (RLS) para evitar cópias — o dono continua a ver o seu.
export async function POST(request) {
  const rl = rateLimited(request, "mine", { max: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  const name = String(body?.name || "").trim();
  const pin = String(body?.pin || "");
  if (!name) return Response.json({ error: "Falta o nome." }, { status: 400 });
  if (!/^\d{3}$/.test(pin)) return Response.json({ error: "Código inválido." }, { status: 400 });

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { data: user, error } = await supabase
    .from("users").select("id, has_submitted_portfolio").eq("telegram_name_lower", name.toLowerCase()).maybeSingle();
  if (error) return Response.json({ error: "Não foi possível verificar o nome." }, { status: 500 });
  if (!user || user.has_submitted_portfolio !== true) {
    return Response.json({ error: "Não encontrámos um portefólio com esse nome." }, { status: 404 });
  }

  // Verifica o código — fail-closed: sem código definido, NÃO há acesso (o admin
  // tem de definir um código para essa conta). Evita acesso só com o nome.
  const { data: pinRow } = await supabase
    .from("member_pins").select("pin").eq("user_id", user.id).maybeSingle();
  if (!pinRow?.pin || !safeEqual(pinRow.pin, pin)) {
    return Response.json({ error: "Código incorreto." }, { status: 401 });
  }

  const { data: pf } = await supabase
    .from("portfolios").select("id").eq("user_id", user.id).maybeSingle();
  if (!pf) return Response.json({ error: "Portefólio não encontrado." }, { status: 404 });

  const { data: stocks, error: sErr } = await supabase
    .from("portfolio_stocks")
    .select("ticker, company_name, initial_price, current_price, initial_weight, side, currency")
    .eq("portfolio_id", pf.id);
  if (sErr) return Response.json({ error: "Não foi possível obter as ações." }, { status: 500 });

  return Response.json({ ok: true, stocks: stocks || [] });
}
