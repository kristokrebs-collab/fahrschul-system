/**
 * Sicherung.
 *
 * Verwendet `VACUUM INTO`. Anders als ein Dateikopieren erzeugt das eine
 * konsistente Sicherung auch waehrend laufender Schreibvorgaenge (WAL) und
 * schreibt sie kompakt. Zusaetzlich wird eine Pruefsumme abgelegt, damit eine
 * beschaedigte Sicherung beim Zurueckspielen auffaellt.
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../config/env.js';
import { getDb, migrate, get } from '../db/index.js';
import { log, recordEvent } from '../observability/logger.js';

export interface BackupResult {
  file: string;
  bytes: number;
  checksum: string;
  createdAt: string;
  tables: Record<string, number>;
}

const COUNTED_TABLES = [
  'users', 'brand_facts', 'media_assets', 'content_items', 'approvals',
  'publish_jobs', 'metric_snapshots', 'leads', 'events', 'change_proposals',
];

export function createBackup(): BackupResult {
  migrate();
  if (!existsSync(config.backupDir)) mkdirSync(config.backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(config.backupDir, `autopilot-${stamp}.db`);

  const db = getDb();
  // Checkpoint, damit alles aus dem WAL in der Hauptdatei landet.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

  const bytes = statSync(file).size;
  const checksum = createHash('sha256').update(readFileSync(file)).digest('hex');

  const tables: Record<string, number> = {};
  for (const t of COUNTED_TABLES) {
    tables[t] = Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0);
  }

  const manifest = {
    file: file.split('/').pop(),
    createdAt: new Date().toISOString(),
    bytes,
    checksum,
    tables,
    schemaVersion: Number(get<{ v: number }>('SELECT MAX(version) AS v FROM schema_migrations')?.v ?? 0),
  };
  writeFileSync(`${file}.json`, JSON.stringify(manifest, null, 2), 'utf8');

  recordEvent({
    kind: 'ops.backup_created',
    actor: 'system:backup',
    message: `Sicherung erstellt: ${manifest.file} (${(bytes / 1024).toFixed(0)} kB, Pruefsumme ${checksum.slice(0, 12)}).`,
    detail: { tables },
  });
  log.info('Sicherung erstellt.', { file, bytes });

  return { file, bytes, checksum, createdAt: manifest.createdAt, tables };
}

export function listBackups(): { file: string; bytes: number; createdAt: string }[] {
  if (!existsSync(config.backupDir)) return [];
  return readdirSync(config.backupDir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const full = join(config.backupDir, f);
      return { file: full, bytes: statSync(full).size, createdAt: statSync(full).mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const invokedDirectly = process.argv[1]?.endsWith('backup.js');
if (invokedDirectly) {
  const result = createBackup();
  process.stdout.write(
    `\nSicherung erstellt:\n  Datei: ${result.file}\n  Groesse: ${(result.bytes / 1024).toFixed(0)} kB\n` +
      `  Pruefsumme: ${result.checksum}\n  Datensaetze: ${JSON.stringify(result.tables)}\n`,
  );
  process.stdout.write(
    `\nZurueckspielen mit:\n  npm run restore -- ${resolve(result.file)}\n`,
  );
}
