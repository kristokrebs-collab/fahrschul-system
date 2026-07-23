import { createDatabase, type Database } from "@fahrschul/database";

let cached: { url: string; db: Database } | null = null;

/**
 * Einfacher, pro-URL gecachter DB-Handle. Tests übergeben DATABASE_URL_TEST
 * über eine eigene Instanz statt den Cache zu teilen (siehe
 * apps/api/src/__tests__/helpers.ts).
 */
export function getDb(databaseUrl: string): Database {
  if (!cached || cached.url !== databaseUrl) {
    cached = { url: databaseUrl, db: createDatabase(databaseUrl) };
  }
  return cached.db;
}
