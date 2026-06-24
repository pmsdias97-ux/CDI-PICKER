import { checkAdminPassword, rateLimited, clientIp } from "../../../lib/apiGuards";

// Gates the admin UI. The real protection is each admin action re-checking the
// password server-side — this just avoids showing the panel to everyone.
export async function POST(request) {
  const rl = rateLimited(request, "admin-verify", { max: 10, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Demasiadas tentativas. Tenta mais tarde." }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!checkAdminPassword(body?.password)) {
    console.warn(`[admin] password incorreta ip=${clientIp(request)}`);
    return Response.json({ error: "Palavra-passe incorreta." }, { status: 401 });
  }
  return Response.json({ ok: true });
}
