import { z } from "zod";
import { baseEntitySchema, baseEntityWithStandortSchema } from "./base.js";
import { roleSchema } from "./roles.js";

/**
 * Kern-Entitäten für Prompt 0 (Prioritätsliste der Aufgabenstellung).
 * Die vollständige fachliche Entitätsliste aus dem deutschen Original-Prompt
 * (Theorie, Praxisstunde, Sonderfahrt, Simulator, Prüfung, Prüfungsfreigabe,
 * Fahrzeugmangel, Raum, Dokumentprüfung, Banktransaktion, Lead/Firma,
 * Nachricht, Einwilligung, Aufgabe, Integrationsstatus, Mitarbeiter) ist als
 * Erweiterung für Prompt 1-4 vorgesehen und wird dort ergänzt – siehe
 * docs/architecture-report.md, Abschnitt "Nicht in Prompt 0 modelliert".
 */

export const fahrerlaubnisklasseCode = z.enum([
  "AM",
  "A1",
  "A2",
  "A",
  "B",
  "B197",
  "BE",
  "C1",
  "C1E",
  "C",
  "CE",
  "D1",
  "D1E",
  "D",
  "DE",
]);
export type FahrerlaubnisklasseCode = z.infer<typeof fahrerlaubnisklasseCode>;

export const organisationSchema = baseEntitySchema.extend({
  name: z.string().min(1),
});
export type Organisation = z.infer<typeof organisationSchema>;

export const standortSchema = baseEntitySchema.extend({
  organisationId: z.string().uuid(),
  name: z.string().min(1),
  adresse: z.string().nullable(),
});
export type Standort = z.infer<typeof standortSchema>;

export const benutzerSchema = baseEntityWithStandortSchema.extend({
  email: z.string().email(),
  rolle: roleSchema,
  vorname: z.string().min(1),
  nachname: z.string().min(1),
  mfaEnabled: z.boolean(),
  // Passwort-Hash wird NIE über das Domain-Schema nach außen gegeben,
  // siehe packages/database Tabellendefinition + packages/auth.
});
export type Benutzer = z.infer<typeof benutzerSchema>;

export const schuelerSchema = baseEntityWithStandortSchema.extend({
  benutzerId: z.string().uuid().nullable(),
  vorname: z.string().min(1),
  nachname: z.string().min(1),
  geburtsdatum: z.coerce.date().nullable(),
  email: z.string().email().nullable(),
  telefon: z.string().nullable(),
});
export type Schueler = z.infer<typeof schuelerSchema>;

export const fahrlehrerSchema = baseEntityWithStandortSchema.extend({
  benutzerId: z.string().uuid().nullable(),
  vorname: z.string().min(1),
  nachname: z.string().min(1),
  klassen: z.array(fahrerlaubnisklasseCode),
});
export type Fahrlehrer = z.infer<typeof fahrlehrerSchema>;

export const ausbildungSchema = baseEntityWithStandortSchema.extend({
  schuelerId: z.string().uuid(),
  klasse: fahrerlaubnisklasseCode,
});
export type Ausbildung = z.infer<typeof ausbildungSchema>;

export const verfuegbarkeitSchema = baseEntityWithStandortSchema.extend({
  fahrlehrerId: z.string().uuid(),
  wochentag: z.number().int().min(0).max(6), // 0=Montag
  startzeit: z.string(), // "HH:MM"
  endzeit: z.string(),
});
export type Verfuegbarkeit = z.infer<typeof verfuegbarkeitSchema>;

export const terminangebotSchema = baseEntityWithStandortSchema.extend({
  fahrlehrerId: z.string().uuid(),
  fahrzeugId: z.string().uuid().nullable(),
  beginnAt: z.coerce.date(),
  endeAt: z.coerce.date(),
  klasse: fahrerlaubnisklasseCode.nullable(),
});
export type Terminangebot = z.infer<typeof terminangebotSchema>;

export const terminbuchungSchema = baseEntityWithStandortSchema.extend({
  terminangebotId: z.string().uuid().nullable(),
  schuelerId: z.string().uuid(),
  fahrlehrerId: z.string().uuid(),
  fahrzeugId: z.string().uuid().nullable(),
  beginnAt: z.coerce.date(),
  endeAt: z.coerce.date(),
  art: z.string(), // Übungsstunde, Sonderfahrt, Prüfung ...
  idempotencyKey: z.string().nullable(),
});
export type Terminbuchung = z.infer<typeof terminbuchungSchema>;

export const fahrzeugSchema = baseEntityWithStandortSchema.extend({
  kennzeichen: z.string(),
  klasse: fahrerlaubnisklasseCode,
  bezeichnung: z.string().nullable(),
});
export type Fahrzeug = z.infer<typeof fahrzeugSchema>;

export const dokumentSchema = baseEntityWithStandortSchema.extend({
  schuelerId: z.string().uuid(),
  typ: z.string(),
  dateiname: z.string(),
  speicherReferenz: z.string(), // Referenz auf packages/integrations Storage-Adapter, NIE Base64 im DB-Feld
  geprueft: z.boolean(),
});
export type Dokument = z.infer<typeof dokumentSchema>;

export const rechnungSchema = baseEntityWithStandortSchema.extend({
  schuelerId: z.string().uuid(),
  betragCent: z.number().int(),
  faelligAm: z.coerce.date().nullable(),
});
export type Rechnung = z.infer<typeof rechnungSchema>;

export const zahlungSchema = baseEntityWithStandortSchema.extend({
  rechnungId: z.string().uuid().nullable(),
  betragCent: z.number().int(),
  eingegangenAm: z.coerce.date().nullable(),
  zugeordnet: z.boolean(),
});
export type Zahlung = z.infer<typeof zahlungSchema>;

export const auditEreignisSchema = z.object({
  id: z.string().uuid(),
  aktion: z.string(),
  entitaet: z.string(),
  entitaetId: z.string().uuid().nullable(),
  akteurBenutzerId: z.string().uuid().nullable(),
  standortId: z.string().uuid().nullable(),
  vorher: z.unknown().nullable(),
  nachher: z.unknown().nullable(),
  createdAt: z.coerce.date(),
});
export type AuditEreignis = z.infer<typeof auditEreignisSchema>;
