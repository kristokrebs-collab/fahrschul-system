/**
 * Aligned polling and backoff math (Plan 4.2 "Polling der 5-min-Feeds", "WS-Regeln", Plan 4.4 re-probe).
 * No free-running `setInterval`: every poll is scheduled at an explicit wall-clock time, paused while the
 * tab is hidden and caught up on `visibilitychange`.
 */

export interface AlignSpec {
  alignMs: number;
  lagMs?: number;
  jitterMs?: number;
}

/**
 * Next aligned poll time strictly after `now`: boundary + lag + jitter. If that instant already passed for
 * the current boundary, the next boundary is used. With `alignMs = 300000`, `lagMs = 60000`,
 * `jitterMs = 45000` polls land 60–105 s after each 5-min boundary (Binance publishes with ≈1 min lag).
 */
export function nextAlignedAt(now: number, spec: AlignSpec, random: () => number = Math.random): number {
  const { alignMs } = spec;
  const lag = spec.lagMs ?? 0;
  const jitter = Math.floor(random() * (spec.jitterMs ?? 0));
  const boundary = Math.floor(now / alignMs) * alignMs;
  const candidate = boundary + lag + jitter;
  return candidate > now ? candidate : boundary + alignMs + lag + jitter;
}

/** Current period boundary (start of the point the exchange is currently building). */
export function currentBoundary(now: number, alignMs: number): number {
  return Math.floor(now / alignMs) * alignMs;
}

/**
 * WebSocket reconnect backoff: `base · 2^attempt` (1 s, 2 s, 4 s, 8 s, 16 s) capped at `cap` (30 s), plus a little
 * jitter from `random` (≤ 25 % of the step and ≤ 1 s) that never lifts the result above the cap. Deterministic growth,
 * so a dead stream is retried after 1 s rather than "somewhere between 0 and 1 s" (the old full jitter could retry at 0 ms
 * and never gave the reconnect ladder the user expects to see in the Live-Daten countdown).
 */
export function wsBackoffMs(attempt: number, random: () => number = Math.random, base = 1000, cap = 30_000): number {
  const ceiling = Math.min(cap, base * 2 ** Math.max(0, attempt));
  const jitter = Math.floor(random() * Math.min(1000, ceiling * 0.25));
  return Math.min(cap, ceiling + jitter);
}

/** Blocked-primary re-probe interval: 5 min, doubling per failure, capped at 60 min. */
export function probeBackoffMs(failures: number): number {
  const base = 5 * 60_000;
  return Math.min(60 * 60_000, base * 2 ** Math.max(0, failures));
}

/** Retry after a non-advancing 5-min poll: once after 60 s, then wait for the next boundary. */
export const NON_ADVANCE_RETRY_MS = 60_000;
/**
 * Retries after a non-advancing aligned poll (the exchange published late): 5-min feeds retry once (+60 s), longer
 * periods up to three times (+60 s, +2 min, +5 min) before waiting for the next period boundary.
 */
export const NON_ADVANCE_RETRIES_MS: readonly number[] = [NON_ADVANCE_RETRY_MS, 120_000, 300_000];
export function nonAdvanceRetries(alignMs: number): number {
  return alignMs > 5 * 60_000 ? NON_ADVANCE_RETRIES_MS.length : 1;
}

/** Soft-failure retry of a feed that stays on its source: 15 s, 30 s, 60 s, 2 min, then every 5 min. */
export const FAILURE_RETRY_MS: readonly number[] = [15_000, 30_000, 60_000, 120_000, 300_000];
export function failureRetryMs(consecutiveFailures: number): number {
  const i = Math.min(FAILURE_RETRY_MS.length - 1, Math.max(0, consecutiveFailures - 1));
  return FAILURE_RETRY_MS[i]!;
}

/**
 * Stale-feed watchdog kicks (a feed whose data is older than its `staleAfterMs` while its next poll is far away):
 * now, then 30 s, 60 s, 2 min, every 5 min until data arrives again.
 */
export const WATCHDOG_KICK_MS: readonly number[] = [0, 30_000, 60_000, 120_000, 300_000];
export function watchdogKickMs(kicks: number): number {
  return WATCHDOG_KICK_MS[Math.min(WATCHDOG_KICK_MS.length - 1, Math.max(0, kicks))]!;
}

