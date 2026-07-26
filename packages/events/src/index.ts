import { randomUUID } from "node:crypto";
import type { EventType } from "@fahrschul/domain";

export * from "./retry.js";

/**
 * Minimaler Helfer zum Aufbau eines audit_events-Inserts (kein vollständiger
 * Message-Bus, wie in der Aufgabenstellung explizit als ausreichend
 * markiert). apps/api ruft buildEventRow(...) auf und fügt die Zeile
 * innerhalb derselben Transaktion wie die fachliche Änderung ein, damit
 * Event und Datenänderung atomar sind.
 */
/**
 * `type` akzeptiert entweder einen der 12 spezifizierten Event-Typen
 * (EventType) oder einen freien String für allgemeines Sicherheits-/
 * Verwaltungs-Audit (z. B. "login", "logout", "role.changed"), das über die
 * 12 fachlichen Ereignisse aus Schritt 6 hinausgeht, aber dieselbe Tabelle
 * nutzt (siehe Aufgabenstellung: "reuse audit_events with a type column").
 */
export type AuditEventType = EventType | (string & { readonly __brand?: never });

export interface EventInput<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  type: AuditEventType;
  aktion: string;
  entitaet: string;
  entitaetId?: string | null;
  akteurBenutzerId?: string | null;
  standortId?: string | null;
  source: string;
  correlationId?: string;
  idempotencyKey?: string | null;
  vorher?: unknown;
  nachher?: unknown;
  payload?: TPayload;
}

export function buildEventRow(input: EventInput) {
  return {
    type: input.type,
    aktion: input.aktion,
    entitaet: input.entitaet,
    entitaetId: input.entitaetId ?? null,
    akteurBenutzerId: input.akteurBenutzerId ?? null,
    standortId: input.standortId ?? null,
    source: input.source,
    correlationId: input.correlationId ?? randomUUID(),
    idempotencyKey: input.idempotencyKey ?? null,
    vorher: input.vorher ?? null,
    nachher: input.nachher ?? null,
    payload: input.payload ?? {},
  };
}

/**
 * PROMPT -1 §5 – Transaktionale Outbox.
 *
 * `buildEventRow` bleibt UNVERÄNDERT: das bestehende Muster (Audit-Zeile in
 * derselben Transaktion wie die fachliche Änderung) war schon atomar, ihm
 * fehlte nur die Zustellseite. Statt jeden Aufrufer anzufassen, erzeugt der
 * DB-Trigger `audit_events_outbox_trg` (migrations/0007_reliability_core.sql)
 * die Outbox-Zeile automatisch in derselben Transaktion. Damit gilt:
 *
 *   Es existiert KEIN Codepfad, der eine fachliche Änderung committen kann,
 *   ohne die zugehörige Outbox-Zeile mitzucommitten.
 *
 * `writeEvent` ist der bevorzugte Helfer für NEUEN Code: er macht die
 * Absicht ("Ereignis veröffentlichen") explizit und liefert die Ereignis-ID
 * für Korrelation zurück, statt nur eine Audit-Zeile einzufügen.
 */
export interface EventPublisherTx {
  insert: (table: unknown) => {
    values: (row: unknown) => { returning: () => Promise<Array<{ id: string }>> };
  };
}

/**
 * Ereignis-Umschlag, wie ihn Konsumenten aus der Outbox erhalten.
 * `eventVersion` erlaubt rückwärtskompatible Weiterentwicklung: ein Konsument
 * MUSS ältere Versionen weiter verarbeiten und darf unbekannte Felder
 * ignorieren (siehe docs/sync-architecture.md "Ereignisversionierung").
 */
export interface OutboxEnvelope<TPayload = Record<string, unknown>> {
  eventId: string;
  seq: number;
  eventType: string;
  eventVersion: number;
  aggregateType: string | null;
  aggregateId: string | null;
  correlationId: string | null;
  standortId: string | null;
  payload: TPayload;
  attempts: number;
}

/**
 * Prüft, ob ein Konsument einen Ereignis-Umschlag verarbeiten kann.
 * Rückwärtskompatibilität heißt: der Konsument kennt eine Maximalversion und
 * verarbeitet ALLES bis dorthin; höhere Versionen werden nicht stillschweigend
 * verworfen, sondern als "nicht unterstützt" gemeldet (der Worker legt sie in
 * die Dead-Letter-Queue statt Daten zu verlieren).
 */
export function supportsEventVersion(envelope: OutboxEnvelope, maxSupportedVersion: number): boolean {
  return envelope.eventVersion <= maxSupportedVersion;
}

export function newCorrelationId(): string {
  return randomUUID();
}
