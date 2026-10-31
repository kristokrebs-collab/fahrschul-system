/**
 * Guard and small helpers shared by the four public-data functions `stock-bars`, `stock-quote`, `stock-symbols` and
 * `stock-news`. The data is public (Yahoo Finance, Nasdaq Trader) and nothing personal goes in or out – only tickers,
 * an interval and a range – so these functions need no key and no account. Still:
 *
 *  - Plan gate (the pattern of the other functions): while payments are NOT set up nothing is gated, anyone may read.
 *    Once Stripe is set up the caller must be signed in and the plan must include `boxScanner` (the multi-market
 *    scanner feature); otherwise 401 / 402 with the usual German envelope. A session that has expired does not lock
 *    the data out while payments are off.
 *  - Rate limit per user (or per pseudonymised IP when anonymous) through `rate_hit`; when the database is not
 *    reachable or not configured the limit falls back to a per-instance counter – a public proxy must never run open.
 *  - Answers are `private` and vary on `Authorization`: a shared cache must not serve a gated answer to someone else.
 */
import type { Context } from "@netlify/functions";
import { ipRateId } from "../audit";
import { requireUser, type AuthUser } from "../auth";
import { clientIp, HttpError, json } from "../http";
import { paymentsConfigured, requireFeature } from "../plan";
import { enforceRateLimit, rateKey } from "../rateLimit";

export interface GuardOptions {
  /** short name of the function (`stock-bars`) – part of the rate-limit key */
  scope: string;
  /** requests per window */
  max: number;
  windowSec: number;
}

interface Slot {
  count: number;
  resetAt: number;
}
const slots = new Map<string, Slot>();

/** Per-instance fixed-window counter – the fallback when `rate_hit` cannot be used. */
export function memoryLimit(key: string, max: number, windowSec: number, now: number = Date.now()): void {
  if (slots.size > 5000) for (const [k, s] of slots) if (s.resetAt <= now) slots.delete(k);
  let s = slots.get(key);
  if (!s || s.resetAt <= now) {
    s = { count: 0, resetAt: now + windowSec * 1000 };
    slots.set(key, s);
  }
  s.count++;
  if (s.count > max) throw new HttpError(429, "rate_limited", undefined, undefined, { "retry-after": String(Math.max(1, Math.ceil((s.resetAt - now) / 1000))) });
}

export function resetGuardForTests(): void {
  slots.clear();
}

export async function stockGuard(req: Request, ctx: Pick<Context, "ip"> | null, opts: GuardOptions): Promise<{ user: AuthUser | null }> {
  const payments = paymentsConfigured();
  let user: AuthUser | null = null;
  if (req.headers.has("authorization")) {
    try {
      user = await requireUser(req);
    } catch (e) {
      // with payments on, a broken session is a real 401; with payments off the data is public anyway
      if (payments) throw e;
    }
  }
  if (payments) {
    if (!user) throw new HttpError(401, "unauthenticated", "Für die Aktien-Daten bitte anmelden.");
    await requireFeature(user.id, "boxScanner");
  }
  const who = user?.id ?? ipRateId(clientIp(req, ctx)) ?? "anon";
  const key = rateKey(opts.scope, who);
  try {
    await enforceRateLimit(key, opts.max, opts.windowSec);
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) throw e;
    memoryLimit(key, opts.max, opts.windowSec);
  }
  return { user };
}

/** JSON answer a browser may keep for `maxAgeSec` seconds – but only this browser (never a shared cache). */
export function stockJson(data: unknown, maxAgeSec: number): Response {
  return json(data, { headers: { "cache-control": `private, max-age=${Math.max(0, Math.round(maxAgeSec))}`, vary: "authorization" } });
}

/** Small time-boxed memory cache with in-flight sharing: two callers asking for the same key at once cause ONE upstream request. */
export interface MemoEntry<T> {
  value: T;
  at: number;
}
export function createMemo<T>(max = 400) {
  const done = new Map<string, MemoEntry<T> & { expires: number }>();
  const inflight = new Map<string, Promise<MemoEntry<T>>>();
  return {
    async wrap(key: string, ttlMs: number, fn: () => Promise<T>, now: () => number = Date.now): Promise<MemoEntry<T> & { cached: boolean }> {
      const hit = done.get(key);
      if (hit && hit.expires > now()) return { value: hit.value, at: hit.at, cached: true };
      let p = inflight.get(key);
      if (!p) {
        p = fn()
          .then((value) => {
            const at = now();
            if (done.size >= max) {
              const oldest = done.keys().next().value;
              if (oldest !== undefined) done.delete(oldest);
            }
            done.set(key, { value, at, expires: at + ttlMs });
            return { value, at };
          })
          .finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      const r = await p;
      return { ...r, cached: false };
    },
    clear(): void {
      done.clear();
      inflight.clear();
    },
  };
}
