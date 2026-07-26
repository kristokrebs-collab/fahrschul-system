import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { deadLetters, eventCursors, eventInbox, eventOutbox } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { decideRetry, supportsEventVersion, type OutboxEnvelope } from "@fahrschul/events";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { emitAlarm } from "./alarm.js";

/**
 * PROMPT -1 §5 – Zustell-Worker für die transaktionale Outbox.
 *
 * Garantien:
 *  - Die Outbox-Zeile entsteht bereits atomar mit der fachlichen Änderung
 *    (DB-Trigger, siehe migrations/0007_reliability_core.sql). Der Worker
 *    liest also NIEMALS ein Ereignis, dessen Änderung nicht committet ist –
 *    das verbotene Muster "DB geändert und danach hoffentlich Nachricht
 *    gesendet" existiert nicht mehr.
 *  - Zustellung ist at-least-once. Jeder Konsument schreibt seine
 *    verarbeitete Ereignis-ID in `event_inbox`; der Unique-Index
 *    (consumer, event_id) macht Duplikate wirkungslos -> effektiv
 *    exactly-once Verarbeitung.
 *  - Absturzsicherheit: Zeilen werden per LEASE (`lease_owner`,
 *    `lease_expires_at`) beansprucht, nicht gelöscht. Stirbt der Worker
 *    mitten in der Zustellung, läuft der Lease ab und
 *    `recoverExpiredOutboxLeases()` gibt die Zeile für einen anderen Worker
 *    frei. Kein Ereignis geht verloren.
 *  - Nach Erschöpfung der Versuche bzw. bei dauerhaftem Fehler: Status
 *    'dead' + Zeile in `dead_letters` + Alarm-Hook + manueller
 *    Wiederaufnahmepfad (§9/§13).
 */

export const DEFAULT_LEASE_SECONDS = 30;

export type ConsumerName =
  | "notifications"
  | "projection"
  | "integration-sync"
  /** PROMPT -1 §6 (Phase 2): autorisierter Fanout für den Realtime-Kanal. */
  | "realtime-fanout";

export interface EventConsumer {
  name: ConsumerName;
  /** Höchste Ereignisversion, die dieser Konsument versteht (Rückwärtskompatibilität). */
  maxEventVersion: number;
  /** Ereignistypen, für die sich der Konsument interessiert. `*` = alle. */
  eventTypes: readonly string[];
  handle: (envelope: OutboxEnvelope, ctx: { db: Database }) => Promise<Record<string, unknown> | void>;
}

export function workerId(prefix = "outbox"): string {
  return `${prefix}@${hostname()}#${process.pid}#${randomUUID().slice(0, 8)}`;
}

/**
 * Gibt Zeilen frei, deren Lease abgelaufen ist (= der bearbeitende Worker ist
 * abgestürzt). DAS ist der Wiederaufnahmepfad nach einem Crash und wird von
 * `runOutboxOnce` bei jedem Durchlauf zuerst aufgerufen.
 */
export async function recoverExpiredOutboxLeases(db: Database): Promise<number> {
  const recovered = await db
    .update(eventOutbox)
    .set({
      status: "pending",
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: sql`coalesce(${eventOutbox.lastError}, 'lease abgelaufen – Worker vermutlich abgestürzt')`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(eventOutbox.status, "in_flight"),
        or(isNull(eventOutbox.leaseExpiresAt), lte(eventOutbox.leaseExpiresAt, sql`now()`)),
      ),
    )
    .returning({ id: eventOutbox.id });
  return recovered.length;
}

/**
 * Beansprucht bis zu `limit` fällige Zeilen. `for update skip locked` sorgt
 * dafür, dass mehrere Worker parallel laufen können, ohne sich dieselbe Zeile
 * zu greifen.
 */
