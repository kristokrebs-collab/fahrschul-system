#!/usr/bin/env node
/**
 * Backup / restore probe (C4 Betrieb): plays an account export back into a FRESH (empty) profile with the app's own import
 * code and compares every record by hash.
 *
 *   node scripts/restoreProbe.mjs                    # the real export code against a Supabase MOCK (what CI runs)
 *   node scripts/restoreProbe.mjs trade-journal-konto-2026-11-07.json   # a REAL export file (Konto → Deine Daten → Exportieren)
 *
 * The logic lives in `tests/unit/restore.probe.test.ts` (it needs the app's TypeScript modules); this script only starts
 * that test with the file path. Exit code 0 = restores completely, 1 = something was lost, changed or invented.
 * It proves the EXPORT restores. It does not prove Supabase's own database backups – see docs/BETRIEB.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2];
const env = { ...process.env };
if (arg) {
  const file = resolve(process.cwd(), arg);
  if (!existsSync(file)) {
    console.error(`Datei nicht gefunden: ${file}`);
    process.exit(2);
  }
  env.RESTORE_PROBE_FILE = file;
} else {
  delete env.RESTORE_PROBE_FILE;
}
const res = spawnSync("npx", ["vitest", "run", "tests/unit/restore.probe.test.ts", "--maxWorkers=1", "--reporter=dot"], { cwd: root, env, stdio: "inherit" });
process.exit(res.status ?? 1);
