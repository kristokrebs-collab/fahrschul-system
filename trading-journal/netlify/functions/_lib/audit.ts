/**
 * Security audit trail → `public.audit_log` (Wave-0 contract, owner P09). Users can read their own rows (Konto →
 * Sicherheit); only functions write. Never throws – an audit failure must not break the action.
 */
import { createHash, createHmac } from "node:crypto";
import { envOptional } from "./env";
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
  const own = envOptional("IP_HASH_PEPPER");
  if (own) return own;
  const sb = envOptional("SUPABASE_SECRET_KEY");
  return sb ? createHash("sha256").update(`tj-ip-pepper:${sb}`).digest("hex") : "tj-local-only";
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
