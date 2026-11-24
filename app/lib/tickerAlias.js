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

// Dados de apresentação das empresas que tiveram um EVENTO CORPORATIVO (ver StockLogo em components/ui.js). Dois tipos:
//  - "rename":   mudou de nome/símbolo (ATLN → CIRC). Os membros guardaram o símbolo antigo; na interface mostra-se o novo
//                (displayTicker/displayCompany). logoDomain porque o serviço de logótipos tem o símbolo CIRC associado a outra empresa.
//  - "acquired": foi adquirida e saiu de bolsa (WBD, 6-out-2026, ~31,02 USD por ação em dinheiro). A posição fica ao último preço.
export const TICKER_NOTES = {
  ATLN: {
    kind: "rename",
    to: "CIRC",
    company: "Circle8 Group, Inc.",
    logoDomain: "circle8group.com",
    text: "A Atlantic International mudou de nome para Circle8 Group e o símbolo na bolsa passou de ATLN para CIRC. É a mesma empresa e a mesma posição — só o nome mudou. O preço mostrado já é o da CIRC.",
  },
  WBD: {
    kind: "acquired",
    pill: "adquirida",
    headline: "Adquirida pela Paramount",
    text: "A Warner Bros. Discovery foi adquirida pela Paramount (hoje Skydance) a 6 de outubro de 2026 e deixou de estar em bolsa. Os acionistas receberam cerca de 31,02 USD por ação, em dinheiro. Por isso o preço já não se mexe: a posição fica fixa no último preço conhecido (≈ 31 USD).",
  },
};
export const RENAMED = Object.fromEntries(Object.entries(TICKER_NOTES).filter(([, v]) => v.kind === "rename"));

const _up = (t) => String(t || "").trim().toUpperCase();
/** Símbolo a MOSTRAR (ATLN → CIRC). Não usar para consultas: os dados continuam guardados com o símbolo antigo. */
export function displayTicker(ticker) { return RENAMED[_up(ticker)]?.to || ticker; }
/** Nome da empresa a MOSTRAR (a guardada diz "Atlantic International Corp."). */
export function displayCompany(ticker, name) { return RENAMED[_up(ticker)]?.company || name || ticker; }
