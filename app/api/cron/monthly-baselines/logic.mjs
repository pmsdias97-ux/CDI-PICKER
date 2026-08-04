export const normTicker = (value) => String(value || "").toUpperCase().replace(/\./g, "-").trim();

export function previousPeriod(period) {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

export function marketDay(now, holidays) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const value = (type) => parts.find((x) => x.type === type)?.value;
  let hour = Number(value("hour")); if (hour === 24) hour = 0;
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  const weekday = value("weekday");
  return {
    date,
    day: Number(value("day")),
    minutes: hour * 60 + Number(value("minute")),
    closed: weekday === "Sat" || weekday === "Sun" || holidays.has(date),
  };
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function isTradingDate(date, holidays) {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6 && !holidays.has(ymd(date));
}

function previousTradingDate(date, holidays) {
  const previous = new Date(date);
  do { previous.setUTCDate(previous.getUTCDate() - 1); } while (!isTradingDate(previous, holidays));
  return previous;
}

export function firstTradingDate(period, holidays) {
  if (!previousPeriod(period)) return null;
  const [year, month] = period.split("-").map(Number);
  const firstTrading = new Date(Date.UTC(year, month - 1, 1));
  while (!isTradingDate(firstTrading, holidays)) firstTrading.setUTCDate(firstTrading.getUTCDate() + 1);
  return ymd(firstTrading);
}

export function isSafeAthWindow(period, market, holidays) {
  const firstTrading = firstTradingDate(period, holidays);
  return firstTrading === market.date && !market.closed && market.minutes < 9 * 60 + 30;
}

// Quando o último pregão do mês anterior é também o último pregão antes da semana,
// mensal e semanal partilham a mesma âncora. Devolve a 2ª feira dessa semana; caso contrário, null.
export function overlappingWeekPeriod(period, holidays) {
  const firstTradingYmd = firstTradingDate(period, holidays);
  if (!firstTradingYmd) return null;
  const [year, month] = period.split("-").map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthAnchor = previousTradingDate(monthStart, holidays);
  const firstTrading = new Date(`${firstTradingYmd}T00:00:00Z`);
  const weekStart = new Date(firstTrading);
  const day = weekStart.getUTCDay();
  weekStart.setUTCDate(weekStart.getUTCDate() + (day === 0 ? -6 : 1 - day));
  const weekAnchor = previousTradingDate(weekStart, holidays);
  return ymd(monthAnchor) === ymd(weekAnchor) ? ymd(weekStart) : null;
}

export function findBaselineTargets(tickers, existingRows, authoritativePrices) {
  const existing = new Map(
    (existingRows || []).filter((row) => Number(row.price) > 0).map((row) => [row.ticker, Number(row.price)])
  );
  return tickers.filter((ticker) => {
    const current = existing.get(ticker);
    if (!(current > 0)) return true;
    const authoritative = authoritativePrices.get(normTicker(ticker));
    return Number.isFinite(authoritative) && authoritative > 0 && authoritative !== current;
  });
}

export function storedBaseline(ticker, weeklyOpen, athPrices, previousClose, allowAthFallback) {
  const key = normTicker(ticker);
  const weekly = weeklyOpen.get(key);
  if (Number.isFinite(weekly) && weekly > 0) return { price: weekly, source: "weeklyOpen" };
  if (allowAthFallback) {
    const ath = athPrices.get(key);
    if (Number.isFinite(ath) && ath > 0) return { price: ath, source: "sp500Ath" };
  }
  const previous = previousClose.get(key);
  if (Number.isFinite(previous) && previous > 0) return { price: previous, source: "previousClose" };
  return null;
}
