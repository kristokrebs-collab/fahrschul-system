import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { standorte } from "./core.js";
import { fahrlehrer, schueler } from "./people.js";

/**
 * Raum/Simulatorgerät als First-Class-Ressourcen für die Terminplanung
 * (Prompt 2). Hier statt in office.ts definiert, damit terminangebote/
 * terminbuchungen unten ohne zirkulären ESM-Import darauf verweisen können;
 * office.ts re-exportiert beide.
 */
export const raeume = pgTable("raeume", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  name: text("name").notNull(),
  ausstattung: jsonb("ausstattung").notNull().default([]),
  status: text("status").notNull().default("verfuegbar"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const simulatorgeraete = pgTable("simulatorgeraete", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  name: text("name").notNull(),
  status: text("status").notNull().default("verfuegbar"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fahrzeuge = pgTable("fahrzeuge", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  kennzeichen: text("kennzeichen").notNull(),
  klasse: text("klasse").notNull(),
  bezeichnung: text("bezeichnung"),
  status: text("status").notNull().default("verfuegbar"),
  // Prompt 2: Ausstattungsmerkmale für Handicap-Matching (jsonb-Array freier
  // Codes, Taxonomie fachlich unbestätigt, siehe docs/fachliche-bestaetigungen.md).
  handicapAusstattung: jsonb("handicap_ausstattung").notNull().default([]),
  automatik: boolean("automatik").notNull().default(false),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const terminangebote = pgTable("terminangebote", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  fahrlehrerId: uuid("fahrlehrer_id")
    .notNull()
    .references(() => fahrlehrer.id),
  fahrzeugId: uuid("fahrzeug_id").references(() => fahrzeuge.id),
  raumId: uuid("raum_id").references(() => raeume.id),
  simulatorgeraetId: uuid("simulatorgeraet_id").references(() => simulatorgeraete.id),
  beginnAt: timestamp("beginn_at", { withTimezone: true }).notNull(),
  endeAt: timestamp("ende_at", { withTimezone: true }).notNull(),
  klasse: text("klasse"),
  art: text("art").notNull().default("Übungsstunde"),
  treffpunkt: text("treffpunkt"),
  automatik: boolean("automatik").notNull().default(false),
  ablaufAt: timestamp("ablauf_at", { withTimezone: true }),
  status: text("status").notNull().default("offen"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Terminbuchung: die serverseitige Konfliktprüfung (kein Doppel-Booking von
 * Fahrlehrer/Fahrzeug) erfolgt in apps/api innerhalb einer Transaktion mit
 * Zeilensperren + Überschneidungsabfrage (siehe
 * apps/api/src/routes/appointments.ts), NICHT nur im Anwendungscode.
 * idempotency_key ist unique, damit derselbe Buchungsversuch (z. B. bei
 * Netzwerk-Retry) nicht zu einer doppelten Buchung führt.
 */
export const terminbuchungen = pgTable("terminbuchungen", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  terminangebotId: uuid("terminangebot_id").references(() => terminangebote.id),
  schuelerId: uuid("schueler_id")
    .notNull()
    .references(() => schueler.id),
  fahrlehrerId: uuid("fahrlehrer_id")
    .notNull()
    .references(() => fahrlehrer.id),
  fahrzeugId: uuid("fahrzeug_id").references(() => fahrzeuge.id),
  raumId: uuid("raum_id").references(() => raeume.id),
  simulatorgeraetId: uuid("simulatorgeraet_id").references(() => simulatorgeraete.id),
  beginnAt: timestamp("beginn_at", { withTimezone: true }).notNull(),
  endeAt: timestamp("ende_at", { withTimezone: true }).notNull(),
  art: text("art").notNull(),
  status: text("status").notNull().default("bestaetigt"),
  idempotencyKey: text("idempotency_key").unique(),
  // Prompt 3 (apps/instructor) – Stunde starten/beenden-Lebenszyklus.
  gestartetAt: timestamp("gestartet_at", { withTimezone: true }),
  beendetAt: timestamp("beendet_at", { withTimezone: true }),
  tatsaechlicheDauerMinuten: integer("tatsaechliche_dauer_minuten"),
  kurznotiz: text("kurznotiz"),
  naechstesZiel: text("naechstes_ziel"),
  schuelerfeedback: text("schuelerfeedback"),
  verspaetungMinuten: integer("verspaetung_minuten"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
