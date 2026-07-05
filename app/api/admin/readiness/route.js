import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

export const maxDuration = 30;

// Verificação de PRONTIDÃO para o lançamento (admin). Relata, num relance: env presentes
// (só NOMES, nunca valores), estado do jogo, frescura do ATH/snapshots, ações sem baseline,
// oficiais vazios, demos sem PIN e nº de tickers distintos. Protegido por ADMIN_PASSWORD.
// NÃO toca em nada — é só leitura/diagnóstico.
export async function POST(request) {
  const rl = rateLimited(request, "admin-readiness", { max: 20, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!checkAdminPassword(body?.password)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  // Presença de env (só no lado do Vercel; os GitHub Secrets verificam-se à parte).
  const env = {
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    CRON_SECRET: !!process.env.CRON_SECRET,
    ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD,
    ALPHA_VANTAGE_API_KEY: !!process.env.ALPHA_VANTAGE_API_KEY,
    SUPABASE_URL: !!(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL),
    SUPABASE_ANON_KEY: !!(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY),
  };

  const out = { ok: true, env };

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { out.dbError = e.message; return Response.json(out); }

  try {
    const { data } = await supabase.from("game_settings")
      .select("submissions_open, game_start_date, game_end_date, competition_started, baselines_locked_at")
      .eq("id", 1).maybeSingle();
    out.settings = data || null;
  } catch (e) { out.settings = { error: String(e) }; }

  try {
    const { data } = await supabase.from("sp500_ath").select("updated_at").order("updated_at", { ascending: false }).limit(1);
    out.athLatest = data?.[0]?.updated_at || null;
  } catch { out.athLatest = null; }

  try {
    const { data } = await supabase.from("portfolio_snapshots").select("captured_at").order("captured_at", { ascending: false }).limit(1);
    out.snapshotLatest = data?.[0]?.captured_at || null;
  } catch { out.snapshotLatest = null; }

  try {
    const { data: pfs } = await supabase.from("portfolios")
      .select("id, official, portfolio_stocks(ticker, initial_price), users!portfolios_user_id_fkey(id)");
    const list = pfs || [];
    const tickers = new Set();
    let stocksNoBase = 0, officialEmpty = 0;
    for (const p of list) {
      const ss = p.portfolio_stocks || [];
      if (p.official === true && ss.length === 0) officialEmpty++;
      for (const s of ss) {
        tickers.add(String(s.ticker || "").toUpperCase());
        const ip = Number(s.initial_price);
        if (!Number.isFinite(ip) || ip <= 0) stocksNoBase++;
      }
    }
    out.portfolios = {
      total: list.length,
      official: list.filter((p) => p.official === true).length,
      demo: list.filter((p) => p.official === false).length,
    };
    out.distinctTickers = tickers.size;
    out.stocksWithoutBaseline = stocksNoBase;
    out.officialEmpty = officialEmpty;

    const demoUserIds = [...new Set(list.filter((p) => p.official === false && p.users?.id).map((p) => p.users.id))];
    if (demoUserIds.length) {
      const { data: pins } = await supabase.from("member_pins").select("user_id, pin").in("user_id", demoUserIds);
      const withPin = new Set((pins || []).filter((r) => r.pin).map((r) => r.user_id));
      out.demosWithoutPin = demoUserIds.filter((id) => !withPin.has(id)).length;
    } else out.demosWithoutPin = 0;
  } catch (e) { out.portfoliosError = String(e); }

  return Response.json(out);
}
