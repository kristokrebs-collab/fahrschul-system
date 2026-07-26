import { realtimeDeliveries } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { MAX_REPLAY_EVENTS, type SyncDataType } from "@fahrschul/domain";
import type { OutboxEnvelope } from "@fahrschul/events";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import {
  expandAudienceToBenutzer,
  resolveAudience,
  subscriberDeliveryKey,
} from "./realtime-audience.js";

/**
 * PROMPT -1 §6 – Echtzeit-Synchronisation, Serverseite.
 *
 * Der geforderte Ablauf, wörtlich:
 *   Server committet die fachliche Änderung
 *     -> Outbox-Ereignis existiert (Phase 1, DB-Trigger, unverändert)
 *     -> der Kanal sendet NUR Ereignis-ID + grobes Thema, NIE die Nutzlast
 *     -> der Client lädt den autoritativen Zustand neu
 *     -> UI aktualisiert
 *
 * Diese Datei besitzt die Mitte dieses Ablaufs: den autorisierten Fanout
 * (`fanoutRealtime`, aufgerufen aus dem Outbox-Konsumenten) und den Lesepfad
 * (`readChanges`), den SSE-Stream UND Polling-Fallback gemeinsam benutzen.
 *
 * ZUSICHERUNGEN, die der Client NICHT erwarten darf – und die er deshalb
 * nirgends voraussetzt:
 *   - keine Zustellgarantie (Ereignisse können verloren gehen),
 *   - keine Exactly-once (Ereignisse können doppelt kommen),
 *   - keine Reihenfolgegarantie über den Kanal hinweg.
 * Korrektheit entsteht ausschließlich daraus, dass jede Meldung nur ein
 * ANLASS ZUM NEULADEN ist. Der Zustand kommt immer aus der Datenbank.
 */

export interface RealtimeChange {
  /** Dichter Cursor DIESES Abonnenten (1, 2, 3, …). */
  cursor: number;
  /** Ereignis-ID (opak). Erlaubt dem Client Duplikaterkennung. */
  eventId: string;
  eventType: string;
  /** Grobes Thema – NIE eine Datensatz-ID, nie Fachinhalt. */
  dataType: SyncDataType;
}

export interface ReadChangesResult {
  changes: RealtimeChange[];
  /** Höchster Cursor, den der Client nach Verarbeitung gespeichert haben darf. */
  cursor: number;
  /** Höchster derzeit vorhandener Cursor dieses Abonnenten. */
  latestCursor: number;
  /**
   * true, wenn ein Replay ab dem angefragten Cursor NICHT möglich ist und der
   * Client eine Vollsynchronisation fahren muss (§6 "gap too large").
   */
  resyncRequired: boolean;
  resyncReason: "gap_too_large" | "cursor_pruned" | "cursor_ahead_of_server" | null;
  hasMore: boolean;
}

/**
 * Vergibt die nächste dichte Cursor-Nummer für einen Empfänger. Atomar über
 * `on conflict do update … returning`, damit parallele Fanouts keine Lücke und
 * keine Doppelnummer erzeugen (die Lückenfreiheit ist die Grundlage der
 * clientseitigen Lückenerkennung).
 */
async function nextAudienceSeq(db: Database, audienceKey: string): Promise<number> {
  const rows = (await db.execute(sql`
    insert into realtime_audience_counters (audience_key, next_seq, updated_at)
         values (${audienceKey}, 1, now())
    on conflict (audience_key)
      do update set next_seq = realtime_audience_counters.next_seq + 1, updated_at = now()
      returning next_seq
  `)) as unknown as Array<{ next_seq: string | number }>;
  return Number(rows[0]?.next_seq ?? 0);
}

export interface FanoutResult {
  dataType: SyncDataType | null;
  audienceKeys: string[];
  benutzerIds: string[];
  delivered: number;
  duplicates: number;
  fallback: boolean;
}

/**
 * Schreibt die Zustellzeilen für ein Outbox-Ereignis. Wird vom Konsumenten
 * `realtime-fanout` aufgerufen und ist damit über `event_inbox` bereits gegen
 * doppelte Ausführung geschützt; der Unique-Index
 * `(audience_key, event_id)` ist die zweite Sperre.
 */
export async function fanoutRealtime(
  db: Database,
  envelope: OutboxEnvelope,
): Promise<FanoutResult> {
  const audience = await resolveAudience(db, envelope);
  if (!audience) {
    return {
      dataType: null,
      audienceKeys: [],
      benutzerIds: [],
      delivered: 0,
      duplicates: 0,
      fallback: false,
    };
  }

  const benutzerIds = await expandAudienceToBenutzer(db, audience.audienceKeys);
  let delivered = 0;
  let duplicates = 0;

  for (const benutzerId of benutzerIds) {
    const audienceKey = subscriberDeliveryKey(benutzerId);

    // Erst prüfen, ob diese Zustellung schon existiert: sonst würde ein
    // (theoretischer) Wiederholungslauf eine Cursor-Nummer verbrauchen, ohne
    // eine Zeile zu schreiben – das wäre eine Lücke und würde beim Client
    // eine unnötige Vollsynchronisation auslösen.
    const [vorhanden] = await db
      .select({ id: realtimeDeliveries.id })
      .from(realtimeDeliveries)
      .where(
        and(
          eq(realtimeDeliveries.audienceKey, audienceKey),
          eq(realtimeDeliveries.eventId, envelope.eventId),
        ),
      )
      .limit(1);
    if (vorhanden) {
      duplicates += 1;
      continue;
    }

    const seq = await nextAudienceSeq(db, audienceKey);
    const inserted = await db
      .insert(realtimeDeliveries)
      .values({
        audienceKey,
        audienceSeq: seq,
        eventId: envelope.eventId,
        eventType: envelope.eventType,
        dataType: audience.dataType,
        standortId: envelope.standortId,
      })
      .onConflictDoNothing({
        target: [realtimeDeliveries.audienceKey, realtimeDeliveries.eventId],
      })
      .returning({ id: realtimeDeliveries.id });
    if (inserted.length > 0) delivered += 1;
    else duplicates += 1;
  }

  return {
    dataType: audience.dataType,
    audienceKeys: audience.audienceKeys,
    benutzerIds,
    delivered,
    duplicates,
    fallback: audience.fallback,
  };
}

