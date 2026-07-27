/**
 * Persistenzschicht auf Basis von node:sqlite (in Node 22 im Kern enthalten,
 * daher keine native Kompilierung und kein zusaetzliches Angriffsziel).
 *
 * Betriebsrelevante Einstellungen:
 *  - WAL: gleichzeitiges Lesen waehrend Schreibvorgaengen (Worker + Web).
 *  - foreign_keys: ON, sonst waeren die Referenzen dekorativ.
 *  - busy_timeout: 5s, damit parallele Worker nicht sofort scheitern.
 *  - synchronous=FULL: kein Datenverlust bei hartem Prozessabbruch.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../config/env.js';
import { MIGRATIONS } from './migrations.js';

export type Row = Record<string, any>;

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const dir = dirname(config.databasePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new DatabaseSync(config.databasePath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = FULL');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql.trim()).digest('hex').slice(0, 16);
}

export interface MigrationResult {
  applied: number[];
  alreadyApplied: number[];
}

/**
 * Wendet ausstehende Migrationen an. Idempotent.
 * Eine bereits angewandte Migration mit abweichender Pruefsumme ist ein
 * harter Fehler - sonst laufen Umgebungen unbemerkt auseinander.
 */
export function migrate(): MigrationResult {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const existing = new Map<number, { name: string; checksum: string }>();
  for (const row of d.prepare('SELECT version, name, checksum FROM schema_migrations').all() as Row[]) {
    existing.set(Number(row.version), { name: row.name, checksum: row.checksum });
  }

  const applied: number[] = [];
  const alreadyApplied: number[] = [];

  for (const m of MIGRATIONS) {
    const sum = checksum(m.sql);
    const prev = existing.get(m.version);
    if (prev) {
      if (prev.checksum !== sum) {
        throw new Error(
          `Migration ${m.version} (${m.name}) wurde nachtraeglich veraendert. ` +
            `Erwartet ${prev.checksum}, gefunden ${sum}. ` +
            `Migrationen sind unveraenderlich - bitte eine neue Migration anlegen.`,
        );
      }
      alreadyApplied.push(m.version);
      continue;
    }
    d.exec('BEGIN');
    try {
      d.exec(m.sql);
      d.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?,?,?,?)',
      ).run(m.version, m.name, sum, new Date().toISOString());
      d.exec('COMMIT');
      applied.push(m.version);
    } catch (err) {
      d.exec('ROLLBACK');
      throw new Error(
        `Migration ${m.version} (${m.name}) fehlgeschlagen: ${(err as Error).message}`,
      );
    }
  }
  return { applied, alreadyApplied };
}

/** Fuehrt fn in einer Transaktion aus. Verschachtelung via SAVEPOINT. */
let txDepth = 0;
export function tx<T>(fn: () => T): T {
  const d = getDb();
  if (txDepth === 0) {
    d.exec('BEGIN IMMEDIATE');
  } else {
    d.exec(`SAVEPOINT sp_${txDepth}`);
  }
  txDepth++;
  try {
    const result = fn();
    txDepth--;
    if (txDepth === 0) d.exec('COMMIT');
    else d.exec(`RELEASE sp_${txDepth}`);
    return result;
  } catch (err) {
    txDepth--;
    if (txDepth === 0) d.exec('ROLLBACK');
    else d.exec(`ROLLBACK TO sp_${txDepth}`);
    throw err;
  }
}

// --- Kleine Query-Helfer ----------------------------------------------------

export function all<T = Row>(sql: string, ...params: any[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function get<T = Row>(sql: string, ...params: any[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: any[]): { changes: number; lastInsertRowid: number } {
  const r = getDb().prepare(sql).run(...params);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** JSON-Spalten sicher lesen: defektes JSON darf nie den Request killen. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
