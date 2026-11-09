/**
 * Client-side throttle of the stock requests (the pattern of `src/market/budget.ts`: a token bucket sized well below the
 * server's own limit, plus a small number of requests in flight). The scanner asks for dozens of batches; this keeps it
 * from hammering the function, and a 429 pauses everything for as long as the server asked.
 *
 * `run(fn)` waits for a free slot and a token, then calls `fn`. Aborting the signal rejects the waiting call with an
 * `AbortError` (a call already in flight is `fn`'s own business – pass it the same signal).
 */
import { TokenBucket } from "../budget";

export interface LimiterOptions {
  /** requests per window; default 40 per minute (the server allows 240 per 10 minutes) */
  capacity?: number;
  windowMs?: number;
  /** requests in flight at once; default 2 */
  concurrency?: number;
  now?: () => number;
  /** waits `ms` (rejects with an `AbortError` when the signal fires first) */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface Limiter {
  run<T>(fn: () => Promise<T>, opts?: { signal?: AbortSignal }): Promise<T>;
  /** no request starts for `ms` (a 429 with `Retry-After`) */
  backoff(ms: number): void;
  /** requests waiting for a slot / running now */
  pending(): { waiting: number; running: number };
}

export const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });

export function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createLimiter(opts: LimiterOptions = {}): Limiter {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? realSleep;
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const bucket = new TokenBucket({ capacity: opts.capacity ?? 40, windowMs: opts.windowMs ?? 60_000 }, now());
  let running = 0;
  const waiting: (() => void)[] = [];

  const acquire = (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) return Promise.reject(abortError());
    if (running < concurrency) {
      running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const grant = (): void => {
        signal?.removeEventListener("abort", onAbort);
        running++;
        resolve();
      };
      const onAbort = (): void => {
        const i = waiting.indexOf(grant);
        if (i >= 0) waiting.splice(i, 1);
        reject(abortError());
      };
      waiting.push(grant);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  };
  const release = (): void => {
    running--;
    waiting.shift()?.();
  };

  return {
    async run<T>(fn: () => Promise<T>, o: { signal?: AbortSignal } = {}): Promise<T> {
      await acquire(o.signal);
      try {
        for (;;) {
          if (o.signal?.aborted) throw abortError();
          const t = now();
          if (bucket.take(1, t)) break;
          await sleep(Math.max(50, bucket.waitFor(1, t)), o.signal);
        }
        return await fn();
      } finally {
        release();
      }
    },
    backoff(ms: number): void {
      bucket.backoff(ms, now());
    },
    pending: () => ({ waiting: waiting.length, running }),
  };
}
