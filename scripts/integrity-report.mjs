/**
 * PROMPT -1 §14 (Phase 4) – Integritätsbericht für zwei Datenbanken.
 *
 * Wird von `scripts/restore-verify.sh` aufgerufen und gibt EIN JSON-Objekt auf
 * stdout aus: den Bericht der Quelle, den der wiederhergestellten Zieldatenbank
 * und den Zeilenvergleich.
 *
 * Eigene Datei und nicht `tsx -e '…'`: `tsx -e` kompiliert nach CJS und
 * verträgt kein `await` auf oberster Ebene.
 *
 *   QUELLE_URL=… ZIEL_URL=… npx tsx scripts/integrity-report.mjs
 */
import { checkDatabaseIntegrity, compareRowCounts } from "../packages/database/src/integrity.ts";

const quelleUrl = process.env.QUELLE_URL;
const zielUrl = process.env.ZIEL_URL;
if (!quelleUrl || !zielUrl) {
  process.stderr.write("QUELLE_URL und ZIEL_URL sind erforderlich.\n");
  process.exit(2);
}

/**
 * Tabellen, die in der QUELLE weiterwachsen dürfen, während gesichert und
 * geprüft wird. Ohne diese Toleranz wäre ein Vergleich gegen eine LEBENDE
 * Quelle grundsätzlich rot und damit wertlos.
 *
 * Ausdrücklich NICHT toleriert: die fachlichen Kerntabellen (Termine, Schüler,
 * Rechnungen, Zahlungen, Dokumente). Eine Abweichung dort ist ein echter
 * Befund – dort darf zwischen Sicherung und Prüfung nichts „von selbst"
 * entstehen.
 */
const WACHSENDE_TABELLEN = ["sessions", "audit_events", "event_outbox", "jobs", "idempotency_keys"];

const quelle = await checkDatabaseIntegrity(quelleUrl);
const ziel = await checkDatabaseIntegrity(zielUrl);
const vergleich = compareRowCounts(quelle, ziel, WACHSENDE_TABELLEN);

process.stdout.write(
  `${JSON.stringify({ toleranz: WACHSENDE_TABELLEN, quelle, ziel, vergleich }, null, 2)}\n`,
);
process.exit(0);
