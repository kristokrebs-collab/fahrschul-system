import "dotenv/config";
import { runMigrations } from "@fahrschul/database";
import { createRawClient } from "@fahrschul/database";
import { generateTotpSecret, hashPassword } from "@fahrschul/auth";
import { authenticator } from "otplib";
import type { FastifyInstance } from "fastify";
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
      storno_angebote,
      storno_events,
      pruefungen,
      nachrichten,
      nachrichten_vorlagen,
      leads,
      arbeitszeitregeln,
      fahrzeugmaengel,
      flex_opt_ins,
      flex_angebote,
      pruefungsfreigaben,
      fahrstunden_feedback,
      lernfortschritte,
      lernressourcen,
      feature_flags,
      schueler_verfuegbarkeiten,
      terminbuchungen,
      terminangebote,
      verfuegbarkeiten,
      ausbildungen,
      rechnungspositionen,
      dokumente,
      zahlungen,
      rechnungen,
      fahrzeuge,
      raeume,
      simulatorgeraete,
      fahrlehrer,
      schueler,
      sessions,
      benutzer,
      standorte,
      organisationen
      restart identity cascade`;
    await sql`insert into feature_flags (key, state, standort_id) values ('krebs_flex', 'hidden', null)`;
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
  ausbildungId: string;
  fahrzeugId: string;
  password: string;
  // Zweiter Schüler für "sieht keine fremden Daten"-Tests.
  schueler2BenutzerId: string;
  schueler2Id: string;
  bueroTotpSecret: string;
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

    // MFA bleibt hier bewusst NICHT abgeschlossen (siehe auth.test.ts
    // "rejects staff (buero) login without completed MFA setup" – das ist
    // der Default-Zustand für neue Mitarbeitendenkonten). Tests, die eine
    // eingeloggte Büro-Session brauchen, rufen enableBueroMfa(...) auf.
    const bueroTotpSecret = generateTotpSecret();
    const [bueroBenutzer] = await sql`
      insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname)
      values (${standort.id}, 'buero@test.local', ${passwordHash}, 'buero', 'Büro', 'Test')
      returning id`;

    const [schuelerBenutzer] = await sql`
      insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname)
      values (${standort.id}, 'schueler@test.local', ${passwordHash}, 'schueler', 'Erika', 'Musterfrau')
      returning id`;

    const [schueler2Benutzer] = await sql`
      insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname)
      values (${standort.id}, 'schueler2@test.local', ${passwordHash}, 'schueler', 'Zweite', 'Schuelerin')
      returning id`;

    const [fahrlehrerRow] = await sql`
      insert into fahrlehrer (standort_id, benutzer_id, vorname, nachname, klassen)
      values (${standort.id}, ${fahrlehrerBenutzer.id}, 'Max', 'Mustermann', '["B"]'::jsonb)
      returning id`;

    const [schuelerRow] = await sql`
      insert into schueler (standort_id, benutzer_id, vorname, nachname)
      values (${standort.id}, ${schuelerBenutzer.id}, 'Erika', 'Musterfrau')
      returning id`;

    const [schueler2Row] = await sql`
      insert into schueler (standort_id, benutzer_id, vorname, nachname)
      values (${standort.id}, ${schueler2Benutzer.id}, 'Zweite', 'Schuelerin')
      returning id`;

    const [ausbildungRow] = await sql`
      insert into ausbildungen (standort_id, schueler_id, klasse)
      values (${standort.id}, ${schuelerRow.id}, 'B')
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
      ausbildungId: ausbildungRow.id,
      fahrzeugId: fahrzeugRow.id,
      password: TEST_PASSWORD,
      schueler2BenutzerId: schueler2Benutzer.id,
      schueler2Id: schueler2Row.id,
      bueroTotpSecret,
    };
  } finally {
    await sql.end();
  }
}

/** Aktiviert MFA für einen bereits geseedeten Mitarbeitenden-Account (Testzweck). */
export async function enableMfa(databaseUrl: string, benutzerId: string, secret: string) {
  const sql = createRawClient(databaseUrl);
  try {
    await sql`update benutzer set mfa_enabled = true, mfa_secret = ${secret} where id = ${benutzerId}`;
  } finally {
    await sql.end();
  }
}

export async function loginAs(
  app: FastifyInstance,
  email: string,
  password: string,
  totpSecret?: string,
): Promise<string> {
  const payload: Record<string, string> = { email, password };
  if (totpSecret) {
    payload.totpToken = authenticator.generate(totpSecret);
  }
  const res = await app.inject({ method: "POST", url: "/auth/login", payload });
  if (res.statusCode !== 200) {
    throw new Error(`loginAs(${email}) failed: ${res.statusCode} ${res.body}`);
  }
  return extractCookie(res.headers["set-cookie"]);
}

/**
 * Baut einen rohen multipart/form-data-Body für Tests von POST /documents,
 * ohne eine zusätzliche Bibliothek zu benötigen (Fastify inject nimmt einen
 * Buffer + passenden Content-Type-Header).
 */
export function buildMultipartBody(params: {
  fields: Record<string, string>;
  fileFieldName: string;
  fileName: string;
  fileContent: Buffer;
  mimeType: string;
}): { body: Buffer; contentType: string } {
  const boundary = `----testboundary${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(params.fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${params.fileFieldName}"; filename="${params.fileName}"\r\nContent-Type: ${params.mimeType}\r\n\r\n`,
    ),
  );
  parts.push(params.fileContent);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

export function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!raw) throw new Error("Kein Set-Cookie-Header in der Antwort gefunden");
  return raw.split(";")[0];
}
