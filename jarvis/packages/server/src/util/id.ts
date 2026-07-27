import { randomBytes, createHash } from 'node:crypto'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** Short, sortable-ish, prefixed id. `msg_lq7f3k_9a2b41` */
export function newId(prefix: string): string {
  const t = Date.now().toString(36)
  const r = randomBytes(4).toString('hex')
  return `${prefix}_${t}_${r}`
}

/** Deterministic id derived from a stable natural key (used for source ids). */
export function stableId(prefix: string, key: string): string {
  const h = createHash('sha256').update(key).digest('hex').slice(0, 20)
  return `${prefix}_${h}`
}

export function randomCode(len = 8): string {
  const buf = randomBytes(len)
  let out = ''
  for (const b of buf) out += ALPHABET[b % ALPHABET.length]
  return out
}
