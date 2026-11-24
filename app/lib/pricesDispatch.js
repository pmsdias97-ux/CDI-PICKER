// Dispara o workflow ath-prices (preços das ações dos membros) no GitHub Actions, no MÁXIMO uma vez por
// MIN_GAP_MS e só dentro da janela da sessão (14:30–21:00 UTC, dias úteis). Fonte única da regra "15 em 15 minutos":
//  - a rota /api/stocks/prices chama-a (via after()) quando o mercado está aberto e os preços têm >13 min → quem
//    abre a plataforma põe os preços ao dia, sem depender de agendadores (GitHub/Vercel Hobby falham/atrasam);
//  - a rota /api/cron/dispatch-prices (crons da Vercel às 14:35, 18:00 e 21:20) usa a mesma regra (até 21:30, p/
//    apanhar o fecho oficial) → se alguém a chamar de mais, o limite mantém-se.
// O intervalo é verificado contra a ÚLTIMA execução no GitHub (vale para todas as instâncias serverless).
// Requer GH_DISPATCH_TOKEN (PAT com Actions: write). Sem token → não faz nada.
const REPO = process.env.GH_REPO || "pmsdias97-ux/CDI-PICKER";
const WORKFLOW = "ath-prices.yml";
export const MIN_GAP_MS = 14 * 60 * 1000;
const WINDOW_START_MIN = 14 * 60 + 30; // 14:30 UTC
export const SESSION_END_MIN = 21 * 60; // 21:00 UTC
let lastCheckAt = 0; // por instância: não consultar o GitHub mais de 1×/min

function ghHeaders(token) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "cdi-picker-cron" };
}

export async function maybeDispatchPrices({ untilMin = SESSION_END_MIN, force = false, now = new Date() } = {}) {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return { ok: false, skipped: "GH_DISPATCH_TOKEN em falta" };
  const ref = process.env.GH_REF || "main";
  if (!force) {
    const dow = now.getUTCDay();
    if (dow === 0 || dow === 6) return { ok: true, dispatched: null, skipped: "fim de semana" };
    const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (mins < WINDOW_START_MIN || mins >= untilMin) return { ok: true, dispatched: null, skipped: "fora da janela 14:30–21:00 UTC" };
    if (Date.now() - lastCheckAt < 60000) return { ok: true, dispatched: null, skipped: "verificado há <1 min" };
    lastCheckAt = Date.now();
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1`, { headers: ghHeaders(token), signal: AbortSignal.timeout(10000) });
      if (!r.ok) return { ok: false, skipped: "não foi possível ler as execuções — não dispara", status: r.status };
      const last = (await r.json())?.workflow_runs?.[0]?.created_at;
      if (last && Date.now() - Date.parse(last) < MIN_GAP_MS) return { ok: true, dispatched: null, skipped: "já correu há <14 min", last };
    } catch (e) {
      return { ok: false, skipped: "não foi possível ler as execuções — não dispara", error: e.message };
    }
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: { ...ghHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 204) return { ok: true, dispatched: WORKFLOW, ref };
    return { ok: false, status: res.status, body: (await res.text().catch(() => "")).slice(0, 300) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
