import { createHash, randomUUID } from "node:crypto";
import { deploymentLogFields } from "./deployment.js";

/**
 * PROMPT -1 §16 – Beobachtbarkeit: strukturierte Logs, Korrelation, Redaktion.
 *
 * ## Warum nicht einfach Fastifys Logger?
 *
 * Fastify (pino) bringt strukturiertes JSON mit, aber nicht die drei Dinge,
 * die §16 eigentlich verlangt:
 *
 *  1. **Eine Korrelations-ID, die die ganze Kette überlebt.** Der Weg ist
 *     Client → API → Worker → Outbox → Realtime. Phase 1 hat dafür bereits
 *     `correlationId` in `audit_events`/`event_outbox`/`jobs` – diese Datei
 *     erweitert genau das und erfindet keine zweite ID: die
 *     Anfrage-Korrelations-ID WIRD die `correlationId` der Audit-Zeile
 *     (siehe `withCorrelation`), und der Outbox-Trigger trägt sie
 *     unverändert weiter.
 *  2. **Pseudonymisierte Akteurs-IDs.** Ein Log darf einen Menschen nicht
 *     direkt benennen. `pseudonymizeActor` bildet die Benutzer-UUID mit einem
 *     HMAC-artigen Salt (SESSION_SECRET) auf ein stabiles, aber nicht
 *     rückrechenbares Kürzel ab – stabil, damit man einen Vorgang über
 *     mehrere Zeilen verfolgen kann, ohne die Identität zu kennen.
 *  3. **Redaktion als Code, nicht als Vorsatz.** `redact` läuft über JEDE
 *     Logzeile. Passwörter, Tokens, Dokumentinhalte, IBANs und
 *     Fahrlehrer-Interna werden entfernt, BEVOR die Zeile den Prozess
 *     verlässt. Getestet in `__tests__/observability.test.ts` – inklusive der
 *     beiden adversarialen Fälle "Dokument-Upload" und "Bankimport".
 */

// ---------------------------------------------------------------------------
// Korrelations-ID
// ---------------------------------------------------------------------------

/** Header, über den ein Client eine bestehende Korrelations-ID mitgibt. */
export const CORRELATION_HEADER = "x-correlation-id";
/** Header, über den die API die Anfrage-ID zurückmeldet. */
export const REQUEST_ID_HEADER = "x-request-id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Nimmt eine vom Client gelieferte Korrelations-ID NUR an, wenn sie eine UUID
 * ist. Begründung: die ID landet in `audit_events.correlation_id` (uuid) und in
 * Logs – ein beliebiger String wäre sowohl ein DB-Fehler als auch ein
 * Log-Injection-Vektor.
 */
