import { rateLimited } from "../../../lib/apiGuards";
import { cryptoIdFor } from "../../../lib/crypto";

// Preço ao vivo de cripto via CoinGecko (grátis, sem chave). Server-side (evita CORS/CSP).
// GET ?tickers=BTC-USD,ETH-USD  ->  { prices: { "BTC-USD": 95000, ... } }
export async function GET(request) {
  const rl = rateLimited(request, "crypto-price", { max: 60, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  const url = new URL(request.url);
  const tickers = (url.searchParams.get("tickers") || "")
    .split(",").map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 50);

  const idByTicker = {}; const ids = [];
  for (const t of tickers) {
    const id = cryptoIdFor(t);
    if (id) { idByTicker[t] = id; if (!ids.includes(id)) ids.push(id); }
  }
  if (!ids.length) return Response.json({ data: {} });

  try {
    const r = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(","))}&per_page=250&page=1`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; CDI-PICKER/1.0)", Accept: "application/json" }, cache: "no-store" }
    );
    if (!r.ok) return Response.json({ data: {} });
    const arr = await r.json();
    const byId = {};
    (Array.isArray(arr) ? arr : []).forEach((c) => { if (c && c.id) byId[c.id] = c; });
    const num = (v) => (typeof v === "number" ? v : null);
    const data = {};
    for (const t of tickers) {
      const c = byId[idByTicker[t]];
      if (c) data[t] = {
        price: num(c.current_price),
        marketcap: num(c.market_cap),
        ath: num(c.ath),
        down: typeof c.ath_change_percentage === "number" ? c.ath_change_percentage / 100 : null,
        ath_ts: c.ath_date || null,
      };
    }
    return Response.json({ data });
  } catch {
    return Response.json({ data: {} });
  }
}
