/**
 * The account's telephone: state, consent text, and the protected storage of the number.
 *
 * The number is stored only as an AES-GCM blob (`alert_phone_secrets`, key `EXCHANGE_ENC_KEY_V<n>`, AAD binds it to the account) and as a
 * keyed hash (one verified number per account). The client only ever sees the masked form. Opt-out deletes the blob.
 */
import { createHmac } from "node:crypto";
import { maskPhone } from "../../../../src/domain/alerts/phone";
import { CryptoError, decrypt, encrypt, keyringFromEnv } from "../crypto";
import { envOptional } from "../env";
import { supabaseAdmin } from "../supabase";
import { phoneAad } from "./deliver";

export { CONSENT_TEXT, CONSENT_VERSION } from "../../../../src/domain/alerts/phone";

export type PhoneStatus = "none" | "pending" | "verified" | "revoked";

export interface PhoneState {
  status: PhoneStatus;
  masked: string | null;
  consentAt: string | null;
  verifiedAt: string | null;
}

export async function phoneState(userId: string): Promise<PhoneState> {
  const { data, error } = await supabaseAdmin().from("alert_phones").select("status, masked, consent_at, verified_at").eq("user_id", userId).maybeSingle();
  if (error || !data) return { status: "none", masked: null, consentAt: null, verifiedAt: null };
  const r = data as { status?: unknown; masked?: unknown; consent_at?: unknown; verified_at?: unknown };
  const status: PhoneStatus = r.status === "pending" || r.status === "verified" || r.status === "revoked" ? r.status : "none";
  return { status, masked: typeof r.masked === "string" ? r.masked : null, consentAt: typeof r.consent_at === "string" ? r.consent_at : null, verifiedAt: typeof r.verified_at === "string" ? r.verified_at : null };
}

const hmacHex = (key: Uint8Array | string, e164: string): string => createHmac("sha256", key).update(`alert-phone:${e164}`).digest("hex");

/** The key the OLD code used: the oldest `EXCHANGE_ENC_KEY_V<n>`. Only kept so numbers verified before `PHONE_HASH_KEY` existed are still found. */
function legacyHashKey(): Uint8Array {
  const ring = keyringFromEnv();
  const key = ring.keys.get(Math.min(...ring.keys.keys()));
  if (!key) throw new CryptoError("no key");
  return key;
}

/**
 * HMAC-SHA256 (hex) of the number – stable, so the same number always gives the same hash (one verified number per number). The key is
 * its OWN secret, `PHONE_HASH_KEY`, which is never rotated (Runde 11, Linse 3 #2 / Linse 1 #25): the hash used the oldest encryption key
 * before, so removing that key after a rotation changed every hash and the uniqueness quietly broke. Without `PHONE_HASH_KEY` the legacy
 * key is used (nothing changes until the operator sets it).
 */
export function numberHash(e164: string): string {
  const own = envOptional("PHONE_HASH_KEY");
  return hmacHex(own ?? legacyHashKey(), e164);
}

/**
 * Every hash this number may be stored under, current first: with `PHONE_HASH_KEY` set also the legacy one (while the old encryption key
 * still exists), so a number verified before the switch is still recognised as taken.
 */
export function numberHashes(e164: string): string[] {
  const current = numberHash(e164);
  if (!envOptional("PHONE_HASH_KEY")) return [current];
  try {
    const legacy = hmacHex(legacyHashKey(), e164);
    return legacy === current ? [current] : [current, legacy];
  } catch {
    return [current];
  }
}

export function sealNumber(userId: string, e164: string): string {
  return encrypt(e164, phoneAad(userId));
}

export function openNumber(userId: string, blob: string): string {
  return decrypt(blob, phoneAad(userId));
}

export { maskPhone };
