// Commodities (futuros) pesquisáveis por nome PT/EN ou ticker. O utilizador adiciona à watchlist e
// o pipeline (yfinance, fora do Vercel) calcula preço + ATH/% abaixo. Sem marketcap (os futuros
// não têm). Tickers Yahoo no formato "XX=F" (ex. CC=F cacau, GC=F ouro).
const RAW = [
  // Agrícolas / soft
  ["CC=F", "Cacau", "Cocoa"],
  ["KC=F", "Café", "Coffee"],
  ["SB=F", "Açúcar", "Sugar"],
  ["CT=F", "Algodão", "Cotton"],
  ["OJ=F", "Sumo de laranja", "Orange Juice"],
  ["ZW=F", "Trigo", "Wheat"],
  ["ZC=F", "Milho", "Corn"],
  ["ZS=F", "Soja", "Soybeans"],
  ["ZO=F", "Aveia", "Oats"],
  ["LE=F", "Gado", "Live Cattle"],
  ["HE=F", "Suínos", "Lean Hogs"],
  // Metais
  ["GC=F", "Ouro", "Gold"],
  ["SI=F", "Prata", "Silver"],
  ["PL=F", "Platina", "Platinum"],
  ["PA=F", "Paládio", "Palladium"],
  ["HG=F", "Cobre", "Copper"],
  // Energia
  ["CL=F", "Petróleo (WTI)", "Crude Oil WTI"],
  ["BZ=F", "Petróleo (Brent)", "Brent Crude"],
  ["NG=F", "Gás natural", "Natural Gas"],
  ["RB=F", "Gasolina", "Gasoline"],
];
export const COMMODITIES = RAW.map(([ticker, name, nameEn]) => ({ ticker, name, nameEn }));

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();

const BY_TICKER = Object.fromEntries(COMMODITIES.map((c) => [c.ticker.toUpperCase(), c.name]));
export function commodityNameFor(ticker) {
  return BY_TICKER[String(ticker || "").toUpperCase()] || null;
}

export function searchCommodities(query) {
  const q = norm(query);
  if (!q) return [];
  return COMMODITIES
    .filter((c) => norm(c.ticker).startsWith(q) || norm(c.name).includes(q) || norm(c.nameEn).includes(q))
    .slice(0, 6)
    .map((c) => ({ ticker: c.ticker, name: c.name, exchange: "Commodity", type: "COMMODITY" }));
}
