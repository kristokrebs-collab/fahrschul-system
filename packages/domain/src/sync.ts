/**
 * PROMPT -1 / Phase 2 – GETEILTES VOKABULAR der Echtzeit-Synchronisation.
 *
 * Diese Datei ist absichtlich frei von Node-, DOM- und DB-Abhängigkeiten:
 * `apps/api` bildet damit den Fanout (§6), die vier Frontends und
 * `packages/sync` bilden damit ihre Zustandsanzeige (§1/§7) und ihre
 * Offline-Outbox (§8). Ein Begriff, eine Definition – kein Auseinanderlaufen
 * zwischen Server und Client.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// §6 Grobe Themen ("data type"), die der Realtime-Kanal übermittelt
// ---------------------------------------------------------------------------
/**
 * Der Kanal sendet NUR Ereignis-ID + eines dieser Themen, NIEMALS die Nutzlast
 * (PROMPT -1 §6). Der Client leitet daraus ab, welche autorisierte GET-Abfrage
 * er erneuern muss. Ein Thema enthält bewusst keine Datensatz-Kennung – sonst
 * wäre schon die Benachrichtigung eine Informationspreisgabe.
 */
export const SYNC_DATA_TYPES = [
  "termine",
  "angebote",
  "dokumente",
  "rechnungen",
  "zahlungen",
  "pruefung",
  "feedback",
  "fahrzeuge",
  "maengel",
  "verfuegbarkeit",
  "wunschzeiten",
  "nachrichten",
  "leads",
  "schueler",
  "kompetenzen",
  "sprachprotokolle",
  "flex",
  "exporte",
] as const;

export const syncDataTypeSchema = z.enum(SYNC_DATA_TYPES);
export type SyncDataType = z.infer<typeof syncDataTypeSchema>;

/**
 * Ereignistyp -> grobes Thema. MUSS für jeden in `event_schema_versions`
 * eingetragenen Ereignistyp einen Eintrag haben; ein Test in apps/api prüft
 * das gegen die Datenbank, damit ein neuer Ereignistyp nicht stillschweigend
 * ohne Realtime-Zustellung bleibt.
 */
export const EVENT_TYPE_DATA_TYPE: Record<string, SyncDataType> = {
  "lead.created": "leads",
  "student.enrolled": "schueler",
  "availability.updated": "verfuegbarkeit",
  "lesson.offer.created": "angebote",
  "lesson.offer.accepted": "angebote",
  "lesson.offer.declined": "angebote",
  "lesson.offer.expired": "angebote",
  "lesson.booked": "termine",
  "lesson.cancelled": "termine",
  "lesson.started": "termine",
  "lesson.completed": "termine",
  "document.submitted": "dokumente",
  "document.verified": "dokumente",
  "document.rejected": "dokumente",
  "document.reuploaded": "dokumente",
  "document.quarantined": "dokumente",
  "exam.clearance.granted": "pruefung",
  "exam.registered": "pruefung",
  "invoice.issued": "rechnungen",
  "invoice.inquiry.raised": "rechnungen",
  "payment.matched": "zahlungen",
  "payment.reversed": "zahlungen",
  "feedback.given": "feedback",
  "feedback.self_assessment.set": "feedback",
  "flex.opt_in": "flex",
  "flex.offer.accepted": "flex",
  "vehicle_issue.reported": "maengel",
  "vehicle.blocked": "fahrzeuge",
  "voice_log.confirmed": "sprachprotokolle",
  "competency.observed": "kompetenzen",
  "communication.message_sent": "nachrichten",
  "export.requested": "exporte",
  "export.downloaded": "exporte",
};

/**
 * Feinabstimmung, wenn derselbe Ereignistyp je Aggregat ein anderes Thema
 * betrifft: `availability.updated` heißt bei `verfuegbarkeit` (Fahrlehrer)
 * etwas anderes als bei `schueler_verfuegbarkeit` (Wunschzeiten des Schülers).
 */
export const AGGREGATE_DATA_TYPE_OVERRIDE: Record<string, SyncDataType> = {
  schueler_verfuegbarkeit: "wunschzeiten",
  flex_opt_in: "flex",
  storno_event: "termine",
};

export function resolveSyncDataType(
  eventType: string,
  aggregateType: string | null | undefined,
): SyncDataType | null {
  if (aggregateType && AGGREGATE_DATA_TYPE_OVERRIDE[aggregateType]) {
    return AGGREGATE_DATA_TYPE_OVERRIDE[aggregateType];
  }
  return EVENT_TYPE_DATA_TYPE[eventType] ?? null;
}

