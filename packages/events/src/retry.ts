/**
 * PROMPT -1 §9 – Wiederholungsstrategie.
 *
 * DIESE DATEI IST DER GETEILTE VERTRAG zwischen Server- und Clientseite:
 *  - Phase 1 (hier gebaut) nutzt sie im Outbox-Worker und im Job-Runner
 *    (apps/api/src/workers/*).
 *  - Phase 2 (Client-Offline-Outbox, §6-§8) MUSS dieselben Klassifikations-
 *    und Backoff-Regeln verwenden, damit Client und Server nicht gegen-
 *    einander arbeiten. SEAM: `classifyError` + `computeBackoffMs` sind
 *    absichtlich frei von Node-/DB-Abhängigkeiten und im Browser lauffähig.
 *
 * Kernregel: NUR transiente Fehler werden automatisch wiederholt.
 * Validierung, Berechtigung, fachlicher Konflikt, abgelaufenes Angebot und
 * veraltete Version werden NIEMALS automatisch wiederholt – ein Retry könnte
 * dort nur denselben Fehler oder (schlimmer) einen unerwünschten Seiteneffekt
 * erzeugen.
 */

export const TRANSIENT_ERROR_CLASSES = [
  "TIMEOUT",
  "RATE_LIMITED",
  "NETWORK",
  "SERVER_UNAVAILABLE",
  "SERIALIZATION_FAILURE",
  "LEASE_LOST",
] as const;

export const PERMANENT_ERROR_CLASSES = [
  "VALIDATION",
  "PERMISSION",
  "BUSINESS_CONFLICT",
  "EXPIRED_OFFER",
  "STALE_VERSION",
  "NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "UNKNOWN_PERMANENT",
] as const;

export type TransientErrorClass = (typeof TRANSIENT_ERROR_CLASSES)[number];
export type PermanentErrorClass = (typeof PERMANENT_ERROR_CLASSES)[number];
export type ErrorClass = TransientErrorClass | PermanentErrorClass;

/** HTTP-Status, die als transient gelten (ausgewählte 5xx + 429). */
const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** PostgreSQL-SQLSTATEs, die als transient gelten. */
const TRANSIENT_SQLSTATE = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "53300", // too_many_connections
  "57P03", // cannot_connect_now
  "08000", // connection_exception
  "08006", // connection_failure
]);

/**
 * SQLSTATEs der in Migration 0007 definierten Fachinvarianten. Sie sind
 * DAUERHAFT: ein Retry würde nur denselben Constraint erneut verletzen.
 */
export const BUSINESS_SQLSTATE: Record<string, string> = {
  FS001: "Fahrstunde bereits endgültig abgeschlossen",
  FS003: "Banktransaktion bereits vollständig zugeordnet / überbucht",
  FS004: "Prüfungsfreigabekette unvollständig",
  FS005: "Fahrzeug gesperrt",
  FS006: "Dokumentstatus ohne Prüfprotokoll",
  FS007: "Ungültiger State-Machine-Übergang",
  "23P01": "Terminüberschneidung (EXCLUDE-Constraint)",
  "23505": "Eindeutigkeitsverletzung",
  "23514": "CHECK-Constraint verletzt",
  "23503": "Fremdschlüssel verletzt",
};

export interface ClassifiableError {
  name?: string;
  message?: string;
  /** HTTP-Status, falls die Ursache eine HTTP-Antwort war. */
  status?: number;
  statusCode?: number;
  /** SQLSTATE, falls die Ursache ein Postgres-Fehler war. */
  code?: string;
  /** Explizite Klasse, falls der Aufrufer sie schon kennt. */
  errorClass?: ErrorClass;
}

