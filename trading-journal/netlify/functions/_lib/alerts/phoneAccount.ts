/**
 * The account's telephone: state, consent text, and the protected storage of the number.
 *
 * The number is stored only as an AES-GCM blob (`alert_phone_secrets`, key `EXCHANGE_ENC_KEY_V<n>`, AAD binds it to the account) and as a
 * keyed hash (one verified number per account). The client only ever sees the masked form. Opt-out deletes the blob.
 */
import { createHmac } from "node:crypto";
import { maskPhone } from "../../../../src/domain/alerts/phone";
import { CryptoError, decrypt, encrypt, keyringFromEnv } from "../crypto";
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

/** HMAC-SHA256 (hex) of the number with the oldest configured key – stable, so the same number always gives the same hash. */
export function numberHash(e164: string): string {
  const ring = keyringFromEnv();
  const v = Math.min(...ring.keys.keys());
  const key = ring.keys.get(v);
  if (!key) throw new CryptoError("no key");
  return createHmac("sha256", key).update(`alert-phone:${e164}`).digest("hex");
}

export function sealNumber(userId: string, e164: string): string {
  return encrypt(e164, phoneAad(userId));
}

export function openNumber(userId: string, blob: string): string {
  return decrypt(blob, phoneAad(userId));
}

export { maskPhone };