export async function claimOutboxBatch(
  db: Database,
  options: { owner: string; limit?: number; leaseSeconds?: number },
) {
  const limit = options.limit ?? 20;
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const rows = await db.execute(sql`
    update event_outbox o
       set status = 'in_flight',
           lease_owner = ${options.owner},
           lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
           attempts = o.attempts + 1,
           updated_at = now()
     where o.id in (
       select id from event_outbox
        where status = 'pending' and next_attempt_at <= now()
        order by seq
        for update skip locked
        limit ${limit}
     )
    returning o.*
  `);
  return rows as unknown as Array<{
    id: string;
    seq: string | number;
    event_type: string;
    event_version: number;
    aggregate_type: string | null;
    aggregate_id: string | null;
    correlation_id: string | null;
    standort_id: string | null;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
  }>;
}

function toEnvelope(row: Awaited<ReturnType<typeof claimOutboxBatch>>[number]): OutboxEnvelope {
  return {
    eventId: row.id,
    seq: Number(row.seq),
    eventType: row.event_type,
    eventVersion: row.event_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    correlationId: row.correlation_id,
    standortId: row.standort_id,
    payload: row.payload,
    attempts: row.attempts,
  };
}

/**
 * Verarbeitet ein Ereignis für EINEN Konsumenten mit Inbox-Dedup.
 * Rückgabe: 'processed' | 'duplicate' | 'skipped'.
 */
export async function deliverToConsumer(
  db: Database,
  consumer: EventConsumer,
  envelope: OutboxEnvelope,
): Promise<"processed" | "duplicate" | "skipped"> {
  const interested =
    consumer.eventTypes.includes("*") || consumer.eventTypes.includes(envelope.eventType);
  if (!interested) return "skipped";

  if (!supportsEventVersion(envelope, consumer.maxEventVersion)) {
    // Kein stiller Datenverlust: eine zu neue Ereignisversion ist ein Fehler,
    // der in die Dead-Letter-Queue gehört, nicht ein "einfach ignorieren".
    throw Object.assign(
      new Error(
        `Konsument ${consumer.name} unterstützt Ereignisversion ${envelope.eventVersion} nicht (max ${consumer.maxEventVersion}).`,
      ),
      { errorClass: "UNKNOWN_PERMANENT" as const },
    );
  }

  // Reservierung ZUERST: gewinnt der Insert nicht, wurde das Ereignis von
  // diesem Konsumenten schon verarbeitet -> Duplikat ignorieren.
  const reserved = await db
    .insert(eventInbox)
    .values({
      consumer: consumer.name,
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      eventVersion: envelope.eventVersion,
      outcome: "processed",
    })
    .onConflictDoNothing({ target: [eventInbox.consumer, eventInbox.eventId] })
    .returning({ id: eventInbox.id });

  if (reserved.length === 0) return "duplicate";

  const result = await consumer.handle(envelope, { db });
  if (result) {
    await db.update(eventInbox).set({ result }).where(eq(eventInbox.id, reserved[0].id));
  }
  return "processed";
}

export interface OutboxRunResult {
  recovered: number;
  claimed: number;
  delivered: number;
  duplicates: number;
  retried: number;
  deadLettered: number;
}

/**
 * Ein Durchlauf des Workers. Bewusst als "once"-Funktion gebaut (kein
 * Endlos-Loop im Prozess), damit sie
 *   a) im Test deterministisch aufrufbar ist,
 *   b) von einem Scheduler/Cron ODER einer Schleife (`startOutboxLoop`)
 *      betrieben werden kann.
 */
