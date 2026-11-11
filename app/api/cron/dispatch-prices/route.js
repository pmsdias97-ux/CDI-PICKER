export const maxDuration = 20;

// Dispara o workflow ath-prices (preços intradiários) no GitHub Actions a partir de um cron da
// Vercel (fiável). Rota dedicada porque os crons da Vercel NÃO aceitam query strings no path
// (ex.: /api/cron/dispatch-ath?wf=ath-prices.yml faz a validação do deploy falhar).
// Protegido por CRON_SECRET. Requer GH_DISPATCH_TOKEN (PAT com Actions: write).
const REPO = process.env.GH_REPO || "pmsdias97-ux/CDI-PICKER";

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return Response.json({ error: "GH_DISPATCH_TOKEN em falta." }, { status: 500 });

  const ref = process.env.GH_REF || "main";
  const gh = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "cdi-picker-cron" };

  // LIMITE: no máximo 3 disparos por dia útil, um por "janela" (UTC): 14:35 (depois da abertura US, verão e inverno),
  // 18:00 (meio da sessão) e 21:20 (depois do fecho, verão e inverno). Esta rota estava a ser chamada de 2 em 2
  // minutos por um agendador externo (~700 execuções/dia do workflow) — agora, por mais vezes que seja chamada, só
  // dispara se ainda NÃO houve nenhuma execução do ath-prices desde o início da janela atual. ?force=1 contorna.
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force) {
    const now = new Date();
    const dow = now.getUTCDay();
    if (dow === 0 || dow === 6) return Response.json({ ok: true, dispatched: null, skipped: "fim de semana" });
    const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const slots = [[14, 35], [18, 0], [21, 20]].map(([h, m]) => day + (h * 60 + m) * 60000);
    const slotStart = slots.filter((t) => t <= now.getTime()).pop();
    if (!slotStart) return Response.json({ ok: true, dispatched: null, skipped: "antes da 1.ª janela (14:35 UTC)" });
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/ath-prices.yml/runs?per_page=1`, { headers: gh, signal: AbortSignal.timeout(10000) });
      if (!r.ok) return Response.json({ ok: false, skipped: "não foi possível ler as execuções — não dispara", status: r.status }, { status: 502 });
      const last = (await r.json())?.workflow_runs?.[0]?.created_at;
      if (last && Date.parse(last) >= slotStart) return Response.json({ ok: true, dispatched: null, skipped: "já correu nesta janela", last });
    } catch (e) {
      return Response.json({ ok: false, skipped: "não foi possível ler as execuções — não dispara", error: e.message }, { status: 502 });
    }
  }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/ath-prices.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "cdi-picker-cron",
        },
        body: JSON.stringify({ ref }),
        signal: AbortSignal.timeout(15000),
      }
    );
    if (res.status === 204) return Response.json({ ok: true, dispatched: "ath-prices.yml", ref });
    const text = await res.text().catch(() => "");
    return Response.json({ ok: false, status: res.status, body: text.slice(0, 300) }, { status: 502 });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 502 });
  }
}
