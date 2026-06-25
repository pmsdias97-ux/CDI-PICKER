import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

// PASSO 2 do arranque: ARRANCAR a competição = revelar os oficiais (liga
// competition_started). Já NÃO fixa preços — isso é o passo 1 (lock-baselines), que tem
// de ter corrido primeiro (baseline = fecho de 30 jun). Protegido por ADMIN_PASSWORD.
export async function POST(request) {
  const rl = rateLimited(request, "admin-start", { max: 10, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!checkAdminPassword(body?.password)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // Guard: não arrancar sem os preços de partida trancados (senão os oficiais ficavam
  // visíveis com baselines errados — preços de submissão em vez do fecho de 30 jun).
  const { data: gs } = await supabase
    .from("game_settings").select("baselines_locked_at, competition_started").eq("id", 1).maybeSingle();
  if (!gs?.baselines_locked_at) {
    return Response.json(
      { error: "Tranca primeiro os preços de partida (fecho de 30 jun)." },
      { status: 400 }
    );
  }

  const { error: flagErr } = await supabase
    .from("game_settings").update({ competition_started: true }).eq("id", 1);
  if (flagErr) return Response.json({ error: flagErr.message }, { status: 500 });

  return Response.json({ ok: true });
}
