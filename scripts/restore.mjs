// Restauro da base de dados a partir de um backup JSON (só em emergência).
// Uso: npm run restore -- backups/backup-<...>.json --yes
// Faz UPSERT por chave primária na ordem das dependências (FK). Idempotente:
// repõe linhas apagadas e corrige valores sobrescritos, sem duplicar.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv();

const args = process.argv.slice(2);
const fileArg = args.find((a) => !a.startsWith("--"));
const confirmed = args.includes("--yes");
if (!fileArg) {
  console.error("Uso: npm run restore -- <ficheiro.json> --yes");
  process.exit(1);
}
if (!confirmed) {
  console.error("Falta --yes. Isto vai SOBRESCREVER dados na BD. Repete com --yes para confirmar.");
  process.exit(1);
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local");
  process.exit(1);
}

const path = isAbsolute(fileArg) ? fileArg : join(ROOT, fileArg);
if (!existsSync(path)) { console.error(`Ficheiro não encontrado: ${path}`); process.exit(1); }
const dump = JSON.parse(readFileSync(path, "utf8"));
const tables = dump.tables || {};

// Ordem de dependências (pais antes dos filhos) + chave de conflito do upsert.
const ORDER = [
  ["users", "id"],
  ["game_settings", "id"],
  ["ticker_sectors", "ticker"],
  ["portfolios", "id"],
  ["portfolio_stocks", "id"],
  ["member_pins", "user_id"],
  ["portfolio_snapshots", "id"],
];

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

console.log(`Restauro a partir de ${fileArg} (${dump.meta?.at || "?"})\n`);
for (const [table, onConflict] of ORDER) {
  const rows = tables[table];
  if (!rows || !rows.length) { console.log(`  – ${table}: nada a repor`); continue; }
  // Upsert em lotes de 500.
  let done = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) { console.error(`  ! ${table}: ${error.message}`); process.exit(1); }
    done += batch.length;
  }
  console.log(`  ✓ ${table}: ${done} linhas repostas`);
}

console.log("\n✅ Restauro concluído.");