export function normalizeCorrelationId(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function newCorrelationId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Pseudonymisierung
// ---------------------------------------------------------------------------

let actorSalt = process.env.SESSION_SECRET ?? "dev-only-insecure-secret-change-me";

/** Für Tests/Betrieb: das Salz austauschen (Rotation, siehe §17 Secret-Rotation). */
export function setActorPseudonymSalt(salt: string): void {
  actorSalt = salt;
}

/**
 * Stabiles, nicht rückrechenbares Kürzel für einen Akteur.
 * `null` -> "anon". Kein Klartext, keine E-Mail, keine UUID.
 */
export function pseudonymizeActor(benutzerId: string | null | undefined): string {
  if (!benutzerId) return "anon";
  const digest = createHash("sha256").update(`${actorSalt}:actor:${benutzerId}`).digest("hex");
  return `akt_${digest.slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// Redaktion
// ---------------------------------------------------------------------------

/**
 * Feldnamen, deren WERT niemals in ein Log gehört. Der Vergleich läuft
 * case-insensitiv und auf Teilstrings, damit `passwordHash`, `mfa_secret`,
 * `downloadToken` usw. mit erfasst sind.
 */
export const REDACTED_KEY_PATTERNS: readonly string[] = [
  "password",
  "passwort",
  "passwordhash",
  "secret",
  "token",
  "authorization",
  "cookie",
  "session",
  "totp",
  "mfa",
  "apikey",
  "api_key",
  "credential",
  "privatekey",
  "signature",
  // §12: Dokumentinhalte. `content`/`buffer`/`base64`/`datei`(inhalt) dürfen nie
  // in ein Log – auch nicht "nur zum Debuggen".
  "content",
  "buffer",
  "base64",
  "dateiinhalt",
  "filecontent",
  "bytes",
  // §16: vollständige Bankdaten.
  "iban",
  "bic",
  "kontonummer",
  "accountnumber",
  "counterpartyiban",
  // Redaktionsvertrag der Fahrlehrer-Notizen: interne Notizen sind aus JEDER
  // schülerseitigen Oberfläche unerreichbar – Logs und Metriken sind ein
  // FRISCHER Leckpfad und werden hier genauso geschlossen.
  "internalnotes",
  "internenotizen",
  "instructornotes",
  "pruefprotokoll",
  // Freitext mit Personenbezug aus dem Sprachprotokoll.
  "transcript",
  "transkript",
  "rohtranskript",
];

export const REDACTED = "[redacted]";

/** IBAN-Muster (DE + generisch) für Freitext-Redaktion. */
const IBAN_IN_TEXT = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;
/** Bearer-/Session-Token in Freitext. */
const BEARER_IN_TEXT = /\b(bearer|token|secret)[=:\s]+[A-Za-z0-9._~+/=-]{8,}/gi;

function isRedactedKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return REDACTED_KEY_PATTERNS.some((pattern) => lower.includes(pattern.replace(/[^a-z0-9]/g, "")));
}

/**
 * Maskiert eine IBAN so, dass ein Mensch sie WIEDERERKENNEN, aber nicht
 * REKONSTRUIEREN kann: Land + letzte vier Stellen. Für die
 * Zahlungszuordnungs-Diagnose reicht das; §16 verlangt "keine vollständigen
 * Bankdaten", nicht "keine Diagnose".
 */
export function maskIban(value: string): string {
  const compact = value.replace(/\s+/g, "");
  if (compact.length < 8) return REDACTED;
  return `${compact.slice(0, 2)}**…${compact.slice(-4)}`;
}

function redactString(value: string): string {
  let out = value.replace(IBAN_IN_TEXT, (m) => maskIban(m));
  out = out.replace(BEARER_IN_TEXT, (m) => `${m.split(/[=:\s]/)[0]}=${REDACTED}`);
  // Sehr lange Freitexte werden gekürzt: ein Dokumentinhalt oder ein
  // Transkript soll nicht über einen anders benannten Schlüssel durchsickern.
  if (out.length > 512) out = `${out.slice(0, 512)}…[gekürzt:${out.length}]`;
  return out;
}

/**
 * Tiefe Redaktion. Arbeitet auf einer KOPIE; die Eingabe wird nie verändert
 * (ein Logger, der seine Eingabe mutiert, wäre ein Fehlerquelle erster Güte).
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[zu tief]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[binär:${value.byteLength}B]`;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) {
    const limited = value.length > 50 ? value.slice(0, 50) : value;
    const out = limited.map((v) => redact(v, depth + 1));
    if (value.length > 50) out.push(`…[${value.length - 50} weitere]`);
    return out;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (isRedactedKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = redact(v, depth + 1);
    }
    return out;
  }
  return "[nicht serialisierbar]";
}

// ---------------------------------------------------------------------------
// Strukturierte Logzeile
// ---------------------------------------------------------------------------

export type LogSeverity = "debug" | "info" | "warn" | "error";

/**
 * Die verpflichtenden Felder aus §16. Namen sind bewusst englisch und flach,
 * damit ein beliebiger Log-Kollektor sie ohne Mapping indexieren kann.
 */
export interface StructuredLogRecord {
  /** ISO-8601 mit Millisekunden. */
  time: string;
  severity: LogSeverity;
  service: string;
  /** Eindeutig je HTTP-Anfrage/Job-Lauf. */
  requestId: string;
  /** Überlebt Client → API → Worker → Outbox → Realtime. */
  correlationId: string;
  /** Pseudonymisiert, NIE die rohe Benutzer-ID. */
  actor: string;
  /** Rolle des Akteurs – gröber als die Identität, für Auswertungen nötig. */
  actorRole?: string;
  /** Fachliche/technische Operation, z. B. "POST /appointments". */
  operation: string;
  /** Maschinenlesbarer Fehlercode (§9-Klasse oder Antwortfeld `error`). */
  errorCode?: string;
  message?: string;
  durationMs?: number;
  httpStatus?: number;
  standortId?: string | null;
  [extra: string]: unknown;
}

export type LogSink = (record: StructuredLogRecord) => void;

