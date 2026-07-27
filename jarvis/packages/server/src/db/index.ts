import Database from 'better-sqlite3'
import { readFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config.js'
import { nowIso } from '../util/time.js'

export type DB = Database.Database

const here = dirname(fileURLToPath(import.meta.url))

/** Resolve schema.sql whether we're running from src (tsx) or dist (tsup). */
function schemaPath(): string {
  const candidates = [
    join(here, 'schema.sql'),                       // src/db (tsx)
    join(here, 'db', 'schema.sql'),                 // dist (copied by tsup)
    join(here, '..', 'db', 'schema.sql'),
    join(here, '..', 'src', 'db', 'schema.sql'),    // dist → src fallback
  ]
  for (const p of candidates) if (existsSync(p)) return p
  throw new Error(`schema.sql nicht gefunden. Gesucht in:\n  ${candidates.join('\n  ')}`)
}

let singleton: DB | null = null

export function openDb(path = config.dbPath): DB {
  const db = new Database(path)
  // WAL gives us concurrent readers alongside the writer, and survives crashes.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.function('regexp', (pattern: unknown, value: unknown) => {
    if (typeof pattern !== 'string' || typeof value !== 'string') return 0
    try { return new RegExp(pattern, 'i').test(value) ? 1 : 0 } catch { return 0 }
  })
  return db
}

export function migrate(db: DB): void {
  const sql = readFileSync(schemaPath(), 'utf8')
  db.exec(sql)
  const name = 'schema.sql@1'
  const done = db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(name)
  if (!done) {
    db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(name, nowIso())
  }
}

export function getDb(): DB {
  if (!singleton) {
    singleton = openDb()
    migrate(singleton)
  }
  return singleton
}

export function closeDb(): void {
  if (singleton) { singleton.close(); singleton = null }
}

/** In-memory DB for tests: same schema, no file, no cleanup. */
export function testDb(): DB {
  const db = openDb(':memory:')
  migrate(db)
  return db
}

/* ── Small typed helpers ─────────────────────────────────────────────────── */

export function one<T = Record<string, unknown>>(db: DB, sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}

export function all<T = Record<string, unknown>>(db: DB, sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params) as T[]
}

export function run(db: DB, sql: string, ...params: unknown[]): Database.RunResult {
  return db.prepare(sql).run(...params)
}

export function jsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

/* ── Backup / restore ────────────────────────────────────────────────────── */

/**
 * `VACUUM INTO` produces a consistent, fully-checkpointed single-file snapshot
 * even while the server is serving traffic — no WAL sidecar to keep with it.
 */
export function backupTo(db: DB, target: string): { path: string; bytes: number } {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  const bytes = existsSync(target) ? Number(readFileSync(target).byteLength) : 0
  return { path: target, bytes }
}

export function makeBackup(db: DB): { path: string; bytes: number } {
  const stamp = nowIso().replace(/[:.]/g, '-')
  return backupTo(db, join(config.backupDir, `jarvis-${stamp}.db`))
}

/**
 * Restore is deliberately offline-only: the caller must stop the server first.
 * We verify the candidate opens and carries our schema before swapping it in.
 */
export function restoreFrom(backupPath: string, targetPath = config.dbPath): void {
  if (!existsSync(backupPath)) throw new Error(`Backup nicht gefunden: ${backupPath}`)
  const probe = openDb(backupPath)
  try {
    const t = probe.prepare(
      "SELECT count(*) n FROM sqlite_master WHERE type='table' AND name IN ('sources','memories','audit_log')",
    ).get() as { n: number }
    if (t.n < 3) throw new Error('Backup enthält kein JARVIS-Schema')
    const integrity = probe.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new Error(`Backup beschädigt: ${String(integrity)}`)
  } finally { probe.close() }
  closeDb()
  copyFileSync(backupPath, targetPath)
  for (const sfx of ['-wal', '-shm']) {
    const f = targetPath + sfx
    if (existsSync(f)) { try { unlinkSync(f) } catch { /* stale sidecar; harmless */ } }
  }
}
