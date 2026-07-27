/**
 * Import des Higgsfield-Archivs in das Medienarchiv.
 *
 * Die Datei `data/seed/higgsfield-archive.json` ist ein Export der
 * tatsaechlichen Generierungshistorie des Arbeitsbereichs (30 Objekte,
 * 21 Bilder und 9 Videos, cinematischer Markenlook mit Crimson-Akzent).
 *
 * Wichtig: Der Import setzt WEDER Rechte NOCH Einwilligung. Beides bleibt auf
 * UNKNOWN, und die automatische Datenschutz-Vorpruefung laeuft an. Der Inhaber
 * entscheidet im Medienarchiv, was freigegeben wird. Das gilt auch fuer rein
 * synthetisches Material - die Rechtelage an KI-Erzeugnissen ist eine
 * Entscheidung des Betreibers, nicht des Importers.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from '../config/env.js';
import { migrate } from '../db/index.js';
import { ingestAsset, runPrivacyReview } from '../domain/media.js';
import { log } from '../observability/logger.js';

const ARCHIVE_PATH = resolve(PROJECT_ROOT, 'data', 'seed', 'higgsfield-archive.json');

interface ArchiveAsset {
  sourceRef: string;
  kind: 'image' | 'video';
  url: string;
  width?: number | null;
  height?: number | null;
  durationS?: number | null;
  model?: string;
  description: string;
  tags: string[];
}

export function importHiggsfieldArchive(actor = 'system:import'): {
  imported: number;
  skipped: number;
  flagged: number;
  note: string;
} {
  migrate();

  if (!existsSync(ARCHIVE_PATH)) {
    throw new Error(
      `Archivdatei nicht gefunden: ${ARCHIVE_PATH}. ` +
        'Ohne Export kann nichts importiert werden.',
    );
  }

  const payload = JSON.parse(readFileSync(ARCHIVE_PATH, 'utf8')) as {
    note: string;
    assets: ArchiveAsset[];
  };

  let imported = 0;
  let skipped = 0;
  let flagged = 0;

  for (const a of payload.assets) {
    const asset = ingestAsset({
      source: 'higgsfield',
      sourceRef: a.sourceRef,
      kind: a.kind,
      url: a.url,
      width: a.width ?? null,
      height: a.height ?? null,
      durationS: a.durationS ?? null,
      captureLocation: 'Studio (synthetisch erzeugt)',
      tags: a.tags,
      searchText: a.description,
      // Synthetisches Markenmaterial ist technisch sauber, aber es zeigt nicht
      // die echte Fahrschule. Deshalb bewusst nicht als Spitzenqualitaet gewertet.
      qualityScore: 72,
      restrictionNotes:
        'Synthetisch erzeugt (Higgsfield). Zeigt keine realen Fahrzeuge, Personen oder Kennzeichen ' +
        'der Fahrschule. Vor Verwendung entscheiden, ob synthetisches Material fuer den Anlass passt - ' +
        'echtes Material hat laut Auftrag Vorrang.',
      actor,
    });

    if (asset.created_at === asset.updated_at) imported++;
    else skipped++;

    const findings = runPrivacyReview(asset.id, actor);
    if (findings.some((f) => f.blocking)) flagged++;
  }

  const note =
    `${imported} Asset(s) neu aufgenommen, ${skipped} bereits vorhanden. ` +
    `${flagged} Asset(s) haben offene Punkte in der Vorpruefung (mindestens fehlende Rechte-/` +
    'Einwilligungsklaerung) und liegen im Sichtungsbereich. Bis der Inhaber sie freigibt, ' +
    'kann kein Beitrag mit ihnen veroeffentlicht werden.';

  log.info(note);
  return { imported, skipped, flagged, note };
}

const invokedDirectly = process.argv[1]?.endsWith('import-higgsfield.js');
if (invokedDirectly) {
  const result = importHiggsfieldArchive();
  process.stdout.write(`\n${result.note}\n`);
}
