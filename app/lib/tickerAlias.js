// Tickers que MUDARAM de símbolo na bolsa mas que os membros guardaram com o símbolo antigo (portfolio_stocks.ticker,
// baselines, rankings). Continuamos a chamar-lhes pelo nome antigo em todo o lado; só ao falar com o Yahoo/CNBC
// é que se usa o símbolo atual. Mantém em sincronia com ALIAS em scripts/ath/fetch_ath.py.
//   ATLN → CIRC: Atlantic International passou a Circle8 Group (Nasdaq: CIRC) por volta de 3-set-2026; o Yahoo
//   deixou de ter dados em ATLN (o preço ficou congelado em 0,90 enquanto a ação real caiu para ~0,16).
export const TICKER_ALIAS = { ATLN: "CIRC" };

export function yahooSymbol(ticker) {
  const t = String(ticker || "").trim().toUpperCase();
  return TICKER_ALIAS[t] || t;
}
