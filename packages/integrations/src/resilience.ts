import {
  classifyError,
  decideRetry,
  isTransient,
  type ErrorClass,
} from "@fahrschul/events/src/retry.js";
import type { IntegrationMode } from "./types.js";

/**
 * PROMPT -1 §11 – Externe Schnittstellen ausfallsicher.
 *
 * ## Eine Hülle, zehn Integrationen
 *
 * Jede Integration aus `docs/integration-gaps.md` bekommt hier dieselben acht
 * Eigenschaften: Zeitlimit, Circuit Breaker, Wiederholungsregeln,
 * Idempotenzschlüssel für ausgehende Aufrufe, Gesundheitsstatus, Zeitpunkt der
 * letzten erfolgreichen Synchronisation, Fehlerwarteschlange und
 * Rate-Limit-Behandlung. Es gibt sie GENAU EINMAL – als Dekorator um den
 * jeweiligen Adapter (`wrapWithResilience`), nicht zehnmal in zehn Adaptern.
 *
 * ## KEINE dritte Retry-Politik
 *
 * Die Klassifikation und der Backoff kommen unverändert aus
 * `packages/events/src/retry.ts` (`classifyError`, `decideRetry`). Diese Datei
 * fügt nur zwei Dinge hinzu, die dort nichts zu suchen hatten:
 *
 *  1. **Zeitlimit** – ein hängender Aufruf ist kein Fehler, den man
 *     klassifizieren kann; er muss erst zu einem gemacht werden. `withTimeout`
 *     erzeugt einen Fehler der Klasse `TIMEOUT`, den `classifyError` dann als
 *     transient erkennt.
 *  2. **Circuit Breaker** – die Entscheidung "gar nicht erst versuchen". Das
 *     ist keine Retry-Entscheidung, sondern ihre Voraussetzung.
 *
 * ## Der Breaker: drei Zustände, echte Übergänge
 *
 * ```
 *            failureThreshold aufeinanderfolgende Fehler
 *   closed  ─────────────────────────────────────────────►  open
 *      ▲                                                      │
 *      │  successThreshold Erfolge                            │ openMs abgelaufen
 *      │                                                      ▼
 *      └──────────────────────  half_open  ◄──────────────────┘
 *                                   │
 *                                   │ ein Fehler in der Sondierung
 *                                   └──────────────────────►  open (openMs verdoppelt)
 * ```
 *
 * - `closed`: normal. Fehler werden gezählt, Erfolge setzen den Zähler auf 0.
 * - `open`: JEDER Aufruf wird sofort mit `CircuitOpenError` abgewiesen
 *   (Klasse `SERVER_UNAVAILABLE`, also transient → der Aufrufer puffert statt
 *   zu scheitern). Kein Aufruf geht nach draußen: das ist der Punkt.
 * - `half_open`: nach Ablauf der Öffnungszeit wird **genau ein** Aufruf als
 *   Sondierung durchgelassen. Gelingt er (bzw. `successThreshold` davon),
 *   schließt der Breaker. Scheitert er, öffnet er wieder – mit VERDOPPELTER
 *   Öffnungszeit (gekappt), damit ein dauerhaft toter Anbieter nicht im
 *   Sekundentakt sondiert wird.
 *
 * ## Rate-Limit-Behandlung
 *
 * Ein `RATE_LIMITED`-Fehler (HTTP 429) ist ausdrücklich KEIN Breaker-Fehler:
 * der Anbieter ist gesund, er will nur weniger Verkehr. Er zählt deshalb nicht
 * auf `consecutiveFailures`, sondern setzt `rateLimitedUntil` aus dem
 * `Retry-After` des Anbieters. Ein Aufruf vor diesem Zeitpunkt wird sofort
 * abgewiesen – dieselbe Höflichkeit, die Phase 2s Client dem Server erweist.
 *
 * ## Was hier NICHT passiert
 *
 * Diese Datei schaltet nichts von `mock` auf `live`. `assertMockOnly` bleibt
 * unangetastet; `sandbox`/`live` werfen weiterhin. Die Ausfallsicherheit ist
 * gegen den MOCK getestet (mit einem absichtlich fehlerhaften Adapter), weil
 * das die einzige ehrliche Möglichkeit ohne echten Zugang ist.
 */

// ---------------------------------------------------------------------------
// Fehler
// ---------------------------------------------------------------------------

export class IntegrationTimeoutError extends Error {
  errorClass: ErrorClass = "TIMEOUT";
  constructor(integration: string, operation: string, timeoutMs: number) {
    super(`${integration}.${operation}: Zeitlimit von ${timeoutMs} ms überschritten`);
    this.name = "IntegrationTimeoutError";
  }
}

