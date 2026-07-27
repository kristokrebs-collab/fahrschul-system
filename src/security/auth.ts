/**
 * Authentifizierung und Rollenmodell.
 *
 * Drei Rollen:
 *   owner  - darf alles, insbesondere freigeben und veroeffentlichen lassen
 *   editor - darf vorbereiten, produzieren, ablehnen; darf NICHT freigeben
 *   viewer - darf lesen
 *
 * Sitzungen: 32 Byte Zufall, in der Datenbank nur als SHA-256-Hash. Ein
 * Datenbankleck gibt damit keine gueltigen Sitzungstoken preis.
 */
import { all, get, run, nowIso } from '../db/index.js';
import { newId, hashPassword, verifyPassword, newSessionToken, sha256 } from './crypto.js';
import { recordEvent } from '../observability/logger.js';
import { config } from '../config/env.js';

export type Role = 'owner' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  display_name: string;
  created_at: string;
  last_login_at: string | null;
  disabled_at: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  displayName: string;
}

const SESSION_TTL_HOURS = 12;

export function createUser(input: {
  email: string;
  password: string;
  role: Role;
  displayName: string;
  actor: string;
}): User {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Ungueltige E-Mail-Adresse.');
  }
  const existing = get<User>('SELECT * FROM users WHERE email = ?', email);
  if (existing) throw new Error(`Es existiert bereits ein Konto fuer ${email}.`);

  const id = newId('usr');
  run(
    `INSERT INTO users (id, email, password_hash, role, display_name, created_at)
     VALUES (?,?,?,?,?,?)`,
    id,
    email,
    hashPassword(input.password),
    input.role,
    input.displayName,
    nowIso(),
  );
  recordEvent({
    kind: 'auth.user_created',
    actor: input.actor,
    severity: 'warn',
    entityType: 'user',
    entityId: id,
    message: `Konto angelegt: ${email} mit Rolle ${input.role}.`,
  });
  return get<User>('SELECT * FROM users WHERE id = ?', id)!;
}

/**
 * Legt beim allerersten Start den Inhaber-Zugang an. Danach wirkungslos -
 * die Bootstrap-Variablen koennen kein bestehendes Konto ueberschreiben.
 */
export function bootstrapOwner(): { created: boolean; note: string } {
  const count = get<{ n: number }>('SELECT COUNT(*) AS n FROM users');
  if ((count?.n ?? 0) > 0) {
    return { created: false, note: 'Es existieren bereits Konten - Bootstrap uebersprungen.' };
  }
  if (!config.bootstrapOwnerEmail || !config.bootstrapOwnerPassword) {
    return {
      created: false,
      note:
        'Kein Konto vorhanden und BOOTSTRAP_OWNER_EMAIL/BOOTSTRAP_OWNER_PASSWORD sind nicht gesetzt. ' +
        'Anmeldung ist bis dahin nicht moeglich.',
    };
  }
  createUser({
    email: config.bootstrapOwnerEmail,
    password: config.bootstrapOwnerPassword,
    role: 'owner',
    displayName: 'Inhaber',
    actor: 'system:bootstrap',
  });
  return {
    created: true,
    note: `Inhaber-Konto ${config.bootstrapOwnerEmail} angelegt. Passwort nach dem ersten Login aendern.`,
  };
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  user: SessionUser;
}

export function login(
  email: string,
  password: string,
  meta: { ip?: string; userAgent?: string },
): LoginResult {
  const user = get<User>('SELECT * FROM users WHERE email = ?', email.trim().toLowerCase());

  // Immer eine Verifikation durchfuehren, damit die Antwortzeit nicht
  // verraet, ob das Konto existiert.
  const reference =
    user?.password_hash ??
    'scrypt$32768$8$1$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';
  const ok = verifyPassword(password, reference);

  if (!user || !ok || user.disabled_at) {
    recordEvent({
      kind: 'auth.login_failed',
      actor: `anonymous:${meta.ip ?? 'unbekannt'}`,
      severity: 'warn',
      message: `Fehlgeschlagener Anmeldeversuch fuer ${email}.`,
    });
    throw new Error('E-Mail-Adresse oder Passwort ist falsch.');
  }

  const { token, hash } = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000).toISOString();
  run(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, ip, user_agent)
     VALUES (?,?,?,?,?,?,?)`,
    newId('ses'),
    user.id,
    hash,
    nowIso(),
    expiresAt,
    meta.ip ?? null,
    meta.userAgent?.slice(0, 200) ?? null,
  );
  run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), user.id);
  recordEvent({
    kind: 'auth.login',
    actor: user.email,
    entityType: 'user',
    entityId: user.id,
    message: `Anmeldung erfolgreich (${user.role}).`,
  });

  return {
    token,
    expiresAt,
    user: { id: user.id, email: user.email, role: user.role, displayName: user.display_name },
  };
}

export function resolveSession(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = get<any>(
    `SELECT s.expires_at, s.revoked_at, u.id, u.email, u.role, u.display_name, u.disabled_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
    sha256(token),
  );
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.disabled_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return { id: row.id, email: row.email, role: row.role, displayName: row.display_name };
}

export function logout(token: string | undefined): void {
  if (!token) return;
  run('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', nowIso(), sha256(token));
}

export function purgeExpiredSessions(): number {
  return run('DELETE FROM sessions WHERE expires_at < ?', nowIso()).changes;
}

const ROLE_RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export function hasRole(user: SessionUser | null, minimum: Role): boolean {
  if (!user) return false;
  return ROLE_RANK[user.role] >= ROLE_RANK[minimum];
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function requireRole(user: SessionUser | null, minimum: Role): SessionUser {
  if (!user) throw new AuthError('Nicht angemeldet.', 401);
  if (!hasRole(user, minimum)) {
    throw new AuthError(
      `Diese Aktion erfordert mindestens die Rolle "${minimum}". Ihre Rolle ist "${user.role}".`,
      403,
    );
  }
  return user;
}

export function listUsers() {
  return all(
    'SELECT id, email, role, display_name, created_at, last_login_at, disabled_at FROM users ORDER BY created_at',
  );
}

export function changePassword(userId: string, newPassword: string, actor: string): void {
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(newPassword), userId);
  // Alle bestehenden Sitzungen beenden - ein Passwortwechsel soll wirken.
  run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), userId);
  recordEvent({
    kind: 'auth.password_changed',
    actor,
    severity: 'warn',
    entityType: 'user',
    entityId: userId,
    message: 'Passwort geaendert, alle Sitzungen beendet.',
  });
}
