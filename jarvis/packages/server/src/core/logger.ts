import { config } from '../config.js'

/**
 * Structured logger with a hard redaction pass. Anything that looks like a
 * credential is replaced before it can reach stdout, a file, or a screenshot.
 */

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 } as const
export type Level = keyof typeof LEVELS

const threshold = LEVELS[(config.logLevel as Level)] ?? LEVELS.info

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_\-]{10,}/g, 'sk-ant-[redigiert]'],
  [/sk-[A-Za-z0-9]{20,}/g, 'sk-[redigiert]'],
  [/pa-[A-Za-z0-9_\-]{20,}/g, 'pa-[redigiert]'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, 'gh_[redigiert]'],
  [/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g, '[jwt redigiert]'],
  [/\b[Bb]earer\s+[A-Za-z0-9._\-]{12,}/g, 'Bearer [redigiert]'],
]

const SECRET_KEYS = /^(password|passwort|token|secret|api_?key|authorization|cookie|credential|totp|vec)/i

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[tief]'
  if (typeof value === 'string') {
    let s = value
    for (const [re, rep] of SECRET_PATTERNS) s = s.replace(re, rep)
    return s.length > 4000 ? s.slice(0, 4000) + '…' : s
  }
  if (value === null || typeof value !== 'object') return value
  if (Buffer.isBuffer(value)) return `[buffer ${value.byteLength}B]`
  if (Array.isArray(value)) return value.slice(0, 40).map((v) => redact(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? '[redigiert]' : redact(v, depth + 1)
  }
  return out
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return
  const line = {
    t: new Date().toISOString(),
    level,
    msg: redact(msg),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  }
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout
  out.write(JSON.stringify(line) + '\n')
}

export const log = {
  trace: (m: string, f?: Record<string, unknown>) => emit('trace', m, f),
  debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => emit('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => emit('error', m, f),
  child: (base: Record<string, unknown>) => ({
    trace: (m: string, f?: Record<string, unknown>) => emit('trace', m, { ...base, ...f }),
    debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, { ...base, ...f }),
    info: (m: string, f?: Record<string, unknown>) => emit('info', m, { ...base, ...f }),
    warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, { ...base, ...f }),
    error: (m: string, f?: Record<string, unknown>) => emit('error', m, { ...base, ...f }),
  }),
}

export function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