export class CircuitOpenError extends Error {
  errorClass: ErrorClass = "SERVER_UNAVAILABLE";
  integration: string;
  retryAfterMs: number;
  constructor(integration: string, retryAfterMs: number) {
    super(
      `${integration}: Circuit Breaker ist offen – Aufruf wurde nicht versucht (nächste Sondierung in ${retryAfterMs} ms)`,
    );
    this.name = "CircuitOpenError";
    this.integration = integration;
    this.retryAfterMs = retryAfterMs;
  }
}

export class IntegrationRateLimitedError extends Error {
  errorClass: ErrorClass = "RATE_LIMITED";
  retryAfterMs: number;
  constructor(integration: string, retryAfterMs: number) {
    super(`${integration}: Anbieter hat ein Rate Limit gemeldet – Wartezeit ${retryAfterMs} ms`);
    this.name = "IntegrationRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

export type BreakerState = "closed" | "open" | "half_open";

export interface IntegrationHealthSnapshot {
  integration: string;
  mode: IntegrationMode;
  breakerState: BreakerState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  openedAt: string | null;
  probeAfter: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  lastErrorClass: string | null;
  rateLimitedUntil: string | null;
  totalCalls: number;
  totalFailures: number;
  totalShortCircuited: number;
  /** Abgeleitet: `gesund` | `eingeschraenkt` | `ausgefallen`. */
  status: "gesund" | "eingeschraenkt" | "ausgefallen";
}

export interface CircuitBreakerOptions {
  /** Aufeinanderfolgende Fehler, bis der Breaker öffnet. */
  failureThreshold: number;
  /** Erfolge in `half_open`, bis er schließt. */
  successThreshold: number;
  /** Öffnungszeit, bevor sondiert wird. */
  openMs: number;
  /** Obergrenze der (verdoppelnden) Öffnungszeit. */
  maxOpenMs: number;
}

export const DEFAULT_BREAKER: CircuitBreakerOptions = {
  failureThreshold: 5,
  successThreshold: 2,
  openMs: 30_000,
  maxOpenMs: 10 * 60_000,
};

export interface ResilienceOptions {
  integration: string;
  mode: IntegrationMode;
  timeoutMs?: number;
  maxAttempts?: number;
  breaker?: Partial<CircuitBreakerOptions>;
  /** Deterministische Uhr für Tests. */
  now?: () => number;
  /** Persistenz (optional): spiegelt den Zustand in `integration_health`. */
  persist?: (snapshot: IntegrationHealthSnapshot) => void | Promise<void>;
  /** Fehlerwarteschlange (optional): wird bei endgültigem Fehlschlag aufgerufen. */
  onErrorQueue?: (entry: FailedCallRecord) => void | Promise<void>;
  /** Wird bei jedem Zustandswechsel des Breakers aufgerufen (Alarmierung). */
  onStateChange?: (from: BreakerState, to: BreakerState, snapshot: IntegrationHealthSnapshot) => void;
  /** Backoff ohne echtes Warten – Tests brauchen keine Sekunden. */
  sleep?: (ms: number) => Promise<void>;
}

export interface FailedCallRecord {
  integration: string;
  operation: string;
  idempotencyKey: string;
  errorClass: ErrorClass;
  error: string;
  attempts: number;
  at: string;
}

export interface CallOptions {
  operation: string;
  /**
   * §11: Idempotenzschlüssel des AUSGEHENDEN Aufrufs. Pflicht – ein
   * Wiederaufsetzen darf beim Zielsystem nicht doppelt wirken. Der Aufrufer
   * bildet ihn aus dem fachlichen Vorgang (nicht aus `Math.random`), damit ein
   * Retry denselben Schlüssel benutzt.
   */
  idempotencyKey: string;
  timeoutMs?: number;
  maxAttempts?: number;
  /** true = dieser Aufruf ist eine reine Sondierung (kein Fachvorgang). */
  probe?: boolean;
}

export interface CallResult<T> {
  ok: boolean;
  value?: T;
  errorClass?: ErrorClass;
  error?: string;
  attempts: number;
  /** true, wenn der Breaker offen war und gar nicht versucht wurde. */
  shortCircuited: boolean;
  idempotencyKey: string;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Setzt ein hartes Zeitlimit um ein Promise. Wichtig: das ursprüngliche
 * Promise wird NICHT abgebrochen (das kann man in JS nicht erzwingen) – aber
 * sein Ergebnis wird verworfen, und der Aufrufer wartet nicht länger. Ein
 * `unhandledRejection` wird verhindert, indem der verlorene Zweig abgefangen
 * wird.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), timeoutMs);
  });
  promise.catch(() => undefined);
  try {
    return await Promise.race([promise, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Liest `Retry-After` aus einem Fehlerobjekt (Sekunden oder HTTP-Datum). */
export function retryAfterMsFromError(err: unknown, now: number): number | null {
  const e = err as { retryAfter?: unknown; retryAfterMs?: unknown; headers?: Record<string, unknown> };
  if (typeof e?.retryAfterMs === "number" && e.retryAfterMs >= 0) return e.retryAfterMs;
  const raw =
    (typeof e?.retryAfter === "string" ? e.retryAfter : null) ??
    (typeof e?.headers?.["retry-after"] === "string" ? (e.headers["retry-after"] as string) : null);
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Math.min(Number(trimmed) * 1000, 24 * 60 * 60 * 1000);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

/**
 * Der Wächter je Integration. Bewusst eine Klasse mit Zustand (der Breaker IST
 * Zustand) und einer expliziten `snapshot()`-Methode, damit der Zustand
 * nachweisbar und persistierbar ist – nicht in einer Closure versteckt.
 */
export class IntegrationGuard {
  readonly integration: string;
  readonly mode: IntegrationMode;
  private readonly breakerOptions: CircuitBreakerOptions;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => number;
  private readonly options: ResilienceOptions;

  private state: BreakerState = "closed";
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private openedAt: number | null = null;
  private probeAfter: number | null = null;
  private currentOpenMs: number;
  private lastSuccessAt: number | null = null;
  private lastFailureAt: number | null = null;
  private lastError: string | null = null;
  private lastErrorClass: ErrorClass | null = null;
  private rateLimitedUntil: number | null = null;
  private totalCalls = 0;
  private totalFailures = 0;
  private totalShortCircuited = 0;
  /** true, solange eine Sondierung läuft – verhindert einen Sondierungssturm. */
  private probeInFlight = false;

  constructor(options: ResilienceOptions) {
    this.options = options;
    this.integration = options.integration;
    this.mode = options.mode;
    this.breakerOptions = { ...DEFAULT_BREAKER, ...(options.breaker ?? {}) };
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.now = options.now ?? (() => Date.now());
    this.currentOpenMs = this.breakerOptions.openMs;
  }

  snapshot(): IntegrationHealthSnapshot {
    return {
      integration: this.integration,
      mode: this.mode,
      breakerState: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : null,
      probeAfter: this.probeAfter ? new Date(this.probeAfter).toISOString() : null,
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
      lastError: this.lastError,
      lastErrorClass: this.lastErrorClass,
      rateLimitedUntil: this.rateLimitedUntil ? new Date(this.rateLimitedUntil).toISOString() : null,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalShortCircuited: this.totalShortCircuited,
      status:
        this.state === "open"
          ? "ausgefallen"
          : this.state === "half_open" || this.rateLimitedUntil !== null
            ? "eingeschraenkt"
            : "gesund",
    };
  }

  get breakerState(): BreakerState {
    // Ein Blick auf den Zustand aktualisiert ihn: `open` läuft nach `openMs`
    // von selbst in `half_open`, ohne dass ein Timer laufen muss (ein Timer
    // wäre in Tests nicht deterministisch und in einem Worker-Prozess ein Leck).
    this.refreshState();
    return this.state;
  }

  private refreshState(): void {
    if (this.state === "open" && this.probeAfter !== null && this.now() >= this.probeAfter) {
      this.transition("half_open");
    }
  }

  private transition(to: BreakerState): void {
    if (this.state === to) return;
    const from = this.state;
    this.state = to;
    if (to === "open") {
      this.openedAt = this.now();
      this.probeAfter = this.openedAt + this.currentOpenMs;
      this.consecutiveSuccesses = 0;
    } else if (to === "closed") {
      this.openedAt = null;
      this.probeAfter = null;
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
      // Erfolgreiche Erholung setzt die Öffnungszeit zurück.
      this.currentOpenMs = this.breakerOptions.openMs;
    } else {
      this.consecutiveSuccesses = 0;
      this.probeInFlight = false;
    }
    this.options.onStateChange?.(from, to, this.snapshot());
  }

  /** Manuelles Schließen (Betriebsoberfläche: "jetzt wieder versuchen"). */
  reset(): void {
    this.currentOpenMs = this.breakerOptions.openMs;
    this.rateLimitedUntil = null;
    this.probeInFlight = false;
    this.transition("closed");
  }

  /** Manuelles Öffnen (Betrieb: Anbieter angekündigt in Wartung). */
  trip(reason = "manuell geöffnet"): void {
    this.lastError = reason;
    this.transition("open");
  }

  private recordSuccess(): void {
    this.lastSuccessAt = this.now();
    this.lastError = null;
    this.lastErrorClass = null;
    this.consecutiveFailures = 0;
    if (this.state === "half_open") {
      this.consecutiveSuccesses += 1;
      this.probeInFlight = false;
      if (this.consecutiveSuccesses >= this.breakerOptions.successThreshold) {
        this.transition("closed");
      }
    } else {
      this.consecutiveSuccesses += 1;
    }
  }

  private recordFailure(err: unknown, errorClass: ErrorClass): void {
    this.lastFailureAt = this.now();
    this.lastError = (err as Error)?.message ?? String(err);
    this.lastErrorClass = errorClass;
    this.totalFailures += 1;

    // Rate Limit ist KEIN Breaker-Fehler (siehe Modulkommentar).
    if (errorClass === "RATE_LIMITED") {
      const wait = retryAfterMsFromError(err, this.now()) ?? 60_000;
      this.rateLimitedUntil = this.now() + wait;
      return;
    }
    // Dauerhafte Fehler (Validierung, Berechtigung) sagen nichts über die
    // Gesundheit des Anbieters – sie sagen etwas über UNSERE Anfrage. Sie
    // dürfen den Breaker nicht öffnen, sonst schaltet ein einziger falscher
    // Datensatz die ganze Integration ab.
    if (!isTransient(errorClass)) return;

    if (this.state === "half_open") {
      this.probeInFlight = false;
      this.currentOpenMs = Math.min(this.breakerOptions.maxOpenMs, this.currentOpenMs * 2);
      this.transition("open");
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.breakerOptions.failureThreshold) {
      this.transition("open");
    }
  }

  /**
   * Führt `fn` unter Zeitlimit, Breaker und Retry-Politik aus.
   *
   * Wirft NICHT: liefert ein `CallResult`. Begründung: §11 verlangt, dass ein
   * Ausfall gepuffert wird und **keine falsche Erfolgsmeldung** entsteht. Ein
   * Ergebnisobjekt zwingt den Aufrufer, den Fehlerfall zu behandeln; eine
   * Exception verleitet zu `try {} catch {}` mit stillem Weitermachen.
   */
  async call<T>(fn: () => Promise<T>, options: CallOptions): Promise<CallResult<T>> {
    this.refreshState();

    if (this.rateLimitedUntil !== null) {
      if (this.now() < this.rateLimitedUntil) {
        this.totalShortCircuited += 1;
        const wait = this.rateLimitedUntil - this.now();
        await this.persist();
        return {
          ok: false,
          errorClass: "RATE_LIMITED",
          error: new IntegrationRateLimitedError(this.integration, wait).message,
          attempts: 0,
          shortCircuited: true,
          idempotencyKey: options.idempotencyKey,
        };
      }
      this.rateLimitedUntil = null;
    }

    if (this.state === "open") {
      this.totalShortCircuited += 1;
      await this.persist();
      const wait = Math.max(0, (this.probeAfter ?? this.now()) - this.now());
      return {
        ok: false,
        errorClass: "SERVER_UNAVAILABLE",
        error: new CircuitOpenError(this.integration, wait).message,
        attempts: 0,
        shortCircuited: true,
        idempotencyKey: options.idempotencyKey,
      };
    }

    if (this.state === "half_open") {
      if (this.probeInFlight && !options.probe) {
        // Genau EIN Aufruf sondiert. Alle anderen werden kurzgeschlossen –
        // sonst wäre die Sondierung ein Lastspitze auf ein System, das gerade
        // ausgefallen war.
        this.totalShortCircuited += 1;
        await this.persist();
        return {
          ok: false,
          errorClass: "SERVER_UNAVAILABLE",
          error: `${this.integration}: Sondierung läuft bereits – Aufruf wurde nicht versucht`,
          attempts: 0,
          shortCircuited: true,
          idempotencyKey: options.idempotencyKey,
        };
      }
      this.probeInFlight = true;
    }

    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    // In `half_open` wird NICHT wiederholt: eine Sondierung ist ein Versuch.
    const maxAttempts =
      this.state === "half_open" ? 1 : (options.maxAttempts ?? this.maxAttempts);
    const sleep = this.options.sleep ?? defaultSleep;

    let attempt = 0;
    let lastClass: ErrorClass = "UNKNOWN_PERMANENT";
    let lastMessage = "";

    while (attempt < maxAttempts) {
      attempt += 1;
      this.totalCalls += 1;
      try {
        const value = await withTimeout(
          fn(),
          timeoutMs,
          () => new IntegrationTimeoutError(this.integration, options.operation, timeoutMs),
        );
        this.recordSuccess();
        await this.persist();
        return { ok: true, value, attempts: attempt, shortCircuited: false, idempotencyKey: options.idempotencyKey };
      } catch (err) {
        lastClass = classifyError(err);
        lastMessage = (err as Error)?.message ?? String(err);
        this.recordFailure(err, lastClass);

        const decision = decideRetry(err, attempt, maxAttempts);
        if (!decision.retry) break;
        // Der Anbieter hat Vorrang: `Retry-After` schlägt unsere Kurve.
        const wait = retryAfterMsFromError(err, this.now()) ?? decision.delayMs;
        await sleep(wait);
        // Der Breaker kann während des Wartens geöffnet haben (der letzte
        // Fehlversuch kann die Schwelle gerissen haben). `breakerState` liest
        // ihn frisch – ein weiterer Versuch gegen einen offenen Breaker wäre
        // genau der Aufruf, den §11 verhindern soll.
        if (this.breakerState === "open") break;
      }
    }

    await this.persist();
    const record: FailedCallRecord = {
      integration: this.integration,
      operation: options.operation,
      idempotencyKey: options.idempotencyKey,
      errorClass: lastClass,
      error: lastMessage,
      attempts: attempt,
      at: new Date(this.now()).toISOString(),
    };
    if (this.options.onErrorQueue) await this.options.onErrorQueue(record);
    return {
      ok: false,
      errorClass: lastClass,
      error: lastMessage,
      attempts: attempt,
      shortCircuited: false,
      idempotencyKey: options.idempotencyKey,
    };
  }

  private async persist(): Promise<void> {
    if (this.options.persist) await this.options.persist(this.snapshot());
  }
}

/**
 * Registry aller Wächter des Prozesses. Ein Prozess hat GENAU EINEN Breaker je
 * Integration – zwei Breaker für denselben Anbieter würden sich gegenseitig
 * belügen.
 */
export class IntegrationGuardRegistry {
  private guards = new Map<string, IntegrationGuard>();

  register(guard: IntegrationGuard): IntegrationGuard {
    this.guards.set(guard.integration, guard);
    return guard;
  }

  get(integration: string): IntegrationGuard | undefined {
    return this.guards.get(integration);
  }

  ensure(options: ResilienceOptions): IntegrationGuard {
    const existing = this.guards.get(options.integration);
    if (existing) return existing;
    return this.register(new IntegrationGuard(options));
  }

  all(): IntegrationGuard[] {
    return [...this.guards.values()];
  }

  snapshots(): IntegrationHealthSnapshot[] {
    return this.all().map((g) => g.snapshot());
  }

  resetAll(): void {
    for (const guard of this.guards.values()) guard.reset();
  }

  clear(): void {
    this.guards.clear();
  }
}

/**
 * Die zehn Integrationsnamen. Zentral, damit `integration_health` und die
 * Wächter dieselben Schlüssel benutzen (ein Tippfehler wäre eine zweite,
 * unsichtbare Integration).
 */
export const INTEGRATIONS = [
  "notifications",
  "calendar",
  "bank",
  "storage",
  "crm",
  "malware-scan",
  "payments",
  "transcription",
  "ai-suggestions",
  /** Fahrschulverwaltungssoftware (Stammdatenabgleich, §18-Szenario 3). */
  "fahrschulverwaltung",
] as const;

export type IntegrationName = (typeof INTEGRATIONS)[number];

/**
 * Zeitlimits je Integration. Unterschiedlich, weil die Aufgaben
 * unterschiedlich sind: ein Malware-Scan über 10 MB darf länger dauern als
 * ein Push-Versand, und ein Bankabruf über einen Tag Buchungen erst recht.
 * Ein einheitliches Limit wäre entweder zu kurz (Fehlalarme) oder zu lang
 * (der Nutzer wartet).
 */
export const DEFAULT_TIMEOUTS: Record<IntegrationName, number> = {
  notifications: 5_000,
  calendar: 8_000,
  bank: 20_000,
  storage: 15_000,
  crm: 5_000,
  "malware-scan": 30_000,
  payments: 10_000,
  transcription: 60_000,
  "ai-suggestions": 30_000,
  fahrschulverwaltung: 20_000,
};
