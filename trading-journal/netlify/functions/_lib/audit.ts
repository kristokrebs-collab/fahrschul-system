/**
 * Security audit trail → `public.audit_log` (Wave-0 contract, owner P09). Users can read their own rows (Konto →
 * Sicherheit); only functions write. Never throws – an audit failure must not break the action.
 */
import { createHash } from "node:crypto";
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

/** Truncated SHA-256 of an IP (`null` passes through) – the raw IP is never stored. */
export function hashIp(ip: string | null): string | null {
  return ip ? createHash("sha256").update(`tj-audit:${ip}`).digest("hex").slice(0, 32) : null;
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
