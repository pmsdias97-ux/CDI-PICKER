import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { runIntegrityChecks } from "../../../lib/integrityChecks";

export const maxDuration = 30;

// ALERTA AUTOMÁTICO de integridade (só leitura). Chamado pelo GitHub Action health-check.yml com
// Authorization: Bearer $CRON_SECRET. Devolve sempre 200 com { ok, problems, warnings }; é o WORKFLOW que
// falha quando há problemas — e o GitHub envia email ao dono do repositório quando um workflow agendado falha.
// Assim os erros de dados deixam de ser descobertos pelos membros.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return Response.json({ error: "Não autorizado." }, { status: 401 });
  let supabase; try { supabase = getSupabaseAdmin(); } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
  try {
    return Response.json(await runIntegrityChecks(supabase, new Date()));
  } catch (e) {
    return Response.json({ ok: false, problems: [{ code: "check-failed", msg: String(e?.message || e) }], warnings: [] });
  }
}
