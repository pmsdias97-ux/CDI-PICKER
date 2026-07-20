import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";
import { isCrypto } from "../../../lib/crypto";

export const maxDuration = 30;

// SAÚDE operacional (admin, só leitura): o que costuma falhar em silêncio — snapshots em falta,
// baselines semanais/mensais, e preços SUSPEITOS (desvio grande do baseline, ex.: ATLN). Protegido
// por ADMIN_PASSWORD. NÃO toca em nada.
const norm = (s) => String(s || "").toUpperCase().replace(/\./g, "-").trim();
function weekKey(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay(); t.setUTCDate(t.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return t.toISOString().slice(0, 10);
}

export async function POST(request) {
  const rl = rateLimited(request, "admin-health", { max: 20, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });
  let body; try { body = await request.json(); } catch { body = null; }
  if (!checkAdminPassword(body?.password)) return Response.json({ error: "Não autorizado." }, { status: 401 });
  let supabase; try { supabase = getSupabaseAdmin(); } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const now = new Date();
  const out = { ok: true, now: now.toISOString() };

  try {
    const { data: gs } = await supabase.from("game_settings")
      .select("competition_started, game_start_date, game_end_date").eq("id", 1).maybeSingle();
    out.competition = { started: gs?.competition_started === true, start: gs?.game_start_date || null, end: gs?.game_end_date || null };

    const { data: pfs } = await supabase.from("portfolios").select("id, user_id, portfolio_stocks(ticker)").eq("official", true);
    const officials = pfs || [];
    const { data: users } = await supabase.from("users").select("id, telegram_name");
    const nameById = new Map((users || []).map((u) => [u.id, u.telegram_name]));
    const officialTickers = new Set();
    for (const p of officials) for (const s of p.portfolio_stocks || []) officialTickers.add(norm(s.ticker));

    // Snapshots — último dia + cobertura dos oficiais.
    const { data: latest } = await supabase.from("portfolio_snapshots").select("date, captured_at").order("date", { ascending: false }).limit(1).maybeSingle();
    const latestDate = latest?.date || null;
    let missing = [];
    if (latestDate) {
      const { data: snaps } = await supabase.from("portfolio_snapshots").select("portfolio_id").eq("date", latestDate);
      const have = new Set((snaps || []).map((s) => s.portfolio_id));
      missing = officials.filter((p) => !have.has(p.id)).map((p) => nameById.get(p.user_id) || p.id);
    }
    const daysSince = latestDate ? Math.round((Date.parse(now.toISOString().slice(0, 10)) - Date.parse(latestDate)) / 86400000) : null;
    out.snapshots = { latestDate, latestAt: latest?.captured_at || null, officials: officials.length, covered: latestDate ? officials.length - missing.length : 0, missing: missing.slice(0, 40), missingCount: missing.length, daysSince };

    // Baselines semanais (semana atual).
    const curWk = weekKey(now);
    const { data: wb } = await supabase.from("weekly_baselines").select("ticker, price, close_price").eq("period", curWk);
    const wbT = new Set((wb || []).map((r) => norm(r.ticker)));
    const weekMissing = [...officialTickers].filter((t) => !wbT.has(t));
    const refByT = new Map();
    for (const r of wb || []) { const ref = r.close_price != null ? Number(r.close_price) : Number(r.price); if (ref > 0) refByT.set(norm(r.ticker), ref); }
    out.week = { period: curWk, tickers: (wb || []).length, closed: (wb || []).some((r) => r.close_price != null), missingTickers: weekMissing.slice(0, 40), missingCount: weekMissing.length };

    // Baseline mensal (mês atual).
    const curM = now.toISOString().slice(0, 7);
    let mbTickers = 0;
    try { const { data: mb } = await supabase.from("monthly_baselines").select("ticker").eq("period", curM); mbTickers = (mb || []).length; } catch { /* tabela pode não existir */ }
    out.month = { period: curM, tickers: mbTickers };

    // Preços — frescura do pipeline + suspeitos (desvio grande do baseline / sem preço).
    const { data: ath } = await supabase.from("sp500_ath").select("symbol, price, updated_at").order("updated_at", { ascending: false });
    const athMap = new Map(); let athLatest = null;
    for (const r of ath || []) { const t = norm(r.symbol); if (!athMap.has(t)) athMap.set(t, { price: Number(r.price), updated: r.updated_at }); if (!athLatest) athLatest = r.updated_at; }
    const suspicious = [];
    for (const t of officialTickers) {
      if (isCrypto(t)) continue; // cripto (BTC…) não está no pipeline sp500_ath por design → não é suspeito
      const a = athMap.get(t); const ref = refByT.get(t);
      if (!a || !(a.price > 0)) { suspicious.push({ ticker: t, reason: "sem preço no pipeline", price: a?.price ?? null, ref: ref ?? null, dev: null }); continue; }
      if (ref > 0) { const dev = a.price / ref - 1; if (Math.abs(dev) > 0.40) suspicious.push({ ticker: t, reason: "desvio grande do baseline", price: a.price, ref, dev }); }
    }
    suspicious.sort((x, y) => Math.abs(y.dev ?? 9) - Math.abs(x.dev ?? 9));
    out.prices = { athLatest, staleHours: athLatest ? Math.round((Date.now() - Date.parse(athLatest)) / 3600000) : null, suspicious: suspicious.slice(0, 40), suspiciousCount: suspicious.length };
  } catch (e) { out.error = String(e?.message || e); }

  return Response.json(out);
}
