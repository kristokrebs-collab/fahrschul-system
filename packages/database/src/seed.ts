import "dotenv/config";
import { hashPassword } from "@fahrschul/auth";
import { createDatabase } from "./client.js";
import { organisationen, standorte, benutzer, fahrlehrer, schueler, fahrzeuge } from "./schema/index.js";

/**
 * ============================================================
 *  NUR FÜR LOKALE ENTWICKLUNG / TESTS. NIEMALS IN PRODUKTION AUSFÜHREN.
 *  Erzeugt Beispiel-Stammdaten (Organisation, Standort, Testkonten je
 *  Rolle, ein paar Fahrzeuge/Fahrlehrer) für manuelle Tests und die
 *  Vitest-Suite von apps/api. Ersetzt NICHT die produktive
 *  Stammdatenpflege (die läuft ausschließlich über apps/office UI + API).
 * ============================================================
 */

export async function seed(databaseUrl: string) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed.ts darf nicht mit NODE_ENV=production ausgeführt werden.");
  }
  const db = createDatabase(databaseUrl);

  const [org] = await db
    .insert(organisationen)
    .values({ name: "Fahrschule Krebs (Testdaten)" })
    .returning();

  const [standortFulda] = await db
    .insert(standorte)
    .values({ organisationId: org.id, name: "Fulda", adresse: "Teststraße 1, 36037 Fulda" })
    .returning();

  const testPasswordHash = await hashPassword("Test-Passwort-123!");

  const [bueroBenutzer] = await db
    .insert(benutzer)
    .values({
      standortId: standortFulda.id,
      email: "buero@example.test",
      passwordHash: testPasswordHash,
      rolle: "buero",
      vorname: "Büro",
      nachname: "Test",
    })
    .returning();

  const [fahrlehrerBenutzer] = await db
    .insert(benutzer)
    .values({
      standortId: standortFulda.id,
      email: "fahrlehrer@example.test",
      passwordHash: testPasswordHash,
      rolle: "fahrlehrer",
      vorname: "Max",
      nachname: "Mustermann",
    })
    .returning();

  const [schuelerBenutzer] = await db
    .insert(benutzer)
    .values({
      standortId: standortFulda.id,
      email: "schueler@example.test",
      passwordHash: testPasswordHash,
      rolle: "schueler",
      vorname: "Erika",
      nachname: "Musterfrau",
    })
    .returning();

  const [testFahrlehrer] = await db
    .insert(fahrlehrer)
    .values({
      standortId: standortFulda.id,
      benutzerId: fahrlehrerBenutzer.id,
      vorname: "Max",
      nachname: "Mustermann",
      klassen: ["B", "BE"],
    })
    .returning();

  const [testSchueler] = await db
    .insert(schueler)
    .values({
      standortId: standortFulda.id,
      benutzerId: schuelerBenutzer.id,
      vorname: "Erika",
      nachname: "Musterfrau",
      email: "schueler@example.test",
    })
    .returning();

  const [testFahrzeug] = await db
    .insert(fahrzeuge)
    .values({
      standortId: standortFulda.id,
      kennzeichen: "FD-KR 123",
      klasse: "B",
      bezeichnung: "Testfahrzeug B",
    })
    .returning();

  return {
    org,
    standortFulda,
    bueroBenutzer,
    fahrlehrerBenutzer,
    schuelerBenutzer,
    testFahrlehrer,
    testSchueler,
    testFahrzeug,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL ist nicht gesetzt (siehe .env.example)");
  }
  seed(databaseUrl)
    .then(() => {
      console.log("Seed abgeschlossen (nur lokale Testdaten).");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
