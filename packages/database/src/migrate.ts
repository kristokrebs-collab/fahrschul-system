import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

/**
 * Einfacher, deterministischer Migrationsläufer für die handgeschriebenen
 * numerierten SQL-Dateien unter migrations/. Jede Datei läuft genau einmal,
 * in einer eigenen Transaktion, und wird in schema_migrations protokolliert.
 */

/**
 * PROMPT -1 §14/§15 (Phase 4) – Erkennung ZERSTÖRENDER Migrationsschritte.
 *
 * §15 verlangt wörtlich: "keine zerstörende Migration ohne Backup und
 * Freigabe". Bis Phase 3 war das eine Absichtserklärung in einem Dokument –
 * `runMigrations` hätte ein `drop column` anstandslos ausgeführt. Jetzt ist es
 * ein **Tor im Läufer selbst**, und zwar aus einem konkreten Anlass: die
 * CONTRACT-Phase der Alt-Statusspalten (§10) ist bewusst noch nicht gelaufen
 * und wird genau so eine Migration sein.
 *
 * Erkannt werden nur die Anweisungen, die Daten oder Lesbarkeit tatsächlich
 * VERLIEREN können. Ausdrücklich NICHT erkannt: `drop trigger`/`drop function`
 * mit anschließendem `create` (der Standardweg, eine Triggerdefinition zu
 * ersetzen – 0007 bis 0009 tun das mehrfach) und `drop ... if exists` auf
 * einem Index, weil ein Index keine Daten trägt.
 *
 * `set not null` ist dabei, obwohl es keine Spalte entfernt: es kann eine
 * Migration mitten im Lauf scheitern lassen, wenn Bestandsdaten NULL
 * enthalten, und es bricht die Rückwärtskompatibilität für einen alten
 * Schreiber, der die Spalte nicht kennt. Das ist genau der Fall, für den
 * expand-contract existiert.
 */
export const DESTRUCTIVE_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "drop table", re: /\bdrop\s+table\b/i },
  { name: "drop column", re: /\bdrop\s+column\b/i },
  { name: "drop schema", re: /\bdrop\s+schema\b/i },
  { name: "drop database", re: /\bdrop\s+database\b/i },
  { name: "rename column", re: /\brename\s+column\b/i },
  { name: "rename table", re: /\balter\s+table\s+\S+\s+rename\s+to\b/i },
  { name: "alter column type", re: /\balter\s+column\s+\S+\s+(?:set\s+data\s+)?type\b/i },
  { name: "set not null", re: /\balter\s+column\s+\S+\s+set\s+not\s+null\b/i },
  { name: "truncate", re: /\btruncate\b/i },
];

/** Entfernt Kommentare, damit ein Muster in einem Kommentar kein Befund ist. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

export function findDestructiveStatements(sql: string): string[] {
  const code = stripSqlComments(sql);
  return DESTRUCTIVE_PATTERNS.filter((p) => p.re.test(code)).map((p) => p.name);
}

export interface MigrationGate {
  /** Freigabe eines Menschen (`MIGRATION_APPROVED_BY`). */
  approvedBy?: string | null;
  /**
   * Nachweis eines Backups (`MIGRATION_BACKUP_REF`) – die `label`-Spalte eines
   * Eintrags in `backup_runs`. Wird gegen die Tabelle GEPRÜFT, nicht geglaubt.
   */
  backupRef?: string | null;
}

export class DestructiveMigrationBlocked extends Error {
  readonly file: string;
  readonly statements: string[];
  readonly reason: "no_approval" | "no_backup_ref" | "backup_not_found" | "backup_not_verified";
  constructor(
    file: string,
    statements: string[],
    reason: DestructiveMigrationBlocked["reason"],
    message: string,
  ) {
    super(message);
    this.file = file;
    this.statements = statements;
    this.reason = reason;
  }
}

function gateFromEnv(): MigrationGate {
  return {
    approvedBy: process.env.MIGRATION_APPROVED_BY?.trim() || null,
    backupRef: process.env.MIGRATION_BACKUP_REF?.trim() || null,
  };
}

/**
 * Prüft das Tor für eine zerstörende Migration. Wirft, wenn Freigabe oder
 * Backup fehlen. Die Prüfung des Backups geht in die Datenbank: eine
 * Umgebungsvariable, die irgendetwas behauptet, ist kein Nachweis – es muss
 * einen `backup_runs`-Eintrag mit diesem Label geben, der `verified` ist.
 */
