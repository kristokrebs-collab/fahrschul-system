import { beforeAll, describe, expect, it } from "vitest";
import { createRawClient } from "@fahrschul/database";
import { ensureMigrated, testDatabaseUrl } from "./helpers.js";

describe("migrations", () => {
  const databaseUrl = testDatabaseUrl();

  beforeAll(async () => {
    await ensureMigrated(databaseUrl);
  });

  it("apply cleanly and are idempotent (running twice applies nothing new)", async () => {
    // ensureMigrated in beforeAll already applied everything once.
    const { runMigrations } = await import("@fahrschul/database");
    const secondRun = await runMigrations(databaseUrl);
    expect(secondRun).toEqual([]);
  });

  it("create all expected core tables", async () => {
    const sql = createRawClient(databaseUrl);
    try {
      const rows = await sql`
        select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
      `;
      const tableNames = rows.map((r) => r.table_name);
      for (const expected of [
        "organisationen",
        "standorte",
        "benutzer",
        "sessions",
        "schueler",
        "fahrlehrer",
        "ausbildungen",
        "verfuegbarkeiten",
        "fahrzeuge",
        "terminangebote",
        "terminbuchungen",
        "rechnungen",
        "zahlungen",
        "dokumente",
        "audit_events",
      ]) {
        expect(tableNames).toContain(expected);
      }
    } finally {
      await sql.end();
    }
  });

  it("enforces the no-overlap exclusion constraint at the database level", async () => {
    const sql = createRawClient(databaseUrl);
    try {
      const constraints = await sql`
        select conname from pg_constraint where conname like 'terminbuchungen_no_overlap%'
      `;
      expect(constraints.map((c) => c.conname).sort()).toEqual([
        "terminbuchungen_no_overlap_fahrlehrer",
        "terminbuchungen_no_overlap_fahrzeug",
      ]);
    } finally {
      await sql.end();
    }
  });
});