/** HTTP 418 (IP banned after ignoring 429s): bucket pause 2 min, doubling per ban, capped at 30 min. */
export function banBackoffMs(bans: number): number {
  return Math.min(30 * 60_000, 2 * 60_000 * 2 ** Math.max(0, bans - 1));
}

/** WS reconnect pace while the tab is hidden (system notifications of the signal check still need the stream). */
export const WS_HIDDEN_RETRY_MS = 60_000;

/** A WS handshake that neither opens nor closes within this time counts as a failed attempt. */
export const WS_CONNECT_TIMEOUT_MS = 15_000;

/** WS liveness: no message for 10 s → `ws_silent`. */
export const WS_SILENT_MS = 10_000;
/** Proactive rollover before the 24 h server cut. */
export const WS_ROLLOVER_MS = 23 * 60 * 60_000;
/** `attempt` resets after this much stable connection time. */
export const WS_STABLE_MS = 60_000;
/** Failed reconnects before WS-fed feeds go to fallback. */
export const WS_MAX_FAILED = 3;

export interface TimerHost {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export const realTimerHost: TimerHost = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

interface Job {
  at: number;
  fn: () => void;
  handle: unknown;
}

/**
 * Keyed one-shot scheduler. `pause()` cancels the timers but keeps the due times; `resume()` re-arms them
 * and fires everything that became due meanwhile (catch-up after `document.hidden`).
 */
export class Scheduler {
  private jobs = new Map<string, Job>();
  private paused = false;
  constructor(private host: TimerHost = realTimerHost) {}

  /** Schedules `fn` at absolute time `at` (ms); replaces any job with the same key. */
  at(key: string, at: number, fn: () => void): void {
    this.cancel(key);
    const job: Job = { at, fn, handle: null };
    this.jobs.set(key, job);
    if (!this.paused) this.arm(key, job);
  }

  /** Schedules `fn` after `ms`. */
  in(key: string, ms: number, fn: () => void): void {
    this.at(key, this.host.now() + Math.max(0, ms), fn);
  }

  private arm(key: string, job: Job): void {
    const delay = Math.max(0, job.at - this.host.now());
    job.handle = this.host.setTimeout(() => {
      this.jobs.delete(key);
      job.fn();
    }, delay);
  }

  cancel(key: string): void {
    const job = this.jobs.get(key);
    if (!job) return;
    if (job.handle != null) this.host.clearTimeout(job.handle);
    this.jobs.delete(key);
  }

  cancelAll(): void {
    for (const key of [...this.jobs.keys()]) this.cancel(key);
  }

  has(key: string): boolean {
    return this.jobs.has(key);
  }

  dueAt(key: string): number | undefined {
    return this.jobs.get(key)?.at;
  }

  /** Moves a pending job to `at`, keeping its callback. Returns false when no such job exists. */
  reschedule(key: string, at: number): boolean {
    const job = this.jobs.get(key);
    if (!job) return false;
    if (job.handle != null) this.host.clearTimeout(job.handle);
    job.handle = null;
    job.at = at;
    if (!this.paused) this.arm(key, job);
    return true;
  }

  /**
   * Keys of jobs whose due time passed more than `graceMs` ago without firing: their timer was lost or frozen
   * (Android does not advance timers while the device sleeps; a frozen tab drops them). The watchdog re-arms them.
   */
  overdue(now: number, graceMs: number): string[] {
    if (this.paused) return [];
    const out: string[] = [];
    for (const [key, job] of this.jobs) if (job.at < now - graceMs) out.push(key);
    return out;
  }

  /** `[key, dueAt]` of every pending job (snapshot). */
  pending(): Array<[string, number]> {
    return [...this.jobs.entries()].map(([k, j]) => [k, j.at]);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    for (const job of this.jobs.values()) {
      if (job.handle != null) this.host.clearTimeout(job.handle);
      job.handle = null;
    }
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const [key, job] of [...this.jobs.entries()]) this.arm(key, job);
  }

  get isPaused(): boolean {
    return this.paused;
  }
}
