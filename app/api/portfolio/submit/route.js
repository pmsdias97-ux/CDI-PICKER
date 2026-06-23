import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { fetchQuote } from "../../../lib/marketData";
import { isValidTicker, rateLimited } from "../../../lib/apiGuards";

const PORTFOLIO_SIZE = 8;
const MAX_SHORTS = 2;
const STARTING_VALUE = 10000;

export async function POST(request) {
  const rl = rateLimited(request, "submit", { max: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: "Demasiados pedidos. Tenta daqui a pouco." }, { status: 429 });
  }

  let body;
  try { body = await request.json(); } catch { body = null; }
  const name = String(body?.name || "").trim();
  const stocks = Array.isArray(body?.stocks) ? body.stocks : [];

  if (!name || name.length < 2 || name.length > 80) {
    return Response.json({ error: "Escreve o teu nome." }, { status: 400 });
  }
  if (stocks.length !== PORTFOLIO_SIZE) {
    return Response.json({ error: `Tens de escolher exatamente ${PORTFOLIO_SIZE} ações.` }, { status: 400 });
  }

  // Normalize + validate tickers; reject duplicates.
  const tickers = [];
  for (const s of stocks) {
    const t = String(s?.ticker || "").trim().toUpperCase();
    if (!isValidTicker(t)) {
      return Response.json({ error: `Ticker inválido: "${t}".` }, { status: 400 });
    }
    if (tickers.includes(t)) {
      return Response.json({ error: `Ticker repetido: "${t}".` }, { status: 400 });
    }
    tickers.push(t);
  }
  const nameByTicker = new Map(
    stocks.map((s) => [String(s?.ticker || "").trim().toUpperCase(), String(s?.name || "").trim().slice(0, 120)])
  );
  const sideByTicker = new Map(
    stocks.map((s) => [String(s?.ticker || "").trim().toUpperCase(), s?.side === "short" ? "short" : "long"])
  );
  const shortCount = [...sideByTicker.values()].filter((v) => v === "short").length;
  if (shortCount > MAX_SHORTS) {
    return Response.json({ error: `Máximo de ${MAX_SHORTS} posições short.` }, { status: 400 });
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // Submissions must be open (authoritative server-side check): desligadas,
  // competição já a decorrer, ou passado o prazo (game_start_date) => fechadas.
  const { data: gs } = await supabase
    .from("game_settings").select("submissions_open,game_start_date,competition_started").eq("id", 1).maybeSingle();
  if (gs) {
    const past = gs.game_start_date && !isNaN(new Date(gs.game_start_date)) && Date.now() >= new Date(gs.game_start_date).getTime();
    if (gs.submissions_open === false || gs.competition_started === true || past) {
      return Response.json({ error: "As submissões estão fechadas de momento." }, { status: 403 });
    }
  }

  // One portfolio per name.
  const { data: existing, error: lookupErr } = await supabase
    .from("users").select("id, has_submitted_portfolio").ilike("telegram_name", name).maybeSingle();
  if (lookupErr) return Response.json({ error: "Não foi possível verificar o nome." }, { status: 500 });
  if (existing?.has_submitted_portfolio) {
    return Response.json({ error: "Já existe um portefólio com esse nome. Cada membro só pode participar uma vez." }, { status: 409 });
  }

  // Authoritative prices fetched on the server — clients can't forge initial_price.
  const prices = {};
  for (const t of tickers) {
    const p = await fetchQuote(t);
    if (typeof p !== "number") {
      return Response.json({ error: `Não foi possível obter o preço de ${t}. Verifica o ticker ou tenta mais tarde.` }, { status: 502 });
    }
    prices[t] = p;
  }

  // Reuse an existing (non-submitted) user row if present, else create one.
  let userId = existing?.id;
  if (!userId) {
    const { data: userRow, error: userErr } = await supabase
      .from("users").insert({ telegram_name: name, has_submitted_portfolio: false }).select("id").single();
    if (userErr || !userRow) return Response.json({ error: "Não foi possível registar o utilizador." }, { status: 500 });
    userId = userRow.id;
  }

  // S&P 500 price at submission, to benchmark "what if you'd bought SPY instead"
  // over the exact same period. Best-effort: null if unavailable.
  const spyAtSubmission = await fetchQuote("SPY");

  const { data: pfRow, error: pfErr } = await supabase
    .from("portfolios")
    .insert({ user_id: userId, locked: true, initial_value: STARTING_VALUE, spy_initial_price: typeof spyAtSubmission === "number" ? spyAtSubmission : null, official: true })
    .select("id").single();
  if (pfErr || !pfRow) return Response.json({ error: "Não foi possível criar o portefólio." }, { status: 500 });

  const stockRows = tickers.map((t) => ({
    portfolio_id: pfRow.id,
    ticker: t,
    company_name: nameByTicker.get(t) || t,
    initial_price: prices[t],
    current_price: prices[t],
    initial_weight: 12.5,
    side: sideByTicker.get(t) || "long",
  }));
  const { error: stocksErr } = await supabase.from("portfolio_stocks").insert(stockRows);
  if (stocksErr) {
    // Roll back the portfolio so we don't leave an empty one behind.
    await supabase.from("portfolios").delete().eq("id", pfRow.id);
    return Response.json({ error: "Não foi possível guardar as ações." }, { status: 500 });
  }

  const { error: updErr } = await supabase
    .from("users").update({ has_submitted_portfolio: true }).eq("id", userId);
  if (updErr) return Response.json({ error: "Portefólio guardado, mas falhou a confirmação. Contacta o administrador." }, { status: 500 });

  return Response.json({ ok: true, name });
}
