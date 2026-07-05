import { rateLimited } from "../../../lib/apiGuards";
import { authOwner } from "../../../lib/watchlistAuth";

// POST { name, pin, portfolioId } → alterna o gosto (1 por pessoa por portefólio; PK garante-o).
export async function POST(request) {
  const rl = rateLimited(request, "like-toggle", { max: 60, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body; try { body = await request.json(); } catch { body = null; }
  const a = await authOwner(body?.name, body?.pin);
  if (a.error) return Response.json({ error: a.error }, { status: a.status });

  const portfolioId = String(body?.portfolioId || "").trim();
  if (!portfolioId) return Response.json({ error: "Portefólio inválido." }, { status: 400 });

  const { data: existing } = await a.supabase
    .from("portfolio_likes").select("portfolio_id")
    .eq("portfolio_id", portfolioId).eq("user_id", a.userId).maybeSingle();

  if (existing) {
    const { error } = await a.supabase.from("portfolio_likes")
      .delete().eq("portfolio_id", portfolioId).eq("user_id", a.userId);
    if (error) return Response.json({ error: "Não foi possível remover o gosto." }, { status: 500 });
    return Response.json({ ok: true, liked: false });
  }
  const { error } = await a.supabase.from("portfolio_likes")
    .insert({ portfolio_id: portfolioId, user_id: a.userId });
  if (error && error.code !== "23505") return Response.json({ error: "Não foi possível dar gosto." }, { status: 500 });
  return Response.json({ ok: true, liked: true });
}
