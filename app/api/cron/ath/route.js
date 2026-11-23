import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const maxDuration = 60;

// Ingestão dos PREÇOS do jogo (ações dos membros). Chamada pelo GitHub Action (Python/yfinance) com
// Authorization: Bearer $CRON_SECRET. Recebe { rows: [{symbol, price, prev_close?}] } e faz upsert em sp500_ath.
// O Python envia linhas UNIFORMES (mesmas chaves em cada POST): o upsert em lote do PostgREST mete NULL nas
// colunas que faltam a algumas linhas do lote.
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
  // Escreve só as colunas que vêm no payload (uniformes por lote). null fica null (nunca 0).
  const clean = [];
  for (const r of rows) {
    const symbol = String(r?.symbol || "").toUpperCase().trim();
    if (!symbol) continue;
    const row = { symbol, updated_at: now };
    if ("price" in r) row.price = num(r.price);
    if ("prev_close" in r) row.prev_close = num(r.prev_close);
    clean.push(row);
  }
  if (!clean.length) return Response.json({ error: "Linhas inválidas." }, { status: 400 });

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // PREV_CLOSE "ROLADO" para tickers SEM histórico no Yahoo (ex.: ATLN, que chega via chart-fallback
  // só com o preço): se a linha traz preço mas NÃO traz prev_close, e o preço GUARDADO é de um dia
  // (ET) anterior, então o guardado era o último preço da sessão anterior → torna-se o prev_close.
  // Dá variação diária a estes tickers sem nenhuma fonte externa nova; nos dias seguintes o ciclo
  // repete-se (o 1º preço de cada dia rola o de ontem). Linhas com prev_close próprio ficam intactas.
  const etDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const rollSyms = clean.filter((r) => "price" in r && r.price != null && !("prev_close" in r)).map((r) => r.symbol);
  if (rollSyms.length) {
    const todayET = etDay(new Date());
    const stored = new Map();
    for (let i = 0; i < rollSyms.length; i += 300) {
      const part = rollSyms.slice(i, i + 300);
      const { data } = await supabase.from("sp500_ath").select("symbol, price, updated_at").in("symbol", part);
      for (const r of data || []) stored.set(r.symbol, r);
    }
    for (const r of clean) {
      if (!("price" in r) || r.price == null || "prev_close" in r) continue;
      const s = stored.get(r.symbol);
      const p = s ? Number(s.price) : null;
      if (s && Number.isFinite(p) && p > 0 && etDay(new Date(s.updated_at)) < todayET) r.prev_close = p;
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
