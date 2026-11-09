/**
 * Security audit trail → `public.audit_log` (Wave-0 contract, owner P09). Users can read their own rows (Konto →
 * Sicherheit); only functions write. Never throws – an audit failure must not break the action.
 */
import { createHash, createHmac } from "node:crypto";
import { envOptional, isProduction } from "./env";
import { HttpError } from "./http";
import { supabaseAdmin } from "./supabase";

export type AuditAction =
  | "account.export"
  | "account.delete"
  | "auth.mfa.enroll"
  | "auth.mfa.unenroll"
  | "auth.sessions.revoke"
  | "exchange.connect"
  | "exchange.disconnect"
  | "exchange.sync"
  | "billing.checkout"
  | "billing.portal"
  | "billing.subscription"
  | "social.share"
  | "api.token.create"
  | "api.token.revoke"
  | (string & {});

const SECRET_KEY = /secret|password|passphrase|token|api[-_]?key|authorization|cookie|jwt/i;

/** Replaces values of secret-looking keys (any depth) with "[redacted]". */
export function scrubMeta(meta: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (Array.isArray(meta)) return meta.slice(0, 50).map((v) => scrubMeta(v, depth + 1));
  if (meta && typeof meta === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : scrubMeta(v, depth + 1);
    return out;
  }
  return typeof meta === "string" && meta.length > 500 ? `${meta.slice(0, 500)}…` : meta;
}

/**
 * Secret key of the IP pseudonyms (review PRIV-02): `IP_HASH_PEPPER`, else derived from `SUPABASE_SECRET_KEY` (server
 * only, never in a dump of the database). A plain hash with a public salt can be reversed for all 2^32 IPv4 addresses
 * in minutes; an HMAC with a secret key cannot without the key. Without either variable nothing is stored anyway (the
 * audit log and the rate limits live in Supabase) – the fixed key only keeps tests and local runs working.
 */
function ipPepper(): string {
  const ring = pepperRing();
  const first = ring[0];
  if (!first) throw new HttpError(500, "server_misconfigured", "Der Server ist nicht vollständig eingerichtet.");
  return first;
}

/**
 * Every key a pseudonym or hash may have been made with, NEWEST FIRST (Runde 11, Linse 3 #9):
 *  1. the explicit, versioned pepper: `IP_HASH_PEPPER_V9` … `IP_HASH_PEPPER_V2`, then `IP_HASH_PEPPER` (= version 1). New hashes use the
 *     first one; old hashes stay checkable with the older ones (rotate by adding `IP_HASH_PEPPER_V2`, remove V1 only when no recovery
 *     code or tombstone made with it is left to matter);
 *  2. the LEGACY key derived from `SUPABASE_SECRET_KEY` – only so that recovery codes made before the pepper was set keep working (checked,
 *     never used to make a new hash while an explicit pepper exists);
 *  3. the fixed local key `tj-local-only` – ONLY outside production (tests, `netlify dev`). A public constant must never key anything in
 *     production: there the ring is just what the operator configured.
 */
export function pepperRing(): string[] {
  const out: string[] = [];
  for (let v = 9; v >= 2; v--) {
    const k = envOptional(`IP_HASH_PEPPER_V${v}`);
    if (k) out.push(k);
  }
  const v1 = envOptional("IP_HASH_PEPPER");
  if (v1) out.push(v1);
  const sb = envOptional("SUPABASE_SECRET_KEY");
  if (sb) out.push(createHash("sha256").update(`tj-ip-pepper:${sb}`).digest("hex"));
  if (!isProduction()) out.push("tj-local-only");
  return out;
}

/** True when the operator set an explicit pepper (`IP_HASH_PEPPER`, `IP_HASH_PEPPER_V<n>`): what a long-lived hash (recovery codes) requires in production. */
export function pepperConfigured(): boolean {
  return !!envOptional("IP_HASH_PEPPER") || [2, 3, 4, 5, 6, 7, 8, 9].some((v) => !!envOptional(`IP_HASH_PEPPER_V${v}`));
}

/**
 * Server-secret key for ONE purpose (B1 recovery codes): HMAC of the purpose label with the pepper, hex. A purpose label
 * keeps two uses of the same secret from ever producing comparable values.
 */
export function purposeKey(purpose: string): string {
  return createHmac("sha256", ipPepper()).update(`tj-purpose:${purpose}`).digest("hex");
}

/** The purpose key under EVERY key of the ring, newest first – to CHECK a hash that may predate a rotation. */
export function purposeKeys(purpose: string): string[] {
  return pepperRing().map((k) => createHmac("sha256", k).update(`tj-purpose:${purpose}`).digest("hex"));
}

/** Pseudonym of an IP for the audit log: truncated HMAC-SHA-256 with the server secret (`null` passes through). */
export function hashIp(ip: string | null): string | null {
  return ip ? createHmac("sha256", ipPepper()).update(`tj-audit:${ip}`).digest("hex").slice(0, 32) : null;
}

/**
 * Pseudonym of an IP for rate-limit keys (`rate_hits`): like `hashIp` plus the UTC day, so the keys of one address are
 * not linkable across days and not to its audit rows. `null` passes through.
 */
export function ipRateId(ip: string | null, nowMs = Date.now()): string | null {
  if (!ip) return null;
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return createHmac("sha256", ipPepper()).update(`tj-rate:${day}:${ip}`).digest("hex").slice(0, 32);
}

/** Appends one audit row. `meta` is scrubbed; pass `ip` from `clientIp(req, ctx)`. */
export async function audit(userId: string | null, action: AuditAction, meta: Record<string, unknown> = {}, ip: string | null = null): Promise<void> {
  try {
    const { error } = await supabaseAdmin()
      .from("audit_log")
      .insert({ user_id: userId, action, meta: scrubMeta(meta), ip_hash: hashIp(ip) });
    if (error) console.error("[fn] audit insert failed", error.code);
  } catch (e) {
    console.error("[fn] audit failed", e instanceof Error ? e.name : typeof e);
  }
}
