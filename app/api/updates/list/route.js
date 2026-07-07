import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

// Lista pública dos updates PUBLICADOS (recap diário). Devolve só campos seguros
// (day, body) — nunca draft_lines. Leitura via service_role porque a tabela tem RLS
// a negar o anon (o draft nunca pode escapar). Mais recente primeiro.
export async function GET() {
  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { data, error } = await supabase
    .from("platform_updates")
    .select("day, body, published_at")
    .eq("status", "published")
    .order("day", { ascending: false })
    .limit(30);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const updates = (data || [])
    .filter((r) => r.body && r.body.trim())
    .map((r) => ({ day: r.day, body: r.body }));
  return Response.json({ updates });
}
