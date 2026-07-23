import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { standorte } from "./core.js";
import { ausbildungen, fahrlehrer, schueler } from "./people.js";
import { fahrzeuge, terminbuchungen } from "./scheduling.js";

/**
 * Prompt 2 (apps/office) – Ressourcen/Entitäten, die in Prompt 0/1 bewusst
 * noch nicht modelliert waren (siehe docs/architecture-report.md "Nicht in
 * Prompt 0 modelliert" und migrations/0004_office.sql).
 *
 * `raeume`/`simulatorgeraete` sind aus Gründen der ESM-Importreihenfolge
 * (fahrzeugmaengel referenziert fahrzeuge, terminangebote/terminbuchungen
 * referenzieren raeume/simulatorgeraete) in ./scheduling.ts definiert und
 * werden von dort re-exportiert.
 */
export { raeume, simulatorgeraete } from "./scheduling.js";

export const fahrzeugmaengel = pgTable("fahrzeugmaengel", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  fahrzeugId: uuid("fahrzeug_id")
    .notNull()
    .references(() => fahrzeuge.id),
  grund: text("grund").notNull(),
  status: text("status").notNull().default("offen"),
  gemeldetAt: timestamp("gemeldet_at", { withTimezone: true }).notNull().defaultNow(),
  behobenAt: timestamp("behoben_at", { withTimezone: true }),
  // Prompt 3 (apps/instructor) – erweiterte Mangelmeldung (Quick-Check).
  gemeldetVonBenutzerId: uuid("gemeldet_von_benutzer_id"),
  kilometerstand: integer("kilometerstand"),
  tankLadungProzent: integer("tank_ladung_prozent"),
  warnleuchten: jsonb("warnleuchten").notNull().default([]),
  schweregrad: text("schweregrad").notNull().default("mittel"),
  einsatzbereit: boolean("einsatzbereit").notNull().default(true),
  fotoReferenz: text("foto_referenz"),
  sprachnotizReferenz: text("sprachnotiz_referenz"),
  geroutetAn: text("geroutet_an").notNull().default("buero"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Arbeitszeitregeln: NUR zur Anzeige/Warnung im Ressourcen-Tab (Spec
 * "Arbeitszeit" – "warn on conflict, but NO automatic personnel action").
 */
export const arbeitszeitregeln = pgTable("arbeitszeitregeln", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  fahrlehrerId: uuid("fahrlehrer_id")
    .notNull()
    .references(() => fahrlehrer.id)
    .unique(),
  maxStundenProTag: numeric("max_stunden_pro_tag").notNull().default("8"),
  maxStundenProWoche: numeric("max_stunden_pro_woche").notNull().default("40"),
  minPauseMinuten: integer("min_pause_minuten").notNull().default(15),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  vorname: text("vorname").notNull(),
  nachname: text("nachname").notNull(),
  email: text("email"),
  telefon: text("telefon"),
  quelle: text("quelle").notNull().default("webseite"),
  interesseKlasse: text("interesse_klasse"),
  kommentar: text("kommentar"),
  status: text("status").notNull().default("neu"),
  konvertiertZuSchuelerId: uuid("konvertiert_zu_schueler_id").references(() => schueler.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const nachrichtenVorlagen = pgTable("nachrichten_vorlagen", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  name: text("name").notNull(),
  kanal: text("kanal").notNull(),
  betreff: text("betreff"),
  inhalt: text("inhalt").notNull(),
  status: text("status").notNull().default("aktiv"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const nachrichten = pgTable("nachrichten", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  vorlageId: uuid("vorlage_id").references(() => nachrichtenVorlagen.id),
  schuelerId: uuid("schueler_id").references(() => schueler.id),
  leadId: uuid("lead_id").references(() => leads.id),
  kanal: text("kanal").notNull(),
  betreff: text("betreff"),
  inhalt: text("inhalt").notNull(),
  status: text("status").notNull().default("warteschlange"),
  fehlergrund: text("fehlergrund"),
  gesendetAt: timestamp("gesendet_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Prüfungs-Pipeline: 9 explizite Zustände (siehe
 * packages/domain/src/pruefungspipeline.ts PRUEFUNG_TRANSITIONS für die
 * erlaubten Übergänge + Autorisierung).
 */
export const pruefungen = pgTable("pruefungen", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  ausbildungId: uuid("ausbildung_id")
    .notNull()
    .references(() => ausbildungen.id),
  schuelerId: uuid("schueler_id")
    .notNull()
    .references(() => schueler.id),
  klasse: text("klasse").notNull(),
  status: text("status").notNull().default("in_vorbereitung"),
  terminBeginnAt: timestamp("termin_beginn_at", { withTimezone: true }),
  ergebnis: text("ergebnis"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Storno-Retter (11-Schritt-Flow, siehe apps/api/src/services/storno-retter.ts).
 * `storno_events` ist die Zeile, auf die per SELECT ... FOR UPDATE gesperrt
 * wird, damit "erste gültige Annahme gewinnt" auch bei parallelen Requests
 * gilt (Race-Schutz zusätzlich zu den bestehenden Buchungs-Constraints).
 */
export const stornoEvents = pgTable("storno_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  terminbuchungId: uuid("terminbuchung_id")
    .notNull()
    .references(() => terminbuchungen.id)
    .unique(),
  klasse: text("klasse").notNull(),
  status: text("status").notNull().default("empfangen"),
  angebotsmodus: text("angebotsmodus"),
  ausgeloestAt: timestamp("ausgeloest_at", { withTimezone: true }).notNull().defaultNow(),
  geschlossenAt: timestamp("geschlossen_at", { withTimezone: true }),
  geretteteMinuten: integer("gerettete_minuten"),
  geretteterUmsatzCent: integer("geretteter_umsatz_cent"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stornoAngebote = pgTable("storno_angebote", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  stornoEventId: uuid("storno_event_id")
    .notNull()
    .references(() => stornoEvents.id),
  schuelerId: uuid("schueler_id")
    .notNull()
    .references(() => schueler.id),
  status: text("status").notNull().default("offen"),
  ablaufAt: timestamp("ablauf_at", { withTimezone: true }).notNull(),
  angenommenAt: timestamp("angenommen_at", { withTimezone: true }),
  terminbuchungId: uuid("terminbuchung_id").references(() => terminbuchungen.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
