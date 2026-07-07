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
