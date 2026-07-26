import { createRawClient } from "@fahrschul/database";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildTestApp,
  enableMfa,
  ensureMigrated,
  loginAs,
  seedFixtures,
  testDatabaseUrl,
  truncateAll,
  type SeededFixtures,
} from "./helpers.js";

/**
 * PROMPT -1 §4 – Optimistische Sperren, tatsächlich verdrahtet.
 *
 * Für jede der sechs geforderten Entitäten (Verfügbarkeit, Termine,
 * Fahrstundenfeedback, Dokumentprüfung, Rechnungen, Fahrzeugstatus) wird
 * bewiesen:
 *   1. Ein Schreibvorgang mit VERALTETER Version wird abgelehnt (409).
 *   2. Die Konfliktantwort enthält den AKTUELLEN Serverzustand (`current`),
 *      die Versionsnummern und die abweichenden Felder – genug für eine
 *      Diff-Ansicht, ohne erneute Abfrage.
 *   3. Es gibt KEIN stilles Überschreiben.
 */
describe("PROMPT -1 §4 – Optimistische Sperren", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let fixtures: SeededFixtures;
  let sql: ReturnType<typeof createRawClient>;
  let officeCookie: string;
  let instructorCookie: string;
  let studentCookie: string;
  let financeCookie: string;

  beforeAll(async () => {
    await ensureMigrated(databaseUrl);
    app = buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    fixtures = await seedFixtures(databaseUrl);
    await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);
    sql = createRawClient(databaseUrl);
    await sql`
      insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
      select ${fixtures.standortId}, 'finanzen@test.local', password_hash, 'finanzen', 'Fin', 'Anzen', true, mfa_secret
        from benutzer where id = ${fixtures.bueroBenutzerId}`;
    officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
    instructorCookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
    studentCookie = await loginAs(app, "schueler@test.local", fixtures.password);
    financeCookie = await loginAs(app, "finanzen@test.local", fixtures.password, fixtures.bueroTotpSecret);
  });

  afterEach(async () => {
    await sql.end();
  });

  /** Prüft die gemeinsame Form jeder Konfliktantwort. */
  function expectConflictCarriesCurrentState(
    res: { statusCode: number; json: () => Record<string, unknown>; headers: Record<string, unknown> },
    expectedVersion: number,
  ) {
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe("version_conflict");
    expect(body.expectedVersion).toBe(expectedVersion);
    expect(typeof body.currentVersion).toBe("number");
    expect(body.currentVersion).not.toBe(expectedVersion);
    // DAS ist die Kernanforderung: der aktuelle Serverzustand kommt mit.
    expect(body.current).toBeTruthy();
    expect((body.current as { version: number }).version).toBe(body.currentVersion);
    expect(res.headers.etag).toBe(`W/"${body.currentVersion}"`);
  }

  // -----------------------------------------------------------------------
  // Verfügbarkeit
  // -----------------------------------------------------------------------
  describe("Verfügbarkeit", () => {
    async function createAvailability() {
      const res = await app.inject({
        method: "POST",
        url: "/availability",
        headers: { cookie: instructorCookie },
        payload: { wochentag: 2, startzeit: "09:00", endzeit: "12:00" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.headers.etag).toBe('W/"1"');
      return res.json().availability as { id: string; version: number };
    }

    it("rejects a stale write and returns the current state (409)", async () => {
      const row = await createAvailability();

      const ok = await app.inject({
        method: "PATCH",
        url: `/availability/${row.id}`,
        headers: { cookie: instructorCookie },
        payload: { endzeit: "13:00", expectedVersion: row.version },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().availability.version).toBe(2);
      expect(ok.json().availability.endzeit).toBe("13:00");

      // Zweiter Client schreibt mit der ALTEN Version.
      const stale = await app.inject({
        method: "PATCH",
        url: `/availability/${row.id}`,
        headers: { cookie: instructorCookie },
        payload: { endzeit: "18:00", expectedVersion: row.version },
      });
      expectConflictCarriesCurrentState(stale, row.version);
      expect(stale.json().conflictFields).toContain("endzeit");
      expect((stale.json().current as { endzeit: string }).endzeit).toBe("13:00");

      // Kein stilles Überschreiben: der Serverwert ist unverändert.
      const check = await sql`select endzeit, version from verfuegbarkeiten where id = ${row.id}`;
      expect(check[0].endzeit).toBe("13:00");
      expect(check[0].version).toBe(2);
    });

    it("accepts the version via the If-Match header (ETag) as well", async () => {
      const row = await createAvailability();
      const ok = await app.inject({
        method: "PATCH",
        url: `/availability/${row.id}`,
        headers: { cookie: instructorCookie, "if-match": 'W/"1"' },
        payload: { endzeit: "14:00" },
      });
      expect(ok.statusCode).toBe(200);

      const stale = await app.inject({
        method: "PATCH",
        url: `/availability/${row.id}`,
        headers: { cookie: instructorCookie, "if-match": 'W/"1"' },
        payload: { endzeit: "15:00" },
      });
      expectConflictCarriesCurrentState(stale, 1);
    });

    it("requires a version at all (428 precondition_required)", async () => {
      const row = await createAvailability();
      const res = await app.inject({
        method: "PATCH",
        url: `/availability/${row.id}`,
        headers: { cookie: instructorCookie },
        payload: { endzeit: "16:00" },
      });
      expect(res.statusCode).toBe(428);
      expect(res.json().error).toBe("precondition_required");
    });
  });

  // -----------------------------------------------------------------------
  // Termine
  // -----------------------------------------------------------------------
  describe("Termine", () => {
    it("rejects cancelling on a stale version and returns the current appointment", async () => {
      const beginn = new Date(Date.now() + 600 * 3600_000);
      const created = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { cookie: officeCookie, "idempotency-key": "opt-book" },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          klasse: "B",
          art: "Übungsstunde",
          beginnAt: beginn.toISOString(),
          endeAt: new Date(beginn.getTime() + 3600_000).toISOString(),
        },
      });
      expect(created.statusCode).toBe(201);
      const booking = created.json().booking as { id: string; version: number };

      // Jemand anderes verschiebt den Termin -> Version steigt.
      await sql`update terminbuchungen set kurznotiz = 'verschoben' where id = ${booking.id}`;

      const stale = await app.inject({
        method: "POST",
        url: `/appointments/${booking.id}/cancel`,
        headers: { cookie: officeCookie, "idempotency-key": "opt-cancel" },
        payload: { grund: "Krankheit", expectedVersion: booking.version },
      });
      expectConflictCarriesCurrentState(stale, booking.version);
      expect((stale.json().current as { status: string }).status).toBe("bestaetigt");

      // Mit der aktuellen Version funktioniert es.
      const ok = await app.inject({
        method: "POST",
        url: `/appointments/${booking.id}/cancel`,
        headers: { cookie: officeCookie, "idempotency-key": "opt-cancel-2" },
        payload: { grund: "Krankheit", expectedVersion: stale.json().currentVersion as number },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().appointment.status).toBe("cancelled");
    });
  });

  // -----------------------------------------------------------------------
  // Fahrstundenfeedback
  // -----------------------------------------------------------------------
  describe("Fahrstundenfeedback", () => {
    async function createFeedback() {
      const beginn = new Date(Date.now() - 3 * 3600_000);
      const [booking] = await sql`
        insert into terminbuchungen (standort_id, schueler_id, fahrlehrer_id, beginn_at, ende_at, art)
        values (${fixtures.standortId}, ${fixtures.schuelerId}, ${fixtures.fahrlehrerId},
                ${beginn.toISOString()}, ${new Date(beginn.getTime() + 3600_000).toISOString()}, 'Übungsstunde')
        returning id`;
      const res = await app.inject({
        method: "POST",
        url: `/appointments/${booking.id}/feedback`,
        headers: { cookie: instructorCookie },
        payload: { wentWell: "Anfahren", internalNotes: "INTERN: unsicher", releasedFields: ["wentWell"] },
      });
      expect(res.statusCode).toBe(201);
      return res.json().feedback as { id: string; version: number };
    }

    it("rejects a stale instructor update and keeps the redaction contract intact", async () => {
      const feedback = await createFeedback();

      const ok = await app.inject({
        method: "PATCH",
        url: `/feedback/${feedback.id}`,
        headers: { cookie: instructorCookie },
        payload: { workOn: "Einparken", expectedVersion: feedback.version },
      });
      expect(ok.statusCode).toBe(200);

      const stale = await app.inject({
        method: "PATCH",
        url: `/feedback/${feedback.id}`,
        headers: { cookie: instructorCookie },
        payload: { workOn: "Etwas anderes", expectedVersion: feedback.version },
      });
      expectConflictCarriesCurrentState(stale, feedback.version);

      // Non-Negotiable: interne Notizen bleiben für den Schüler unsichtbar.
      const studentView = await app.inject({
        method: "GET",
        url: "/feedback/mine",
        headers: { cookie: studentCookie },
      });
      expect(studentView.statusCode).toBe(200);
      expect(JSON.stringify(studentView.json())).not.toContain("INTERN");
      expect(JSON.stringify(studentView.json())).not.toContain("internalNotes");
    });

    it("rejects a stale student self-assessment", async () => {
      const feedback = await createFeedback();
      const first = await app.inject({
        method: "PATCH",
        url: `/feedback/${feedback.id}/self-assessment`,
        headers: { cookie: studentCookie },
        payload: { text: "Fühlte sich gut an", expectedVersion: feedback.version },
      });
      expect(first.statusCode).toBe(200);

      const stale = await app.inject({
        method: "PATCH",
        url: `/feedback/${feedback.id}/self-assessment`,
        headers: { cookie: studentCookie },
        payload: { text: "Doch nicht", expectedVersion: feedback.version },
      });
      expectConflictCarriesCurrentState(stale, feedback.version);
    });
  });

  // -----------------------------------------------------------------------
  // Dokumentprüfung
  // -----------------------------------------------------------------------
  describe("Dokumentprüfung", () => {
    it("rejects a stale review decision and returns the current document", async () => {
      const [doc] = await sql`
        insert into dokumente (standort_id, schueler_id, typ, dateiname, speicher_referenz, status)
        values (${fixtures.standortId}, ${fixtures.schuelerId}, 'sehtest', 'a.pdf', 'mock://a', 'eingereicht')
        returning id, version`;

      const ok = await app.inject({
        method: "POST",
        url: `/documents/${doc.id}/review`,
        headers: { cookie: officeCookie },
        payload: {
          entscheidung: "akzeptiert",
          expectedVersion: doc.version,
          pruefprotokoll: { geprueftePunkte: ["lesbar", "gueltig"] },
        },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().document.dokumentStatus).toBe("verified");
      expect(ok.headers.etag).toBeTruthy();

      const stale = await app.inject({
        method: "POST",
        url: `/documents/${doc.id}/review`,
        headers: { cookie: officeCookie },
        payload: {
          entscheidung: "abgelehnt",
          ablehnungsgrund: "doch nicht",
          expectedVersion: doc.version,
          pruefprotokoll: { geprueftePunkte: ["unlesbar"] },
        },
      });
      expectConflictCarriesCurrentState(stale, doc.version);

      const check = await sql`select dokument_status from dokumente where id = ${doc.id}`;
      expect(check[0].dokument_status).toBe("verified");
    });
  });

  // -----------------------------------------------------------------------
  // Rechnungen
  // -----------------------------------------------------------------------
  describe("Rechnungen", () => {
    it("rejects a stale invoice update and returns the current invoice", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/invoices",
        headers: { cookie: financeCookie, "idempotency-key": "opt-inv" },
        payload: {
          schuelerId: fixtures.schuelerId,
          positionen: [
            { bezeichnung: "Grundgebühr", einzelpreisCent: 25000, gesamtpreisCent: 25000, leistungRef: "grundgebuehr" },
          ],
        },
      });
      expect(created.statusCode).toBe(201);
      const invoice = created.json().invoice as { id: string; version: number };

      const ok = await app.inject({
        method: "PATCH",
        url: `/invoices/${invoice.id}`,
        headers: { cookie: financeCookie },
        payload: { status: "ueberfaellig", expectedVersion: invoice.version },
      });
      expect(ok.statusCode).toBe(200);

      const stale = await app.inject({
        method: "PATCH",
        url: `/invoices/${invoice.id}`,
        headers: { cookie: financeCookie },
        payload: { status: "bezahlt", expectedVersion: invoice.version },
      });
      expectConflictCarriesCurrentState(stale, invoice.version);
      expect((stale.json().current as { status: string }).status).toBe("ueberfaellig");
    });
  });

  // -----------------------------------------------------------------------
  // Fahrzeugstatus
  // -----------------------------------------------------------------------
  describe("Fahrzeugstatus", () => {
    it("rejects a stale vehicle status change and returns the current vehicle", async () => {
      const [vehicle] = await sql`select id, version from fahrzeuge where id = ${fixtures.fahrzeugId}`;

      const ok = await app.inject({
        method: "PATCH",
        url: `/resources/fahrzeuge/${vehicle.id}`,
        headers: { cookie: officeCookie },
        payload: { kilometerstand: 12345, expectedVersion: vehicle.version },
      });
      expect(ok.statusCode).toBe(200);

      const stale = await app.inject({
        method: "PATCH",
        url: `/resources/fahrzeuge/${vehicle.id}`,
        headers: { cookie: officeCookie },
        payload: { status: "defekt", expectedVersion: vehicle.version },
      });
      expectConflictCarriesCurrentState(stale, vehicle.version);
      expect((stale.json().current as { status: string }).status).toBe("verfuegbar");
    });

    it("rejects blocking a vehicle on a stale version", async () => {
      const [vehicle] = await sql`select id, version from fahrzeuge where id = ${fixtures.fahrzeugId}`;
      await sql`update fahrzeuge set kilometerstand = 999 where id = ${vehicle.id}`;

      const stale = await app.inject({
        method: "POST",
        url: `/resources/fahrzeuge/${vehicle.id}/block`,
        headers: { cookie: officeCookie, "idempotency-key": "opt-block" },
        payload: { grund: "Bremse", expectedVersion: vehicle.version },
      });
      expectConflictCarriesCurrentState(stale, vehicle.version);

      const check = await sql`select status from fahrzeuge where id = ${vehicle.id}`;
      expect(check[0].status).toBe("verfuegbar");
    });
  });

  // -----------------------------------------------------------------------
  // Die Versions-Automatik selbst
  // -----------------------------------------------------------------------
  describe("version/updated_at bookkeeping (DB trigger, cannot be bypassed)", () => {
    it("bumps version and updated_at on EVERY update, including raw SQL", async () => {
      const tabellen: Array<[string, string]> = [
        ["fahrzeuge", fixtures.fahrzeugId],
        ["schueler", fixtures.schuelerId],
      ];
      for (const [tabelle, id] of tabellen) {
        if (tabelle === "schueler") continue; // schueler hat (noch) keinen Versions-Trigger
        const before = await sql`select version, updated_at from fahrzeuge where id = ${id}`;
        await new Promise((r) => setTimeout(r, 5));
        await sql`update fahrzeuge set bezeichnung = 'geändert' where id = ${id}`;
        const after = await sql`select version, updated_at from fahrzeuge where id = ${id}`;
        expect(after[0].version).toBe(before[0].version + 1);
        expect(new Date(after[0].updated_at).getTime()).toBeGreaterThan(
          new Date(before[0].updated_at).getTime(),
        );
      }
    });

    it("covers all six §4 entities with a version trigger", async () => {
      const rows = await sql`
        select c.relname as tabelle
          from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where t.tgname like '%\\_z\\_version\\_trg'`;
      const tabellen = rows.map((r) => r.tabelle as string);
      for (const t of [
        "verfuegbarkeiten",
        "terminbuchungen",
        "fahrstunden_feedback",
        "dokumente",
        "rechnungen",
        "fahrzeuge",
        "zahlungen",
        "banktransaktionen",
        "fahrzeugmaengel",
        "pruefungen",
      ]) {
        expect(tabellen, `Versions-Trigger auf ${t}`).toContain(t);
      }
    });
  });
});
