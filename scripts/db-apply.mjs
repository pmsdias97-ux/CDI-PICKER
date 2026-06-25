// Aplica um ficheiro .sql à base de dados Supabase, num único comando.
//
//   npm run db:apply supabase/snapshots-intraday.sql
//
// Lê a connection string de SUPABASE_DB_URL no .env.local (gitignored).
// Obtém-na em: Supabase > Project Settings > Database > Connection string > URI
// (serve o "Session pooler" ou a ligação direta). Contém a palavra-passe da BD —
// por isso fica só no .env.local, nunca no repositório.
//
// Corre tudo dentro de uma transação: se algo falhar, faz rollback (nada fica a meio).

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const root = path.resolve(new URL("..", import.meta.url).pathname);

// Carrega o .env.local sem dependências externas.
function loadEnvLocal() {
  let txt;
  try { txt = readFileSync(path.join(root, ".env.local"), "utf8"); }
  catch { return; }
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("✗ Falta SUPABASE_DB_URL no .env.local.");
  console.error("  Copia a 'Connection string' (URI) de Supabase > Project Settings > Database");
  console.error("  e adiciona:  SUPABASE_DB_URL=postgresql://postgres.[ref]:[PASSWORD]@...pooler.supabase.com:5432/postgres");
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  console.error("Uso: npm run db:apply <ficheiro.sql>");
  process.exit(1);
}

const sql = readFileSync(path.resolve(root, file), "utf8");

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log(`✅ Aplicado com sucesso: ${file}`);
} catch (e) {
  try { await client.query("rollback"); } catch {}
  console.error(`✗ Erro ao aplicar ${file} (rollback feito):`);
  console.error("  " + (e.message || e));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
