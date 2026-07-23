import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { standorte } from "./core.js";
import { benutzer } from "./core.js";
import { fahrlehrer, schueler } from "./people.js";
import { terminbuchungen } from "./scheduling.js";

/**
 * Prompt 3 (apps/instructor) – neue Tabellen. Siehe
 * packages/database/migrations/0005_instructor.sql für die rohe DDL und
 * packages/domain/src/instructor.ts für die dazugehörigen Zod-Schemas.
 */
export const kompetenzbeobachtungen = pgTable("kompetenzbeobachtungen", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  schuelerId: uuid("schueler_id")
    .notNull()
    .references(() => schueler.id),
  fahrlehrerId: uuid("fahrlehrer_id")
    .notNull()
    .references(() => fahrlehrer.id),
  terminbuchungId: uuid("terminbuchung_id").references(() => terminbuchungen.id),
  feld: text("feld").notNull(),
  kompetenzstatus: text("kompetenzstatus").notNull(),
  beobachtung: text("beobachtung"),
  datum: timestamp("datum", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sprachprotokolle = pgTable("sprachprotokolle", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  terminbuchungId: uuid("terminbuchung_id")
    .notNull()
    .references(() => terminbuchungen.id),
  fahrlehrerId: uuid("fahrlehrer_id")
    .notNull()
    .references(() => fahrlehrer.id),
  schuelerId: uuid("schueler_id")
    .notNull()
    .references(() => schueler.id),
  audioReferenz: text("audio_referenz"),
  transcriptOriginal: text("transcript_original"),
  transcriptBearbeitet: text("transcript_bearbeitet"),
  aiVorschlaege: jsonb("ai_vorschlaege").notNull().default({}),
  internZusammenfassung: text("intern_zusammenfassung"),
  schuelerseitigZusammenfassung: text("schuelerseitig_zusammenfassung"),
  kompetenzvorschlaege: jsonb("kompetenzvorschlaege").notNull().default([]),
  naechstesZiel: text("naechstes_ziel"),
  sprachprotokollStatus: text("sprachprotokoll_status").notNull().default("aufnahme"),
  bestaetigtAt: timestamp("bestaetigt_at", { withTimezone: true }),
  bestaetigtDurchBenutzerId: uuid("bestaetigt_durch_benutzer_id").references(() => benutzer.id),
  gespiegeltesFeedbackId: uuid("gespiegeltes_feedback_id"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
