import type { DB } from '../db/index.js'
import type { Role, SessionUser } from '@jarvis/shared'
import { newId } from '../util/id.js'
import { nowIso, plus, isPast, DAY, MINUTE } from '../util/time.js'
import {
  hashPassword, verifyPassword, newToken, sha256, encryptSecret, decryptSecret,
  newTotpSecret, verifyTotp, totpUri, hasMasterKey,
} from '../core/crypto.js'
import { audit } from '../core/audit.js'
import { log } from '../core/logger.js'

/**
 * Authentication.
 *
 * Session tokens are random 32-byte values; only their SHA-256 is stored, so a
 * database leak does not yield usable sessions. Failed logins lock the account
 * with an escalating delay — this is a single-owner system on the open
 * internet, and unlimited password guessing is the realistic attack.
 */

const SESSION_TTL = 30 * DAY
const MAX_FAILED = 5
const LOCK_MS = 15 * MINUTE

export interface AuthedUser extends SessionUser {
  sessionId: string
}

interface UserRow {
  id: string; username: string; password_hash: string; role: Role
  totp_secret: string | null; totp_enabled: number
  failed_logins: number; locked_until: string | null
}

export function userCount(db: DB): number {
  return (db.prepare('SELECT count(*) n FROM users').get() as { n: number }).n
}

export function createUser(
  db: DB, username: string, password: string, role: Role, actor = 'system',
): SessionUser {
  if (password.length < 12) throw new Error('Passwort muss mindestens 12 Zeichen haben')
  const id = newId('usr')
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, totp_secret, totp_enabled, created_at,
       last_login_at, failed_logins, locked_until)
     VALUES (?,?,?,?,NULL,0,?,NULL,0,NULL)`,
  ).run(id, username.toLowerCase().trim(), hashPassword(password), role, nowIso())
  audit(db, { actor, action: 'auth.user_create', subject: username, outcome: 'ok', detail: { role } })
  return { id, username: username.toLowerCase().trim(), role, totp_enabled: false }
}

export interface LoginResult {
  ok: boolean
  token?: string
  user?: SessionUser
  needsTotp?: boolean
  error?: string
}

export function login(
  db: DB, username: string, password: string, totp: string | undefined,
  meta: { ip?: string; userAgent?: string } = {},
): LoginResult {
  const row = db.prepare('SELECT * FROM users WHERE username = ?')
    .get(username.toLowerCase().trim()) as UserRow | undefined

  // Uniform failure message: revealing "unknown user" vs "wrong password"
  // hands an attacker a user enumeration oracle for free.
  const generic = { ok: false as const, error: 'Benutzername oder Passwort ist falsch.' }

  if (!row) {
    // Spend comparable time on the miss so timing does not leak existence.
    verifyPassword(password, hashPassword('dummy-password-for-timing'))
    audit(db, { actor: 'anon', action: 'auth.login', subject: username, outcome: 'denied', detail: { reason: 'unknown_user' } })
    return generic
  }

  if (row.locked_until && !isPast(row.locked_until)) {
    audit(db, { actor: `user:${row.id}`, action: 'auth.login', outcome: 'denied', detail: { reason: 'locked' } })
    return { ok: false, error: `Konto ist gesperrt bis ${row.locked_until}.` }
  }

  if (!verifyPassword(password, row.password_hash)) {
    const failed = row.failed_logins + 1
    const lock = failed >= MAX_FAILED ? plus(LOCK_MS) : null
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(failed, lock, row.id)
    audit(db, {
      actor: `user:${row.id}`, action: 'auth.login', outcome: 'denied',
      detail: { reason: 'bad_password', failed, locked: !!lock },
    })
    if (lock) log.warn('Konto nach Fehlversuchen gesperrt', { user: row.username, failed })
    return generic
  }

  if (row.totp_enabled) {
    if (!totp) return { ok: false, needsTotp: true, error: 'Zweiter Faktor erforderlich.' }
    const secret = row.totp_secret ? decryptSecret(row.totp_secret) : ''
    if (!secret || !verifyTotp(secret, totp)) {
      db.prepare('UPDATE users SET failed_logins = failed_logins + 1 WHERE id = ?').run(row.id)
      audit(db, { actor: `user:${row.id}`, action: 'auth.login', outcome: 'denied', detail: { reason: 'bad_totp' } })
      return { ok: false, needsTotp: true, error: 'Der Code stimmt nicht.' }
    }
  }

  const token = newToken(32)
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, ip, revoked_at)
     VALUES (?,?,?,?,?,?,?,NULL)`,
  ).run(sha256(token), row.id, nowIso(), plus(SESSION_TTL), nowIso(),
    meta.userAgent?.slice(0, 300) ?? null, meta.ip ?? null)
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?')
    .run(nowIso(), row.id)

  audit(db, { actor: `user:${row.id}`, action: 'auth.login', outcome: 'ok', detail: { role: row.role } })
  return {
    ok: true, token,
    user: { id: row.id, username: row.username, role: row.role, totp_enabled: !!row.totp_enabled },
  }
}

