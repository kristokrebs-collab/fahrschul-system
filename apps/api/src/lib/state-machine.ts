import {
  auditEreignisse,
  banktransaktionen,
  dokumente,
  fahrzeugmaengel,
  terminangebote,
} from "@fahrschul/database";
import {
  assertStateTransition,
  STATE_LEGACY_MAP,
  StateTransitionError,
  type StateMachineName,
} from "@fahrschul/domain";
import { buildEventRow, type AuditEventType } from "@fahrschul/events";
import { eq, sql } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import type { Tx } from "../services/booking.js";

/**
 * PROMPT -1 §10 – Ausführung eines Zustandsübergangs.
 *
 * Ein Übergang ist genau dann gültig, wenn ALLE vier Bedingungen erfüllt sind:
 *   1. allow-listed  – `assertStateTransition` (packages/domain) UND
 *                      zusätzlich die DB-Tabelle `state_machine_transitions`
 *                      über den jeweiligen Trigger (Verteidigung in der Tiefe).
 *   2. validiert     – die Vorbedingungen der Route (Rolle, Eigentum, Frist).
 *   3. auditiert     – `state_transitions` (per Trigger, also auch bei
 *                      Roh-SQL) UND ein `audit_events`-Ereignis, das per
 *                      Outbox-Trigger zugestellt wird.
 *   4. wiederaufnehmbar – der Zustand steht in der Entitätsspalte, nie im
 *                      Prozessspeicher. Fällt der Prozess zwischen zwei
 *                      Schritten aus, setzt ein Job (§13) genau dort wieder an.
 *
 * `setTransitionContext` schreibt Akteur und Grund in Sitzungsvariablen, die
 * der DB-Trigger ausliest – so landet der Akteur auch dann im Protokoll, wenn
 * der Übergang aus einem Job ohne HTTP-Request stammt.
 */

const MACHINE_TABLES = {
  terminangebot: { table: terminangebote, column: "angebotStatus", entitaet: "terminangebot" },
  dokument: { table: dokumente, column: "dokumentStatus", entitaet: "dokument" },
  zahlung: { table: banktransaktionen, column: "zahlungStatus", entitaet: "banktransaktion" },
  fahrzeugmangel: { table: fahrzeugmaengel, column: "mangelStatus", entitaet: "fahrzeugmangel" },
} as const;

export { StateTransitionError };

/** Legt Akteur/Grund für die DB-Trigger in der aktuellen Transaktion ab. */
export async function setTransitionContext(
  tx: Tx,
  ctx: { akteurBenutzerId?: string | null; grund?: string | null },
): Promise<void> {
  // set_config(..., true) = LOCAL, gilt nur bis zum Ende der Transaktion.
  await tx.execute(
    sql`select set_config('fahrschul.akteur_benutzer_id', ${ctx.akteurBenutzerId ?? ""}, true),
               set_config('fahrschul.transition_grund', ${ctx.grund ?? ""}, true)`,
  );
}

export interface TransitionOptions {
  machine: StateMachineName;
  entitaetId: string;
  to: string;
  akteurBenutzerId?: string | null;
  standortId?: string | null;
  grund?: string | null;
  /** Ereignistyp für das Audit-/Outbox-Ereignis. Ohne Angabe wird kein Ereignis publiziert. */
  eventType?: AuditEventType;
  aktion?: string;
  source?: string;
  /** Zusätzliche Spalten, die im gleichen Update gesetzt werden. */
  patch?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

/**
 * Führt einen Übergang aus. Muss innerhalb einer Transaktion aufgerufen
 * werden, damit Zustandsänderung, Protokoll und Ereignis atomar sind.
 */
export async function transitionState(tx: Tx, options: TransitionOptions) {
  const cfg = MACHINE_TABLES[options.machine];
  const table = cfg.table as never;

  const rows = (await tx
    .select()
    .from(table)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(eq((cfg.table as any).id, options.entitaetId))
    .limit(1)) as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) {
    throw new StateTransitionError(options.machine, "unbekannt", options.to, []);
  }

  const from = String(row[cfg.column]);
  assertStateTransition(options.machine, from, options.to);
  if (from === options.to) {
    return { row, from, to: options.to, changed: false as const };
  }

  await setTransitionContext(tx, { akteurBenutzerId: options.akteurBenutzerId, grund: options.grund });

  const updated = (await tx
    .update(table)
    .set({ [cfg.column]: options.to, ...(options.patch ?? {}) } as never)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(eq((cfg.table as any).id, options.entitaetId))
    .returning()) as unknown as Array<Record<string, unknown>>;

  if (options.eventType) {
    await tx.insert(auditEreignisse).values(
      buildEventRow({
        type: options.eventType,
        aktion: options.aktion ?? `${options.machine}.transition`,
        entitaet: cfg.entitaet,
        entitaetId: options.entitaetId,
        akteurBenutzerId: options.akteurBenutzerId ?? null,
        standortId: options.standortId ?? null,
        source: options.source ?? `apps/api:state-machine.${options.machine}`,
        vorher: { state: from, legacyStatus: STATE_LEGACY_MAP[options.machine][from] },
        nachher: { state: options.to, legacyStatus: STATE_LEGACY_MAP[options.machine][options.to] },
        payload: { grund: options.grund ?? null, ...(options.payload ?? {}) },
      }),
    );
  }

  return { row: updated[0], from, to: options.to, changed: true as const };
}

/** SQLSTATE-Codes der in Migration 0007 definierten Fachinvarianten. */
export const BUSINESS_CONSTRAINT_CODES = {
  FS001: "lesson_already_completed",
  FS003: "banktransaktion_already_matched",
  FS004: "exam_clearance_chain_missing",
  FS005: "vehicle_blocked",
  FS006: "document_review_protocol_required",
  FS007: "invalid_state_transition",
} as const;

/**
 * Übersetzt eine Verletzung der DB-Invarianten in eine HTTP-Antwort.
 * Gibt `true` zurück, wenn der Fehler behandelt wurde.
 */
export function sendBusinessConstraintError(err: unknown, reply: FastifyReply): boolean {
  const pg = err as { code?: string; message?: string };
  if (pg.code && pg.code in BUSINESS_CONSTRAINT_CODES) {
    const code = BUSINESS_CONSTRAINT_CODES[pg.code as keyof typeof BUSINESS_CONSTRAINT_CODES];
    reply.code(409).send({ error: code, sqlstate: pg.code, message: pg.message });
    return true;
  }
  if (err instanceof StateTransitionError) {
    reply.code(409).send({
      error: "invalid_state_transition",
      machine: err.machine,
      from: err.from,
      to: err.to,
      allowed: err.allowed,
      message: err.message,
    });
    return true;
  }
  return false;
}
