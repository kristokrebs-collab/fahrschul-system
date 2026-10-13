/**
 * AES-256-GCM for exchange API secrets at rest (Wave-0 contract, owner P09; used by P11).
 *
 * Blob format: `v<version>:<iv b64>:<tag b64>:<ciphertext b64>` – 12-byte random IV per call, 16-byte tag.
 * The AAD binds a blob to its row and field (`secretAad(userId, connectionId, "secret")` – generate the connection
 * id with `crypto.randomUUID()` before inserting), so a ciphertext copied to another row or column does not decrypt.
 * Keys: `EXCHANGE_ENC_KEY_V1`, `…_V2`, … (each `openssl rand -base64 32`); new blobs use the highest version present,
 * old blobs keep decrypting with theirs (`needsReencrypt` → re-encrypted after each sync / positions read and by the
 * cron's sweep, `rotateIfNeeded` / `rotateStaleConnections` in exchanges/store.ts).
 * Never log plaintext, blobs or keys.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { envOptional } from "./env";

export interface Keyring {
  /** Version used for new blobs. */
  current: number;
  /** version → 32-byte key */
  keys: ReadonlyMap<number, Uint8Array>;
}

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

const MAX_VERSION = 9;

/** 32-byte key from base64, or a `CryptoError`. */
export function keyFromBase64(b64: string): Uint8Array {
  const key = Buffer.from(b64.trim(), "base64");
  if (key.length !== 32) throw new CryptoError("encryption key must be 32 bytes (base64)");
  return new Uint8Array(key);
}

/** Keyring from `EXCHANGE_ENC_KEY_V1…V9`; throws when none is configured. */
export function keyringFromEnv(): Keyring {
  const keys = new Map<number, Uint8Array>();
  for (let v = 1; v <= MAX_VERSION; v++) {
    const b64 = envOptional(`EXCHANGE_ENC_KEY_V${v}`);
    if (b64) keys.set(v, keyFromBase64(b64));
  }
  if (!keys.size) throw new CryptoError("no EXCHANGE_ENC_KEY_V<n> configured");
  return { current: Math.max(...keys.keys()), keys };
}

/** AAD of one secret column of `exchange_connections`: `<userId>:<connectionId>:<field>`. */
export function secretAad(userId: string, connectionId: string, field: "api_key" | "secret" | "passphrase"): string {
  return `${userId}:${connectionId}:${field}`;
}

/** Encrypts `plain` with the keyring's current key. */
export function encrypt(plain: string, aad: string, ring: Keyring = keyringFromEnv()): string {
  const key = ring.keys.get(ring.current);
  if (!key) throw new CryptoError(`key v${ring.current} missing`);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [`v${ring.current}`, iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

/** Key version of a blob (`v2:…` → 2), null when the format is not recognised. */
export function keyVersionOf(blob: string): number | null {
  const m = /^v(\d+):/.exec(blob);
  return m ? Number(m[1]) : null;
}

/** Decrypts a blob; throws `CryptoError` on an unknown version, a malformed blob, a wrong AAD or tampering. */
export function decrypt(blob: string, aad: string, ring: Keyring = keyringFromEnv()): string {
  const parts = blob.split(":");
  const version = keyVersionOf(blob);
  if (parts.length !== 4 || version === null) throw new CryptoError("malformed blob");
  const key = ring.keys.get(version);
  if (!key) throw new CryptoError(`unknown key version v${version}`);
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  if (iv.length !== 12 || tag.length !== 16) throw new CryptoError("malformed blob");
  try {
    const d = createDecipheriv("aes-256-gcm", key, iv);
    d.setAAD(Buffer.from(aad, "utf8"));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(Buffer.from(ctB64, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new CryptoError("decryption failed");
  }
}

/** True when the blob was written with an older key version than the keyring's current one. */
export function needsReencrypt(blob: string, ring: Keyring = keyringFromEnv()): boolean {
  const v = keyVersionOf(blob);
  return v !== null && v !== ring.current;
}

/** Last 4 characters for display (`••••abcd`); shorter secrets reveal nothing. */
export function last4(secret: string): string {
  const s = secret.trim();
  return s.length >= 8 ? s.slice(-4) : "";
}
