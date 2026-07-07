import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

// Lista PÚBLICA de feedback (anónima): devolve só { id, message, created_at } — NUNCA o autor.
// Leitura via service_role porque a tabela tem RLS a negar o anon (o autor não pode escapar).
export async function GET() {
  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (e) { return Response.json({ error: e.message }, { status: 500 }); }

  const { data, error } = await supabase
    .from("member_feedback")
    .select("id, message, created_at")   // sem `author` — anonimato garantido no servidor
    .eq("hidden", false)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ feedback: data || [] });
}