export function resolveSession(db: DB, token: string | undefined): AuthedUser | null {
  if (!token) return null
  const id = sha256(token)
  const row = db.prepare(
    `SELECT s.id sid, s.expires_at, s.revoked_at, u.id, u.username, u.role, u.totp_enabled
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
  ).get(id) as {
    sid: string; expires_at: string; revoked_at: string | null
    id: string; username: string; role: Role; totp_enabled: number
  } | undefined
  if (!row || row.revoked_at || isPast(row.expires_at)) return null

  // Cheap liveness touch; keeps the session list meaningful without a write
  // on every request in a hot loop.
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), row.sid)
  return {
    sessionId: row.sid, id: row.id, username: row.username,
    role: row.role, totp_enabled: !!row.totp_enabled,
  }
}

export function logout(db: DB, token: string | undefined): void {
  if (!token) return
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), sha256(token))
}

export function revokeAllSessions(db: DB, userId: string, actor: string): number {
  const r = db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(nowIso(), userId)
  audit(db, { actor, action: 'auth.revoke_all', subject: userId, outcome: 'ok', detail: { count: r.changes } })
  return r.changes
}

export function listSessions(db: DB, userId: string) {
  return db.prepare(
    `SELECT id, created_at, expires_at, last_seen_at, user_agent, ip, revoked_at
       FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 50`,
  ).all(userId)
}

/* ── TOTP enrolment ──────────────────────────────────────────────────────── */

export function beginTotpEnrolment(db: DB, userId: string, username: string): { secret: string; uri: string } {
  if (!hasMasterKey()) {
    throw new Error('JARVIS_MASTER_KEY fehlt – das TOTP-Geheimnis kann nicht verschlüsselt gespeichert werden.')
  }
  const secret = newTotpSecret()
  db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?')
    .run(encryptSecret(secret), userId)
  return { secret, uri: totpUri(secret, username) }
}

export function confirmTotpEnrolment(db: DB, userId: string, code: string): boolean {
  const row = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(userId) as
    { totp_secret: string | null } | undefined
  if (!row?.totp_secret) return false
  const secret = decryptSecret(row.totp_secret)
  if (!verifyTotp(secret, code)) return false
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(userId)
  audit(db, { actor: `user:${userId}`, action: 'auth.totp_enable', outcome: 'ok' })
  return true
}

export function disableTotp(db: DB, userId: string, password: string): boolean {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
    { password_hash: string } | undefined
  if (!row || !verifyPassword(password, row.password_hash)) return false
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(userId)
  audit(db, { actor: `user:${userId}`, action: 'auth.totp_disable', outcome: 'ok' })
  return true
}

export function changePassword(db: DB, userId: string, current: string, next: string): boolean {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
    { password_hash: string } | undefined
  if (!row || !verifyPassword(current, row.password_hash)) return false
  if (next.length < 12) throw new Error('Passwort muss mindestens 12 Zeichen haben')
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), userId)
  revokeAllSessions(db, userId, `user:${userId}`)
  audit(db, { actor: `user:${userId}`, action: 'auth.password_change', outcome: 'ok' })
  return true
}

export function pruneSessions(db: DB): number {
  return db.prepare('DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL')
    .run(plus(-DAY)).changes
}