export async function assertDestructiveAllowed(
  sql: postgres.Sql,
  file: string,
  statements: string[],
  gate: MigrationGate,
): Promise<void> {
  if (!gate.approvedBy) {
    throw new DestructiveMigrationBlocked(
      file,
      statements,
      "no_approval",
      `Migration "${file}" enthält zerstörende Anweisungen (${statements.join(", ")}). ` +
        `Erforderlich: MIGRATION_APPROVED_BY=<Name der freigebenden Person>. ` +
        `Siehe docs/recovery-runbook.md, Abschnitt "Zerstörende Migration".`,
    );
  }
  if (!gate.backupRef) {
    throw new DestructiveMigrationBlocked(
      file,
      statements,
      "no_backup_ref",
      `Migration "${file}" enthält zerstörende Anweisungen (${statements.join(", ")}). ` +
        `Erforderlich: MIGRATION_BACKUP_REF=<label eines verifizierten Eintrags in backup_runs>. ` +
        `Backup erzeugen mit scripts/backup.sh.`,
    );
  }
  let rows: Array<{ verified_at: Date | null; kind: string }>;
  try {
    rows = await sql<Array<{ verified_at: Date | null; kind: string }>>`
      select verified_at, kind from backup_runs where label = ${gate.backupRef} limit 1`;
  } catch {
    // `backup_runs` kommt selbst erst mit Migration 0010. Fehlt die Tabelle,
    // kann kein Nachweis existieren – das ist ein BLOCK, kein Durchlasser
    // (fail closed).
    throw new DestructiveMigrationBlocked(
      file,
      statements,
      "backup_not_found",
      `Tabelle backup_runs ist nicht vorhanden (Migration 0010 fehlt), ein Backupnachweis ist ` +
        `damit nicht prüfbar. Zerstörende Migration "${file}" wird nicht ausgeführt.`,
    );
  }
  if (rows.length === 0) {
    throw new DestructiveMigrationBlocked(
      file,
      statements,
      "backup_not_found",
      `MIGRATION_BACKUP_REF="${gate.backupRef}" hat keinen Eintrag in backup_runs. ` +
        `Ein behauptetes Backup ist kein Backup.`,
    );
  }
  if (!rows[0].verified_at) {
    throw new DestructiveMigrationBlocked(
      file,
      statements,
      "backup_not_verified",
      `Backup "${gate.backupRef}" existiert, ist aber NICHT verifiziert ` +
        `(backup_runs.verified_at ist leer). Wiederherstellungstest ausführen: ` +
        `scripts/restore-verify.sh.`,
    );
  }
}

async function ensureMigrationsTable(sql: postgres.Sql): Promise<void> {
  await sql`create table if not exists schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  )`;
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * §15: Welche Migrationen fehlen dieser Datenbank noch? Grundlage der
 * Bereitschaftsprüfung (`GET /health/ready`) – eine Instanz, deren Schema
 * nicht zu ihrem Artefakt passt, darf keinen Verkehr bekommen.
 */
export async function pendingMigrations(databaseUrl: string): Promise<string[]> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await ensureMigrationsTable(sql);
    const applied = await sql<Array<{ filename: string }>>`select filename from schema_migrations`;
    const bekannt = new Set(applied.map((r) => r.filename));
    return migrationFiles().filter((f) => !bekannt.has(f));
  } finally {
    await sql.end();
  }
}

export interface RunMigrationsOptions {
  /**
   * Freigabe + Backupnachweis für zerstörende Schritte. Standard: aus der
   * Umgebung. Wird nur gelesen, WENN eine ausstehende Migration zerstörend ist.
   */
  gate?: MigrationGate;
}

export async function runMigrations(
  databaseUrl: string,
  options: RunMigrationsOptions = {},
): Promise<string[]> {
  const sql = postgres(databaseUrl, { max: 1 });
  const applied: string[] = [];
  try {
    await ensureMigrationsTable(sql);

    const files = migrationFiles();

    for (const file of files) {
      const already = await sql`select 1 from schema_migrations where filename = ${file}`;
      if (already.length > 0) {
        continue;
      }
      const content = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");

      // §15-Tor: VOR der Ausführung, nicht danach.
      const destructive = findDestructiveStatements(content);
      if (destructive.length > 0) {
        await assertDestructiveAllowed(sql, file, destructive, options.gate ?? gateFromEnv());
      }

      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`insert into schema_migrations (filename) values (${file})`;
      });
      applied.push(file);
    }
    return applied;
  } finally {
    await sql.end();
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL ist nicht gesetzt (siehe .env.example)");
  }
  const applied = await runMigrations(databaseUrl);
  if (applied.length === 0) {
    console.log("Keine neuen Migrationen. Schema ist aktuell.");
  } else {
    console.log(`Angewendete Migrationen: ${applied.join(", ")}`);
  }
}

// Nur ausführen, wenn direkt aufgerufen (nicht beim Import in Tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
