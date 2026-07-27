/** Migrationen anwenden. Idempotent, mit Klartext-Ausgabe. */
import { migrate, all } from '../db/index.js';

const result = migrate();
process.stdout.write(
  `\nMigrationen: ${result.applied.length} neu angewandt, ${result.alreadyApplied.length} bereits vorhanden.\n`,
);
if (result.applied.length > 0) {
  process.stdout.write(`Neu: ${result.applied.join(', ')}\n`);
}
const rows = all<{ version: number; name: string; applied_at: string }>(
  'SELECT version, name, applied_at FROM schema_migrations ORDER BY version',
);
process.stdout.write('\nSchema-Stand:\n');
for (const r of rows) {
  process.stdout.write(`  ${String(r.version).padStart(3)} ${r.name.padEnd(32)} ${r.applied_at}\n`);
}
