import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

/**
 * Einfacher, deterministischer Migrationsläufer für die handgeschriebenen
 * numerierten SQL-Dateien unter migrations/. Jede Datei läuft genau einmal,
 * in einer eigenen Transaktion, und wird in schema_migrations protokolliert.
 */
export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const sql = postgres(databaseUrl, { max: 1 });
  const applied: string[] = [];
  try {
    await sql`create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )`;

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const already = await sql`select 1 from schema_migrations where filename = ${file}`;
      if (already.length > 0) {
        continue;
      }
      const content = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`insert into schema_migrations (filename) values (${file})`;
      });
      applied.push(file);
    }
    return applied;
  } finally {
    await sql.end();
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL ist nicht gesetzt (siehe .env.example)");
  }
  const applied = await runMigrations(databaseUrl);
  if (applied.length === 0) {
    console.log("Keine neuen Migrationen. Schema ist aktuell.");
  } else {
    console.log(`Angewendete Migrationen: ${applied.join(", ")}`);
  }
}

// Nur ausführen, wenn direkt aufgerufen (nicht beim Import in Tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
