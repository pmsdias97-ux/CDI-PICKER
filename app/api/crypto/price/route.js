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
  if (!ids.length) return Response.json({ prices: {} });

  try {
    const r = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; CDI-PICKER/1.0)", Accept: "application/json" }, cache: "no-store" }
    );
    if (!r.ok) return Response.json({ prices: {} });
    const d = await r.json();
    const prices = {};
    for (const t of tickers) {
      const id = idByTicker[t];
      const p = id && d[id] ? d[id].usd : null;
      if (typeof p === "number") prices[t] = p;
    }
    return Response.json({ prices });
  } catch {
    return Response.json({ prices: {} });
  }
}
