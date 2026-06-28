// Lista curada de ações populares (sobretudo europeias/internacionais) para a procura LOCAL,
// já que o Yahoo Search bloqueia este IP e a lista local (SEC) só tem EUA. Assim "Hermès",
// "LVMH", "Nestlé", etc. ficam pesquisáveis por nome ou ticker. Preço/ATH resolvem na mesma
// (cotação live + pipeline) porque são tickers válidos (ex. RMS.PA).
const RAW = [
  // França (Euronext Paris, .PA)
  ["MC.PA", "LVMH Moët Hennessy"], ["RMS.PA", "Hermès"], ["OR.PA", "L'Oréal"],
  ["TTE.PA", "TotalEnergies"], ["AIR.PA", "Airbus"], ["SU.PA", "Schneider Electric"],
  ["SAN.PA", "Sanofi"], ["BNP.PA", "BNP Paribas"], ["AI.PA", "Air Liquide"],
  ["EL.PA", "EssilorLuxottica"], ["KER.PA", "Kering (Gucci)"], ["DG.PA", "Vinci"],
  ["BN.PA", "Danone"], ["RI.PA", "Pernod Ricard"], ["CAP.PA", "Capgemini"],
  ["CS.PA", "AXA"], ["SGO.PA", "Saint-Gobain"], ["ORA.PA", "Orange"], ["ENGI.PA", "Engie"],
  // Países Baixos (.AS)
  ["ASML.AS", "ASML (Amesterdão)"], ["ADYEN.AS", "Adyen"], ["PRX.AS", "Prosus"],
  ["HEIA.AS", "Heineken"], ["INGA.AS", "ING"], ["AD.AS", "Ahold Delhaize"],
  ["WKL.AS", "Wolters Kluwer"], ["PHIA.AS", "Philips"],
  // Alemanha (.DE)
  ["SAP.DE", "SAP"], ["SIE.DE", "Siemens"], ["ALV.DE", "Allianz"], ["DTE.DE", "Deutsche Telekom"],
  ["MBG.DE", "Mercedes-Benz"], ["BMW.DE", "BMW"], ["VOW3.DE", "Volkswagen"], ["BAS.DE", "BASF"],
  ["BAYN.DE", "Bayer"], ["IFX.DE", "Infineon"], ["ADS.DE", "Adidas"], ["RHM.DE", "Rheinmetall"],
  ["MUV2.DE", "Munich Re"], ["DHL.DE", "DHL Group"], ["DB1.DE", "Deutsche Börse"],
  // Suíça (.SW)
  ["NESN.SW", "Nestlé"], ["ROG.SW", "Roche"], ["NOVN.SW", "Novartis"], ["UBSG.SW", "UBS"],
  ["ZURN.SW", "Zurich Insurance"], ["ABBN.SW", "ABB"], ["CFR.SW", "Richemont"],
  // Itália (.MI)
  ["RACE.MI", "Ferrari"], ["ENEL.MI", "Enel"], ["ISP.MI", "Intesa Sanpaolo"], ["UCG.MI", "UniCredit"], ["ENI.MI", "Eni"],
  // Espanha (.MC)
  ["ITX.MC", "Inditex (Zara)"], ["SAN.MC", "Banco Santander"], ["IBE.MC", "Iberdrola"], ["BBVA.MC", "BBVA"],
];
export const POPULAR = RAW.map(([ticker, name]) => ({ ticker, name }));

const MKT = { PA: "Paris", AS: "Amesterdão", DE: "Frankfurt", SW: "Suíça", L: "Londres", MI: "Milão", MC: "Madrid", CO: "Copenhaga", BR: "Bruxelas", LS: "Lisboa" };
const exFor = (t) => { const p = String(t).toUpperCase().split("."); return p.length > 1 ? (MKT[p[p.length - 1]] || p[p.length - 1]) : ""; };
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();

export function searchPopular(query) {
  const q = norm(query);
  if (!q) return [];
  return POPULAR
    .filter((c) => norm(c.ticker).startsWith(q) || norm(c.name).includes(q))
    .slice(0, 6)
    .map((c) => ({ ticker: c.ticker, name: c.name, exchange: exFor(c.ticker), type: "EQUITY" }));
}
