// Helper partilhado pelos gatilhos: cria uma notificação para um destinatário.
// Best-effort — NUNCA deixa rebentar a ação principal (comentar/reagir/fechar semana) se falhar.
// `supabase` = cliente service_role (getSupabaseAdmin, já obtido pela rota chamadora).
export async function createNotification(supabase, { userId, type, title, body = null, link = null, actorName = null }) {
  if (!supabase || !userId || !type || !title) return;
  try {
    await supabase.from("notifications").insert({
      user_id: userId, type, title,
      body, link, actor_name: actorName,
    });
  } catch { /* best-effort: ignora falhas de notificação */ }
}
