import { BUILD_VERSION } from "../../version";

// Devolve a versão do deploy ATUAL (servidor). O cliente compara com a versão que tem
// carregada; se diferirem, mostra o aviso "nova versão". Nunca em cache.
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ v: BUILD_VERSION }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
