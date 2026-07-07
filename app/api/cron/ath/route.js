import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const maxDuration = 60; // upsert de ~500 linhas

// Ingestão dos dados da aba ATH (S&P 500). Chamada pelo GitHub Action (Python/yfinance) com
// Authorization: Bearer $CRON_SECRET. Recebe { rows: [...] } e faz upsert em sp500_ath.
// O Python envia linhas UNIFORMES e completas (mesmas chaves) → upsert consistente.
export async function POST(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  let body;
  try { body = await request.json(); } catch { body = null; }
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows || !rows.length) return Response.json({ error: "Sem linhas." }, { status: 400 });

  const now = new Date().toISOString();
  const num = (v) => (v == null || v === "" ? null : (Number.isFinite(+v) ? +v : null));
  // Escreve só as colunas que vêm no payload (uniformes por lote) — assim o modo "prices"
  // não toca em marketcap/name/ath. null fica null (nunca 0).
  const clean = [];
  for (const r of rows) {
    const symbol = String(r?.symbol || "").toUpperCase().trim();
    if (!symbol) continue;
    const row = { symbol, updated_at: now };
    if ("name" in r) row.name = r.name == null ? null : String(r.name).slice(0, 120);
    if ("price" in r) row.price = num(r.price);
    if ("prev_close" in r) row.prev_close = num(r.prev_close);
    if ("marketcap" in r) row.marketcap = num(r.marketcap);
    if ("shares" in r) row.shares = num(r.shares);
    if ("ath" in r) row.ath = num(r.ath);
    if ("ath_ts" in r) row.ath_ts = r.ath_ts || null;
    if ("in_sp500" in r) row.in_sp500 = r.in_sp500 === true;
    clean.push(row);
  }
  if (!clean.length) return Response.json({ error: "Linhas inválidas." }, { status: 400 });

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // ATH AO VIVO: o modo "prices" (hora a hora) só traz o preço, não o ath. Se o preço de agora
  // ultrapassar o ath JÁ CONHECIDO, é um novo máximo → bumpa aqui (senão o ATH só atualizaria no
  // "full" diário das 06:00 UTC, ANTES da abertura US → novos ATHs intradiários ficavam de fora).
  // NB: só SOBE um ath existente (nunca inventa: se o ath for null, deixa null — quem estabelece o
  // máximo histórico é o "full"; fabricar ath=preço marcaria a ação "no máximo" mesmo estando abaixo).
  const bumpSyms = clean.filter((r) => !("ath" in r) && r.price != null).map((r) => r.symbol);
  if (bumpSyms.length) {
    const athMap = new Map();
    for (let i = 0; i < bumpSyms.length; i += 300) {
      const part = bumpSyms.slice(i, i + 300);
      const { data } = await supabase.from("sp500_ath").select("symbol, ath").in("symbol", part);
      for (const r of data || []) athMap.set(r.symbol, r.ath == null ? null : +r.ath);
    }
    for (const r of clean) {
      if ("ath" in r || r.price == null) continue;
      const cur = athMap.get(r.symbol);
      if (cur != null && r.price > cur) { r.ath = r.price; r.ath_ts = now; } // só sobe um máximo conhecido
    }
  }

  let upserted = 0;
  for (let i = 0; i < clean.length; i += 200) {
    const batch = clean.slice(i, i + 200);
    const { error } = await supabase.from("sp500_ath").upsert(batch, { onConflict: "symbol" });
    if (error) return Response.json({ error: error.message, upserted }, { status: 500 });
    upserted += batch.length;
  }
  return Response.json({ ok: true, upserted });
}
