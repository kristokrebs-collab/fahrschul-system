import { idempotencyKeys } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { MAX_REPLAY_EVENTS } from "@fahrschul/domain";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { IDEMPOTENT_OPERATIONS } from "../lib/idempotency.js";
import { requireAuth } from "../middleware/auth.js";
import { latestCursor, readChanges } from "../services/realtime.js";

/**
 * PROMPT -1 §6/§7 – Der Synchronisationskanal.
 *
 * ## Transportwahl: Server-Sent Events, nicht WebSocket
 *
 * Begründet, nicht geraten:
 *
 *  1. **Der Kanal ist einseitig.** Er überträgt ausschließlich "es hat sich
 *     etwas geändert" (Ereignis-ID + grobes Thema). Alles Schreibende läuft
 *     über die bestehenden, autorisierten, idempotenten HTTP-Routen. Der
 *     Hauptvorteil von WebSocket – bidirektionale Vollduplex-Kommunikation –
 *     ist hier ohne Nutzen, sein Preis (eigenes Framing, eigenes
 *     Reconnect-/Heartbeat-Protokoll, eigene Autorisierung beim Upgrade,
 *     zusätzliche Abhängigkeit `@fastify/websocket`) fällt trotzdem an.
 *  2. **Sitzung.** Die Anmeldung läuft über ein httpOnly-Cookie. Ein
 *     normaler GET trägt es mit `credentials: 'include'`; ein
 *     WebSocket-Upgrade kann keine eigenen Header setzen und verleitet zu
 *     Token-in-Query-String – das wäre eine Verschlechterung der
 *     Sicherheitslage.
 *  3. **Netzwerkpfad.** Ein langlebiger GET passiert Proxies, die
 *     `Upgrade: websocket` blockieren. Zusammen mit dem Polling-Fallback
 *     (`GET /sync/changes`) gibt es damit zwei Wege über gewöhnliches HTTP.
 *  4. **Wiederaufnahme.** SSE hat Cursor-Wiederaufnahme im Protokoll:
 *     `id:` im Ereignis, `Last-Event-ID` beim Reconnect. Genau die von §6
 *     geforderte Semantik, ohne sie selbst zu erfinden.
 *
 * Der Preis ist bekannt und akzeptiert: SSE ist Text-only, hat in HTTP/1.1
 * ein Verbindungslimit je Origin (6) und kann keine Client-Nachrichten
 * annehmen. Für einen reinen Änderungs-Ticker ist das irrelevant.
 *
 * ## Was der Kanal NICHT ist
 *
 * Er ist keine Datenquelle. Er transportiert NIE eine Nutzlast. Verlorene,
 * doppelte und vertauschte Meldungen sind ausdrücklich erlaubt – der Client
 * ist korrekt, weil jede Meldung nur ein Anlass zum Neuladen ist und der
 * Cursor Lücken sichtbar macht.
 */

export interface RealtimeOptions {
  /** Abfrageintervall des Streams gegen die Datenbank. */
  pollIntervalMs?: number;
  /** Herzschlagintervall (hält Proxies offen, erlaubt dem Client Totmann-Erkennung). */
  heartbeatIntervalMs?: number;
}

const DEFAULT_POLL_MS = 1000;
const DEFAULT_HEARTBEAT_MS = 15000;

const cursorQuerySchema = z.object({
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_REPLAY_EVENTS).optional(),
});

const OPERATION_VALUES = Object.values(IDEMPOTENT_OPERATIONS) as string[];

/**
 * Überträgt die von @fastify/cors gesetzten Kopfzeilen auf die rohe Antwort.
 * Nötig, weil ein gehijackter Stream die `onSend`-Kette verlässt – und
 * bewusst KEIN Echo beliebiger Origins: es wird ausschließlich übernommen,
 * was die zentrale CORS-Allowlist ohnehin erlaubt hat.
 */
function copyCorsHeaders(reply: FastifyReply): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [
    "access-control-allow-origin",
    "access-control-allow-credentials",
    "vary",
  ]) {
    const value = reply.getHeader(name);
    if (typeof value === "string" && value.length > 0) out[name] = value;
    else if (Array.isArray(value) && value.length > 0) out[name] = value.join(", ");
  }
  return out;
}

