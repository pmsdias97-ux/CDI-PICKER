import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { usMarketOpen } from "../../../lib/marketHours";

export const maxDuration = 30;

// BLINDAGEM do baseline semanal. À 2ª feira ANTES da abertura US, reconcilia o baseline de arranque da
// semana ATUAL (weekly_baselines[curWk].price) com o preço JÁ ASSENTE do sp500_ath. Corrige fechos de
// 6ª não-assentes de ações ilíquidas (ex.: ATLN, que só assentou 0.838 depois da weekly-close das 22:00,
// poluindo o baseline com 0.93). Com o mercado fechado, o baseline TEM de igualar o preço que a
// plataforma mostra → a semana arranca a 0% para todos.
//
// Guards: só com o mercado FECHADO (senão o sp500_ath.price já é preço vivo de hoje, não o fecho de 6ª
// → reconciliar corromperia o baseline). Só na semana ATUAL (nunca semanas fechadas). Só atualiza a
// coluna `price` (nunca `close_price`), e só onde diverge ≥0.5%. Idempotente. CRON_SECRET. ?force=1.
const norm = (s) => String(s || "").toUpperCase().replace(/\./g, "-").trim();
function weekKey(d){
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay(); t.setUTCDate(t.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return t.toISOString().slice(0, 10);
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return Response.json({ error: "Não autorizado." }, { status: 401 });

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const now = new Date();
  const period = url.searchParams.get("period") || weekKey(now);

  // NUNCA reconciliar com sessão a decorrer (o feed seria preço vivo de hoje, não o fecho de 6ª).
  if (!force && usMarketOpen(now)) return Response.json({ ok: true, period, synced: 0, skipped: "mercado aberto — não reconcilia" });

  let supabase; try { supabase = getSupabaseAdmin(); } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { data: gs } = await supabase.from("game_settings").select("competition_started").eq("id", 1).maybeSingle();
  if (gs?.competition_started !== true) return Response.json({ ok: true, period, synced: 0, skipped: "competição não começou" });

  const { data: rows, error } = await supabase.from("weekly_baselines").select("ticker, price").eq("period", period);
  if (error) return Response.json({ error: "Falha a ler weekly_baselines." }, { status: 500 });
  if (!rows || !rows.length) return Response.json({ ok: true, period, synced: 0, skipped: "semana sem baseline" });

  // Preço ASSENTE atual (= fecho de 6ª, pré-abertura de 2ª) do sp500_ath.
  const { data: ath, error: aErr } = await supabase.from("sp500_ath").select("symbol, price");
  if (aErr) return Response.json({ error: "Falha a ler sp500_ath." }, { status: 500 });
  const priceMap = new Map();
  for (const r of ath || []) { const p = Number(r.price); if (Number.isFinite(p) && p > 0) priceMap.set(norm(r.symbol), p); }

  // Reconcilia só onde diverge ≥0.5% e o ticker existe no feed. Cripto (BTC…) fica de fora: negoceia
  // 24/7, logo o seu "fecho de 6ª" difere legitimamente do preço de 2ª — não é fecho não-assente.
  const capturedAt = now.toISOString();
  const toFix = [];
  for (const r of rows) {
    const settled = priceMap.get(norm(r.ticker));
    const base = Number(r.price);
    if (!(Number.isFinite(settled) && settled > 0) || !(base > 0)) continue;
    if (Math.abs(settled / base - 1) >= 0.005) toFix.push({ ticker: r.ticker, from: base, to: settled });
  }
  if (!toFix.length) return Response.json({ ok: true, period, synced: 0, note: "nada a reconciliar" });

  // UPDATE por ticker (só a coluna `price` — preserva `close_price`).
  let synced = 0;
  for (const u of toFix) {
    const { error: upErr } = await supabase
      .from("weekly_baselines").update({ price: u.to, captured_at: capturedAt })
      .eq("period", period).eq("ticker", u.ticker);
    if (!upErr) synced++;
  }
  return Response.json({ ok: true, period, synced, fixed: toFix });
}
