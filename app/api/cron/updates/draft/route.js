import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

export const maxDuration = 20;

// RASCUNHO AUTOMÁTICO dos updates: a GitHub Action (on push) envia os assuntos dos commits do dia.
// Acumula-os em platform_updates.draft_lines da linha do `day` (append + dedup), SEM tocar no
// body/status. O admin usa isto como semente e reescreve conciso/não-técnico antes de publicar.
// Protegido por CRON_SECRET (Authorization: Bearer $CRON_SECRET). Rota sob /api/cron (mesma família).
export async function POST(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  let body;
  try { body = await request.json(); } catch { body = null; }
  const day = String(body?.day || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return Response.json({ error: "day inválido (YYYY-MM-DD)." }, { status: 400 });
  const incoming = (Array.isArray(body?.lines) ? body.lines : [])
    .map((l) => String(l || "").trim())
    .filter(Boolean)
    .slice(0, 100);
  if (!incoming.length) return Response.json({ ok: true, day, added: 0 });

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { data: existing } = await supabase
    .from("platform_updates").select("draft_lines").eq("day", day).maybeSingle();

  const prev = Array.isArray(existing?.draft_lines) ? existing.draft_lines : [];
  const seen = new Set(prev);
  const merged = [...prev];
  for (const l of incoming) { if (!seen.has(l)) { seen.add(l); merged.push(l); } }

  const { error } = await supabase
    .from("platform_updates")
    .upsert({ day, draft_lines: merged, updated_at: new Date().toISOString() }, { onConflict: "day" });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, day, total: merged.length, added: merged.length - prev.length });
}
