import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const maxDuration = 60;

// "Mudanças no ranking" — 1×/dia (após o fecho). Calcula o lugar de cada oficial no Ranking Geral pelo
// ÚLTIMO snapshot (total_return congelado do dia), compara com users.last_rank (lugar do dia anterior) e
// notifica quem MUDOU ≥ THRESHOLD lugares (desceu OU subiu). A notificação SUBSTITUI a anterior (apaga as
// "overtaken" antigas do membro) → não acumula quando o membro não visita a plataforma durante dias.
// Idempotente: grava o lugar de hoje → 2ª corrida vê delta=0. CRON_SECRET.
const THRESHOLD = 3; // só notifica mudanças de 3+ lugares (evita ruído de ±1-2)

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

  // Quem mudou ≥ THRESHOLD lugares (desceu OU subiu).
  const toNotify = [];
  for (const r of ranked) {
    const prev = lastById.get(r.userId);
    if (prev == null) continue;
    const delta = r.rank - prev; // >0 desceu (rank maior); <0 subiu
    if (delta >= THRESHOLD) toNotify.push({ userId: r.userId, rank: r.rank, prev, up: false, n: delta });
    else if (delta <= -THRESHOLD) toNotify.push({ userId: r.userId, rank: r.rank, prev, up: true, n: -delta });
  }
  let notified = 0;
  if (toNotify.length) {
    const ids = toNotify.map((x) => x.userId);
    // SUBSTITUI: apaga as "overtaken" anteriores destes membros → cada um fica só com a MAIS RECENTE.
    await supabase.from("notifications").delete().eq("type", "overtaken").in("user_id", ids);
    const sentAt = new Date().toISOString(); // created_at único do lote (agrupa no admin)
    const rows = toNotify.map((x) => ({
      user_id: x.userId, type: "overtaken",
      title: x.up ? `Subiste ${x.n} lugares no Ranking Geral` : `Desceste ${x.n} lugares no Ranking Geral`,
      body: `Agora ${x.rank}º · antes ${x.prev}º`, link: "ranking", created_at: sentAt,
    }));
    for (let i = 0; i < rows.length; i += 500) await supabase.from("notifications").insert(rows.slice(i, i + 500));
    notified = rows.length;
  }
  // Atualiza o lugar de todos (para a comparação de amanhã).
  for (const r of ranked) await supabase.from("users").update({ last_rank: r.rank }).eq("id", r.userId);

  return Response.json({ ok: true, day, ranked: ranked.length, notified });
}
