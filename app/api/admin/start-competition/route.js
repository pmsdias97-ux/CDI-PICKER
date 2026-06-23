import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { fetchQuote } from "../../../lib/marketData";
import { checkAdminPassword, rateLimited } from "../../../lib/apiGuards";

// Arranque oficial: fixa o preço de partida (ao vivo, no momento do clique) para
// TODOS os portefólios, para começarem nas mesmas condições. Marca a competição
// como iniciada. Mantém os snapshots de evolução. Protegido por ADMIN_PASSWORD.
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

  const { data: pfs, error } = await supabase
    .from("portfolios").select("id, portfolio_stocks(ticker)");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Preços ao vivo de todos os tickers + SPY (Yahoo→CNBC, cache).
  const tickers = [...new Set((pfs || []).flatMap((p) => (p.portfolio_stocks || []).map((s) => s.ticker)))];
  const prices = {};
  for (const t of tickers) {
    const p = await fetchQuote(t);
    if (typeof p === "number") prices[t] = p;
  }
  const spy = await fetchQuote("SPY");

  let stocksUpdated = 0, missing = 0;
  for (const t of tickers) {
    if (typeof prices[t] !== "number") { missing++; continue; }
    const { error: e } = await supabase
      .from("portfolio_stocks").update({ initial_price: prices[t], current_price: prices[t] }).eq("ticker", t);
    if (!e) stocksUpdated++;
  }
  if (typeof spy === "number") {
    await supabase.from("portfolios").update({ spy_initial_price: spy }).neq("id", "00000000-0000-0000-0000-000000000000");
  }

  const { error: flagErr } = await supabase
    .from("game_settings").update({ competition_started: true }).eq("id", 1);
  if (flagErr) return Response.json({ error: flagErr.message }, { status: 500 });

  return Response.json({ ok: true, tickers: tickers.length, stocksUpdated, missing, spy: typeof spy === "number" ? spy : null });
}
