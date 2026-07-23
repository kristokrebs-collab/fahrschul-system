import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(databaseUrl: string) {
  const sql = postgres(databaseUrl);
  return drizzle(sql, { schema });
}

export function createRawClient(databaseUrl: string) {
  return postgres(databaseUrl);
}

export * as schema from "./schema/index.js";
