import "dotenv/config";
import { runMigrations } from "@fahrschul/database";
import { createRawClient } from "@fahrschul/database";
import { hashPassword } from "@fahrschul/auth";
import { buildApp } from "../app.js";

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL_TEST/DATABASE_URL nicht gesetzt. Für apps/api-Tests wird eine laufende " +
        "Postgres-Instanz benötigt (siehe README: `docker compose up -d`).",
    );
  }
  return url;
}

export async function ensureMigrated(databaseUrl: string) {
  await runMigrations(databaseUrl);
}

export async function truncateAll(databaseUrl: string) {
  const sql = createRawClient(databaseUrl);
  try {
    await sql`truncate table
      audit_events,
      terminbuchungen,
      terminangebote,
      verfuegbarkeiten,
      ausbildungen,
      dokumente,
      zahlungen,
      rechnungen,
      fahrzeuge,
      fahrlehrer,
      schueler,
      sessions,
      benutzer,
      standorte,
      organisationen
      restart identity cascade`;
  } finally {
    await sql.end();
  }
}

export function buildTestApp() {
  return buildApp({ databaseUrl: testDatabaseUrl(), cookieSecure: false, logger: false });
}

export interface SeededFixtures {
  organisationId: string;
  standortId: string;
  fahrlehrerBenutzerId: string;
  fahrlehrerId: string;
  bueroBenutzerId: string;
  schuelerBenutzerId: string;
  schuelerId: string;
  fahrzeugId: string;
  password: string;
}

const TEST_PASSWORD = "Test-Passwort-123!";

export async function seedFixtures(databaseUrl: string): Promise<SeededFixtures> {
  const sql = createRawClient(databaseUrl);
  try {
    const passwordHash = await hashPassword(TEST_PASSWORD);

    const [org] = await sql`insert into organisationen (name) values ('Testorganisation') returning id`;
    const [standort] = await sql`insert into standorte (organisation_id, name) values (${org.id}, 'Fulda') returning id`;

    const [fahrlehrerBenutzer] = await sql`
      insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname)
      values (${standort.id}, 'fahrlehrer@test.local', ${passwordHash}, 'fahrlehrer', 'Max', 'Mustermann')
      returning id`;

    const [bueroBenutzer] = await sql`
      insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname)
      values (${standort.id}, 'buero@test.local', ${passwordHash}, 'buero', 'Büro', 'Test')
      returning id`;

    const [schuelerBenutzer] = await sql`
      insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname)
      values (${standort.id}, 'schueler@test.local', ${passwordHash}, 'schueler', 'Erika', 'Musterfrau')
      returning id`;

    const [fahrlehrerRow] = await sql`
      insert into fahrlehrer (standort_id, benutzer_id, vorname, nachname, klassen)
      values (${standort.id}, ${fahrlehrerBenutzer.id}, 'Max', 'Mustermann', '["B"]'::jsonb)
      returning id`;

    const [schuelerRow] = await sql`
      insert into schueler (standort_id, benutzer_id, vorname, nachname)
      values (${standort.id}, ${schuelerBenutzer.id}, 'Erika', 'Musterfrau')
      returning id`;

    const [fahrzeugRow] = await sql`
      insert into fahrzeuge (standort_id, kennzeichen, klasse, bezeichnung)
      values (${standort.id}, 'FD-KR 1', 'B', 'Testfahrzeug')
      returning id`;

    return {
      organisationId: org.id,
      standortId: standort.id,
      fahrlehrerBenutzerId: fahrlehrerBenutzer.id,
      fahrlehrerId: fahrlehrerRow.id,
      bueroBenutzerId: bueroBenutzer.id,
      schuelerBenutzerId: schuelerBenutzer.id,
      schuelerId: schuelerRow.id,
      fahrzeugId: fahrzeugRow.id,
      password: TEST_PASSWORD,
    };
  } finally {
    await sql.end();
  }
}

export function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!raw) throw new Error("Kein Set-Cookie-Header in der Antwort gefunden");
  return raw.split(";")[0];
}
