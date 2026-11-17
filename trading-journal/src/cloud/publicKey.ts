/**
 * Which Supabase keys may sit in a browser bundle. Dependency-free on purpose: `cloud/env.ts` (runtime) and
 * `scripts/secretGuard.ts` (build) both use it.
 *
 * - `sb_publishable_…` – the publishable key, public by design;
 * - the legacy `anon` key, a JWT whose payload says `"role":"anon"`.
 * Everything else is refused – above all `sb_secret_…` and the legacy `service_role` JWT, which bypass Row Level Security
 * and must never leave the server (`SUPABASE_SECRET_KEY` in Netlify, scope Functions only).
 */

export type KeyVerdict = { ok: true } | { ok: false; reason: string };

/** Payload of a JWT (`header.payload.signature`), or `null` when `s` is not one. */
export function jwtPayload(s: string): Record<string, unknown> | null {
  const parts = s.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
    const v: unknown = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Whether `key` is a key that may be public. Never throws. */
export function checkPublicKey(key: string): KeyVerdict {
  const k = key.trim();
  if (!k) return { ok: false, reason: "leer" };
  if (/^sb_secret_/i.test(k)) return { ok: false, reason: "ein geheimer Schlüssel (sb_secret_…)" };
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(k)) return { ok: true };
  const jwt = jwtPayload(k);
  if (jwt) {
    if (jwt.role === "anon") return { ok: true };
    return { ok: false, reason: `ein JWT mit der Rolle „${typeof jwt.role === "string" ? jwt.role : "?"}“ (nur „anon“ ist öffentlich)` };
  }
  return { ok: false, reason: "weder sb_publishable_… noch ein anon-JWT" };
}
