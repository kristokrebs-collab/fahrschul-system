import { date, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { standorte, benutzer } from "./core.js";
import { fahrzeuge } from "./scheduling.js";
import { fahrzeugmaengel } from "./office.js";

/**
 * Produkt/Preisliste: konfigurierbare Produkte statt hartkodierter Preise
 * (Non-Negotiable aus Prompt 0). Siehe migrations/0006_finance.sql für die
 * vollständige Produktliste (B/BF17/B197, BE/B96, Motorrad, C/CE/C1/C1E,
 * D/DE, BKF, Grundqualifikation, Simulator, Handicap, ASF/FES, Erste Hilfe,
 * Unternehmerprüfung).
 */
export const produkte = pgTable("produkte", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  code: text("code").notNull(),
  bezeichnung: text("bezeichnung").notNull(),
  kategorie: text("kategorie").notNull(),
  preisCent: integer("preis_cent").notNull(),
  steuersatz: numeric("steuersatz", { precision: 4, scale: 3 }).notNull().default("0.19"),
  einheit: text("einheit").notNull().default("stueck"),
  gueltigVon: date("gueltig_von").notNull(),
  gueltigBis: date("gueltig_bis"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fahrzeugkosten = pgTable("fahrzeugkosten", {
  id: uuid("id").primaryKey().defaultRandom(),
  fahrzeugId: uuid("fahrzeug_id")
    .notNull()
    .references(() => fahrzeuge.id),
  standortId: uuid("standort_id").references(() => standorte.id),
  kategorie: text("kategorie").notNull(), // energie|wartung|reparatur|reifen|versicherung|steuer|leasing|sonstiges
  betragCent: integer("betrag_cent").notNull(),
  angefallenAm: date("angefallen_am").notNull(),
  belegReferenz: text("beleg_referenz"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fahrzeugausfalltage = pgTable("fahrzeugausfalltage", {
  id: uuid("id").primaryKey().defaultRandom(),
  fahrzeugId: uuid("fahrzeug_id")
    .notNull()
    .references(() => fahrzeuge.id),
  fahrzeugmangelId: uuid("fahrzeugmangel_id").references(() => fahrzeugmaengel.id),
  datum: date("datum").notNull(),
  grund: text("grund"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Export-Audit: jeder Finanz-Export (PDF/CSV/XLSX) wird protokolliert.
 * `downloadTokenHash` ist ein einmaliger, session-gebundener Token-Hash –
 * es gibt bewusst KEINEN öffentlichen/statischen Downloadpfad.
 */
export const finanzExporte = pgTable("finanz_exporte", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  angefordertVonBenutzerId: uuid("angefordert_von_benutzer_id")
    .notNull()
    .references(() => benutzer.id),
  format: text("format").notNull(), // pdf|csv|xlsx
  bericht: text("bericht").notNull(),
  parameter: jsonb("parameter").notNull().default({}),
  downloadTokenHash: text("download_token_hash").notNull().unique(),
  abgelaufenAt: timestamp("abgelaufen_at", { withTimezone: true }).notNull(),
  heruntergeladenAt: timestamp("heruntergeladen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
