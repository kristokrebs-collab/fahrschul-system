import {
  bigint,
  bigserial,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { benutzer, standorte } from "./core.js";
import { dokumente } from "./billing.js";
import { schueler } from "./people.js";

/**
 * PROMPT -1 / Phase 3 – §17 Defense in Depth, §12 Upload-Härtung,
 * §11 Ausfallsicherheit externer Schnittstellen.
 *
 * Rohe DDL in packages/database/migrations/0009_defense_in_depth.sql; diese
 * Datei ist die getypte Abbildung für Query-Builder-Zugriffe aus apps/api.
 */

// ---------------------------------------------------------------------------
// §17 Brute-Force-Schutz (persistiert – ein Neustart setzt keinen Angriff zurück)
// ---------------------------------------------------------------------------
export const authThrottle = pgTable(
  "auth_throttle",
  {
    /** 'account' (Schlüssel = E-Mail, kleingeschrieben) oder 'ip'. */
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    failures: integer("failures").notNull().default(0),
    firstFailureAt: timestamp("first_failure_at", { withTimezone: true }).notNull().defaultNow(),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lockCount: integer("lock_count").notNull().default(0),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
    unlockedByBenutzerId: uuid("unlocked_by_benutzer_id").references(() => benutzer.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.scope, t.key] }) }),
);

// ---------------------------------------------------------------------------
// §12 Resumable Uploads (+ Aufräumen abgebrochener Uploads)
// ---------------------------------------------------------------------------
export const uploadSessions = pgTable("upload_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  benutzerId: uuid("benutzer_id")
    .notNull()
    .references(() => benutzer.id, { onDelete: "cascade" }),
  schuelerId: uuid("schueler_id").references(() => schueler.id),
  typ: text("typ").notNull(),
  dateiname: text("dateiname").notNull(),
  deklarierterMimeTyp: text("deklarierter_mime_typ"),
  erwarteteGroesseBytes: integer("erwartete_groesse_bytes").notNull(),
  empfangeneBytes: integer("empfangene_bytes").notNull().default(0),
  erwarteteChecksumSha256: text("erwartete_checksum_sha256"),
  checksumSha256: text("checksum_sha256"),
  status: text("status").notNull().default("offen"),
  idempotencyKey: text("idempotency_key"),
  teile: jsonb("teile").notNull().default([]),
  speicherReferenz: text("speicher_referenz"),
  dokumentId: uuid("dokument_id").references(() => dokumente.id),
  fehler: text("fehler"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// §11 Circuit-Breaker-Zustand + Gesundheit je Integration
// ---------------------------------------------------------------------------
export const integrationHealth = pgTable("integration_health", {
  integration: text("integration").primaryKey(),
  mode: text("mode").notNull().default("mock"),
  /** closed | open | half_open */
  breakerState: text("breaker_state").notNull().default("closed"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  consecutiveSuccesses: integer("consecutive_successes").notNull().default(0),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  probeAfter: timestamp("probe_after", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastError: text("last_error"),
  lastErrorClass: text("last_error_class"),
  rateLimitedUntil: timestamp("rate_limited_until", { withTimezone: true }),
  totalCalls: bigint("total_calls", { mode: "number" }).notNull().default(0),
  totalFailures: bigint("total_failures", { mode: "number" }).notNull().default(0),
  totalShortCircuited: bigint("total_short_circuited", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * §11 Puffer UND Fehlerwarteschlange für ausgehende Aufrufe. Ein Ausfall
 * verliert nichts und meldet keinen falschen Erfolg: die Änderung liegt hier
 * als `buffered` und wird automatisch oder manuell wieder aufgenommen.
 */
export const integrationOutboundCalls = pgTable("integration_outbound_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  integration: text("integration").notNull(),
  operation: text("operation").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payload: jsonb("payload").notNull().default({}),
  status: text("status").notNull().default("buffered"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(8),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  lastErrorClass: text("last_error_class"),
  correlationId: uuid("correlation_id"),
  standortId: uuid("standort_id").references(() => standorte.id),
  akteurBenutzerId: uuid("akteur_benutzer_id").references(() => benutzer.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByBenutzerId: uuid("resolved_by_benutzer_id").references(() => benutzer.id),
  result: jsonb("result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * §17: Nur zur Typisierung der Hash-Kettenspalten von `audit_events`
 * (die Tabelle selbst bleibt in schema/audit.ts, damit bestehende Importe
 * unverändert bleiben – Expand-Contract auch im Code).
 */
export const auditChainColumns = {
  chainSeq: bigserial("chain_seq", { mode: "number" }),
  prevHash: text("prev_hash"),
  rowHash: text("row_hash"),
} as const;
