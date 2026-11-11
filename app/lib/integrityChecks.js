import { isCrypto } from "./crypto";
import { US_MARKET_HOLIDAYS } from "./marketHours";

// VERIFICAÇÕES DE INTEGRIDADE dos dados (só leitura). Apanham os erros que já aconteceram em silêncio:
//  - abertura da semana ≠ fecho da anterior (sync a correr fora de horas: 31-ago, 28-set, 5/12/19-out de 2026);
//  - fecho do mês ≠ abertura do seguinte (monthly-close a gravar o dia errado: setembro de 2026);
//  - semana/mês anterior sem fecho, baselines em falta, pipeline parado, snapshots parados;
//  - escala errada (split não propagado às aberturas: NXTS 1:5 em 9-nov-2026).
// Devolve { problems: [...] } (falham o alerta) e { warnings: [...] } (só informativo — ex.: ATLN sem cotação).
// Usado pelo painel de admin (/api/admin/health) e pelo alerta automático (/api/cron/health-check).
const norm = (s) => String(s || "").toUpperCase().replace(/\./g, "-").trim();
const KNOWN_UNSTABLE = new Set(["ATLN"]); // sem cotação fiável: reconciliação própria, não conta como divergência
const iso = (d) => d.toISOString().slice(0, 10);
function weekKey(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay(); t.setUTCDate(t.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return iso(t);
}
const addDays = (key, n) => iso(new Date(Date.parse(key + "T00:00:00Z") + n * 86400000));
const prevMonth = (ym) => { const [y, m] = ym.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
const isTradingDay = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !US_MARKET_HOLIDAYS.has(iso(d));
// Diferença relevante entre dois preços: ≥0,5% E mais do que 1 cêntimo (penny stocks arredondam: 0.94 vs 0.95).
const differs = (a, b) => a > 0 && b > 0 && Math.abs(a - b) > Math.max(0.005 * b, 0.011);

async function allRows(supabase, table, cols, filter) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(cols).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export async function runIntegrityChecks(supabase, now = new Date()) {
  const problems = [], warnings = [];
  const add = (list, code, msg, tickers) => list.push({ code, msg, ...(tickers && tickers.length ? { tickers: tickers.slice(0, 12), count: tickers.length } : {}) });

  const { data: gs } = await supabase.from("game_settings").select("competition_started").eq("id", 1).maybeSingle();
  if (gs?.competition_started !== true) return { ok: true, problems, warnings, note: "competição não começou" };

  const pfs = await allRows(supabase, "portfolios", "id, portfolio_stocks(ticker)", (q) => q.eq("official", true));
  const held = new Set(); for (const p of pfs) for (const s of p.portfolio_stocks || []) held.add(norm(s.ticker));

  // ---- SEMANA ----
  const curWk = weekKey(now), prevWk = addDays(curWk, -7);
  const wb = await allRows(supabase, "weekly_baselines", "period, ticker, price, close_price", (q) => q.in("period", [curWk, prevWk]));
  const cur = new Map(), prev = new Map();
  for (const r of wb) (r.period === curWk ? cur : prev).set(norm(r.ticker), r);
  if (prev.size) {
    const noClose = [...prev.values()].filter((r) => !(Number(r.close_price) > 0)).map((r) => r.ticker);
    if (noClose.length) add(problems, "week-prev-not-closed", `Semana ${prevWk}: ${noClose.length} ticker(s) sem fecho gravado`, noClose);
  }
  if (cur.size) {
    const missing = [...held].filter((t) => !cur.has(t));
    if (missing.length) add(problems, "week-baseline-missing", `Semana ${curWk}: ${missing.length} ticker(s) de membros sem abertura`, missing);
    const mis = [];
    for (const [t, r] of cur) {
      if (isCrypto(t) || KNOWN_UNSTABLE.has(t)) continue;
      const pc = Number(prev.get(t)?.close_price);
      if (differs(Number(r.price), pc)) mis.push(r.ticker);
    }
    if (mis.length > 5) add(problems, "week-open-mismatch", `Semana ${curWk}: abertura ≠ fecho da semana anterior em ${mis.length} tickers (o sync correu fora de horas?)`, mis);
    else if (mis.length) add(warnings, "week-open-mismatch-few", `Semana ${curWk}: ${mis.length} ticker(s) com abertura ≠ fecho anterior`, mis);
  } else if (now.getUTCDay() !== 0 && now.getUTCDay() !== 6) {
    add(problems, "week-baseline-empty", `Semana ${curWk}: sem baseline nenhum`);
  }

  // ---- MÊS ----
  const curM = iso(now).slice(0, 7), prevM = prevMonth(curM);
  const mb = await allRows(supabase, "monthly_baselines", "period, ticker, price, close_price", (q) => q.in("period", [curM, prevM]));
  const mCur = new Map(), mPrev = new Map();
  for (const r of mb) (r.period === curM ? mCur : mPrev).set(norm(r.ticker), r);
  // 1.º pregão do mês, 16:00 UTC: só a partir daí se exige o baseline do mês e o fecho do anterior.
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); while (!isTradingDay(first)) first.setUTCDate(first.getUTCDate() + 1);
  const monthSettled = now.getTime() >= first.getTime() + 16 * 3600000;
  if (monthSettled) {
    if (!mCur.size) add(problems, "month-baseline-empty", `Mês ${curM}: sem baseline de abertura`);
    else { const missing = [...held].filter((t) => !mCur.has(t)); if (missing.length) add(problems, "month-baseline-missing", `Mês ${curM}: ${missing.length} ticker(s) de membros sem abertura`, missing); }
    if (mPrev.size) {
      const noClose = [...mPrev.values()].filter((r) => !(Number(r.close_price) > 0)).map((r) => r.ticker);
      if (noClose.length) add(problems, "month-prev-not-closed", `Mês ${prevM}: ${noClose.length} ticker(s) sem fecho gravado`, noClose);
      const mis = [];
      for (const [t, r] of mPrev) {
        if (isCrypto(t) || KNOWN_UNSTABLE.has(t)) continue;
        const open = Number(mCur.get(t)?.price);
        if (differs(Number(r.close_price), open)) mis.push(r.ticker);
      }
      if (mis.length > 5) add(problems, "month-close-mismatch", `Mês ${prevM}: fecho ≠ abertura de ${curM} em ${mis.length} tickers (fecho gravado no dia errado?)`, mis);
    }
  }

  // ---- PREÇOS (pipeline) ----
  const ath = await allRows(supabase, "sp500_ath", "symbol, price, updated_at");
  const A = new Map(ath.map((r) => [norm(r.symbol), r]));
  const latest = Math.max(0, ...ath.map((r) => Date.parse(r.updated_at) || 0));
  // Último dia de pregão (hoje incluído): o pipeline tem de ter corrido desde as 06:00 UTC desse dia.
  const lastTd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (now.getUTCHours() < 8) lastTd.setUTCDate(lastTd.getUTCDate() - 1); // antes das 08:00 UTC ainda conta o dia anterior
  while (!isTradingDay(lastTd)) lastTd.setUTCDate(lastTd.getUTCDate() - 1);
  if (latest < lastTd.getTime() + 6 * 3600000) add(problems, "prices-stale", `Pipeline de preços parado: última atualização ${latest ? new Date(latest).toISOString().slice(0, 16) + "Z" : "nunca"}`);
  const stale = [], scale = [], noPrice = [];
  for (const t of held) {
    if (isCrypto(t)) continue;
    const a = A.get(t);
    if (!a || !(Number(a.price) > 0)) { noPrice.push(t); continue; }
    if (latest - Date.parse(a.updated_at) > 4 * 86400000) stale.push(t);
    // Escala: preço atual vs abertura da semana fora de [÷1,8 ; ×1,8] → quase de certeza um split não propagado.
    const open = Number(cur.get(t)?.price);
    if (open > 0 && !KNOWN_UNSTABLE.has(t)) { const r = Number(a.price) / open; if (r > 1.8 || r < 1 / 1.8) scale.push(`${t} (${open}→${a.price})`); }
  }
  if (noPrice.length) add(problems, "price-missing", `${noPrice.length} ticker(s) de membros sem preço no pipeline`, noPrice);
  if (scale.length) add(problems, "price-scale", `Preço vs abertura da semana fora de escala (split por propagar?)`, scale);
  if (stale.length) add(warnings, "price-stale-ticker", `${stale.length} ticker(s) sem cotação há mais de 4 dias (delistado?)`, stale);

  // ---- SNAPSHOTS ----
  const { data: lastSnap } = await supabase.from("portfolio_snapshots").select("captured_at").order("captured_at", { ascending: false }).limit(1).maybeSingle();
  const snapMs = lastSnap?.captured_at ? Date.parse(lastSnap.captured_at) : 0;
  // O último pregão JÁ TERMINADO (antes de hoje) tem de ter pelo menos um snapshot.
  const prevTd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)); while (!isTradingDay(prevTd)) prevTd.setUTCDate(prevTd.getUTCDate() - 1);
  if (snapMs < prevTd.getTime()) add(problems, "snapshots-stale", `Snapshots parados: último em ${snapMs ? new Date(snapMs).toISOString().slice(0, 16) + "Z" : "nunca"}`);

  return { ok: problems.length === 0, checkedAt: now.toISOString(), week: curWk, month: curM, problems, warnings };
}
