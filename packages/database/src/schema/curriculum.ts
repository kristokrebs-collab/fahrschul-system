import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { benutzer, standorte } from "./core.js";
import { fahrlehrer, schueler, ausbildungen } from "./people.js";
import { terminbuchungen, terminangebote } from "./scheduling.js";

export const lernressourcen = pgTable("lernressourcen", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  titel: text("titel").notNull(),
  typ: text("typ").notNull(),
  klassen: jsonb("klassen").notNull().default([]),
  ort: text("ort"),
  beschreibung: text("beschreibung"),
  url: text("url"),
  status: text("status").notNull().default("aktiv"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lernfortschritte = pgTable("lernfortschritte", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  schuelerId: uuid("schueler_id")
    .notNull()
    .references(() => schueler.id),
  ressourceId: uuid("ressource_id")
    .notNull()
    .references(() => lernressourcen.id),
  status: text("status").notNull().default("offen"),
  besuchtAm: timestamp("besucht_am", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `internal_notes` wird von apps/api NIE in eine schülerseitige API-Antwort
 * aufgenommen (siehe apps/api/src/routes/feedback.ts) – Durchsetzung erfolgt
 * auf Query-/Serialisierungsebene, nicht nur im UI.
 */
export const fahrstundenFeedback = pgTable("fahrstunden_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  terminbuchungId: uuid("terminbuchung_id")
    .notNull()
    .references(() => terminbuchungen.id),
  schuelerId: uuid("schueler_id")
    .notNull()
    .references(() => schueler.id),
  fahrlehrerId: uuid("fahrlehrer_id")
    .notNull()
    .references(() => fahrlehrer.id),
  wentWell: text("went_well"),
  workOn: text("work_on"),
  nextGoal: text("next_goal"),
  resourceId: uuid("resource_id").references(() => lernressourcen.id),
  internalNotes: text("internal_notes"),
  releasedFields: jsonb("released_fields").notNull().default([]),
  studentSelfAssessment: text("student_self_assessment"),
  status: text("status").notNull().default("aktiv"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Zwei getrennte Freigabe-Spalten (Fahrlehrer + Büro) statt einer einzelnen
 * boolean – bildet das in docs/fachliche-bestaetigungen.md Punkt 11
 * angefragte Vier-Augen-Prinzip technisch ab, OHNE es fachlich zu behaupten:
 * beide Status sind unabhängig lesbar/setzbar, ob eine Prüfungsanmeldung
 * beide zwingend voraussetzt, bleibt bis zur fachlichen Bestätigung offen.
 */
export const pruefungsfreigaben = pgTable("pruefungsfreigaben", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  ausbildungId: uuid("ausbildung_id")
    .notNull()
    .references(() => ausbildungen.id),
  schuelerId: uuid("schueler_id")
    .notNull()
    .references(() => schueler.id),
  status: text("status").notNull().default("offen"),
  freigegebenDurchBenutzerId: uuid("freigegeben_durch_benutzer_id").references(() => benutzer.id),
  freigegebenAt: timestamp("freigegeben_at", { withTimezone: true }),
  buerofreigabeStatus: text("buerofreigabe_status").notNull().default("offen"),
  buerofreigabeDurchBenutzerId: uuid("buerofreigabe_durch_benutzer_id").references(
    () => benutzer.id,
  ),
  kommentar: text("kommentar"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Einfacher Feature-Flag-Mechanismus (erstmals in Prompt 1 eingeführt, siehe
 * packages/domain/src/curriculum.ts featureFlagSchema). `standort_id = null`
 * bedeutet organisationsweiter Default.
 */
export const featureFlags = pgTable("feature_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  state: text("state").notNull().default("hidden"),
  standortId: uuid("standort_id").references(() => standorte.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const flexAngebote = pgTable("flex_angebote", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  terminangebotId: uuid("terminangebot_id")
    .notNull()
    .references(() => terminangebote.id),
  status: text("status").notNull().default("offen"),
  ablaufAt: timestamp("ablauf_at", { withTimezone: true }).notNull(),
  angenommenVonSchuelerId: uuid("angenommen_von_schueler_id").references(() => schueler.id),
  angenommenAt: timestamp("angenommen_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const flexOptIns = pgTable("flex_opt_ins", {
  id: uuid("id").primaryKey().defaultRandom(),
  schuelerId: uuid("schueler_id")
    .notNull()
    .references(() => schueler.id)
    .unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
