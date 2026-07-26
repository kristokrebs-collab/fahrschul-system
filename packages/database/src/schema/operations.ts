import { bigint, boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * PROMPT -1 / Phase 4 §14/§15 – Betriebsprotokoll: Sicherungen und Rollouts.
 * Rohe DDL in `packages/database/migrations/0010_backup_and_deployment.sql`;
 * diese Datei ist die getypte Abbildung für Zugriffe aus `apps/api` und aus
 * den Betriebsskripten.
 *
 * Beide Tabellen sind BETRIEBSPROTOKOLL, nicht Fachzustand: keine
 * `version`-Spalte (§4 gilt für Fachdaten), keine Outbox-Ereignisse (§5 gilt
 * für fachliche Ereignisse), keine Invarianten. Eine Zeile hier macht keine
 * Buchung gültig oder ungültig.
 */

/**
 * §14: eine Zeile je ausgeführter Sicherung.
 *
 * `verifiedAt` ist der Zweck der Tabelle: es unterscheidet ein Backup, das
 * existiert, von einem Backup, das nachweislich zurückspielbar war. Nur der
 * zweite Fall öffnet das §15-Tor für eine zerstörende Migration
 * (`assertDestructiveAllowed` in `../migrate.ts`).
 */
export const backupRuns = pgTable("backup_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Eindeutiges, menschenlesbares Label – der Wert von `MIGRATION_BACKUP_REF`. */
  label: text("label").notNull().unique(),
  /** `logical` (pg_dump) | `physical` (pg_basebackup) | `wal` (archivierte Segmente). */
  kind: text("kind").notNull(),
  /** Im Produktivbetrieb ein Speicherort GETRENNT von der Datenbank (§14). */
  location: text("location").notNull(),
  encryption: text("encryption"),
  /** Schlüsselkennung, NIE der Schlüssel. */
  keyId: text("key_id"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  checksumSha256: text("checksum_sha256"),
  /** Konsistenzpunkt – Grundlage der RPO-Aussage. */
  consistentAt: timestamp("consistent_at", { withTimezone: true }),
  walLsn: text("wal_lsn"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  /** `laufend` | `erfolgreich` | `fehlgeschlagen` | `verworfen`. */
  status: text("status").notNull().default("laufend"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifyMethod: text("verify_method"),
  verifyDetails: jsonb("verify_details"),
  /** Gemessene Wiederherstellungsdauer – Grundlage der RTO-Aussage. */
  restoreDurationMs: integer("restore_duration_ms"),
  error: text("error"),
  ausgeloestVon: text("ausgeloest_von"),
  deploymentId: text("deployment_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * §15: eine Zeile je Rollout (nicht je Prozess).
 *
 * `destructive` + `backupRef` sind die beiden Felder, die einen Rollback
 * planbar machen: ein Code-Rollback ist billig, ein zurückgenommener
 * Schemaschritt nicht – und ohne die Angabe, auf welches Backup sich der
 * Rollout gestützt hat, ist "wir rollen zurück" eine Absicht ohne Ziel.
 */
export const deployments = pgTable("deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  deploymentId: text("deployment_id").notNull(),
  releaseChannel: text("release_channel").notNull(),
  version: text("version"),
  gitCommit: text("git_commit"),
  migrationsApplied: jsonb("migrations_applied").notNull().default([]),
  destructive: boolean("destructive").notNull().default(false),
  backupRef: text("backup_ref"),
  approvedBy: text("approved_by"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** `laufend` | `erfolgreich` | `fehlgeschlagen` | `zurueckgerollt`. */
  status: text("status").notNull().default("laufend"),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
  rollbackReason: text("rollback_reason"),
  rollbackTo: text("rollback_to"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
