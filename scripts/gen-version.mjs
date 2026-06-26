// Gera app/version.js no build (prebuild). Em produção (Vercel) usa o SHA do commit →
// muda a cada deploy; localmente fica "dev" (o aviso de nova versão não dispara).
import { writeFileSync } from "node:fs";

const v = process.env.VERCEL_GIT_COMMIT_SHA || "dev";
const out = new URL("../app/version.js", import.meta.url);
writeFileSync(out, `// Gerado por scripts/gen-version.mjs no build — não editar à mão.\nexport const BUILD_VERSION = ${JSON.stringify(v)};\n`);
console.log("version.js →", v);