// ---------------------------------------------------------------------------
// §6 Empfängerschlüssel ("audience keys")
// ---------------------------------------------------------------------------
/**
 * Ein Empfängerschlüssel beschreibt, WER ein Ereignis sehen darf. Er wird
 * ausschließlich serverseitig gebildet – aus der Sitzung (Rolle, Benutzer,
 * Standort) beim Abonnenten und aus den Fachtabellen beim Fanout. Ein Client
 * kann seine Schlüssel nicht wählen und nicht erweitern.
 */
export function benutzerAudience(benutzerId: string): string {
  return `benutzer:${benutzerId}`;
}
export function schuelerAudience(schuelerId: string): string {
  return `schueler:${schuelerId}`;
}
export function fahrlehrerAudience(fahrlehrerId: string): string {
  return `fahrlehrer:${fahrlehrerId}`;
}
/**
 * Standort-gebundene Rollenschlüssel (Mandanten-/Standorttrennung). Ein
 * `null`-Standort wird auf den festen Literal `unbekannt` abgebildet, damit
 * Ereignisse ohne Standort nicht versehentlich an ALLE Standorte gehen.
 */
export function standortRoleAudience(standortId: string | null | undefined, rolle: string): string {
  return `standort:${standortId ?? "unbekannt"}:${rolle}`;
}
/** Organisationsweite Rollen (Finanzen, Geschäftsführung). */
export function rolleAudience(rolle: string): string {
  return `rolle:${rolle}`;
}

// ---------------------------------------------------------------------------
// §7 Die neun Client-Synchronisationszustände
// ---------------------------------------------------------------------------
/**
 * Wörtlich die neun Zustände aus PROMPT -1 §7. Die Reihenfolge ist die der
 * Spezifikation; ein Test in packages/sync prüft die Menge zeichengenau.
 */
export const SYNC_STATES = [
  "synced",
  "local_draft",
  "queued",
  "syncing",
  "retrying",
  "conflict",
  "failed",
  "offline",
  "stale",
] as const;

export const syncStateSchema = z.enum(SYNC_STATES);
export type SyncState = z.infer<typeof syncStateSchema>;

// ---------------------------------------------------------------------------
// §8 Was offline überhaupt entworfen werden darf
// ---------------------------------------------------------------------------
/**
 * ERLAUBT offline – und zwar ausschließlich als ENTWURF (§8). Nichts hiervon
 * wird offline "fertig"; der Abschluss passiert immer serverseitig nach
 * Wiederverbindung.
 */
export const OFFLINE_DRAFT_KINDS = [
  "verfuegbarkeit_entwurf",
  "fahrstundenbericht_entwurf",
  "fahrzeugmangel_entwurf",
  "schueler_selbsteinschaetzung",
] as const;

export const offlineDraftKindSchema = z.enum(OFFLINE_DRAFT_KINDS);
export type OfflineDraftKind = z.infer<typeof offlineDraftKindSchema>;

/**
 * NICHT offline abschließbar (§8). Diese Liste ist die Client-Spiegelung eines
 * Non-Negotiables; sie ist KEIN Ersatz für die serverseitige Prüfung, sondern
 * verhindert, dass die UI überhaupt einen falschen Erfolg behauptet.
 */
export const OFFLINE_FORBIDDEN_OPERATIONS = [
  "termin_buchung",
  "termin_storno",
  "pruefung_go",
  "zahlung",
  "rechnung",
  "fahrzeug_blockierung",
  "dokument_verifizierung",
] as const;

export type OfflineForbiddenOperation = (typeof OFFLINE_FORBIDDEN_OPERATIONS)[number];

/**
 * Schema-Version der lokal gespeicherten Entwürfe/Outbox-Einträge (§8:
 * "Schema-Version" ist ein Pflichtfeld). Wird sie erhöht, gelten ältere
 * Entwürfe als `stale` und werden dem Benutzer zur Bestätigung vorgelegt
 * statt stillschweigend gesendet oder verworfen.
 */
export const DRAFT_SCHEMA_VERSION = 1;

/**
 * Ab wann gilt ein angezeigter Datenstand als `stale` (§1 Datenalter /
 * §7 Zustand `stale`)? Bewusst konservativ: 5 Minuten.
 */
export const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Ab wann ist ein Offline-Entwurf so alt, dass er nicht mehr ohne
 * ausdrückliche Bestätigung gesendet werden darf (§8 "Sieben Tage offline")?
 */
export const DRAFT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Wie viele Ereignisse der Server maximal nachliefert, bevor er statt eines
 * Replays eine VOLLSYNCHRONISATION anordnet (§6 "gap too large").
 */
export const MAX_REPLAY_EVENTS = 500;
