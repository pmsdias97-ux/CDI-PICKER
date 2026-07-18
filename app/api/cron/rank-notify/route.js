import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { createNotification } from "../../../lib/notify";

export const maxDuration = 60;

// "Foste ultrapassado no ranking" — 1×/dia (após o fecho). Calcula o lugar de cada oficial no
// Ranking Geral pelo ÚLTIMO snapshot (total_return congelado do dia), compara com users.last_rank
// (o lugar do dia anterior) e notifica quem DESCEU ≥ THRESHOLD lugares. Depois atualiza last_rank.
// Idempotente: como grava o lugar de hoje, uma 2ª corrida vê drop=0 → não duplica. CRON_SECRET.
const THRESHOLD = 3; // só notifica quedas de 3+ lugares (evita ruído de ±1-2)

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return Response.json({ error: "Não autorizado." }, { status: 401 });

  let supabase; try { supabase = getSupabaseAdmin(); } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { data: gs } = await supabase.from("game_settings").select("competition_started").eq("id", 1).maybeSingle();
  if (gs?.competition_started !== true) return Response.json({ ok: true, skipped: "competição não começou" });

  // Último dia com snapshots (todos os oficiais têm 1/dia).
  const { data: latest } = await supabase.from("portfolio_snapshots").select("date").order("date", { ascending: false }).limit(1).maybeSingle();
  const day = latest?.date;
  if (!day) return Response.json({ ok: true, skipped: "sem snapshots" });
  const { data: snaps } = await supabase.from("portfolio_snapshots").select("portfolio_id, total_return").eq("date", day);
  const retById = new Map((snaps || []).map((s) => [s.portfolio_id, Number(s.total_return)]));

  const { data: pfs } = await supabase.from("portfolios").select("id, user_id").eq("official", true);
  const ranked = (pfs || [])
    .filter((p) => p.user_id && retById.has(p.id) && Number.isFinite(retById.get(p.id)))
    .map((p) => ({ userId: p.user_id, ret: retById.get(p.id) }))
    .sort((a, b) => b.ret - a.ret);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  if (!ranked.length) return Response.json({ ok: true, day, ranked: 0 });

  // Lugares anteriores.
  const { data: users } = await supabase.from("users").select("id, last_rank").in("id", ranked.map((r) => r.userId));
  const lastById = new Map((users || []).map((u) => [u.id, u.last_rank]));

  let notified = 0;
  for (const r of ranked) {
    const prev = lastById.get(r.userId);
    if (prev != null && r.rank - prev >= THRESHOLD) {
      await createNotification(supabase, { userId: r.userId, type: "overtaken",
        title: `Desceste ${r.rank - prev} lugares hoje`, body: `Agora ${r.rank}º no Ranking Geral`, link: "ranking" });
      notified++;
    }
  }
  // Atualiza o lugar de todos (para a comparação de amanhã).
  for (const r of ranked) await supabase.from("users").update({ last_rank: r.rank }).eq("id", r.userId);

  return Response.json({ ok: true, day, ranked: ranked.length, notified });
}
