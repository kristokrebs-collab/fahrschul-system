import { boolean, integer, pgTable, text, timestamp, uuid, date } from "drizzle-orm/pg-core";
import { standorte } from "./core.js";
import { schueler } from "./people.js";

export const rechnungen = pgTable("rechnungen", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  schuelerId: uuid("schueler_id")
    .notNull()
    .references(() => schueler.id),
  betragCent: integer("betrag_cent").notNull(),
  faelligAm: date("faellig_am"),
  status: text("status").notNull().default("offen"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Zahlungszuordnung ist NICHT automatisch-unsicher (Non-Negotiable):
 * `zugeordnet` wird nur durch einen expliziten Abgleichs-Schritt in
 * apps/api gesetzt (Rolle finanzen, packages/integrations bank-Adapter im
 * mock-Modus), niemals durch reine Betragsübereinstimmung ohne Prüfung.
 */
export const zahlungen = pgTable("zahlungen", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  rechnungId: uuid("rechnung_id").references(() => rechnungen.id),
  betragCent: integer("betrag_cent").notNull(),
  eingegangenAm: date("eingegangen_am"),
  zugeordnet: boolean("zugeordnet").notNull().default(false),
  status: text("status").notNull().default("offen"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dokumente = pgTable("dokumente", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  schuelerId: uuid("schueler_id")
    .notNull()
    .references(() => schueler.id),
  typ: text("typ").notNull(),
  dateiname: text("dateiname").notNull(),
  // Referenz auf packages/integrations Storage-Adapter (mock/sandbox/live),
  // niemals Base64-Klartext in der Datenbank (Security-Risk #4 im Prototyp).
  speicherReferenz: text("speicher_referenz").notNull(),
  geprueft: boolean("geprueft").notNull().default(false),
  status: text("status").notNull().default("eingereicht"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
