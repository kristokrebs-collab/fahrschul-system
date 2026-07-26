import {
  bigint,
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { benutzer, standorte } from "./core.js";
import { auditEreignisse } from "./audit.js";

/**
 * PROMPT -1 / Phase 1 – Zuverlässigkeitskern. Rohe DDL in
 * packages/database/migrations/0007_reliability_core.sql; diese Datei ist die
 * getypte Abbildung für Query-Builder-Zugriffe aus apps/api.
 */

// ---------------------------------------------------------------------------
// §2 Idempotenz
// ---------------------------------------------------------------------------
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operation: text("operation").notNull(),
    key: text("key").notNull(),
    benutzerId: uuid("benutzer_id").references(() => benutzer.id),
    standortId: uuid("standort_id").references(() => standorte.id),
    /** SHA-256 über den kanonisierten Request – erkennt Key-Wiederverwendung mit anderem Body. */
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull().default("in_progress"),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    entitaet: text("entitaet"),
    entitaetId: uuid("entitaet_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ operationKeyUnique: unique("idempotency_keys_operation_key_key").on(t.operation, t.key) }),
);

// ---------------------------------------------------------------------------
// §5 Outbox / Inbox / Cursor
// ---------------------------------------------------------------------------
export const eventSchemaVersions = pgTable("event_schema_versions", {
  eventType: text("event_type").primaryKey(),
  version: integer("version").notNull().default(1),
  beschreibung: text("beschreibung"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Transaktionale Outbox. Zeilen werden NIE vom Anwendungscode eingefügt,
 * sondern vom Trigger `audit_events_outbox_trg` in derselben Transaktion wie
 * das Audit-Ereignis (und damit wie die fachliche Änderung). Damit ist das
 * verbotene Muster "DB geändert und danach hoffentlich Nachricht gesendet"
 * strukturell ausgeschlossen.
 */
export const eventOutbox = pgTable("event_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  seq: bigserial("seq", { mode: "number" }).notNull(),
  auditEventId: uuid("audit_event_id")
    .notNull()
    .references(() => auditEreignisse.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  eventVersion: integer("event_version").notNull().default(1),
  aggregateType: text("aggregate_type"),
  aggregateId: uuid("aggregate_id"),
  correlationId: uuid("correlation_id"),
  standortId: uuid("standort_id").references(() => standorte.id),
  payload: jsonb("payload").notNull().default({}),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(8),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  lastError: text("last_error"),
  errorClass: text("error_class"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Consumer-Inbox: der Unique-Index (consumer, event_id) IST die Deduplizierung. */
export const eventInbox = pgTable(
  "event_inbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    consumer: text("consumer").notNull(),
    eventId: uuid("event_id").notNull(),
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").notNull().default(1),
    outcome: text("outcome").notNull().default("processed"),
    result: jsonb("result"),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ consumerEventUnique: unique("event_inbox_consumer_event_key").on(t.consumer, t.eventId) }),
);

export const eventCursors = pgTable("event_cursors", {
  consumer: text("consumer").primaryKey(),
  lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
  lastEventId: uuid("last_event_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// §13 Job-Store + Dead-Letter-Queue (§9 Serverseite)
// ---------------------------------------------------------------------------
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobType: text("job_type").notNull(),
  /** Idempotente Einplanung: nur EIN offener Job pro (job_type, dedupe_key). */
  dedupeKey: text("dedupe_key"),
  payload: jsonb("payload").notNull().default({}),
  status: text("status").notNull().default("pending"),
  priority: integer("priority").notNull().default(100),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  maxRuntimeSeconds: integer("max_runtime_seconds").notNull().default(60),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  result: jsonb("result"),
  lastError: text("last_error"),
  errorClass: text("error_class"),
  correlationId: uuid("correlation_id"),
  standortId: uuid("standort_id").references(() => standorte.id),
  akteurBenutzerId: uuid("akteur_benutzer_id").references(() => benutzer.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deadLetters = pgTable(
  "dead_letters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    sourceId: uuid("source_id").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default({}),
    attempts: integer("attempts").notNull().default(0),
    errorClass: text("error_class"),
    lastError: text("last_error"),
    auditKontext: jsonb("audit_kontext").notNull().default({}),
    alarmEmittedAt: timestamp("alarm_emitted_at", { withTimezone: true }),
    resumedAt: timestamp("resumed_at", { withTimezone: true }),
    resumedByBenutzerId: uuid("resumed_by_benutzer_id").references(() => benutzer.id),
    resumedJobId: uuid("resumed_job_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ sourceUnique: unique("dead_letters_source_key").on(t.source, t.sourceId) }),
);

// ---------------------------------------------------------------------------
// §10 State Machines
// ---------------------------------------------------------------------------
export const stateTransitions = pgTable("state_transitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  machine: text("machine").notNull(),
  entitaetId: uuid("entitaet_id").notNull(),
  vonStatus: text("von_status"),
  nachStatus: text("nach_status").notNull(),
  akteurBenutzerId: uuid("akteur_benutzer_id").references(() => benutzer.id),
  grund: text("grund"),
  correlationId: uuid("correlation_id"),
  quelle: text("quelle"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stateMachineTransitions = pgTable(
  "state_machine_transitions",
  {
    machine: text("machine").notNull(),
    vonStatus: text("von_status").notNull(),
    nachStatus: text("nach_status").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.machine, t.vonStatus, t.nachStatus] }) }),
);

export const pruefungTransitionsTable = pgTable(
  "pruefung_transitions",
  {
    vonStatus: text("von_status").notNull(),
    nachStatus: text("nach_status").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.vonStatus, t.nachStatus] }) }),
);

// ---------------------------------------------------------------------------
// §19 Konsistenzprüfung
// ---------------------------------------------------------------------------
export const consistencyCheckRuns = pgTable("consistency_check_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  gestartetAt: timestamp("gestartet_at", { withTimezone: true }).notNull().defaultNow(),
  beendetAt: timestamp("beendet_at", { withTimezone: true }),
  status: text("status").notNull().default("laufend"),
  anzahlBefunde: integer("anzahl_befunde").notNull().default(0),
  bericht: jsonb("bericht"),
  ausgeloestDurch: text("ausgeloest_durch").notNull().default("job"),
  akteurBenutzerId: uuid("akteur_benutzer_id").references(() => benutzer.id),
  fehler: text("fehler"),
});

export const consistencyFindings = pgTable("consistency_findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => consistencyCheckRuns.id, { onDelete: "cascade" }),
  pruefung: text("pruefung").notNull(),
  schweregrad: text("schweregrad").notNull(),
  entitaet: text("entitaet").notNull(),
  entitaetId: uuid("entitaet_id"),
  beschreibung: text("beschreibung").notNull(),
  vorschlag: text("vorschlag"),
  /** Riskante Reparaturen sind AUSSCHLIESSLICH Vorschläge – nie automatisch angewendet. */
  vorschlagRiskant: boolean("vorschlag_riskant").notNull().default(true),
  vorschlagAngewendet: boolean("vorschlag_angewendet").notNull().default(false),
  kontext: jsonb("kontext").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
