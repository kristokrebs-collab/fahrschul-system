import { z } from "zod";
import { baseEntityWithStandortSchema } from "./base.js";

/**
 * Prompt 3 (apps/instructor) – Erweiterungen des Domain-Modells. Bewusst in
 * einer eigenen Datei statt curriculum.ts erweitert zu werden, weil dies
 * eindeutig Fahrlehrer-Werkzeuge sind (Kompetenzraster, Stunde-
 * starten/beenden, Sprachprotokoll, Fahrzeug-Mangelmeldung), keine
 * Schüler-/Büro-Erweiterung.
 */

/** Die 15 geforderten Kompetenzfelder, wörtlich aus der Aufgabenstellung. */
export const KOMPETENZFELDER = [
  "fahrzeugbedienung",
  "blickfuehrung",
  "geschwindigkeit",
  "abstand",
  "vorfahrt",
  "abbiegen",
  "fahrstreifenwechsel",
  "kreisverkehr",
  "einfaedeln",
  "stadt",
  "landstrasse",
  "autobahn",
  "nacht",
  "selbststaendige_fahrweise",
  "klassenbezogene_manoever",
] as const;
export const kompetenzfeldSchema = z.enum(KOMPETENZFELDER);
export type Kompetenzfeld = z.infer<typeof kompetenzfeldSchema>;

/**
 * Bewusst NUR beobachtbare Fahrverhalten-Zustände – KEIN Feld für
 * Diagnose/Charakter/Motivation/Intelligenz (Spec: "No diagnosis/character/
 * motivation/intelligence judgments"). Das ist eine inhaltliche
 * Formvorgabe, die durch das Fehlen jedes solchen Feldes in diesem Enum
 * technisch erzwungen wird – es gibt schlicht kein Feld, das damit befüllt
 * werden könnte.
 */
export const KOMPETENZSTATUS = ["neu", "in_uebung", "zunehmend_sicher", "stabil", "erneut_pruefen"] as const;
export const kompetenzstatusSchema = z.enum(KOMPETENZSTATUS);
export type Kompetenzstatus = z.infer<typeof kompetenzstatusSchema>;

export const kompetenzbeobachtungSchema = baseEntityWithStandortSchema.extend({
  schuelerId: z.string().uuid(),
  fahrlehrerId: z.string().uuid(),
  terminbuchungId: z.string().uuid().nullable(),
  feld: kompetenzfeldSchema,
  kompetenzstatus: kompetenzstatusSchema,
  beobachtung: z.string().nullable(),
  datum: z.coerce.date(),
});
export type Kompetenzbeobachtung = z.infer<typeof kompetenzbeobachtungSchema>;

/**
 * Stunde-beenden: verpflichtender, geordneter 8-Schritt-Fluss. Alle Felder
 * sind PFLICHT (keine .optional()) – ein unvollständiges Payload wird von
 * Zod bereits an der Schema-Grenze abgelehnt, bevor `lesson.completed`
 * ausgelöst werden kann (siehe apps/api/src/routes/instructor.ts).
 */
export const lessonCompletionInputSchema = z.object({
  tatsaechlicheDauerMinuten: z.number().int().positive(), // 1
  stundenart: z.string().min(1), // 2
  lernziele: z.array(z.string().min(1)).min(1), // 3
  beobachteteKompetenzfelder: z
    .array(
      z.object({
        feld: kompetenzfeldSchema,
        kompetenzstatus: kompetenzstatusSchema,
        beobachtung: z.string().nullable().default(null),
      }),
    )
    .min(1), // 4
  kurznotiz: z.string().min(1), // 5
  naechstesZiel: z.string().min(1), // 6
  schuelerfeedback: z.string().min(1), // 7
  bestaetigung: z.literal(true), // 8 – "instructor confirms", muss explizit true sein
});
export type LessonCompletionInput = z.infer<typeof lessonCompletionInputSchema>;

/**
 * Sprachprotokoll (Voice-Log). `transcriptOriginal`/`aiVorschlaege` kommen
 * aus austauschbaren Mock-Adaptern (packages/integrations, Muster wie
 * Prompt 0/1 malware-scan/notifications) – es gibt in dieser Sandbox KEINEN
 * echten Speech-to-Text-/LLM-Anbieter (siehe docs/integration-gaps.md).
 * `status` bleibt "entwurf" bis Schritt 6 ("instructor confirms") –
 * schülerseitige Inhalte werden erst bei der Bestätigung in
 * fahrstunden_feedback gespiegelt (kein automatisches Publizieren).
 */
export const sprachprotokollStatus = z.enum(["aufnahme", "transkribiert", "entwurf", "bestaetigt"]);

export const sprachprotokollSchema = baseEntityWithStandortSchema.extend({
  terminbuchungId: z.string().uuid(),
  fahrlehrerId: z.string().uuid(),
  schuelerId: z.string().uuid(),
  audioReferenz: z.string().nullable(),
  transcriptOriginal: z.string().nullable(),
  transcriptBearbeitet: z.string().nullable(),
  aiVorschlaege: z.record(z.unknown()).default({}),
  internZusammenfassung: z.string().nullable(),
  schuelerseitigZusammenfassung: z.string().nullable(),
  kompetenzvorschlaege: z
    .array(z.object({ feld: kompetenzfeldSchema, kompetenzstatus: kompetenzstatusSchema }))
    .default([]),
  naechstesZiel: z.string().nullable(),
  sprachprotokollStatus: sprachprotokollStatus,
  bestaetigtAt: z.coerce.date().nullable(),
  bestaetigtDurchBenutzerId: z.string().uuid().nullable(),
});
export type Sprachprotokoll = z.infer<typeof sprachprotokollSchema>;

/**
 * Fahrzeug-Mangelmeldung (Prompt-3-Erweiterung von Prompt 2s
 * `fahrzeugmaengel`). `schweregrad` steuert die Routing-Härte:
 * "kritisch" => einsatzbereit wird zwingend false, Fahrzeugstatus sofort
 * "wartung" (blockiert neue Buchungen über die bestehende harte Regel
 * VEHICLE_NOT_READY aus Prompt 2).
 */
export const mangelSchweregrad = z.enum(["gering", "mittel", "kritisch"]);
export const mangelRouting = z.enum(["buero", "fuhrpark"]);

export const fahrzeugMangelDetailSchema = z.object({
  fahrzeugId: z.string().uuid(),
  kilometerstand: z.number().int().nonnegative().nullable(),
  tankLadungProzent: z.number().int().min(0).max(100).nullable(),
  warnleuchten: z.array(z.string()).default([]),
  grund: z.string().min(1),
  schweregrad: mangelSchweregrad,
  einsatzbereit: z.boolean(),
  fotoReferenz: z.string().nullable().default(null),
  sprachnotizReferenz: z.string().nullable().default(null),
  geroutetAn: mangelRouting.default("buero"),
});
export type FahrzeugMangelDetail = z.infer<typeof fahrzeugMangelDetailSchema>;
