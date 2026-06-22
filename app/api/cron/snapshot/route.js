import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { fetchQuote } from "../../../lib/marketData";

// Daily snapshot of each portfolio's return, for the evolution chart (#5).
// Secured by CRON_SECRET: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // Only portfolios whose user has submitted.
  const { data: rows, error } = await supabase
    .from("portfolios")
    .select("id, users!inner(has_submitted_portfolio), portfolio_stocks(ticker, initial_price, side)");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const portfolios = (rows || []).filter((r) => r.users?.has_submitted_portfolio);
  if (!portfolios.length) return Response.json({ ok: true, snapshots: 0 });

  // One price lookup per unique ticker (Yahoo→CNBC fallback, cached).
  const tickers = [...new Set(portfolios.flatMap((p) => (p.portfolio_stocks || []).map((s) => s.ticker)))];
  const prices = {};
  for (const t of tickers) {
    const p = await fetchQuote(t);
    if (typeof p === "number") prices[t] = p;
  }

  const date = new Date().toISOString().slice(0, 10);
  const snapshots = [];
  for (const pf of portfolios) {
    const stocks = pf.portfolio_stocks || [];
    if (!stocks.length) continue;
    const rets = stocks.map((s) => {
      const init = Number(s.initial_price);
      const cur = typeof prices[s.ticker] === "number" ? prices[s.ticker] : init;
      const base = init ? cur / init - 1 : 0;
      return s.side === "short" ? -base : base; // short = espelho
    });
    const total = rets.reduce((a, b) => a + b, 0) / rets.length;
    snapshots.push({ portfolio_id: pf.id, date, total_return: total });
  }

  if (!snapshots.length) return Response.json({ ok: true, snapshots: 0 });

  const { error: upErr } = await supabase
    .from("portfolio_snapshots")
    .upsert(snapshots, { onConflict: "portfolio_id,date" });
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

  return Response.json({ ok: true, snapshots: snapshots.length, date });
}
