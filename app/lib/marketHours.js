// Horário do mercado de ações dos EUA (NYSE/Nasdaq), partilhado entre o cron de
// snapshots e o arranque oficial (trancar baselines só após o fecho).

// Feriados de FECHO TOTAL da bolsa US, na janela da competição (jul/2026 → jun/2027).
// Datas em hora de Nova Iorque (ET).
export const US_MARKET_HOLIDAYS = new Set([
  "2026-07-03", // Independence Day (4 jul é sábado → observado sexta)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
  "2027-01-01", // New Year's Day
  "2027-01-18", // Martin Luther King Jr. Day
  "2027-02-15", // Presidents' Day
  "2027-03-26", // Good Friday
  "2027-05-31", // Memorial Day
  "2027-06-18", // Juneteenth (19 jun é sábado → observado sexta)
]);
// Meios-dias (fecho antecipado às 13:00 ET).
export const US_MARKET_HALF_DAYS = new Set([
  "2026-11-27", // dia a seguir ao Thanksgiving
  "2026-12-24", // véspera de Natal
]);

// Mercado de ações dos EUA aberto? Dias úteis (excl. feriados), 9:30–16:15 ET
// (15 min de folga p/ o snapshot de fecho; 13:15 nos meios-dias). Usa o fuso
// "America/New_York" → trata do horário de verão/inverno automaticamente.
export function usMarketOpen(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const v = (t) => parts.find((x) => x.type === t)?.value;
  const wd = v("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const dateET = `${v("year")}-${v("month")}-${v("day")}`;
  if (US_MARKET_HOLIDAYS.has(dateET)) return false;
  let h = parseInt(v("hour"), 10); if (h === 24) h = 0;
  const mins = h * 60 + parseInt(v("minute"), 10);
  const close = US_MARKET_HALF_DAYS.has(dateET) ? 13 * 60 + 15 : 16 * 60 + 15; // 13:15 ou 16:15 ET
  return mins >= 570 && mins <= close; // abertura 9:30 (570 min)
}
