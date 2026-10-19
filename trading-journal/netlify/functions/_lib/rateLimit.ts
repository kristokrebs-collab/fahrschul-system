/**
 * Fixed-window rate limit backed by `public.rate_hit(p_key, p_window_sec)` (migration 0001; service role only).
 * Wave-0 contract, owner P09. Keys: `rateKey("exchange-connect", user.id)`, `rateKey("log", ipHash)`, …
 */
import { HttpError } from "./http";
import { supabaseAdmin } from "./supabase";

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  /** Hits in the current window including this one. */
  count: number;
  remaining: number;
  /** Epoch ms when the window resets. */
  resetAt: number;
}

export interface RateLimitOptions {
  /** On a database error: false (default) lets the request through, true rejects it (sensitive endpoints). */
  failClosed?: boolean;
  /** Clock for tests. */
  now?: number;
}

/** `scope:part1:part2` – scope is a short constant, parts are ids or hashes (never raw IPs or e-mails). */
export function rateKey(scope: string, ...parts: string[]): string {
  return [scope, ...parts].join(":");
}

/** End of the fixed window containing `nowMs` (same bucketing as `rate_hit`). */
export function windowReset(nowMs: number, windowSec: number): number {
  const w = windowSec * 1000;
  return Math.floor(nowMs / w) * w + w;
}

/** Counts one hit for `key`; `ok` is false once more than `max` hits fall into the current `windowSec` window. */
export async function rateLimit(key: string, max: number, windowSec: number, opts: RateLimitOptions = {}): Promise<RateLimitResult> {
  const now = opts.now ?? Date.now();
  const resetAt = windowReset(now, windowSec);
  const { data, error } = await supabaseAdmin().rpc("rate_hit", { p_key: key, p_window_sec: windowSec });
  if (error || typeof data !== "number") {
    console.error("[fn] rate_hit failed", error?.code ?? "no data");
    const ok = !opts.failClosed;
    return { ok, limit: max, count: ok ? 0 : max + 1, remaining: ok ? max : 0, resetAt };
  }
  return { ok: data <= max, limit: max, count: data, remaining: Math.max(0, max - data), resetAt };
}

/** `rateLimit`, throwing 429 `rate_limited` (with `Retry-After`) when exceeded. */
export async function enforceRateLimit(key: string, max: number, windowSec: number, opts: RateLimitOptions = {}): Promise<RateLimitResult> {
  const r = await rateLimit(key, max, windowSec, opts);
  if (!r.ok) {
    const retry = Math.max(1, Math.ceil((r.resetAt - (opts.now ?? Date.now())) / 1000));
    throw new HttpError(429, "rate_limited", undefined, undefined, { "retry-after": String(retry) });
  }
  return r;
}
