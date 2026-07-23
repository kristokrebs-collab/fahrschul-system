import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { benutzer, standorte } from "./core.js";

/**
 * Ein Audit-Log für alle sensiblen Schreibvorgänge UND (mit type=<EventType>)
 * das versionierte Event-Log aus Spec Schritt 6 (lead.created,
 * lesson.booked, ...). Statt zweier separater Tabellen wird bewusst eine
 * gemeinsame Tabelle genutzt (siehe Aufgabenstellung: "oder just reuse
 * audit_events with a type column").
 */
export const auditEreignisse = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  aktion: text("aktion").notNull(),
  entitaet: text("entitaet").notNull(),
  entitaetId: uuid("entitaet_id"),
  akteurBenutzerId: uuid("akteur_benutzer_id").references(() => benutzer.id),
  standortId: uuid("standort_id").references(() => standorte.id),
  source: text("source").notNull(),
  correlationId: uuid("correlation_id").notNull(),
  idempotencyKey: text("idempotency_key"),
  vorher: jsonb("vorher"),
  nachher: jsonb("nachher"),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
