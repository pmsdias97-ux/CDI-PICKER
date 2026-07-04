import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { usMarketOpen } from "../../../lib/marketHours";

export const maxDuration = 30;

// MINI-ÉPOCA SEMANAL ("Campeão da semana"). Toda a 2ª feira (à abertura US) grava o preço de
// INÍCIO DA SEMANA de cada ticker em competição. O período é a data da SEGUNDA-FEIRA (UTC) da
// semana, 'YYYY-MM-DD'. A rentabilidade semanal (no cliente) = média de (preço_atual/baseline−1),
// espelhada p/ shorts — a MESMA fórmula do total, só com o baseline da semana. Justo ao membro.
//
// Fonte dos preços: sp500_ath (Supabase→Supabase, sem chamadas externas). Idempotente: cada semana
// é capturada UMA vez (guard + PK). Se a 2ª for feriado, apanha na 3ª/4ª sob a MESMA chave (2ª feira).
// Protegido por CRON_SECRET (Authorization: Bearer $CRON_SECRET). ?force=1 ignora os guards.
const norm = (s) => String(s || "").toUpperCase().replace(/\./g, "-").trim();

// Chave da semana = a SEGUNDA-FEIRA (UTC) da semana da data dada, 'YYYY-MM-DD'.
function weekKey(d) {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (dt.getUTCDay() + 6) % 7; // 0=2ª … 6=domingo
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const now = new Date();
  // Período = 2ª feira da semana atual (UTC). ?period=YYYY-MM-DD força um período à mão (com CRON_SECRET).
  const period = url.searchParams.get("period") || weekKey(now);

  // O jogo semanal ao vivo arranca na Semana 2 (6-jul). A Semana 1 (1–3 jul) é um registo fixo
  // (semeado no cliente) → nunca capturar baselines de semanas anteriores a WEEK_LIVE_FROM.
  const WEEK_LIVE_FROM = "2026-07-06";
  if (!force && period < WEEK_LIVE_FROM) {
    return Response.json({ ok: true, period, captured: 0, skipped: "semana pré-arranque (antes de WEEK_LIVE_FROM)" });
  }

  // Janela de captura: só no INÍCIO da semana (2ª a 4ª, dias 1–3). Se a 2ª for feriado, a 3ª/4ª
  // apanham na mesma sob a chave da 2ª feira. O guard de idempotência garante 1× por semana.
  const dow = now.getUTCDay(); // 0=dom, 1=2ª … 6=sáb
  if (!force && (dow < 1 || dow > 3)) {
    return Response.json({ ok: true, period, captured: 0, skipped: "fora da janela de captura (2ª–4ª)" });
  }
  // Só com o mercado aberto → os preços do sp500_ath estão frescos (o pipeline corre em pregão).
  if (!force && !usMarketOpen(now)) {
    return Response.json({ ok: true, period, captured: 0, skipped: "mercado fechado" });
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // A mini-época semanal só faz sentido depois de a competição arrancar (baselines trancados).
  const { data: gs } = await supabase
    .from("game_settings").select("competition_started").eq("id", 1).maybeSingle();
  if (gs?.competition_started !== true) {
    return Response.json({ ok: true, period, captured: 0, skipped: "competição não começou" });
  }

  // Idempotência: se esta semana já foi capturada, não repete.
  const { data: existing, error: exErr } = await supabase
    .from("weekly_baselines").select("period").eq("period", period).limit(1);
  if (exErr) return Response.json({ error: "Falha a ler weekly_baselines." }, { status: 500 });
  if (existing && existing.length) {
    return Response.json({ ok: true, period, captured: 0, skipped: "semana já capturada" });
  }

  // Tickers em competição = portefólios OFICIAIS de utilizadores que submeteram.
  const { data: rows, error } = await supabase
    .from("portfolios")
    .select("official, users!inner(has_submitted_portfolio), portfolio_stocks(ticker)");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const tickers = [...new Set(
    (rows || [])
      .filter((r) => r.official === true && r.users?.has_submitted_portfolio)
      .flatMap((r) => (r.portfolio_stocks || []).map((s) => s.ticker))
      .filter(Boolean)
  )];
  if (!tickers.length) return Response.json({ ok: true, period, captured: 0, skipped: "sem tickers" });

  // Preços frescos do sp500_ath (a MESMA fonte dos baselines trancados → escala coerente).
  const { data: ath, error: athErr } = await supabase.from("sp500_ath").select("symbol, price");
  if (athErr) return Response.json({ error: "Falha a ler sp500_ath." }, { status: 500 });
  const priceMap = new Map();
  for (const r of ath || []) {
    const p = Number(r.price);
    if (Number.isFinite(p) && p > 0) priceMap.set(norm(r.symbol), p);
  }

  const capturedAt = now.toISOString();
  const baselines = [];
  const skippedTickers = [];
  for (const ticker of tickers) {
    const p = priceMap.get(norm(ticker)); // guarda o ticker CRU (casa com portfolio_stocks no cliente)
    if (Number.isFinite(p) && p > 0) baselines.push({ period, ticker, price: p, captured_at: capturedAt });
    else skippedTickers.push(ticker); // sem preço no pipeline (ex.: BTC) → cliente cai no preço inicial
  }
  if (!baselines.length) return Response.json({ ok: true, period, captured: 0, skipped: "sem preços" });

  const { error: upErr } = await supabase
    .from("weekly_baselines")
    .upsert(baselines, { onConflict: "period,ticker", ignoreDuplicates: true });
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

  return Response.json({ ok: true, period, captured: baselines.length, skippedTickers });
}
