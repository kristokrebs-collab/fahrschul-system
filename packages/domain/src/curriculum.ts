import { z } from "zod";
import { baseEntityWithStandortSchema } from "./base.js";
import { fahrerlaubnisklasseCode } from "./entities.js";

/**
 * Prompt 1 – Erweiterungen des Domain-Modells für apps/student. Wo die
 * Fachlogik laut docs/fachliche-bestaetigungen.md unbestätigt ist, bleibt
 * die Regel bewusst konservativ/Platzhalter (siehe Kommentare) statt eine
 * endgültige Fachregel zu behaupten.
 */

export const getriebeart = z.enum(["schaltung", "automatik"]);
export type Getriebeart = z.infer<typeof getriebeart>;

/**
 * Erweiterung von `ausbildungSchema` (packages/domain/src/entities.ts) um
 * Vorbesitz/Erweiterung/B197/Getriebeart/Standort-Felder, die im
 * ursprünglichen Prompt-0-Datenmodell noch fehlten (siehe
 * docs/architecture-report.md "Nicht in Prompt 0 modelliert").
 */
export const ausbildungDetailSchema = baseEntityWithStandortSchema.extend({
  schuelerId: z.string().uuid(),
  klasse: fahrerlaubnisklasseCode,
  vorbesitzKlasse: fahrerlaubnisklasseCode.nullable(),
  istErweiterung: z.boolean(),
  getriebeart: getriebeart,
  b197: z.boolean(),
});
export type AusbildungDetail = z.infer<typeof ausbildungDetailSchema>;

/** Vom Schüler eingegebene Wunschzeiten (Verfügbarkeit für Terminvorschläge). */
export const schuelerVerfuegbarkeitSchema = baseEntityWithStandortSchema.extend({
  schuelerId: z.string().uuid(),
  wochentag: z.number().int().min(0).max(6),
  startzeit: z.string(),
  endzeit: z.string(),
});
export type SchuelerVerfuegbarkeit = z.infer<typeof schuelerVerfuegbarkeitSchema>;

export const lernressourceTyp = z.enum([
  "video",
  "hoerbuch",
  "simulator",
  "kurs",
  "gefahrentraining",
]);
export type LernressourceTyp = z.infer<typeof lernressourceTyp>;

export const lernressourceSchema = baseEntityWithStandortSchema.extend({
  titel: z.string().min(1),
  typ: lernressourceTyp,
  klassen: z.array(fahrerlaubnisklasseCode),
  ort: z.string().nullable(), // z.B. "Fulda" / "Bad Hersfeld" für Gefahrentraining
  beschreibung: z.string().nullable(),
  url: z.string().nullable(),
});
export type Lernressource = z.infer<typeof lernressourceSchema>;

export const lernfortschrittStatus = z.enum(["offen", "besucht"]);

export const lernfortschrittSchema = baseEntityWithStandortSchema.extend({
  schuelerId: z.string().uuid(),
  ressourceId: z.string().uuid(),
  status: lernfortschrittStatus,
  besuchtAm: z.coerce.date().nullable(),
});
export type Lernfortschritt = z.infer<typeof lernfortschrittSchema>;

/**
 * Fahrstundenfeedback: `internalNotes` verlässt server-seitig NIEMALS eine
 * schülerseitige API-Antwort (siehe apps/api/src/routes/feedback.ts).
 * `releasedFields` steuert explizit, welche der freigebbaren Felder
 * (wentWell/workOn/nextGoal/resourceId) dem Schüler gezeigt werden dürfen -
 * die Default-Query filtert serverseitig, das ist keine reine UI-Blende.
 */
export const feedbackFieldSchema = z.enum(["wentWell", "workOn", "nextGoal", "resourceId"]);

export const fahrstundenFeedbackSchema = baseEntityWithStandortSchema.extend({
  terminbuchungId: z.string().uuid(),
  schuelerId: z.string().uuid(),
  fahrlehrerId: z.string().uuid(),
  wentWell: z.string().nullable(),
  workOn: z.string().nullable(),
  nextGoal: z.string().nullable(),
  resourceId: z.string().uuid().nullable(),
  internalNotes: z.string().nullable(),
  releasedFields: z.array(feedbackFieldSchema),
  studentSelfAssessment: z.string().nullable(),
});
export type FahrstundenFeedback = z.infer<typeof fahrstundenFeedbackSchema>;

/**
 * Prüfungsfreigabe: NUR Fahrlehrer/Büro dürfen setzen (serverseitig über
 * requirePermission("exam:clearance:set") erzwungen, siehe
 * apps/api/src/routes/exam.ts). Die Schüler-App ist an dieser Stelle
 * ausschließlich lesend.
 */
export const pruefungsfreigabeStatus = z.enum(["offen", "freigegeben", "abgelehnt"]);

export const pruefungsfreigabeSchema = baseEntityWithStandortSchema.extend({
  ausbildungId: z.string().uuid(),
  schuelerId: z.string().uuid(),
  status: pruefungsfreigabeStatus,
  freigegebenDurchBenutzerId: z.string().uuid().nullable(),
  freigegebenAt: z.coerce.date().nullable(),
  buerofreigabeStatus: pruefungsfreigabeStatus,
  buerofreigabeDurchBenutzerId: z.string().uuid().nullable(),
  kommentar: z.string().nullable(),
});
export type Pruefungsfreigabe = z.infer<typeof pruefungsfreigabeSchema>;

/**
 * Feature-Flag-Mechanismus (Prompt 1 führt diesen erstmals ein, siehe
 * Aufgabenstellung "add a simple flags mechanism"). state="hidden" ist der
 * verpflichtende Default für Krebs Flex, solange nichts anderes angewiesen
 * wird.
 */
export const featureFlagState = z.enum(["hidden", "pilot", "live"]);
export type FeatureFlagState = z.infer<typeof featureFlagState>;

export const featureFlagSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1),
  state: featureFlagState,
  standortId: z.string().uuid().nullable(),
  updatedAt: z.coerce.date(),
});
export type FeatureFlag = z.infer<typeof featureFlagSchema>;

/**
 * Krebs Flex – kurzfristige Ausgleichs-/Lückenangebote. Faire Verteilung ist
 * laut docs/fachliche-bestaetigungen.md Punkt 8 fachlich NICHT bestätigt;
 * diese Implementierung nutzt bewusst die einfachste denkbare Regel
 * ("wer zuerst mit Opt-in annimmt, race-sicher wie reguläre Buchungen") als
 * unbestätigten Platzhalter, keine endgültige Fachregel.
 */
export const flexAngebotStatus = z.enum(["offen", "angenommen", "abgelaufen", "storniert"]);

export const flexAngebotSchema = baseEntityWithStandortSchema.extend({
  terminangebotId: z.string().uuid(),
  status: flexAngebotStatus,
  ablaufAt: z.coerce.date(),
  angenommenVonSchuelerId: z.string().uuid().nullable(),
  angenommenAt: z.coerce.date().nullable(),
});
export type FlexAngebot = z.infer<typeof flexAngebotSchema>;

export const flexOptInSchema = z.object({
  id: z.string().uuid(),
  schuelerId: z.string().uuid(),
  createdAt: z.coerce.date(),
});
export type FlexOptIn = z.infer<typeof flexOptInSchema>;
