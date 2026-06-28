import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { isCrypto } from "../../../lib/crypto";

// Tickers que os membros TÊM (portfolio_stocks) ou VIGIAM (watchlists) — para o pipeline ATH
// calcular ATH/marketcap também para estes. Exclui cripto (tratado via CoinGecko, live).
// Protegido por Bearer CRON_SECRET (só o GitHub Action chama). GET.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const set = new Set();
  // Exclui cripto (CoinGecko) e futuros/commodities (têm "=", ex. CC=F — o Yahoo limita-os e penduram o pipeline).
  const add = (t) => { const s = String(t || "").toUpperCase().trim(); if (s && !s.includes("=") && !isCrypto(s)) set.add(s); };

  try {
    const { data } = await supabase.from("portfolio_stocks").select("ticker");
    (data || []).forEach((r) => add(r.ticker));
  } catch {}
  try {
    const { data } = await supabase.from("watchlists").select("tickers");
    (data || []).forEach((r) => { const arr = Array.isArray(r.tickers) ? r.tickers : []; arr.forEach(add); });
  } catch {}

  return Response.json({ ok: true, tickers: [...set] });
}
