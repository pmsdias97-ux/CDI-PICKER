import { maybeDispatchPrices } from "../../../lib/pricesDispatch";

export const maxDuration = 20;

// Dispara o workflow ath-prices (preços das ações dos membros) no GitHub Actions. Chamada pelos crons da Vercel
// (14:35, 18:00 e 21:20 UTC) e, se quiseres, por um agendador externo. Rota dedicada porque os crons da Vercel NÃO
// aceitam query strings no path. Protegida por CRON_SECRET; requer GH_DISPATCH_TOKEN (PAT com Actions: write).
//
// LIMITE (em lib/pricesDispatch.js): no máximo 1 disparo por 14 min, só em dias úteis entre as 14:30 e as 21:30 UTC
// (a margem até 21:30 apanha o fecho oficial no cron das 21:20), por mais vezes que seja chamada. ?force=1 contorna.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  const force = new URL(request.url).searchParams.get("force") === "1";
  const out = await maybeDispatchPrices({ untilMin: 21 * 60 + 30, force });
  return Response.json(out, { status: out.ok === false ? 502 : 200 });
}
