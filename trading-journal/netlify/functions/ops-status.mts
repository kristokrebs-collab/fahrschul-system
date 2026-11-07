/**
 * GET /api/v1/ops/status[?probe=1][&stats=1] – the operator's status page (C4 Betrieb). Only with the operator token
 * (`Authorization: Bearer <OPS_TOKEN>`); this is NOT a user endpoint and shows no user data.
 *
 * What it says (names and states only, never a value):
 * - `verdict`: `bereit` only when every core group (Supabase, Site address) is complete and nothing is half-set;
 *   otherwise `unvollständig` or `nicht eingerichtet`. A missing variable is never reported as "free" or "ok".
 * - `groups` / `functions`: which variable group each function stands on and whether it is set up ("eingerichtet",
 *   "teilweise", "nicht eingerichtet"), plus the emergency switches the RUNNING functions see (`KILL_*`).
 * - `unknown`: environment names that look like ours but are not in the list (a typo is the commonest cause of "it does
 *   not work").
 * - `production` (Runde 11): states of a production deploy (`CONTEXT=production`) that are no missing group but wrong – Stripe not set up
 *   (the functions then run CLOSED unless `ALLOW_UNGATED=true`), `IP_HASH_PEPPER` missing. While one stands the verdict is never `bereit`.
 * - `?probe=1`: one read-only request per CONFIGURED service (Supabase, Stripe, Resend, Twilio); unconfigured ones are
 *   "nicht geprüft". `?stats=1`: counts of the last 24 h (registrations, sync runs, jobs, webhooks, billing, errors).
 *
 * Security: without `OPS_TOKEN` (or shorter than 24 characters) the function answers 503 and returns nothing; a wrong or
 * missing token is the same 401 for every case; the comparison is constant-time on SHA-256 digests; 10 wrong tries per 10
 * minutes per address pseudonym lock the address out (per instance – the page works even when Supabase is down, which is
 * the moment the operator needs it). The token never appears in a log.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { ipRateId } from "./_lib/audit";
import { envOptional, type ServerEnvName } from "./_lib/env";
import { evaluateEnv, ENV_SPEC } from "./_lib/envSpec";
import { clientIp, handler, HttpError, json, requireMethod } from "./_lib/http";
import { runProbes } from "./_lib/opsProbes";
import { collectStats } from "./_lib/opsStats";

export const OPS_MIN_TOKEN = 24;
export const OPS_MAX_FAILURES = 10;
export const OPS_WINDOW_MS = 10 * 60_000;

const failures = new Map<string, { n: number; resetAt: number }>();

export const opsTesting = { clear: (): void => failures.clear() };

const digest = (s: string): Buffer => createHash("sha256").update(s).digest();

function locked(key: string, now: number): boolean {
  const f = failures.get(key);
  return !!f && f.resetAt > now && f.n >= OPS_MAX_FAILURES;
}

function fail(key: string, now: number): void {
  if (failures.size > 2_000) for (const [k, f] of failures) if (f.resetAt <= now) failures.delete(k);
  const f = failures.get(key);
  if (!f || f.resetAt <= now) failures.set(key, { n: 1, resetAt: now + OPS_WINDOW_MS });
  else f.n++;
}

/** Names present in the process environment (never values). */
function presentNames(): string[] {
  const names = new Set(Object.keys(process.env));
  const nf = (globalThis as { Netlify?: { env?: { toObject?: () => Record<string, string> } } }).Netlify?.env?.toObject?.();
  if (nf) for (const k of Object.keys(nf)) names.add(k);
  return [...names];
}

export default handler(async (req, ctx) => {
  requireMethod(req, "GET");
  const token = envOptional("OPS_TOKEN");
  if (!token || token.length < OPS_MIN_TOKEN) {
    throw new HttpError(503, "ops_not_configured", "Die Betreiber-Statusseite ist nicht eingerichtet: OPS_TOKEN fehlt oder ist kürzer als 24 Zeichen.");
  }
  const now = Date.now();
  const who = ipRateId(clientIp(req, ctx), now) ?? "anon";
  if (locked(who, now)) throw new HttpError(429, "rate_limited", undefined, undefined, { "retry-after": "600" });
  const presented = /^Bearer\s+(\S{1,256})$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  const same = !!presented && timingSafeEqual(digest(presented), digest(token));
  if (!same) {
    fail(who, now);
    throw new HttpError(401, "unauthenticated", "Nicht erlaubt.");
  }

  const report = evaluateEnv((n) => envOptional(n as ServerEnvName), presentNames());
  const url = new URL(req.url);
  const out: Record<string, unknown> = {
    generatedAt: new Date(now).toISOString(),
    verdict: report.verdict,
    verdictNote:
      report.verdict === "bereit"
        ? "Die Kern-Variablen sind gesetzt. Optionale Bereiche, die „nicht eingerichtet“ sind, laufen bewusst nicht."
        : "Es fehlen Angaben. „Nicht eingerichtet“ heißt: der Bereich läuft nicht – nicht: er ist frei.",
    release: { deployId: process.env.DEPLOY_ID ?? null, context: process.env.CONTEXT ?? null, node: process.version, region: process.env.AWS_REGION ?? process.env.NETLIFY_REGION ?? null },
    groups: report.groups,
    functions: report.functions,
    switches: report.switches,
    unknown: report.unknown,
    // Runde 11: wrong states of a PRODUCTION deploy (Stripe missing → the functions run closed; no IP_HASH_PEPPER). Empty = none.
    production: report.production,
    variables: ENV_SPEC.filter((e) => e.scope === "functions" && !e.planned).map((e) => ({ name: e.name, set: !!envOptional(e.name as ServerEnvName), need: e.need, group: e.group })),
  };
  if (url.searchParams.get("probe") === "1") out.probes = await runProbes();
  if (url.searchParams.get("stats") === "1") {
    try {
      out.stats = await collectStats(new Date(now));
    } catch {
      out.stats = { error: "Die Datenbank ist nicht erreichbar oder nicht eingerichtet." };
    }
  }
  return json(out);
});

export const config: Config = { path: "/api/v1/ops/status", method: ["GET"] };