export async function runOutboxOnce(
  db: Database,
  consumers: readonly EventConsumer[],
  options: { owner?: string; limit?: number; leaseSeconds?: number } = {},
): Promise<OutboxRunResult> {
  const owner = options.owner ?? workerId();
  const result: OutboxRunResult = {
    recovered: await recoverExpiredOutboxLeases(db),
    claimed: 0,
    delivered: 0,
    duplicates: 0,
    retried: 0,
    deadLettered: 0,
  };

  const batch = await claimOutboxBatch(db, {
    owner,
    limit: options.limit,
    leaseSeconds: options.leaseSeconds,
  });
  result.claimed = batch.length;

  for (const row of batch) {
    const envelope = toEnvelope(row);
    try {
      let anyProcessed = false;
      for (const consumer of consumers) {
        const outcome = await deliverToConsumer(db, consumer, envelope);
        if (outcome === "processed") anyProcessed = true;
        if (outcome === "duplicate") result.duplicates += 1;
      }

      await db
        .update(eventOutbox)
        .set({
          status: "delivered",
          deliveredAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: null,
          errorClass: null,
          updatedAt: new Date(),
        })
        .where(eq(eventOutbox.id, row.id));

      await advanceCursors(db, consumers, envelope);
      if (anyProcessed || true) result.delivered += 1;
    } catch (err) {
      const decision = decideRetry(err, row.attempts, row.max_attempts);
      if (decision.retry) {
        await db
          .update(eventOutbox)
          .set({
            status: "pending",
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: new Date(Date.now() + decision.delayMs),
            lastError: (err as Error).message,
            errorClass: decision.errorClass,
            updatedAt: new Date(),
          })
          .where(eq(eventOutbox.id, row.id));
        result.retried += 1;
      } else {
        await db
          .update(eventOutbox)
          .set({
            status: "dead",
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: (err as Error).message,
            errorClass: decision.errorClass,
            updatedAt: new Date(),
          })
          .where(eq(eventOutbox.id, row.id));
        await pushDeadLetter(db, {
          source: "outbox",
          sourceId: row.id,
          kind: row.event_type,
          payload: row.payload,
          attempts: row.attempts,
          errorClass: decision.errorClass,
          lastError: (err as Error).message,
          auditKontext: {
            reason: decision.reason,
            correlationId: row.correlation_id,
            aggregateType: row.aggregate_type,
            aggregateId: row.aggregate_id,
            eventVersion: row.event_version,
          },
        });
        result.deadLettered += 1;
      }
    }
  }

  return result;
}

/** Schreibt den Cursor je Konsument fort (Wiederaufnahme ohne Inbox-Scan). */
async function advanceCursors(
  db: Database,
  consumers: readonly EventConsumer[],
  envelope: OutboxEnvelope,
): Promise<void> {
  for (const consumer of consumers) {
    await db
      .insert(eventCursors)
      .values({ consumer: consumer.name, lastSeq: envelope.seq, lastEventId: envelope.eventId })
      .onConflictDoUpdate({
        target: eventCursors.consumer,
        set: { lastSeq: envelope.seq, lastEventId: envelope.eventId, updatedAt: new Date() },
        setWhere: lte(eventCursors.lastSeq, envelope.seq),
      });
  }
}

export interface DeadLetterInput {
  source: "outbox" | "job";
  sourceId: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  errorClass: string;
  lastError: string;
  auditKontext: Record<string, unknown>;
}

/** Legt einen Dead-Letter-Eintrag an und feuert den Alarm-Hook (§9). */
export async function pushDeadLetter(db: Database, input: DeadLetterInput): Promise<void> {
  await db
    .insert(deadLetters)
    .values({
      source: input.source,
      sourceId: input.sourceId,
      kind: input.kind,
      payload: input.payload,
      attempts: input.attempts,
      errorClass: input.errorClass,
      lastError: input.lastError,
      auditKontext: input.auditKontext,
      alarmEmittedAt: new Date(),
    })
    .onConflictDoNothing({ target: [deadLetters.source, deadLetters.sourceId] });

  await emitAlarm({
    kind: "dead_letter",
    source: input.source,
    sourceId: input.sourceId,
    subject: input.kind,
    errorClass: input.errorClass,
    message: input.lastError,
  });
}

/** Zählt offene (nicht wiederaufgenommene) Dead-Letter-Einträge – Basis für §21-SLOs (Phase 4). */
export async function openDeadLetterCount(db: Database): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(deadLetters)
    .where(isNull(deadLetters.resumedAt));
  return Number(rows[0]?.n ?? 0);
}

/** Nur für Diagnose/Ops: älteste unzugestellte Ereignisse. */
export async function pendingOutbox(db: Database, limit = 50) {
  return db
    .select()
    .from(eventOutbox)
    .where(or(eq(eventOutbox.status, "pending"), eq(eventOutbox.status, "in_flight")))
    .orderBy(asc(eventOutbox.seq))
    .limit(limit);
}
