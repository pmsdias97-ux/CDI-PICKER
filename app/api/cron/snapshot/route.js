import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { fetchQuote } from "../../../lib/marketData";
import { usMarketOpen } from "../../../lib/marketHours";

export const maxDuration = 60; // muitos tickers → damos folga à função

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
