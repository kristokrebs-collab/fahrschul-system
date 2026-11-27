/**
 * GET /api/v1/flags – the public state of the operator's emergency switches (C4): `{ switches: { sync, calls, ai,
 * checkout } }`, `true` = switched OFF. No login, no secret, no user data – four booleans. The app reads it so that a
 * switched-off area says so ("Der Betreiber hat den Sync vorübergehend abgeschaltet") instead of failing silently, and the
 * browser stops talking to Supabase for the journal sync while `sync` is on (`src/cloud/flags.ts`).
 * Cached for a minute at the edge; 120 requests per minute per address pseudonym (per instance counter – this must work
 * without a database).
 */
import type { Config } from "@netlify/functions";
import { ipRateId } from "./_lib/audit";
import { clientIp, handler, HttpError, json, requireMethod } from "./_lib/http";
import { switchStates } from "./_lib/killswitch";

const slots = new Map<string, { n: number; resetAt: number }>();
export const flagsTesting = { clear: (): void => slots.clear() };

export default handler(async (req, ctx) => {
  requireMethod(req, "GET");
  const now = Date.now();
  const key = ipRateId(clientIp(req, ctx), now) ?? "anon";
  if (slots.size > 2_000) for (const [k, s] of slots) if (s.resetAt <= now) slots.delete(k);
  let s = slots.get(key);
  if (!s || s.resetAt <= now) {
    s = { n: 0, resetAt: now + 60_000 };
    slots.set(key, s);
  }
  if (++s.n > 120) throw new HttpError(429, "rate_limited", undefined, undefined, { "retry-after": String(Math.max(1, Math.ceil((s.resetAt - now) / 1000))) });
  return json({ switches: switchStates() }, { headers: { "cache-control": "public, max-age=60" } });
});

export const config: Config = { path: "/api/v1/flags", method: ["GET"] };
