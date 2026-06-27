// Lista curada de cripto (top ~34) — símbolo, id CoinGecko, nome.
// Serve para: (a) procura LOCAL fiável (não depende do Yahoo, que bloqueia o IP) e
// (b) mapear o símbolo (ex. "BTC-USD") -> id CoinGecko para ir buscar o preço.
const RAW = [
  ["BTC", "bitcoin", "Bitcoin"],
  ["ETH", "ethereum", "Ethereum"],
  ["USDT", "tether", "Tether"],
  ["BNB", "binancecoin", "BNB"],
  ["SOL", "solana", "Solana"],
  ["XRP", "ripple", "XRP"],
  ["USDC", "usd-coin", "USD Coin"],
  ["ADA", "cardano", "Cardano"],
  ["DOGE", "dogecoin", "Dogecoin"],
  ["TRX", "tron", "TRON"],
  ["AVAX", "avalanche-2", "Avalanche"],
  ["SHIB", "shiba-inu", "Shiba Inu"],
  ["LINK", "chainlink", "Chainlink"],
  ["DOT", "polkadot", "Polkadot"],
  ["BCH", "bitcoin-cash", "Bitcoin Cash"],
  ["NEAR", "near", "NEAR Protocol"],
  ["LTC", "litecoin", "Litecoin"],
  ["UNI", "uniswap", "Uniswap"],
  ["ICP", "internet-computer", "Internet Computer"],
  ["ETC", "ethereum-classic", "Ethereum Classic"],
  ["XLM", "stellar", "Stellar"],
  ["ATOM", "cosmos", "Cosmos"],
  ["XMR", "monero", "Monero"],
  ["APT", "aptos", "Aptos"],
  ["FIL", "filecoin", "Filecoin"],
  ["ARB", "arbitrum", "Arbitrum"],
  ["OP", "optimism", "Optimism"],
  ["HBAR", "hedera-hashgraph", "Hedera"],
  ["VET", "vechain", "VeChain"],
  ["MKR", "maker", "Maker"],
  ["AAVE", "aave", "Aave"],
  ["ALGO", "algorand", "Algorand"],
  ["SUI", "sui", "Sui"],
  ["PEPE", "pepe", "Pepe"],
];
export const CRYPTOS = RAW.map(([sym, id, name]) => ({ sym, id, name }));
const BY_SYM = new Map(CRYPTOS.map((c) => [c.sym, c]));

const baseSym = (t) => String(t || "").toUpperCase().replace(/-USD$/, "").trim();

export function cryptoIdFor(ticker) { const c = BY_SYM.get(baseSym(ticker)); return c ? c.id : null; }
export function isCrypto(ticker) { return BY_SYM.has(baseSym(ticker)); }
export function cryptoNameFor(ticker) { const c = BY_SYM.get(baseSym(ticker)); return c ? c.name : null; }

// Resultados no mesmo formato da procura de ações: {ticker:"BTC-USD", name, exchange, type}.
export function searchCryptos(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  return CRYPTOS
    .filter((c) => c.sym.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q))
    .slice(0, 5)
    .map((c) => ({ ticker: `${c.sym}-USD`, name: c.name, exchange: "Cripto", type: "CRYPTO" }));
}
