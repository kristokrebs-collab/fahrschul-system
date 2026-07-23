import { boolean, integer, pgTable, text, timestamp, uuid, date, jsonb } from "drizzle-orm/pg-core";
import { benutzer, standorte } from "./core.js";

export const schueler = pgTable("schueler", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  benutzerId: uuid("benutzer_id").references(() => benutzer.id),
  vorname: text("vorname").notNull(),
  nachname: text("nachname").notNull(),
  geburtsdatum: date("geburtsdatum"),
  email: text("email"),
  telefon: text("telefon"),
  status: text("status").notNull().default("aktiv"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fahrlehrer = pgTable("fahrlehrer", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  benutzerId: uuid("benutzer_id").references(() => benutzer.id),
  vorname: text("vorname").notNull(),
  nachname: text("nachname").notNull(),
  // Klassen als jsonb-Array von Fahrerlaubnisklassen-Codes (@fahrschul/domain).
  klassen: jsonb("klassen").notNull().default([]),
  status: text("status").notNull().default("aktiv"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ausbildungen = pgTable("ausbildungen", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  schuelerId: uuid("schueler_id")
    .notNull()
    .references(() => schueler.id),
  klasse: text("klasse").notNull(),
  // Prompt 1: Vorbesitz/Erweiterung/B197/Getriebeart (siehe
  // docs/architecture-report.md "Nicht in Prompt 0 modelliert" +
  // packages/domain/src/curriculum.ts ausbildungDetailSchema).
  vorbesitzKlasse: text("vorbesitz_klasse"),
  istErweiterung: boolean("ist_erweiterung").notNull().default(false),
  getriebeart: text("getriebeart").notNull().default("schaltung"),
  b197: boolean("b197").notNull().default(false),
  status: text("status").notNull().default("laufend"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verfuegbarkeiten = pgTable("verfuegbarkeiten", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  fahrlehrerId: uuid("fahrlehrer_id")
    .notNull()
    .references(() => fahrlehrer.id),
  wochentag: integer("wochentag").notNull(),
  startzeit: text("startzeit").notNull(),
  endzeit: text("endzeit").notNull(),
  status: text("status").notNull().default("aktiv"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Wunschzeiten des Schülers (nicht zu verwechseln mit `verfuegbarkeiten`,
 * das ist die Dienstplan-Verfügbarkeit der Fahrlehrer). Ersetzt die grobe
 * 6-Wochen-Tagesperioden-Matrix aus app.html durch echte Zeitfenster.
 */
export const schuelerVerfuegbarkeiten = pgTable("schueler_verfuegbarkeiten", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  schuelerId: uuid("schueler_id")
    .notNull()
    .references(() => schueler.id),
  wochentag: integer("wochentag").notNull(),
  startzeit: text("startzeit").notNull(),
  endzeit: text("endzeit").notNull(),
  status: text("status").notNull().default("aktiv"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
