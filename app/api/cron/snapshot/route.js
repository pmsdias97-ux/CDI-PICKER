import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { fetchQuote } from "../../../lib/marketData";

export const maxDuration = 60; // muitos tickers → damos folga à função

// Feriados de FECHO TOTAL da bolsa US (NYSE/Nasdaq), na janela da competição
// (jul/2026 → jun/2027). Datas em hora de Nova Iorque (ET).
const US_MARKET_HOLIDAYS = new Set([
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
const US_MARKET_HALF_DAYS = new Set([
  "2026-11-27", // dia a seguir ao Thanksgiving
  "2026-12-24", // véspera de Natal
]);

// Mercado de ações dos EUA aberto? Dias úteis (excl. feriados), 9:30–16:15 ET
// (15 min de folga p/ o snapshot de fecho; 13:15 nos meios-dias). Usa o fuso
// "America/New_York" → trata do horário de verão/inverno automaticamente.
// Evita gravar/chamar a API com o mercado fechado (cotações repetidas).
function usMarketOpen(now) {
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

// Corre N tarefas com concorrência limitada (não rebenta a função nem martela a API).
async function mapPool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

// Snapshot do retorno de cada portefólio para os gráficos (evolução / season race).
// Pode correr várias vezes por dia (ex.: 2×) — cada corrida grava um ponto por
// "slot" (hora arredondada), por isso re-runs no mesmo slot não duplicam.
// Secured by CRON_SECRET: o gatilho envia `Authorization: Bearer $CRON_SECRET`.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  // Só gravamos com o mercado aberto (senão as cotações repetem-se → pontos "achatados").
  // ?force=1 permite forçar à mão (testes), continuando a exigir o CRON_SECRET.
  const now = new Date();
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force && !usMarketOpen(now)) {
    return Response.json({ ok: true, snapshots: 0, skipped: "mercado fechado" });
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // Snapshot rules:
  //   - DEMO (official=false): sempre (mostra uma amostra da evolução desde já).
  //   - OFICIAL (official=true): só depois de a competição arrancar (1 jul) — antes
  //     disso as rentabilidades são provisórias e o baseline ainda vai ser reposto.
  const { data: gs } = await supabase
    .from("game_settings").select("competition_started").eq("id", 1).maybeSingle();
  const started = gs?.competition_started === true;

  // Only portfolios whose user has submitted.
  const { data: rows, error } = await supabase
    .from("portfolios")
    .select("id, official, users!inner(has_submitted_portfolio), portfolio_stocks(ticker, initial_price, side)");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const portfolios = (rows || []).filter(
    (r) => r.users?.has_submitted_portfolio && (r.official === false || started)
  );
  if (!portfolios.length) return Response.json({ ok: true, snapshots: 0 });

  // One price lookup per unique ticker (Yahoo→CNBC fallback, cached), em paralelo
  // limitado para a corrida caber no tempo da função mesmo com muitos membros.
  const tickers = [...new Set(portfolios.flatMap((p) => (p.portfolio_stocks || []).map((s) => s.ticker)))];
  const prices = {};
  const quotes = await mapPool(tickers, 5, async (t) => [t, await fetchQuote(t)]);
  for (const [t, p] of quotes) if (typeof p === "number") prices[t] = p;

  // captured_at = instante da corrida arredondado à hora (o "slot" intraday).
  const slot = new Date(now);
  slot.setUTCMinutes(0, 0, 0);
  const capturedAt = slot.toISOString();
  const date = now.toISOString().slice(0, 10);
  const snapshots = [];
  for (const pf of portfolios) {
    const stocks = pf.portfolio_stocks || [];
    if (!stocks.length) continue;
    const rets = stocks.map((s) => {
      const init = Number(s.initial_price);
      const cur = typeof prices[s.ticker] === "number" ? prices[s.ticker] : init;
      const base = init ? cur / init - 1 : 0;
      return s.side === "short" ? -base : base; // short = espelho
    });
    const total = rets.reduce((a, b) => a + b, 0) / rets.length;
    snapshots.push({ portfolio_id: pf.id, date, captured_at: capturedAt, total_return: total });
  }

  if (!snapshots.length) return Response.json({ ok: true, snapshots: 0 });

  const { error: upErr } = await supabase
    .from("portfolio_snapshots")
    .upsert(snapshots, { onConflict: "portfolio_id,captured_at" });
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

  return Response.json({ ok: true, snapshots: snapshots.length, date, captured_at: capturedAt });
}
