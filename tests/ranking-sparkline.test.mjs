import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPeriodSparklineSeries,
  fetchPaginatedRows,
  prepareSparklinePoints,
} from "../app/lib/ranking-sparkline.mjs";

test("fetchPaginatedRows reads beyond the Supabase 1000-row response limit", async () => {
  const source = Array.from({ length: 2305 }, (_, index) => ({ id: index + 1 }));
  const cursors = [];
  const result = await fetchPaginatedRows(async (cursor, limit) => {
    cursors.push(cursor);
    const start = cursor == null ? 0 : source.findIndex((row) => row.id > cursor);
    return { data: source.slice(start, start + limit), error: null };
  });

  assert.equal(result.error, null);
  assert.equal(result.cancelled, false);
  assert.equal(result.data.length, 2305);
  assert.deepEqual(cursors, [null, 1000, 2000]);
});

test("fetchPaginatedRows stops without exposing an incomplete result after cancellation", async () => {
  let cancelled = false;
  const result = await fetchPaginatedRows(async () => {
    cancelled = true;
    return { data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null };
  }, { isCancelled: () => cancelled });

  assert.equal(result.cancelled, true);
  assert.equal(result.data.length, 1000);
});

test("the weekly anchor is preserved when the period starts today", () => {
  const series = buildPeriodSparklineSeries([], "2026-08-03", 0.0618, 0.0618);
  const points = prepareSparklinePoints(series, 0.0618, "2026-08-03");

  assert.equal(points.length, 2);
  assert.deepEqual(points.map(({ date, r, anchor }) => ({ date, r, anchor })), [
    { date: "2026-08-03", r: 0, anchor: true },
    { date: "2026-08-03", r: 0.0618, anchor: false },
  ]);
});

test("the monthly sparkline still joins its calendar anchor to today's return", () => {
  const series = buildPeriodSparklineSeries([], "2026-08-01", 0.0618, 0.0618);
  const points = prepareSparklinePoints(series, 0.0618, "2026-08-03");

  assert.equal(points.length, 2);
  assert.deepEqual(points.map((point) => point.date), ["2026-08-01", "2026-08-03"]);
});

test("intraday captured_at values remain distinct and the live point is appended", () => {
  const series = buildPeriodSparklineSeries([
    { date: "2026-08-03", capturedAt: "2026-08-03T15:00:00+00:00", r: 0.01 },
    { date: "2026-08-03", capturedAt: "2026-08-03T16:00:00+00:00", r: 0.02 },
  ], "2026-08-03", 0.03, 0.03);
  const points = prepareSparklinePoints(series, 0.03, "2026-08-03");

  assert.deepEqual(points.map((point) => point.date), [
    "2026-08-03",
    "2026-08-03T15:00:00+00:00",
    "2026-08-03T16:00:00+00:00",
    "2026-08-03",
  ]);
});

test("a date-only snapshot from today is updated instead of duplicated", () => {
  const points = prepareSparklinePoints([{ date: "2026-08-03", r: 0.01 }], 0.02, "2026-08-03");

  assert.deepEqual(points, [{ date: "2026-08-03", r: 0.02, anchor: false }]);
});
