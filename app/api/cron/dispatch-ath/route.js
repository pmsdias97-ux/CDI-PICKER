export const maxDuration = 20;

// Dispara o workflow de ATH no GitHub Actions a partir de um cron do VERCEL (que é fiável),
// porque o cron do próprio GitHub Actions é best-effort e às vezes simplesmente não corre.
// O trabalho continua no GitHub (o Yahoo dá 429 ao IP do Vercel — daí o pipeline yfinance lá).
// Protegido por CRON_SECRET (o Vercel envia "Authorization: Bearer $CRON_SECRET" nos crons).
// Requer GH_DISPATCH_TOKEN: um PAT fine-grained com permissão Actions: Read and write neste repo.
const REPO = process.env.GH_REPO || "pmsdias97-ux/CDI-PICKER";
// Só estes podem ser disparados (evita disparar workflows arbitrários com o CRON_SECRET).
const ALLOWED = ["ath-full.yml", "ath-prices.yml"];

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  // ?wf=ath-prices.yml (intra-dia, leve) ou ath-full.yml (após fecho, default).
  const wf = new URL(request.url).searchParams.get("wf") || "ath-full.yml";
  if (!ALLOWED.includes(wf)) {
    return Response.json({ error: `wf inválido (usa ${ALLOWED.join(" ou ")}).` }, { status: 400 });
  }

  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return Response.json({ error: "GH_DISPATCH_TOKEN em falta." }, { status: 500 });

  const ref = process.env.GH_REF || "main";
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${wf}/dispatches`,
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
    if (res.status === 204) return Response.json({ ok: true, dispatched: wf, ref });
    const text = await res.text().catch(() => "");
    return Response.json({ ok: false, status: res.status, body: text.slice(0, 300) }, { status: 502 });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 502 });
  }
}
