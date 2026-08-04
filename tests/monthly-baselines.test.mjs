import assert from "node:assert/strict";
import test from "node:test";

import {
  firstTradingDate,
  findBaselineTargets,
  isSafeAthWindow,
  marketDay,
  normTicker,
  overlappingWeekPeriod,
  previousPeriod,
  storedBaseline,
} from "../app/api/cron/monthly-baselines/logic.mjs";

const holidays = new Set(["2026-09-07"]);

test("previousPeriod validates months and crosses the year boundary", () => {
  assert.equal(previousPeriod("2026-08"), "2026-07");
  assert.equal(previousPeriod("2027-01"), "2026-12");
  assert.equal(previousPeriod("2026-13"), null);
  assert.equal(previousPeriod("August"), null);
});

test("marketDay distinguishes the weekend, a trading day and a holiday in New York", () => {
  const saturday = marketDay(new Date("2026-08-01T13:00:00Z"), holidays);
  assert.deepEqual(saturday, { date: "2026-08-01", day: 1, minutes: 540, closed: true });

  const monday = marketDay(new Date("2026-08-03T13:00:00Z"), holidays);
  assert.deepEqual(monday, { date: "2026-08-03", day: 3, minutes: 540, closed: false });

  const holiday = marketDay(new Date("2026-09-07T13:00:00Z"), holidays);
  assert.equal(holiday.closed, true);
});

test("overlappingWeekPeriod detects when monthly and weekly anchors are identical", () => {
  assert.equal(overlappingWeekPeriod("2026-08", holidays), "2026-08-03");
  assert.equal(overlappingWeekPeriod("2026-09", holidays), null);
  assert.equal(overlappingWeekPeriod("2027-01", new Set(["2027-01-01"])), "2027-01-04");
});

test("ATH is allowed only before the first trading session, never on a retry day", () => {
  assert.equal(firstTradingDate("2026-08", holidays), "2026-08-03");
  assert.equal(firstTradingDate("2027-01", new Set(["2027-01-01"])), "2027-01-04");
  const firstDay = marketDay(new Date("2026-09-01T13:00:00Z"), holidays);
  const retryDay = marketDay(new Date("2026-09-02T13:00:00Z"), holidays);
  assert.equal(isSafeAthWindow("2026-09", firstDay, holidays), true);
  assert.equal(isSafeAthWindow("2026-09", retryDay, holidays), false);
});

test("findBaselineTargets repairs missing and divergent rows without touching valid rows", () => {
  const tickers = ["AAPL", "MSFT", "BTC"];
  const existing = [{ ticker: "AAPL", price: 210 }, { ticker: "MSFT", price: 400 }];
  const weekly = new Map([["AAPL", 210], ["MSFT", 405], ["BTC", 27.81]]);
  assert.deepEqual(findBaselineTargets(tickers, existing, weekly), ["MSFT", "BTC"]);
});

test("storedBaseline prefers a coincident weekly baseline", () => {
  const weekly = new Map([["BTC", 27.81]]);
  const ath = new Map([["BTC", 28.16]]);
  const previous = new Map([["BTC", 27.81]]);
  assert.deepEqual(storedBaseline("BTC", weekly, ath, previous, true), {
    price: 27.81,
    source: "weeklyOpen",
  });
  assert.deepEqual(storedBaseline("BTC", weekly, ath, previous, false), {
    price: 27.81,
    source: "weeklyOpen",
  });
});

test("storedBaseline uses settled ATH before a stale monthly close only in the safe window", () => {
  const weekly = new Map();
  const previous = new Map([["ATLN", 0.9]]);
  const ath = new Map([["ATLN", 0.75]]);
  assert.deepEqual(storedBaseline("ATLN", weekly, ath, previous, true), {
    price: 0.75,
    source: "sp500Ath",
  });
  assert.deepEqual(storedBaseline("ATLN", weekly, ath, previous, false), {
    price: 0.9,
    source: "previousClose",
  });
  assert.equal(normTicker(" brk.b "), "BRK-B");
});
