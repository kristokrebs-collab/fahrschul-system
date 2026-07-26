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

  /**
   * Feststehendes TOTP-Secret für die Mitarbeiter-Testkonten.
   *
   * Ohne das könnte sich nach dem Seed KEIN Mitarbeiter einloggen: Rollen aus
   * STAFF_ROLES_REQUIRING_MFA erhalten in routes/auth.ts ein hartes
   * 403 mfa_setup_required, solange mfaEnabled/mfaSecret fehlen. Das Secret ist
   * bewusst statisch, damit man es einmal in eine Authenticator-App aufnehmen
   * kann; den aktuellen Code liefert alternativ `pnpm dev:totp`.
   *
   * Unkritisch, weil diese Datei nur lokale Testdaten erzeugt und mit
   * NODE_ENV=production abbricht. Echte Konten bekommen ihr Secret über den
   * regulären MFA-Einrichtungsweg, niemals hierüber.
   */
  const devTotpSecret = "KREBSDEVTOTPSECRETTESTONLYAAAAAA";
  const staffMfa = { mfaEnabled: true, mfaSecret: devTotpSecret } as const;

  const [bueroBenutzer] = await db
    .insert(benutzer)
    .values({
      standortId: standortFulda.id,
      email: "buero@example.test",
      passwordHash: testPasswordHash,
      rolle: "buero",
      ...staffMfa,
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
      ...staffMfa,
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

  // Rolle "finanzen": ohne dieses Konto ist apps/finance nach dem Seed nicht
  // aufrufbar (das Cockpit verlangt finance:*-Rechte, die weder buero noch
  // fahrlehrer besitzen).
  const [finanzenBenutzer] = await db
    .insert(benutzer)
    .values({
      standortId: standortFulda.id,
      email: "finanzen@example.test",
      passwordHash: testPasswordHash,
      rolle: "finanzen",
      ...staffMfa,
      vorname: "Franka",
      nachname: "Kasse",
    })
    .returning();

  // Rolle "geschaeftsfuehrung": sieht die sieben GF-Karten, darf aber bewusst
  // NICHT bank:reconcile/products:manage (siehe docs/role-permission-matrix.md).
  const [gfBenutzer] = await db
    .insert(benutzer)
    .values({
      standortId: standortFulda.id,
      email: "leitung@example.test",
      passwordHash: testPasswordHash,
      rolle: "geschaeftsfuehrung",
      ...staffMfa,
      vorname: "Gerd",
      nachname: "Leitung",
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
    finanzenBenutzer,
    gfBenutzer,
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
