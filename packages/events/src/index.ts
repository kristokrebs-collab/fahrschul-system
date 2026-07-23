import { randomUUID } from "node:crypto";
import type { EventType } from "@fahrschul/domain";

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
