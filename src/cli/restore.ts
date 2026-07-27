/**
 * Wiederherstellung aus einer Sicherung.
 *
 * Schritte, in dieser Reihenfolge:
 *   1. Pruefsumme der Sicherung gegen das Manifest pruefen. Stimmt sie nicht,
 *      wird abgebrochen - eine beschaedigte Sicherung einzuspielen ist
 *      schlimmer als gar keine.
 *   2. Die aktuelle Datenbank vorher als `.pre-restore` sichern.
 *   3. Ersetzen und Integritaet der wiederhergestellten Datei pruefen.
 */
import { existsSync, readFileSync, copyFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config/env.js';
import { closeDb } from '../db/index.js';
import { log } from '../observability/logger.js';

export interface RestoreResult {
  restoredFrom: string;
  preRestoreBackup: string | null;
  integrity: string;
  tables: Record<string, number>;
}

export function restoreBackup(backupFile: string): RestoreResult {
  const file = resolve(backupFile);
  if (!existsSync(file)) throw new Error(`Sicherungsdatei nicht gefunden: ${file}`);

  // --- 1. Pruefsumme -------------------------------------------------
  const manifestPath = `${file}.json`;
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (manifest.checksum && manifest.checksum !== actual) {
      throw new Error(
        `Pruefsumme stimmt nicht. Erwartet ${manifest.checksum}, gefunden ${actual}. ` +
          'Die Sicherung ist beschaedigt und wird NICHT eingespielt.',
      );
    }
    log.info('Pruefsumme der Sicherung bestaetigt.', { checksum: actual });
  } else {
    log.warn('Kein Manifest zur Sicherung gefunden - Pruefsumme kann nicht geprueft werden.');
  }

  // --- 2. Aktuellen Stand sichern -------------------------------------
  closeDb();
  let preRestore: string | null = null;
  if (existsSync(config.databasePath)) {
    preRestore = `${config.databasePath}.pre-restore-${Date.now()}`;
    copyFileSync(config.databasePath, preRestore);
    log.info('Aktueller Stand vor der Wiederherstellung gesichert.', { file: preRestore });
  }
  // WAL-Reste entfernen, sonst mischt SQLite alt und neu.
  for (const suffix of ['-wal', '-shm']) {
    const p = `${config.databasePath}${suffix}`;
    if (existsSync(p)) unlinkSync(p);
  }

  // --- 3. Einspielen und pruefen --------------------------------------
  const temp = `${config.databasePath}.incoming`;
  copyFileSync(file, temp);
  renameSync(temp, config.databasePath);

  const db = new DatabaseSync(config.databasePath);
  const integrity = (db.prepare('PRAGMA integrity_check').get() as any)?.integrity_check ?? 'unbekannt';
  if (integrity !== 'ok') {
    db.close();
    throw new Error(
      `Integritaetspruefung der wiederhergestellten Datenbank fehlgeschlagen: ${integrity}. ` +
        (preRestore ? `Vorheriger Stand liegt unter ${preRestore}.` : ''),
    );
  }

  const tables: Record<string, number> = {};
  for (const t of ['users', 'media_assets', 'content_items', 'approvals', 'publish_jobs', 'events']) {
    try {
      tables[t] = Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n);
    } catch {
      tables[t] = -1;
    }
  }
  db.close();

  log.info('Wiederherstellung abgeschlossen.', { integrity, tables });
  return { restoredFrom: file, preRestoreBackup: preRestore, integrity, tables };
}

const invokedDirectly = process.argv[1]?.endsWith('restore.js');
if (invokedDirectly) {
  const target = process.argv[2];
  if (!target) {
    process.stderr.write('Aufruf: npm run restore -- <pfad-zur-sicherung.db>\n');
    process.exit(1);
  }
  const result = restoreBackup(target);
  process.stdout.write(
    `\nWiederherstellung abgeschlossen.\n  Quelle: ${result.restoredFrom}\n` +
      `  Integritaet: ${result.integrity}\n  Datensaetze: ${JSON.stringify(result.tables)}\n` +
      (result.preRestoreBackup ? `  Vorheriger Stand: ${result.preRestoreBackup}\n` : ''),
  );
}
