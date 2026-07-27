/**
 * Kryptographie-Primitive.
 *
 *  - Passwoerter: scrypt (N=2^15) mit zufaelligem Salt, Vergleich in konstanter Zeit.
 *  - Integrations-Tokens at rest: AES-256-GCM mit zufaelligem IV und AAD.
 *  - Session-Tokens: 32 Byte CSPRNG, in der DB nur als SHA-256-Hash gespeichert.
 *  - Content-Hash: SHA-256 ueber die kanonisierte, veroeffentlichungsrelevante
 *    Repraesentation eines Content-Items. Bindet eine Freigabe an exakt einen
 *    Inhalt (siehe domain/approval.ts).
 */
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
} from 'node:crypto';
import { config } from '../config/env.js';

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  if (password.length < 12) {
    throw new Error('Passwort muss mindestens 12 Zeichen lang sein.');
  }
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  const derived = scryptSync(password, salt, expected.length, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

function encryptionKey(): Buffer {
  return Buffer.from(config.encryptionKey, 'hex');
}

/**
 * Verschluesselt einen Klartext (z. B. ein Plattform-Token).
 * `aad` bindet den Chiffretext an seinen Verwendungskontext, damit ein
 * kopierter Datenbankwert nicht in einem anderen Feld wiederverwendet
 * werden kann.
 */
export function encryptSecret(plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptSecret(payload: string, aad: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Ungueltiges Secret-Format.');
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const enc = Buffer.from(parts[3], 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function signPayload(payload: string): string {
  return createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}

/**
 * Kanonischer Hash ueber alle veroeffentlichungsrelevanten Felder.
 * Schluessel werden rekursiv sortiert, damit die Reihenfolge im JSON
 * das Ergebnis nicht beeinflusst.
 */
export function contentHash(value: unknown): string {
  return sha256(canonicalize(value));
}

export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Stabile, fachlich sprechende IDs. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

/**
 * Entfernt bekannte Secret-Muster aus beliebigem Text (Logs, Fehlermeldungen,
 * API-Antworten). Bewusst aggressiv: lieber ein Token zu viel maskiert.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\b(EA[A-Za-z0-9]{20,})\b/g, // Meta Graph Tokens
  /\b(act\.[A-Za-z0-9._-]{20,})\b/g, // TikTok Tokens
  /\b(ya29\.[A-Za-z0-9._-]{20,})\b/g, // Google OAuth Tokens
  /\b([A-Fa-f0-9]{64})\b/g, // Hex-Keys
  /"?(access_token|client_secret|password|api_key|authorization)"?\s*[:=]\s*"?([^"\s,&}]+)"?/gi,
];

export function redact(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match, ...groups) => {
      // Bei Key/Value-Mustern nur den Wert maskieren, den Schluessel behalten.
      if (groups.length >= 2 && typeof groups[1] === 'string' && match.includes(groups[0])) {
        const key = groups[0];
        if (/^(access_token|client_secret|password|api_key|authorization)$/i.test(String(key))) {
          return `${key}=***REDACTED***`;
        }
      }
      return '***REDACTED***';
    });
  }
  return out;
}