const defaultSink: LogSink = (record) => {
  const stream = record.severity === "error" || record.severity === "warn" ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(record)}\n`);
};

let sink: LogSink = defaultSink;
const captured: StructuredLogRecord[] = [];
let capturing = false;
const MAX_CAPTURED = 500;

/** §16-Seam: echter Log-Kollektor. Standard ist stdout/stderr als JSON. */
export function setLogSink(next: LogSink): void {
  sink = next;
}

export function resetLogSink(): void {
  sink = defaultSink;
}

/**
 * Testhilfe: Logzeilen im Prozess mitschneiden, damit ein Test BEWEISEN kann,
 * dass ein Geheimnis NICHT in einer Logzeile stand. Ohne diesen Mitschnitt
 * wäre die Redaktion nur eine Behauptung.
 */
export function startLogCapture(): void {
  capturing = true;
  captured.length = 0;
}

export function stopLogCapture(): void {
  capturing = false;
}

export function capturedLogs(): readonly StructuredLogRecord[] {
  return captured;
}

export function clearCapturedLogs(): void {
  captured.length = 0;
}

/** Der gesamte Mitschnitt als ein String – für "darf nirgends vorkommen"-Prüfungen. */
export function capturedLogText(): string {
  return captured.map((r) => JSON.stringify(r)).join("\n");
}

export const SERVICE_NAME = "@fahrschul/api";

export interface LogInput {
  severity?: LogSeverity;
  service?: string;
  requestId: string;
  correlationId: string;
  actorBenutzerId?: string | null;
  actorRole?: string | null;
  operation: string;
  errorCode?: string | null;
  message?: string;
  durationMs?: number;
  httpStatus?: number;
  standortId?: string | null;
  /** Zusatzfelder – laufen durch die Redaktion. */
  details?: Record<string, unknown>;
}

export function log(input: LogInput): StructuredLogRecord {
  const record: StructuredLogRecord = {
    time: new Date().toISOString(),
    severity: input.severity ?? "info",
    service: input.service ?? SERVICE_NAME,
    requestId: input.requestId,
    correlationId: input.correlationId,
    actor: pseudonymizeActor(input.actorBenutzerId ?? null),
    operation: input.operation,
    // §15 (Phase 4): Deployment-Identität an JEDER Zeile. Sie steht hier und
    // nicht an den ~20 Aufrufstellen, damit sie nicht bei der nächsten neuen
    // Logzeile vergessen wird – und damit auch Job-, Alarm- und Fehlerzeilen
    // sie tragen, nicht nur das Zugriffsprotokoll.
    ...deploymentLogFields(),
  };
  if (input.actorRole) record.actorRole = input.actorRole;
  if (input.errorCode) record.errorCode = input.errorCode;
  if (input.message) record.message = redactString(input.message);
  if (typeof input.durationMs === "number") record.durationMs = input.durationMs;
  if (typeof input.httpStatus === "number") record.httpStatus = input.httpStatus;
  if (input.standortId !== undefined) record.standortId = input.standortId;
  if (input.details) {
    const redacted = redact(input.details) as Record<string, unknown>;
    for (const [k, v] of Object.entries(redacted)) {
      if (k in record) continue;
      record[k] = v;
    }
  }

  if (capturing) {
    captured.push(record);
    if (captured.length > MAX_CAPTURED) captured.shift();
  }
  sink(record);
  return record;
}

// ---------------------------------------------------------------------------
// §16 Tracing: die Korrelations-ID über Prozessgrenzen weitergeben
// ---------------------------------------------------------------------------

/**
 * Eine Spanne im Trace. Bewusst KEIN OpenTelemetry-SDK: in dieser Umgebung
 * existiert kein Collector (siehe docs/integration-gaps.md), und eine
 * Abhängigkeit ohne Backend wäre eine Behauptung. Der Vertrag ist trotzdem
 * derselbe – `correlationId` ist die Trace-ID, `spanId`/`parentSpanId`
 * bilden den Baum, und `setTraceSink` ist der Einhängepunkt für einen echten
 * Exporter.
 */
export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: "ok" | "error";
  attributes: Record<string, unknown>;
}

export type TraceSink = (span: TraceSpan) => void;

const recentSpans: TraceSpan[] = [];
const MAX_SPANS = 200;

let traceSink: TraceSink = (span) => {
  recentSpans.push(span);
  if (recentSpans.length > MAX_SPANS) recentSpans.shift();
};

export function setTraceSink(next: TraceSink): void {
  traceSink = next;
}

export function recentTraceSpans(): readonly TraceSpan[] {
  return recentSpans;
}

export function clearTraceSpans(): void {
  recentSpans.length = 0;
}

export function newSpanId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * Führt `fn` als Spanne aus. Der Rückgabewert ist der von `fn`; ein Fehler
 * wird als `status: "error"` vermerkt und weitergeworfen (eine Trace-Hülle
 * darf niemals einen Fehler schlucken).
 */
export async function withSpan<T>(
  input: {
    traceId: string;
    parentSpanId?: string | null;
    name: string;
    attributes?: Record<string, unknown>;
  },
  fn: (span: { traceId: string; spanId: string }) => Promise<T>,
): Promise<T> {
  const spanId = newSpanId();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  let status: "ok" | "error" = "ok";
  try {
    return await fn({ traceId: input.traceId, spanId });
  } catch (err) {
    status = "error";
    throw err;
  } finally {
    const endedAtMs = Date.now();
    traceSink({
      traceId: input.traceId,
      spanId,
      parentSpanId: input.parentSpanId ?? null,
      name: input.name,
      startedAt,
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: endedAtMs - startedAtMs,
      status,
      attributes: (redact(input.attributes ?? {}) as Record<string, unknown>) ?? {},
    });
  }
}
