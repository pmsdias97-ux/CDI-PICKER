import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { rateLimited } from "../../../lib/apiGuards";
import { fetchQuote } from "../../../lib/marketData";

export const maxDuration = 30;

// Devolve os badges de um portefólio (gamificação leve).
export async function GET(request) {
  const rl = rateLimited(request, "portfolio-badges", { max: 60, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  const { searchParams } = new URL(request.url);
  const slugOrId = String(searchParams.get("slug") || "").trim();
  if (!slugOrId) return Response.json({ error: "Falta o identificador." }, { status: 400 });

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // Resolve por id ou nome.
  let pf = null;
  if (/^[0-9a-f-]{36}$/i.test(slugOrId)) {
    const { data } = await supabase
      .from("portfolios")
      .select("id, user_id, spy_initial_price, created_at, portfolio_stocks(ticker, initial_price, side)")
      .eq("id", slugOrId)
      .maybeSingle();
    pf = data;
  } else {
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .ilike("telegram_name_lower", slugOrId.toLowerCase())
      .eq("has_submitted_portfolio", true)
      .maybeSingle();
    if (user) {
      const { data } = await supabase
        .from("portfolios")
        .select("id, user_id, spy_initial_price, created_at, portfolio_stocks(ticker, initial_price, side)")
        .eq("user_id", user.id)
        .maybeSingle();
      pf = data;
    }
  }
  if (!pf) return Response.json({ error: "Portfólio não encontrado." }, { status: 404 });

  const stocks = (pf.portfolio_stocks || []).map((s) => ({
    ticker: s.ticker,
    initialPrice: Number(s.initial_price),
    side: s.side === "short" ? "short" : "long",
  }));

  // Preços atuais (best effort).
  const tickers = stocks.map((s) => s.ticker);
  const prices = await fetchPrices(supabase, tickers);

  const badges = [];

  // 🏆 Bateu o S&P
  if (Number.isFinite(pf.spy_initial_price) && pf.spy_initial_price > 0) {
    const spyPrice = await fetchQuote("SPY");
    if (typeof spyPrice === "number") {
      const portfolioRet = portfolioReturn(stocks, prices);
      const spyRet = spyPrice / pf.spy_initial_price - 1;
      if (portfolioRet > spyRet) {
        badges.push({
          id: "beat-spy",
          label: "Bate o S&P",
          emoji: "🏆",
          description: "Rentabilidade superior ao SPY desde o início.",
        });
      }
    }
  }

  // 🌿 Tudo verde
  const rets = stocks.map((s) => stockReturn(s, prices));
  if (stocks.length > 0 && rets.every((r) => r > 0)) {
    badges.push({
      id: "all-green",
      label: "Tudo verde",
      emoji: "🌿",
      description: "Todas as posições do portefólio estão positivas.",
    });
  }

  // 🩳 Short master
  const shorts = stocks.filter((s) => s.side === "short");
  if (shorts.length > 0) {
    const shortRets = shorts.map((s) => stockReturn(s, prices));
    const avgShort = shortRets.reduce((a, b) => a + b, 0) / shortRets.length;
    if (avgShort > 0) {
      badges.push({
        id: "short-master",
        label: "Short master",
        emoji: "🩳",
        description: "As tuas posições short estão a ganhar dinheiro.",
      });
    }
  }

  // 🦾 Resiliente (drawdown >5% mas agora positivo)
  const { data: snapshots } = await supabase
    .from("portfolio_snapshots")
    .select("total_return")
    .eq("portfolio_id", pf.id)
    .order("captured_at", { ascending: true });
  const returns = (snapshots || []).map((s) => Number(s.total_return)).filter(Number.isFinite);
  if (returns.length >= 2) {
    let peak = -Infinity;
    let maxDrawdown = 0;
    for (const r of returns) {
      if (r > peak) peak = r;
      const dd = peak - r;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
    const currentRet = portfolioReturn(stocks, prices);
    if (maxDrawdown > 0.05 && currentRet > 0) {
      badges.push({
        id: "resilient",
        label: "Resiliente",
        emoji: "🦾",
        description: "Recuperou de um drawdown superior a 5%.",
      });
    }
  }

  return Response.json({ ok: true, badges });
}

function stockReturn(stock, livePrices) {
  const c = livePrices[stock.ticker] ?? stock.initialPrice;
  const base = stock.initialPrice ? c / stock.initialPrice - 1 : 0;
  return stock.side === "short" ? -base : base;
}

function portfolioReturn(stocks, livePrices) {
  if (!stocks.length) return 0;
  const rets = stocks.map((s) => stockReturn(s, livePrices));
  return rets.reduce((a, b) => a + b, 0) / rets.length;
}

async function fetchPrices(supabase, tickers) {
  if (!tickers.length) return {};
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()))];
  const { data } = await supabase
    .from("sp500_ath")
    .select("ticker, price")
    .in("ticker", unique);
  const prices = {};
  const missing = new Set(unique);
  for (const r of data || []) {
    const t = r.ticker.toUpperCase();
    if (typeof r.price === "number") {
      prices[t] = r.price;
      missing.delete(t);
    }
  }
  for (const t of missing) {
    try {
      const p = await fetchQuote(t);
      if (typeof p === "number") prices[t] = p;
    } catch {
      // ignora
    }
  }
  return prices;
}
