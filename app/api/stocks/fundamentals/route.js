import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { fetchFundamentals } from "../../../lib/marketData";
import { isValidTicker, rateLimited } from "../../../lib/apiGuards";

// Fundamentais de um ticker com aprendizagem persistente: cache na BD primeiro,
// depois Alpha Vantage (OVERVIEW), gravando para nunca buscar duas vezes.
export async function GET(request) {
  const rl = rateLimited(request, "stocks-fundamentals", { max: 40, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  const ticker = (new URL(request.url).searchParams.get("ticker") || "").trim().toUpperCase();
  if (!ticker || !isValidTicker(ticker)) {
    return Response.json({ error: "Ticker inválido." }, { status: 400 });
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // 1) Cache aprendido.
  const { data: row } = await supabase
    .from("ticker_fundamentals")
    .select("eps, shares_outstanding, week52_high").eq("ticker", ticker).maybeSingle();
  if (row) {
    return Response.json({ ticker, eps: row.eps, sharesOutstanding: row.shares_outstanding, week52High: row.week52_high, source: "db" });
  }

  // 2) Alpha Vantage, depois persistir (aprender).
  const f = await fetchFundamentals(ticker);
  if (!f) return Response.json({ ticker, eps: null, sharesOutstanding: null, week52High: null });

  await supabase.from("ticker_fundamentals").upsert({
    ticker, eps: f.eps, shares_outstanding: f.sharesOutstanding, week52_high: f.week52High,
  });
  // A mesma resposta OVERVIEW traz o setor — aproveita para preencher e poupar uma chamada futura.
  if (f.sector) await supabase.from("ticker_sectors").upsert({ ticker, sector: f.sector, source: "av" });

  return Response.json({ ticker, eps: f.eps, sharesOutstanding: f.sharesOutstanding, week52High: f.week52High, source: "av" });
}
