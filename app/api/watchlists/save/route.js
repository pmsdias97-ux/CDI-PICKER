import { rateLimited, isValidTicker } from "../../../lib/apiGuards";
import { authOwner } from "../../../lib/watchlistAuth";

// Cria (sem id) ou atualiza (com id: renomeia / atualiza tickers) uma watchlist.
// POST { name, pin, id?, listName, tickers[] }.
export async function POST(request) {
  const rl = rateLimited(request, "wl-save", { max: 40, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiados pedidos." }, { status: 429 });

  let body; try { body = await request.json(); } catch { body = null; }
  const a = await authOwner(body?.name, body?.pin);
  if (a.error) return Response.json({ error: a.error }, { status: a.status });

  const id = body?.id ? String(body.id) : null;
  const listName = String(body?.listName || "").trim();
  if (!listName) return Response.json({ error: "Falta o nome da lista." }, { status: 400 });
  if (listName.length > 60) return Response.json({ error: "Nome demasiado longo." }, { status: 400 });

  const tickers = Array.isArray(body?.tickers)
    ? [...new Set(body.tickers.map(t => String(t || "").toUpperCase().trim()).filter(t => t && isValidTicker(t)))].slice(0, 500)
    : [];
  const now = new Date().toISOString();

  const handle = (data, error) => {
    if (error) {
      if (error.code === "23505") return Response.json({ error: "Já tens uma lista com esse nome." }, { status: 409 });
      return Response.json({ error: "Não foi possível guardar a lista." }, { status: 500 });
    }
    if (!data) return Response.json({ error: "Lista não encontrada." }, { status: 404 });
    return Response.json({ ok: true, list: { id: data.id, name: data.list_name, tickers: Array.isArray(data.tickers) ? data.tickers : [] } });
  };

  if (id) {
    const { data, error } = await a.supabase.from("watchlists")
      .update({ list_name: listName, tickers, updated_at: now })
      .eq("id", id).eq("user_id", a.userId)
      .select("id, list_name, tickers").maybeSingle();
    return handle(data, error);
  }

  // Limite suave de listas por utilizador.
  const { count } = await a.supabase.from("watchlists")
    .select("id", { count: "exact", head: true }).eq("user_id", a.userId);
  if ((count || 0) >= 30) return Response.json({ error: "Atingiste o limite de listas." }, { status: 400 });

  const { data, error } = await a.supabase.from("watchlists")
    .insert({ user_id: a.userId, list_name: listName, tickers, updated_at: now })
    .select("id, list_name, tickers").maybeSingle();
  return handle(data, error);
}
