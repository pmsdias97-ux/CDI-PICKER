import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const maxDuration = 30;

// AUTO-CORREÇÃO DE SPLITS (justa ao membro).
// O pipeline (GitHub Action, yfinance) deteta splits recentes das ações que os membros
// TÊM e faz POST aqui com { splits: [{symbol, date, factor}] } e Bearer CRON_SECRET.
//
// Quando uma ação faz split, o yfinance reajusta os preços ao vivo para a nova escala mas
// o baseline trancado (initial_price) fica na escala antiga -> rentabilidade fantasma. Aqui
// dividimos o baseline pelo fator do split, mas SÓ para holdings cujo baseline foi trancado
// ANTES da data do split (quem submeteu depois já comprou ao preço pós-split -> justo).
//
// Idempotente: cada split (symbol+data) é aplicado UMA vez, via o ledger applied_stock_splits.
const round2 = (x) => Math.round(x * 100) / 100;

export async function POST(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  let body;
  try { body = await request.json(); } catch { body = null; }
  const incoming = Array.isArray(body?.splits) ? body.splits : null;
  if (!incoming) return Response.json({ error: "Sem splits." }, { status: 400 });

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  // Data de trancamento dos baselines (30-jun): é a data efetiva do baseline de toda a coorte
  // de lançamento (mesmo para quem criou o portefólio antes). É o ANCORA de segurança: só se
  // corrige um split cuja data seja POSTERIOR a esta (senão o baseline já é pós-split).
  // Sem baselines_locked_at NÃO processamos — sem âncora, um split anterior ao lançamento
  // poderia dividir um baseline que já é pós-split (ex.: KLAC 10:1 pré-30-jun -> +782% fantasma).
  const { data: gs, error: gsErr } = await supabase
    .from("game_settings").select("baselines_locked_at").eq("id", 1).maybeSingle();
  if (gsErr) return Response.json({ error: "Falha a ler game_settings." }, { status: 500 });
  if (!gs?.baselines_locked_at) {
    return Response.json({ ok: true, applied: [], skipped: [], note: "baselines_locked_at ausente — nada processado." });
  }
  const lockMs = Date.parse(gs.baselines_locked_at);

  // Splits já aplicados (ledger) -> chave "SYMBOL|YYYY-MM-DD".
  const { data: ledger, error: ledErr } = await supabase
    .from("applied_stock_splits").select("symbol, split_date");
  if (ledErr) return Response.json({ error: "Falha a ler o ledger." }, { status: 500 });
  const done = new Set((ledger || []).map((r) => `${String(r.symbol).toUpperCase()}|${String(r.split_date).slice(0, 10)}`));

  const todayStartIso = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z").toISOString();
  const applied = [];
  const skipped = [];

  for (const s of incoming) {
    const symbol = String(s?.symbol || "").toUpperCase().trim();
    const date = String(s?.date || "").slice(0, 10);
    const factor = Number(s?.factor);
    // Validação: símbolo, data ISO, fator plausível e != 1.
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(factor)
        || factor < 0.02 || factor > 50 || Math.abs(factor - 1) < 0.01) {
      skipped.push({ symbol, date, reason: "inválido" });
      continue;
    }
    if (done.has(`${symbol}|${date}`)) { skipped.push({ symbol, date, reason: "já aplicado" }); continue; }

    // Holdings desta ação (as duas formas de ticker: BRK.B ↔ BRK-B).
    const forms = [...new Set([symbol, symbol.replace(/-/g, "."), symbol.replace(/\./g, "-")])];
    const { data: holds, error: hErr } = await supabase
      .from("portfolio_stocks")
      .select("id, portfolio_id, initial_price, current_price, portfolios!inner(created_at)")
      .in("ticker", forms);
    if (hErr) { skipped.push({ symbol, date, reason: "erro a ler holdings (retry no próximo ciclo)" }); continue; }

    // Corrige só quem trancou o baseline ANTES do split (justo).
    const updates = [];
    const affectedPfs = new Set();
    for (const h of holds || []) {
      const createdMs = Date.parse(h.portfolios?.created_at || "") || 0;
      const effStr = new Date(Math.max(lockMs, createdMs)).toISOString().slice(0, 10);
      if (effStr >= date) continue; // baseline já pós-split -> não mexe
      const init = Number(h.initial_price);
      if (!Number.isFinite(init) || init <= 0) continue;
      const patch = { initial_price: round2(init / factor) };
      const cur = Number(h.current_price);
      if (Number.isFinite(cur) && cur > 0) patch.current_price = round2(cur / factor);
      updates.push({ id: h.id, patch });
      affectedPfs.add(h.portfolio_id);
    }

    // IDEMPOTÊNCIA (ledger-first): regista o split no ledger ANTES de dividir os baselines.
    // Se dividíssemos primeiro e o registo do ledger falhasse, o retry não seria travado pelo
    // `done` e voltaria a dividir os baselines JÁ corrigidos (÷factor a dobrar -> corrupção
    // PERMANENTE do baseline, rentabilidade fantasma). Marcando primeiro, qualquer
    // reprocessamento do mesmo symbol|data é bloqueado pelo `done` -> nunca há dupla divisão.
    // holdings_adjusted = nº que TENCIONAMOS corrigir (pode ser 0 num split sem holdings afetados).
    const { error: insErr } = await supabase.from("applied_stock_splits")
      .upsert({ symbol, split_date: date, factor, holdings_adjusted: updates.length }, { onConflict: "symbol,split_date", ignoreDuplicates: true });
    if (insErr) { skipped.push({ symbol, date, reason: "ledger falhou (nada dividido) — retry seguro" }); continue; }

    // Aplica as correções. Como o split já está no ledger, uma falha aqui NÃO se repete no
    // próximo ciclo (sem risco de dupla divisão); a holding que falhar fica por corrigir e é
    // reportada em `skipped.failed` para correção manual (best-effort: não paramos na 1ª falha).
    let adjusted = 0; const failed = [];
    for (const u of updates) {
      const { error: uErr } = await supabase.from("portfolio_stocks").update(u.patch).eq("id", u.id);
      if (uErr) failed.push(u.id); else adjusted++;
    }

    // Limpa os snapshots de HOJE dos afetados (evita uma cratera fantasma no gráfico;
    // o próximo snapshot horário reconstrói o ponto com o baseline já corrigido).
    if (affectedPfs.size) {
      await supabase.from("portfolio_snapshots").delete()
        .in("portfolio_id", [...affectedPfs]).gte("captured_at", todayStartIso);
    }

    if (failed.length) skipped.push({ symbol, date, reason: `ledger ok, ${failed.length} holding(s) por corrigir — correção manual`, failed });
    applied.push({ symbol, date, factor, adjusted, intended: updates.length });
  }

  return Response.json({ ok: true, applied, skipped });
}