/** Höchster vorhandener Cursor eines Abonnenten (0 = noch nie etwas). */
export async function latestCursor(db: Database, benutzerId: string): Promise<number> {
  const rows = await db
    .select({ max: sql<number | null>`max(${realtimeDeliveries.audienceSeq})` })
    .from(realtimeDeliveries)
    .where(eq(realtimeDeliveries.audienceKey, subscriberDeliveryKey(benutzerId)));
  return Number(rows[0]?.max ?? 0);
}

/** Kleinster noch vorhandener Cursor – alles darunter wurde weggeräumt. */
export async function oldestCursor(db: Database, benutzerId: string): Promise<number> {
  const rows = await db
    .select({ min: sql<number | null>`min(${realtimeDeliveries.audienceSeq})` })
    .from(realtimeDeliveries)
    .where(eq(realtimeDeliveries.audienceKey, subscriberDeliveryKey(benutzerId)));
  return Number(rows[0]?.min ?? 0);
}

/**
 * DER gemeinsame Lesepfad für SSE-Stream und Polling-Fallback.
 *
 * Vollsynchronisation wird angeordnet, wenn
 *   a) der Cursor unter den ältesten noch vorhandenen fällt (aufgeräumt –
 *      ein Replay wäre unvollständig, und ein unvollständiges Replay ist
 *      schlimmer als ein sauberer Neuaufbau),
 *   b) die Lücke größer als `MAX_REPLAY_EVENTS` ist (z. B. eine Woche offline),
 *   c) der Cursor VOR dem Server liegt (Client hat eine fremde/alte
 *      Datenbank gesehen, z. B. nach einem Restore) – dann ist der
 *      Client-Zustand nicht vertrauenswürdig.
 */
export async function readChanges(
  db: Database,
  options: { benutzerId: string; cursor: number; limit?: number },
): Promise<ReadChangesResult> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), MAX_REPLAY_EVENTS);
  const audienceKey = subscriberDeliveryKey(options.benutzerId);
  const cursor = Number.isFinite(options.cursor) ? Math.max(0, Math.floor(options.cursor)) : 0;

  const latest = await latestCursor(db, options.benutzerId);
  const oldest = await oldestCursor(db, options.benutzerId);

  if (cursor > latest) {
    return {
      changes: [],
      cursor: latest,
      latestCursor: latest,
      resyncRequired: true,
      resyncReason: "cursor_ahead_of_server",
      hasMore: false,
    };
  }
  // Auch ein Client mit Cursor 0 kann betroffen sein: sind die ältesten
  // Zeilen weggeräumt, beginnt die Folge nicht bei 1 und ein Replay wäre
  // unvollständig. Ein unvollständiges Replay ist schlimmer als ein sauberer
  // Neuaufbau.
  if (oldest > 0 && cursor < oldest - 1) {
    return {
      changes: [],
      cursor: latest,
      latestCursor: latest,
      resyncRequired: true,
      resyncReason: "cursor_pruned",
      hasMore: false,
    };
  }
  if (latest - cursor > MAX_REPLAY_EVENTS) {
    return {
      changes: [],
      cursor: latest,
      latestCursor: latest,
      resyncRequired: true,
      resyncReason: "gap_too_large",
      hasMore: false,
    };
  }

  const rows = await db
    .select({
      cursor: realtimeDeliveries.audienceSeq,
      eventId: realtimeDeliveries.eventId,
      eventType: realtimeDeliveries.eventType,
      dataType: realtimeDeliveries.dataType,
    })
    .from(realtimeDeliveries)
    .where(and(eq(realtimeDeliveries.audienceKey, audienceKey), gt(realtimeDeliveries.audienceSeq, cursor)))
    .orderBy(realtimeDeliveries.audienceSeq)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const changes = rows.slice(0, limit).map((r) => ({
    cursor: Number(r.cursor),
    eventId: r.eventId,
    eventType: r.eventType,
    dataType: r.dataType as SyncDataType,
  }));

  return {
    changes,
    cursor: changes.length > 0 ? changes[changes.length - 1].cursor : cursor,
    latestCursor: latest,
    resyncRequired: false,
    resyncReason: null,
    hasMore,
  };
}

/**
 * Aufbewahrung: alte Zustellzeilen werden entfernt (Job `realtime.prune`).
 * Der Zähler bleibt stehen – die Cursor-Folge darf nie zurückgesetzt werden,
 * sonst würde ein Client mit gespeichertem hohem Cursor Ereignisse
 * überspringen. Das Aufräumen ist genau der Grund, warum es den Zustand
 * "Cursor aufgeräumt -> Vollsynchronisation" gibt.
 */
export async function pruneRealtimeDeliveries(
  db: Database,
  options: { olderThanMs?: number; now?: Date } = {},
): Promise<number> {
  const olderThanMs = options.olderThanMs ?? 7 * 24 * 60 * 60 * 1000;
  const grenze = new Date((options.now?.getTime() ?? Date.now()) - olderThanMs);
  const deleted = await db
    .delete(realtimeDeliveries)
    .where(lt(realtimeDeliveries.createdAt, grenze))
    .returning({ id: realtimeDeliveries.id });
  return deleted.length;
}