export function classifyError(err: unknown): ErrorClass {
  const e = (err ?? {}) as ClassifiableError;
  if (e.errorClass) return e.errorClass;

  const code = typeof e.code === "string" ? e.code : undefined;
  if (code) {
    if (BUSINESS_SQLSTATE[code]) return "BUSINESS_CONFLICT";
    if (TRANSIENT_SQLSTATE.has(code)) {
      return code === "40001" || code === "40P01" ? "SERIALIZATION_FAILURE" : "NETWORK";
    }
    if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "TIMEOUT";
    if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EAI_AGAIN" || code === "EPIPE") {
      return "NETWORK";
    }
  }

  const status = e.status ?? e.statusCode;
  if (typeof status === "number") {
    if (TRANSIENT_HTTP_STATUS.has(status)) {
      if (status === 429) return "RATE_LIMITED";
      if (status === 408) return "TIMEOUT";
      return "SERVER_UNAVAILABLE";
    }
    if (status === 401 || status === 403) return "PERMISSION";
    if (status === 404) return "NOT_FOUND";
    if (status === 409) return "BUSINESS_CONFLICT";
    if (status === 410) return "EXPIRED_OFFER";
    if (status === 412 || status === 428) return "STALE_VERSION";
    if (status === 400 || status === 422) return "VALIDATION";
  }

  const message = (e.message ?? "").toLowerCase();
  if (message.includes("timeout") || message.includes("timed out")) return "TIMEOUT";
  if (message.includes("econnreset") || message.includes("socket hang up") || message.includes("network")) {
    return "NETWORK";
  }
  if (message.includes("stale") || message.includes("version_conflict")) return "STALE_VERSION";
  if (message.includes("expired")) return "EXPIRED_OFFER";

  // Unbekannt => NICHT automatisch wiederholen. Ein unklassifizierter Fehler
  // wird bewusst konservativ als dauerhaft behandelt und landet in der
  // Dead-Letter-Queue, damit ein Mensch draufschaut, statt ihn endlos zu
  // wiederholen.
  return "UNKNOWN_PERMANENT";
}

export function isTransient(errorClass: ErrorClass): boolean {
  return (TRANSIENT_ERROR_CLASSES as readonly string[]).includes(errorClass);
}

export interface BackoffOptions {
  /** Basisverzögerung in ms (Standard 1000). */
  baseMs?: number;
  /** Obergrenze in ms (Standard 5 Minuten). */
  capMs?: number;
  /** Anteil Jitter, 0..1 (Standard 0.3 = ±30 %). */
  jitterRatio?: number;
  /** Deterministische Zufallsquelle für Tests. */
  random?: () => number;
}

export const DEFAULT_BACKOFF: Required<Omit<BackoffOptions, "random">> = {
  baseMs: 1000,
  capMs: 5 * 60 * 1000,
  jitterRatio: 0.3,
};

/**
 * Exponentieller Backoff mit Jitter und Obergrenze.
 * attempt=1 -> ~1s, 2 -> ~2s, 3 -> ~4s, ... gekappt bei capMs.
 */
export function computeBackoffMs(attempt: number, options: BackoffOptions = {}): number {
  const baseMs = options.baseMs ?? DEFAULT_BACKOFF.baseMs;
  const capMs = options.capMs ?? DEFAULT_BACKOFF.capMs;
  const jitterRatio = options.jitterRatio ?? DEFAULT_BACKOFF.jitterRatio;
  const random = options.random ?? Math.random;

  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exponential = Math.min(capMs, baseMs * 2 ** (safeAttempt - 1));
  const jitterSpan = exponential * jitterRatio;
  const jitter = (random() * 2 - 1) * jitterSpan;
  return Math.max(0, Math.min(capMs, Math.round(exponential + jitter)));
}

export interface RetryDecision {
  errorClass: ErrorClass;
  retry: boolean;
  delayMs: number;
  /** true, wenn die Versuche erschöpft sind bzw. der Fehler dauerhaft ist -> Dead-Letter-Queue. */
  deadLetter: boolean;
  reason: string;
}

/**
 * Die einzige Stelle, an der über "noch einmal versuchen" entschieden wird –
 * Outbox-Worker UND Job-Runner nutzen sie, damit es kein Auseinanderlaufen
 * der Politik gibt.
 */
export function decideRetry(
  err: unknown,
  attempt: number,
  maxAttempts: number,
  options: BackoffOptions = {},
): RetryDecision {
  const errorClass = classifyError(err);
  if (!isTransient(errorClass)) {
    return {
      errorClass,
      retry: false,
      delayMs: 0,
      deadLetter: true,
      reason: `dauerhafter Fehler (${errorClass}) – kein automatischer Retry`,
    };
  }
  if (attempt >= maxAttempts) {
    return {
      errorClass,
      retry: false,
      delayMs: 0,
      deadLetter: true,
      reason: `Versuche erschöpft (${attempt}/${maxAttempts})`,
    };
  }
  return {
    errorClass,
    retry: true,
    delayMs: computeBackoffMs(attempt, options),
    deadLetter: false,
    reason: `transienter Fehler (${errorClass}) – Retry ${attempt + 1}/${maxAttempts}`,
  };
}