function readCursorFromRequest(request: FastifyRequest): number {
  // `Last-Event-ID` ist der SSE-Standardweg zur Wiederaufnahme nach einem
  // automatischen Reconnect des Browsers; die Query ist der explizite Weg
  // (z. B. nach einem App-Neustart mit gespeichertem Cursor).
  const header = request.headers["last-event-id"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === "string" && /^\d+$/.test(fromHeader.trim())) {
    return Number(fromHeader.trim());
  }
  const parsed = cursorQuerySchema.safeParse(request.query);
  return parsed.success ? (parsed.data.cursor ?? 0) : 0;
}

export function registerSyncRoutes(
  app: FastifyInstance,
  db: Database,
  options: RealtimeOptions = {},
) {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;

  /**
   * Startpunkt für einen Client ohne gespeicherten Cursor ("ab jetzt") und
   * gleichzeitig die Zeitreferenz für die Datenalter-Anzeige (§1).
   */
  app.get("/sync/cursor", { preHandler: [requireAuth] }, async (request, reply) => {
    const cursor = await latestCursor(db, request.user!.id);
    return reply.send({
      cursor,
      serverTime: new Date().toISOString(),
      maxReplayEvents: MAX_REPLAY_EVENTS,
      pollIntervalMs,
      heartbeatIntervalMs,
    });
  });

  /**
   * §6 POLLING-FALLBACK. Derselbe Lesepfad wie der Stream, nur ohne
   * langlebige Verbindung. Der Client wechselt hierher, wenn der Stream nicht
   * verfügbar ist (Proxy, Verbindungslimit, wiederholt fehlgeschlagener
   * Reconnect) – die Konvergenz ist identisch, nur die Latenz höher.
   *
   * SEAM Phase 3 (§18 Degraded-Operation-UX): das ist der Mechanismus, auf
   * dem der eingeschränkte Betrieb aufsetzt. Er braucht dafür keine
   * Erweiterung, nur eine Anzeige.
   */
  app.get("/sync/changes", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = cursorQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const result = await readChanges(db, {
      benutzerId: request.user!.id,
      cursor: parsed.data.cursor ?? 0,
      limit: parsed.data.limit,
    });
    return reply.send({ ...result, serverTime: new Date().toISOString() });
  });

  /**
   * §6 SSE-STREAM.
   *
   * Nachrichtenarten:
   *   `hello`     einmalig beim Verbinden: aktueller/angefragter Cursor,
   *               Intervalle, ob eine Vollsynchronisation nötig ist.
   *   `resync`    Replay ab dem Cursor nicht möglich -> alles neu laden.
   *   `change`    { cursor, eventId, eventType, dataType } – KEINE Nutzlast.
   *   `heartbeat` Lebenszeichen; der Client erkennt daran einen toten Kanal
   *               auch dann, wenn TCP das nicht merkt.
   */
  app.get("/sync/stream", { preHandler: [requireAuth] }, async (request, reply) => {
    const benutzerId = request.user!.id;
    let cursor = readCursorFromRequest(request);

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      // no-transform verhindert, dass ein Proxy den Stream puffert/komprimiert.
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      // nginx-spezifisch, aber harmlos und wirksam gegen Pufferung.
      "x-accel-buffering": "no",
      ...copyCorsHeaders(reply),
    });

    let closed = false;
    const send = (event: string, data: unknown, id?: number) => {
      if (closed || raw.writableEnded) return;
      const zeilen = [`event: ${event}`];
      if (typeof id === "number") zeilen.push(`id: ${id}`);
      zeilen.push(`data: ${JSON.stringify(data)}`, "", "");
      raw.write(zeilen.join("\n"));
    };

    // `retry:` sagt dem Browser, wie lange er bis zum Reconnect warten soll –
    // automatischer Reconnect ist damit Teil des Protokolls, nicht des Clients.
    raw.write(`retry: 3000\n\n`);

    const start = await readChanges(db, { benutzerId, cursor, limit: 1 });
    send("hello", {
      cursor: start.resyncRequired ? start.latestCursor : cursor,
      latestCursor: start.latestCursor,
      resyncRequired: start.resyncRequired,
      resyncReason: start.resyncReason,
      heartbeatIntervalMs,
      pollIntervalMs,
      serverTime: new Date().toISOString(),
    });
    if (start.resyncRequired) {
      // Vollsynchronisation: der Client verwirft seinen Stand und lädt alles
      // neu. Danach zählt der Cursor ab dem aktuellen Serverstand weiter.
      cursor = start.latestCursor;
      send("resync", { reason: start.resyncReason, cursor }, cursor);
    }

    let ticking = false;
    const tick = async () => {
      if (closed || ticking) return;
      ticking = true;
      try {
        const result = await readChanges(db, { benutzerId, cursor, limit: 100 });
        if (result.resyncRequired) {
          cursor = result.latestCursor;
          send("resync", { reason: result.resyncReason, cursor }, cursor);
          return;
        }
        for (const change of result.changes) {
          send("change", change, change.cursor);
          cursor = change.cursor;
        }
      } catch (err) {
        // Ein Datenbankfehler beendet den Stream nicht: der Client soll nicht
        // in einen Reconnect-Sturm laufen. Nächster Durchlauf versucht es neu.
        request.log?.error?.(err);
      } finally {
        ticking = false;
      }
    };

    const pollTimer = setInterval(() => void tick(), pollIntervalMs);
    const heartbeatTimer = setInterval(() => {
      send("heartbeat", { serverTime: new Date().toISOString(), cursor });
    }, heartbeatIntervalMs);

    const beenden = () => {
      if (closed) return;
      closed = true;
      clearInterval(pollTimer);
      clearInterval(heartbeatTimer);
      try {
        raw.end();
      } catch {
        // Verbindung war schon weg – nichts zu tun.
      }
    };

    request.raw.on("close", beenden);
    request.raw.on("error", beenden);
    app.addHook("onClose", async () => beenden());

    // Ein erster Durchlauf sofort, damit ein Client, der mit altem Cursor
    // startet, nicht erst ein Intervall auf sein Replay warten muss.
    void tick();
  });

  /**
   * §7 – "Nach einem Neustart offene Vorgänge auflösen."
   *
   * Der Client hat den Idempotenzschlüssel eines kritischen Schreibvorgangs
   * lokal gespeichert, BEVOR er ihn gesendet hat. Kommt die App wieder hoch
   * ohne die Antwort gesehen zu haben, fragt sie hier nach – statt den
   * Vorgang blind zu wiederholen oder einen falschen Erfolg zu behaupten.
   * Genau dafür existiert der Idempotenzspeicher aus Phase 1.
   *
   * Drei Antworten, drei UI-Zustände:
   *   `completed`   -> der Vorgang hat gewirkt; die gespeicherte Antwort wird
   *                    mitgeliefert. UI: Erfolg (jetzt bestätigt).
   *   `in_progress` -> eine Anfrage mit diesem Schlüssel läuft gerade.
   *                    UI: "Status wird geprüft".
   *   `unknown`     -> kein Eintrag. Weil `runIdempotent` die Reservierung bei
   *                    Fehlern MIT zurückrollt und nur 2xx speichert, heißt
   *                    das: der Vorgang hat NICHT gewirkt. Der Client darf
   *                    denselben Schlüssel erneut senden.
   *
   * Ehrliche Einschränkung: nach Ablauf des Schlüssels (24 h) ist der Eintrag
   * weg und die Antwort lautet `unknown`, obwohl der Vorgang gewirkt haben
   * kann. Deshalb prüft der Client bei `unknown` und einem Eintrag, der älter
   * als die TTL ist, zusätzlich den Fachzustand, statt automatisch zu senden
   * (siehe packages/sync/src/outbox.ts, `resolveUnknownOutcome`).
   */
  app.get("/sync/operations/:operation/:key", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = request.params as { operation: string; key: string };
    if (!OPERATION_VALUES.includes(params.operation)) {
      return reply.code(400).send({ error: "unknown_operation", erlaubt: OPERATION_VALUES });
    }
    const [row] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.operation, params.operation), eq(idempotencyKeys.key, params.key)))
      .limit(1);

    if (!row) {
      return reply.send({
        operation: params.operation,
        key: params.key,
        status: "unknown" as const,
        hinweis:
          "Kein Eintrag. Der Vorgang hat nicht gewirkt (fehlgeschlagene Vorgänge rollen die Reservierung mit zurück) oder der Schlüssel ist abgelaufen.",
      });
    }
    // Fremde Schlüssel werden als "nicht vorhanden" behandelt – eine 403
    // würde deren Existenz bestätigen.
    if (row.benutzerId && row.benutzerId !== request.user!.id) {
      return reply.code(404).send({ error: "not_found" });
    }

    return reply.send({
      operation: row.operation,
      key: row.key,
      status: row.status === "completed" ? ("completed" as const) : ("in_progress" as const),
      responseStatus: row.responseStatus,
      responseBody: row.responseBody,
      entitaet: row.entitaet,
      entitaetId: row.entitaetId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    });
  });
}
