// Backup de toda a base de dados (Supabase) para um ficheiro JSON local.
// Uso: npm run backup
// Lê NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY de .env.local.
// O ficheiro vai para backups/ (gitignored) — contém PINs/PII, guarda em local privado.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Carregador mínimo de .env.local (sem dependências, qualquer versão de Node).
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

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local");
  process.exit(1);
}

const TABLES = [
  "users",
  "game_settings",
  "ticker_sectors",
  "portfolios",
  "portfolio_stocks",
  "member_pins",
  "portfolio_snapshots",
];

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

const dump = { meta: { at: new Date().toISOString(), url: URL }, tables: {} };
let totalRows = 0;

for (const table of TABLES) {
  // Paginação para tabelas grandes (Supabase limita a 1000 por pedido).
  let rows = [];
  let from = 0;
  const page = 1000;
  let failed = false;
  for (;;) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + page - 1);
    if (error) { console.warn(`  ! ${table}: ${error.message} (ignorado)`); failed = true; break; }
    rows = rows.concat(data || []);
    if (!data || data.length < page) break;
    from += page;
  }
  if (failed) continue;
  dump.tables[table] = rows;
  totalRows += rows.length;
  console.log(`  ✓ ${table}: ${rows.length} linhas`);
}

const dir = join(ROOT, "backups");
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = join(dir, `backup-${stamp}.json`);
writeFileSync(file, JSON.stringify(dump, null, 2), "utf8");

console.log(`\n✅ Backup gravado: backups/backup-${stamp}.json (${totalRows} linhas no total)`);
