import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { fetchSector } from "../../../lib/marketData";
import { isValidTicker, rateLimited } from "../../../lib/apiGuards";

export const maxDuration = 30;

// Resolves a ticker's sector with persistent learning: DB cache first, then
// Alpha Vantage, saving the result so it's never fetched twice.
export async function GET(request) {
  const rl = rateLimited(request, "stocks-sector", { max: 40, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  const ticker = (new URL(request.url).searchParams.get("ticker") || "").trim().toUpperCase();
  if (!ticker || !isValidTicker(ticker)) {
    return Response.json({ error: "Ticker inválido." }, { status: 400 });
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // 1) Learned cache.
  const { data: row } = await supabase
    .from("ticker_sectors").select("sector").eq("ticker", ticker).maybeSingle();
  if (row?.sector) return Response.json({ ticker, sector: row.sector, source: "db" });

  // 2) Alpha Vantage, then persist (learn).
  const sector = await fetchSector(ticker);
  if (!sector) return Response.json({ ticker, sector: null });

  await supabase.from("ticker_sectors").upsert({ ticker, sector, source: "av" });
  return Response.json({ ticker, sector, source: "av" });
}
