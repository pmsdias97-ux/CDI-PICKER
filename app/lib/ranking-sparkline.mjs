const DEFAULT_PAGE_SIZE = 1000;

export async function fetchPaginatedRows(
  fetchPage,
  { pageSize = DEFAULT_PAGE_SIZE, isCancelled = () => false, getCursor = (row) => row.id } = {},
) {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError("pageSize must be a positive integer");
  }

  const data = [];
  let cursor = null;

  while (!isCancelled()) {
    const result = await fetchPage(cursor, pageSize);
    if (result?.error) return { data, error: result.error, cancelled: false };

    const page = Array.isArray(result?.data) ? result.data : [];
    data.push(...page);
    if (page.length < pageSize) return { data, error: null, cancelled: false };

    const nextCursor = getCursor(page[page.length - 1]);
    if (nextCursor == null || nextCursor === cursor) {
      return {
        data,
        error: new Error("Snapshot pagination did not advance"),
        cancelled: false,
      };
    }
    cursor = nextCursor;
  }

  return { data, error: null, cancelled: true };
}

export function buildPeriodSparklineSeries(series, periodStart, currentTotal, periodReturn) {
  const all = Array.isArray(series) ? series : [];
  const before = all.filter((point) => point.date < periodStart);
  const inPeriod = all.filter((point) => point.date >= periodStart);
  const startReturn = before.length
    ? before[before.length - 1].r
    : inPeriod.length
      ? inPeriod[0].r
      : (currentTotal ?? 0) - (periodReturn ?? 0);

  return [
    { date: periodStart, r: 0, anchor: true },
    ...inPeriod.map((point) => ({ ...point, r: point.r - startReturn })),
  ];
}

export function prepareSparklinePoints(series, current, today = new Date().toISOString().slice(0, 10)) {
  const points = (Array.isArray(series) ? series : []).map((point) => ({
    date: point.capturedAt || point.date,
    r: point.r,
    anchor: Boolean(point.anchor),
  }));

  if (typeof current === "number") {
    const last = points[points.length - 1];
    if (last && last.date === today && !last.anchor) last.r = current;
    else points.push({ date: today, r: current, anchor: false });
  }

  return points;
}
