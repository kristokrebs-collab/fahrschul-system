import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, uuid, date } from "drizzle-orm/pg-core";
import { standorte } from "./core.js";
import { schueler } from "./people.js";
import { benutzer } from "./core.js";

export const rechnungen = pgTable("rechnungen", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  schuelerId: uuid("schueler_id")
    .notNull()
    .references(() => schueler.id),
  betragCent: integer("betrag_cent").notNull(), // Brutto-Gesamtbetrag (Prompt 0, unverändert für Student/Office-Views)
  faelligAm: date("faellig_am"),
  status: text("status").notNull().default("offen"),
  // Prompt 4: Brutto/Netto sauber getrennt (nie konfliert), Leistungszeitraum
  // für Periodenabgrenzung, siehe packages/finance umsatz-erkennung.ts.
  steuersatz: numeric("steuersatz", { precision: 4, scale: 3 }).notNull().default("0.19"),
  // Nullable: siehe migrations/0006_finance.sql Kommentar – wird bei Bedarf
  // aus betragCent/steuersatz berechnet (packages/finance nettoVonBrutto).
  nettoCent: integer("netto_cent"),
  leistungszeitraumVon: date("leistungszeitraum_von"),
  leistungszeitraumBis: date("leistungszeitraum_bis"),
  rechnungsnummer: text("rechnungsnummer"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Persistenz für Banktransaktionen aus dem Mock-Bank-Feed-Adapter
 * (packages/integrations/src/bank) + Ergebnis der Matching-Kaskade
 * (packages/finance bank-matching.ts). Nur `konfidenz === 'sicher'` darf
 * `auto_gebucht = true` bekommen; alles andere bleibt in der Review-Queue
 * (status 'offen') bis Rolle "finanzen" manuell bestätigt.
 */
export const banktransaktionen = pgTable("banktransaktionen", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  externalId: text("external_id").notNull().unique(),
  amountCent: integer("amount_cent").notNull(),
  bookedAt: date("booked_at").notNull(),
  reference: text("reference").notNull().default(""),
  counterparty: text("counterparty").notNull().default(""),
  zahlungsart: text("zahlungsart").notNull().default("ueberweisung"),
  istRuecklastschriftVon: text("ist_ruecklastschrift_von"),
  konfidenz: text("konfidenz").notNull().default("unklar"),
  grund: text("grund"),
  rechnungIds: jsonb("rechnung_ids").notNull().default([]),
  aufteilung: jsonb("aufteilung").notNull().default({}),
  hinweis: text("hinweis"),
  status: text("status").notNull().default("offen"),
  autoGebucht: boolean("auto_gebucht").notNull().default(false),
  bearbeitetDurchBenutzerId: uuid("bearbeitet_durch_benutzer_id").references(() => benutzer.id),
  bearbeitetAt: timestamp("bearbeitet_at", { withTimezone: true }),
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
  zahlungsart: text("zahlungsart").notNull().default("ueberweisung"),
  banktransaktionId: uuid("banktransaktion_id").references(() => banktransaktionen.id),
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
  ablehnungsgrund: text("ablehnungsgrund"),
  gueltigBis: date("gueltig_bis"),
  ersetztVonDokumentId: uuid("ersetzt_von_dokument_id"),
  // Mock-Malware-Scan (packages/integrations malware-scan Adapter,
  // "always clean" – kein echter AV-Anbieter in dieser Sandbox verfügbar).
  scanStatus: text("scan_status").notNull().default("ausstehend"),
  status: text("status").notNull().default("eingereicht"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rechnungspositionen = pgTable("rechnungspositionen", {
  id: uuid("id").primaryKey().defaultRandom(),
  rechnungId: uuid("rechnung_id")
    .notNull()
    .references(() => rechnungen.id),
  bezeichnung: text("bezeichnung").notNull(),
  mengeCent: integer("menge_cent"),
  einzelpreisCent: integer("einzelpreis_cent").notNull(),
  gesamtpreisCent: integer("gesamtpreis_cent").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
