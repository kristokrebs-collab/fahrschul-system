import { fahrlehrer, schueler } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { eq } from "drizzle-orm";

/**
 * Löst den `schueler`-Stammdatensatz zum eingeloggten Benutzer auf. Wird von
 * jeder "own"-Scope-Route benutzt, damit ein Schüler ausschließlich seine
 * eigenen Datensätze sehen/verändern kann (siehe
 * docs/role-permission-matrix.md "own = nur eigene bzw. zugeordnete
 * Datensätze" + Non-Negotiable "Schüler sieht keine Daten anderer
 * Schüler").
 */
export async function getOwnSchuelerId(db: Database, benutzerId: string): Promise<string | null> {
  const rows = await db
    .select({ id: schueler.id })
    .from(schueler)
    .where(eq(schueler.benutzerId, benutzerId))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function getOwnFahrlehrerId(
  db: Database,
  benutzerId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: fahrlehrer.id })
    .from(fahrlehrer)
    .where(eq(fahrlehrer.benutzerId, benutzerId))
    .limit(1);
  return rows[0]?.id ?? null;
}
