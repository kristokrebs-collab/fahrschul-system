import {
  classifyError,
  computeBackoffMs,
  decideRetry,
  isTransient,
  type BackoffOptions,
  type ErrorClass,
  type RetryDecision,
} from "@fahrschul/events/src/retry.js";

/**
 * PROMPT -1 §9 (CLIENTSEITE).
 *
 * Es gibt hier KEINE zweite Retry-Politik. `classifyError`, `computeBackoffMs`
 * und `decideRetry` kommen unverändert aus `packages/events/src/retry.ts` –
 * genau dafür hat Phase 1 diese Datei node- und DB-frei gehalten. Server und
 * Client können damit nicht auseinanderlaufen: dieselbe Klassifikation,
 * dieselbe Backoff-Kurve, derselbe Jitter, dieselbe Obergrenze.
 *
 * Ergänzt wird nur, was auf dem Server keine Rolle spielte:
 *   1. `Retry-After` aus einer HTTP-Antwort (Sekunden ODER HTTP-Datum) hat
 *      VORRANG vor der eigenen Backoff-Kurve. Wenn der Server sagt, wann er
 *      wieder mag, ist Raten unhöflich und schädlich.
 *   2. Netzwerkabbrüche im Browser sind mehrdeutig: ein `TypeError: Failed to
 *      fetch` NACH dem Absenden kann bedeuten "nicht angekommen" oder
 *      "angekommen, Antwort verloren". Das wird als `outcomeUnknown`
 *      weitergegeben – §7 verlangt dafür "Status wird geprüft", NIE einen
 *      Erfolg.
 *
 * Niemals automatisch wiederholt werden (unverändert aus §9): Validierung
 * (400/422), Berechtigung (401/403), fachlicher Konflikt (409, alle FS00x),
 * abgelaufenes Angebot (410), veraltete Version (412/428) und mehrdeutige
 * Zahlungszuordnung (die als 409 `ambiguous_*`/`review_required` kommt und
 * damit BUSINESS_CONFLICT ist).
 */

export {
  classifyError,
  computeBackoffMs,
  decideRetry,
  isTransient,
  type BackoffOptions,
  type ErrorClass,
  type RetryDecision,
};

/** Client-Backoff: etwas kürzere Obergrenze als der Server – ein Mensch wartet. */
export const CLIENT_BACKOFF: BackoffOptions = {
  baseMs: 1000,
  capMs: 60_000,
  jitterRatio: 0.3,
};

export const CLIENT_MAX_ATTEMPTS = 6;

export interface HttpFailure {
  status?: number;
  body?: unknown;
  /** Rohwert des `Retry-After`-Headers, falls vorhanden. */
  retryAfter?: string | null;
  message?: string;
  /** true, wenn der Ausgang der Anfrage unbekannt ist (Abbruch nach dem Senden). */
  outcomeUnknown?: boolean;
}

/**
 * Liest `Retry-After`. Erlaubt sind laut RFC 9110 eine Anzahl Sekunden ODER
 * ein HTTP-Datum. Beides wird unterstützt; alles andere ergibt `null`, damit
 * ein kaputter Header nicht zu einem absurden Wartewert führt.
 */
export function parseRetryAfterMs(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.min(seconds * 1000, 24 * 60 * 60 * 1000);
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

export interface ClientRetryPlan extends RetryDecision {
  /** true, wenn `delayMs` aus `Retry-After` stammt und nicht aus dem Backoff. */
  respectedRetryAfter: boolean;
  /** true, wenn der Ausgang unbekannt ist -> UI zeigt "Status wird geprüft". */
  outcomeUnknown: boolean;
  /** true, wenn die Versuche erschöpft sind und ein Mensch übernehmen muss. */
  exhausted: boolean;
}

/**
 * Die EINE Stelle, an der der Client entscheidet, ob noch einmal versucht
 * wird. Delegiert die Klassifikation vollständig an §9 und legt nur
 * `Retry-After` obendrauf.
 */
export function planClientRetry(
  failure: HttpFailure,
  attempt: number,
  options: { maxAttempts?: number; backoff?: BackoffOptions; now?: number } = {},
): ClientRetryPlan {
  const maxAttempts = options.maxAttempts ?? CLIENT_MAX_ATTEMPTS;
  const backoff = options.backoff ?? CLIENT_BACKOFF;
  const now = options.now ?? Date.now();

  const decision = decideRetry(failure, attempt, maxAttempts, backoff);
  const retryAfterMs = parseRetryAfterMs(failure.retryAfter, now);

  if (decision.retry && retryAfterMs !== null) {
    return {
      ...decision,
      delayMs: retryAfterMs,
      respectedRetryAfter: true,
      outcomeUnknown: failure.outcomeUnknown === true,
      exhausted: false,
      reason: `${decision.reason} – Retry-After respektiert (${retryAfterMs} ms)`,
    };
  }

  return {
    ...decision,
    respectedRetryAfter: false,
    outcomeUnknown: failure.outcomeUnknown === true,
    // Erschöpft = transient, aber keine Versuche mehr. Ein DAUERHAFTER Fehler
    // ist nicht "erschöpft", sondern von Anfang an nicht wiederholbar – die
    // UI muss beides unterschiedlich erklären.
    exhausted: !decision.retry && isTransient(decision.errorClass),
  };
}

/**
 * Fehlerklassen, die eine BENUTZERENTSCHEIDUNG brauchen, statt technisch
 * behandelbar zu sein (§7: kritische Konflikte gehen in eine Prüf-Warteschlange
 * und werden NICHT automatisch aufgelöst).
 */
export const CONFLICT_ERROR_CLASSES: readonly ErrorClass[] = [
  "BUSINESS_CONFLICT",
  "STALE_VERSION",
  "EXPIRED_OFFER",
  "IDEMPOTENCY_CONFLICT",
];

export function needsHumanDecision(errorClass: ErrorClass): boolean {
  return CONFLICT_ERROR_CLASSES.includes(errorClass);
}
