import {
  randomBytes, createCipheriv, createDecipheriv, scryptSync,
  timingSafeEqual, createHmac, createHash,
} from 'node:crypto'
import { config } from '../config.js'

/**
 * Envelope encryption for data classified `private` / `secret`, plus password
 * hashing and TOTP. Deliberately zero third-party crypto dependencies: every
 * primitive here is from node:crypto.
 */

const KEY_LEN = 32
let cachedKey: Buffer | null = null

function decodeKey(raw: string): Buffer {
  const hex = /^[0-9a-fA-F]{64}$/
  if (hex.test(raw)) return Buffer.from(raw, 'hex')
  const b64 = Buffer.from(raw, 'base64')
  if (b64.length === KEY_LEN) return b64
  // Any other string is treated as a passphrase and stretched.
  return scryptSync(raw, 'jarvis-master-key-v1', KEY_LEN)
}

export function masterKey(): Buffer {
  if (cachedKey) return cachedKey
  if (!config.masterKey) {
    throw new Error(
      'JARVIS_MASTER_KEY ist nicht gesetzt. Ohne Master-Key können private/geheime ' +
      'Daten nicht verschlüsselt gespeichert werden. Erzeuge einen mit: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    )
  }
  cachedKey = decodeKey(config.masterKey)
  return cachedKey
}

export function hasMasterKey(): boolean {
  return !!config.masterKey
}

/** AES-256-GCM. Output: `v1:<iv b64>:<tag b64>:<ciphertext b64>` */
export function encryptSecret(plain: string): string {
  const key = masterKey()
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`
}

export function decryptSecret(blob: string): string {
  const parts = blob.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Ungültiges Ciphertext-Format')
  const [, ivB, tagB, dataB] = parts as [string, string, string, string]
  const d = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB, 'base64'))
  d.setAuthTag(Buffer.from(tagB, 'base64'))
  return Buffer.concat([d.update(Buffer.from(dataB, 'base64')), d.final()]).toString('utf8')
}

export function isEncrypted(v: string): boolean {
  return v.startsWith('v1:') && v.split(':').length === 4
}

/* ── Passwords ───────────────────────────────────────────────────────────── */

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 } as const

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const dk = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2 })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${dk.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, nS, rS, pS, saltB, hashB] = stored.split('$')
    if (scheme !== 'scrypt' || !nS || !rS || !pS || !saltB || !hashB) return false
    const N = Number(nS), r = Number(rS), p = Number(pS)
    const expected = Buffer.from(hashB, 'base64')
    const dk = scryptSync(password, Buffer.from(saltB, 'base64'), expected.length,
      { N, r, p, maxmem: 128 * N * r * 2 })
    return dk.length === expected.length && timingSafeEqual(dk, expected)
  } catch { return false }
}

/* ── Tokens & signatures ─────────────────────────────────────────────────── */

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

export function hmac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/* ── TOTP (RFC 6238, SHA-1, 6 digits, 30s) ───────────────────────────────── */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function newTotpSecret(): string {
  const buf = randomBytes(20)
  let bits = '', out = ''
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0')
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]
  return out
}

function b32decode(secret: string): Buffer {
  let bits = ''
  for (const ch of secret.toUpperCase().replace(/=+$/, '')) {
    const idx = B32.indexOf(ch)
    if (idx < 0) continue
    bits += idx.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

export function totpAt(secret: string, counter: number): string {
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const h = createHmac('sha1', b32decode(secret)).update(buf).digest()
  const off = h[h.length - 1]! & 0x0f
  const code = ((h[off]! & 0x7f) << 24) | ((h[off + 1]! & 0xff) << 16) |
               ((h[off + 2]! & 0xff) << 8) | (h[off + 3]! & 0xff)
  return String(code % 1_000_000).padStart(6, '0')
}

/** Accepts the current step plus one step of clock drift either way. */
export function verifyTotp(secret: string, token: string, now = Date.now()): boolean {
  const step = Math.floor(now / 30_000)
  const clean = token.replace(/\s/g, '')
  for (let d = -1; d <= 1; d++) if (safeEqual(totpAt(secret, step + d), clean)) return true
  return false
}

export function totpUri(secret: string, account: string, issuer = 'JARVIS'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` +
         `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}
