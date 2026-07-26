import { createRawClient } from "@fahrschul/database";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildMultipartBody,
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
 * PROMPT -1 §2 – EIN generischer Idempotenz-Mechanismus für die neun
 * mandatierten Operationen. Für JEDE Operation wird geprüft:
 *   (a) gleicher Schlüssel + gleicher Body -> identisches, gespeichertes
 *       Ergebnis OHNE erneute Ausführung,
 *   (b) gleicher Schlüssel + ABWEICHENDER Body -> 409
 *       `idempotency_key_conflict` (dokumentierte Wahl, siehe
 *       docs/sync-architecture.md §2),
 *   (c) Schlüssel laufen ab.
 */
describe("PROMPT -1 §2 – Idempotenz für jeden kritischen Schreibvorgang", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let fixtures: SeededFixtures;
  let officeCookie: string;
  let studentCookie: string;
  let instructorCookie: string;
  let financeCookie: string;
  let financeBenutzerId: string;

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
    officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
    studentCookie = await loginAs(app, "schueler@test.local", fixtures.password);
    instructorCookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);

    const sql = createRawClient(databaseUrl);
    try {
      const [row] = await sql`
        insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
        select ${fixtures.standortId}, 'finanzen@test.local', password_hash, 'finanzen', 'Fin', 'Anzen', true, mfa_secret
          from benutzer where id = ${fixtures.bueroBenutzerId}
        returning id`;
      financeBenutzerId = row.id;
      await sql`
        insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
        select ${fixtures.standortId}, 'systemdienst@test.local', password_hash, 'systemdienst', 'Sys', 'Dienst', true, mfa_secret
          from benutzer where id = ${fixtures.bueroBenutzerId}`;
    } finally {
      await sql.end();
    }
    financeCookie = await loginAs(app, "finanzen@test.local", fixtures.password, fixtures.bueroTotpSecret);
  });

  function futureSlot(hourOffset: number) {
    const beginn = new Date(Date.now() + hourOffset * 3600_000);
    beginn.setUTCMinutes(0, 0, 0);
    return { beginnAt: beginn.toISOString(), endeAt: new Date(beginn.getTime() + 3600_000).toISOString() };
  }

  async function createOffer(hourOffset = 48) {
    const slot = futureSlot(hourOffset);
    const res = await app.inject({
      method: "POST",
      url: "/appointment-offers",
      headers: { cookie: officeCookie },
      payload: { fahrlehrerId: fixtures.fahrlehrerId, klasse: "B", ...slot },
    });
    expect(res.statusCode).toBe(201);
    return res.json().offer as { id: string };
  }

  // -----------------------------------------------------------------------
  // (1) Terminangebot annehmen
  // -----------------------------------------------------------------------
  describe("1. Terminangebot annehmen", () => {
    it("same key + same body replays the stored result without a second booking", async () => {
      const offer = await createOffer(50);
      const first = await app.inject({
        method: "POST",
        url: `/appointment-offers/${offer.id}/accept`,
        headers: { cookie: studentCookie },
        payload: { idempotencyKey: "accept-1" },
      });
      expect(first.statusCode).toBe(201);
      const bookingId = first.json().booking.id;

      const second = await app.inject({
        method: "POST",
        url: `/appointment-offers/${offer.id}/accept`,
        headers: { cookie: studentCookie },
        payload: { idempotencyKey: "accept-1" },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().booking.id).toBe(bookingId);
      expect(second.json().reused).toBe(true);

      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select count(*)::int as n from terminbuchungen where terminangebot_id = ${offer.id}`;
        expect(rows[0].n).toBe(1);
      } finally {
        await sql.end();
      }
    });

    it("same key for a DIFFERENT offer is rejected with 409", async () => {
      const offerA = await createOffer(52);
      const offerB = await createOffer(60);
      const first = await app.inject({
        method: "POST",
        url: `/appointment-offers/${offerA.id}/accept`,
        headers: { cookie: studentCookie },
        payload: { idempotencyKey: "accept-shared" },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: "POST",
        url: `/appointment-offers/${offerB.id}/accept`,
        headers: { cookie: studentCookie },
        payload: { idempotencyKey: "accept-shared" },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe("idempotency_key_conflict");
    });
  });

  // -----------------------------------------------------------------------
  // (2) Termin buchen
  // -----------------------------------------------------------------------
  describe("2. Termin buchen", () => {
    const bookingBody = (over: Record<string, unknown> = {}) => ({
      schuelerId: fixtures.schuelerId,
      fahrlehrerId: fixtures.fahrlehrerId,
      klasse: "B",
      art: "Übungsstunde",
      ...futureSlot(72),
      ...over,
    });

    it("replays via the Idempotency-Key HEADER (not only the body field)", async () => {
      const first = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { cookie: officeCookie, "idempotency-key": "book-header-1" },
        payload: bookingBody(),
      });
      expect(first.statusCode).toBe(201);
      const id = first.json().booking.id;

      const second = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { cookie: officeCookie, "idempotency-key": "book-header-1" },
        payload: bookingBody(),
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().booking.id).toBe(id);
    });

    it("is insensitive to JSON key ORDER but sensitive to a changed value", async () => {
      const first = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { cookie: officeCookie, "idempotency-key": "book-order" },
        payload: bookingBody(),
      });
      expect(first.statusCode).toBe(201);

      // Gleiche Werte, andere Schlüsselreihenfolge -> KEIN Konflikt.
      const reordered = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { cookie: officeCookie, "idempotency-key": "book-order" },
        payload: {
          ...futureSlot(72),
          art: "Übungsstunde",
          klasse: "B",
          fahrlehrerId: fixtures.fahrlehrerId,
          schuelerId: fixtures.schuelerId,
        },
      });
      expect(reordered.statusCode).toBe(200);

      // Geänderter Wert -> Konflikt.
      const changed = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { cookie: officeCookie, "idempotency-key": "book-order" },
        payload: bookingBody({ art: "Sonderfahrt" }),
      });
      expect(changed.statusCode).toBe(409);
      expect(changed.json().error).toBe("idempotency_key_conflict");
    });

  });

  // -----------------------------------------------------------------------
  // Schlüssel-Ablauf (§2, dritte Pflicht-Semantik)
  // -----------------------------------------------------------------------
  describe("expiry of idempotency keys", () => {
    // Bewusst an "Nachricht versenden" geprüft und NICHT an einer Buchung:
    // `terminbuchungen.idempotency_key` ist eine zweite, DAUERHAFTE DB-Sperre
    // (Migration 0001), die den Schlüssel unabhängig von der TTL festhält.
    // Der Ablauf betrifft also nur den generischen Speicher.
    const sendBody = (inhalt: string) => ({
      kanal: "email",
      to: "schueler@test.local",
      betreff: "Ablauftest",
      inhalt,
      schuelerId: fixtures.schuelerId,
    });

    it("treats an expired key as new and the cleanup job purges it", async () => {
      const first = await app.inject({
        method: "POST",
        url: "/communication/send",
        headers: { cookie: officeCookie, "idempotency-key": "expiry-1" },
        payload: sendBody("erste Nachricht"),
      });
      expect(first.statusCode).toBe(201);

      // Vor Ablauf: abweichender Body -> Konflikt.
      const konflikt = await app.inject({
        method: "POST",
        url: "/communication/send",
        headers: { cookie: officeCookie, "idempotency-key": "expiry-1" },
        payload: sendBody("andere Nachricht"),
      });
      expect(konflikt.statusCode).toBe(409);

      const sql = createRawClient(databaseUrl);
      try {
        await sql`update idempotency_keys set expires_at = now() - interval '1 hour' where key = 'expiry-1'`;
      } finally {
        await sql.end();
      }

      // Nach Ablauf: derselbe Schlüssel, abweichender Body -> NEUE Ausführung.
      const nachAblauf = await app.inject({
        method: "POST",
        url: "/communication/send",
        headers: { cookie: officeCookie, "idempotency-key": "expiry-1" },
        payload: sendBody("andere Nachricht"),
      });
      expect(nachAblauf.statusCode).toBe(201);
      expect(nachAblauf.json().nachricht.inhalt).toBe("andere Nachricht");

      // Aufräum-Job (§13) entfernt abgelaufene Schlüssel.
      const sql2 = createRawClient(databaseUrl);
      try {
        await sql2`update idempotency_keys set expires_at = now() - interval '1 hour'`;
        const vorher = await sql2`select count(*)::int as n from idempotency_keys`;
        expect(vorher[0].n).toBeGreaterThan(0);
      } finally {
        await sql2.end();
      }

      const opsCookie = await loginAs(app, "systemdienst@test.local", fixtures.password, fixtures.bueroTotpSecret);
      const run = await app.inject({
        method: "POST",
        url: "/ops/jobs",
        headers: { cookie: opsCookie },
        payload: { jobType: "idempotency.cleanup" },
      });
      expect(run.statusCode).toBe(201);
      const exec = await app.inject({
        method: "POST",
        url: "/ops/jobs/run",
        headers: { cookie: opsCookie },
        payload: { jobTypes: ["idempotency.cleanup"] },
      });
      expect(exec.statusCode).toBe(200);
      expect(exec.json().succeeded).toBe(1);

      const sql3 = createRawClient(databaseUrl);
      try {
        const nachher = await sql3`select count(*)::int as n from idempotency_keys`;
        expect(nachher[0].n).toBe(0);
      } finally {
        await sql3.end();
      }
    });
  });

  // -----------------------------------------------------------------------
  // (3) Termin stornieren
  // -----------------------------------------------------------------------
  describe("3. Termin stornieren", () => {
    async function bookOne() {
      const res = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { cookie: officeCookie, "idempotency-key": `book-${Math.random()}` },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          klasse: "B",
          art: "Übungsstunde",
          ...futureSlot(100),
        },
      });
      expect(res.statusCode).toBe(201);
      return res.json().booking as { id: string; version: number };
    }

    it("requires an idempotency key and a version, then replays the stored result", async () => {
      const booking = await bookOne();

      const ohneKey = await app.inject({
        method: "POST",
        url: `/appointments/${booking.id}/cancel`,
        headers: { cookie: officeCookie },
        payload: { grund: "Krankheit", expectedVersion: booking.version },
      });
      expect(ohneKey.statusCode).toBe(400);
      expect(ohneKey.json().error).toBe("idempotency_key_required");

      const ohneVersion = await app.inject({
        method: "POST",
        url: `/appointments/${booking.id}/cancel`,
        headers: { cookie: officeCookie, "idempotency-key": "cancel-1" },
        payload: { grund: "Krankheit" },
      });
      expect(ohneVersion.statusCode).toBe(428);

      const first = await app.inject({
        method: "POST",
        url: `/appointments/${booking.id}/cancel`,
        headers: { cookie: officeCookie, "idempotency-key": "cancel-1" },
        payload: { grund: "Krankheit", expectedVersion: booking.version },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().appointment.status).toBe("cancelled");
      expect(first.json().replayed).toBe(false);

      const replay = await app.inject({
        method: "POST",
        url: `/appointments/${booking.id}/cancel`,
        headers: { cookie: officeCookie, "idempotency-key": "cancel-1" },
        payload: { grund: "Krankheit", expectedVersion: booking.version },
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replayed).toBe(true);
      expect(replay.json().appointment.id).toBe(booking.id);
    });

    it("rejects the same key with a different reason (409)", async () => {
      const booking = await bookOne();
      const first = await app.inject({
        method: "POST",
        url: `/appointments/${booking.id}/cancel`,
        headers: { cookie: officeCookie, "idempotency-key": "cancel-2" },
        payload: { grund: "Krankheit", expectedVersion: booking.version },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: "POST",
        url: `/appointments/${booking.id}/cancel`,
        headers: { cookie: officeCookie, "idempotency-key": "cancel-2" },
        payload: { grund: "Anderer Grund", expectedVersion: booking.version },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe("idempotency_key_conflict");
    });
  });

  // -----------------------------------------------------------------------
  // (4) Fahrstunde abschließen
  // -----------------------------------------------------------------------
  describe("4. Fahrstunde abschließen", () => {
    const completionPayload = (over: Record<string, unknown> = {}) => ({
      tatsaechlicheDauerMinuten: 45,
      stundenart: "Übungsstunde",
      lernziele: ["Anfahren"],
      beobachteteKompetenzfelder: [
        { feld: "abstand", kompetenzstatus: "in_uebung", beobachtung: "hält Abstand meist ein" },
      ],
      kurznotiz: "Lief gut",
      naechstesZiel: "Autobahn",
      schuelerfeedback: "zufrieden",
      bestaetigung: true,
      ...over,
    });

    async function startedLesson() {
      const sql = createRawClient(databaseUrl);
      let id: string;
      try {
        const beginn = new Date(Date.now() + 200 * 3600_000);
        const [row] = await sql`
          insert into terminbuchungen (standort_id, schueler_id, fahrlehrer_id, beginn_at, ende_at, art)
          values (${fixtures.standortId}, ${fixtures.schuelerId}, ${fixtures.fahrlehrerId},
                  ${beginn.toISOString()}, ${new Date(beginn.getTime() + 3600_000).toISOString()}, 'Übungsstunde')
          returning id`;
        id = row.id;
      } finally {
        await sql.end();
      }
      const start = await app.inject({
        method: "POST",
        url: `/instructor/lessons/${id}/start`,
        headers: { cookie: instructorCookie },
      });
      expect(start.statusCode).toBe(200);
      return id;
    }

    it("replays the completion result instead of completing twice", async () => {
      const id = await startedLesson();
      const first = await app.inject({
        method: "POST",
        url: `/instructor/lessons/${id}/complete`,
        headers: { cookie: instructorCookie, "idempotency-key": "complete-1" },
        payload: completionPayload(),
      });
      expect(first.statusCode).toBe(200);

      const replay = await app.inject({
        method: "POST",
        url: `/instructor/lessons/${id}/complete`,
        headers: { cookie: instructorCookie, "idempotency-key": "complete-1" },
        payload: completionPayload(),
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().termin.id).toBe(first.json().termin.id);

      // Kein doppelter Kompetenzeintrag durch den Retry.
      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select count(*)::int as n from kompetenzbeobachtungen where terminbuchung_id = ${id}`;
        expect(rows[0].n).toBe(1);
      } finally {
        await sql.end();
      }
    });

    it("rejects the same key with a different completion payload (409)", async () => {
      const id = await startedLesson();
      const first = await app.inject({
        method: "POST",
        url: `/instructor/lessons/${id}/complete`,
        headers: { cookie: instructorCookie, "idempotency-key": "complete-2" },
        payload: completionPayload(),
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: "POST",
        url: `/instructor/lessons/${id}/complete`,
        headers: { cookie: instructorCookie, "idempotency-key": "complete-2" },
        payload: completionPayload({ tatsaechlicheDauerMinuten: 90 }),
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe("idempotency_key_conflict");
    });
  });

  // -----------------------------------------------------------------------
  // (5) Rechnung erzeugen
  // -----------------------------------------------------------------------
  describe("5. Rechnung erzeugen", () => {
    const invoiceBody = (over: Record<string, unknown> = {}) => ({
      schuelerId: fixtures.schuelerId,
      positionen: [
        {
          bezeichnung: "Übungsstunde",
          einzelpreisCent: 6500,
          gesamtpreisCent: 6500,
          leistungRef: `produkt:UEBUNG:${fixtures.schuelerId}`,
        },
      ],
      ...over,
    });

    it("requires a key, then replays the exact stored invoice", async () => {
      const ohneKey = await app.inject({
        method: "POST",
        url: "/invoices",
        headers: { cookie: financeCookie },
        payload: invoiceBody(),
      });
      expect(ohneKey.statusCode).toBe(400);
      expect(ohneKey.json().error).toBe("idempotency_key_required");

      const first = await app.inject({
        method: "POST",
        url: "/invoices",
        headers: { cookie: financeCookie, "idempotency-key": "invoice-1" },
        payload: invoiceBody(),
      });
      expect(first.statusCode).toBe(201);
      const invoiceId = first.json().invoice.id;

      const replay = await app.inject({
        method: "POST",
        url: "/invoices",
        headers: { cookie: financeCookie, "idempotency-key": "invoice-1" },
        payload: invoiceBody(),
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replayed).toBe(true);
      expect(replay.json().invoice.id).toBe(invoiceId);

      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select count(*)::int as n from rechnungen where schueler_id = ${fixtures.schuelerId}`;
        expect(rows[0].n).toBe(1);
      } finally {
        await sql.end();
      }
    });

    it("rejects the same key with a different amount (409)", async () => {
      const first = await app.inject({
        method: "POST",
        url: "/invoices",
        headers: { cookie: financeCookie, "idempotency-key": "invoice-2" },
        payload: invoiceBody(),
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: "POST",
        url: "/invoices",
        headers: { cookie: financeCookie, "idempotency-key": "invoice-2" },
        payload: invoiceBody({
          positionen: [
            {
              bezeichnung: "Übungsstunde",
              einzelpreisCent: 9900,
              gesamtpreisCent: 9900,
              leistungRef: `produkt:ANDERS:${fixtures.schuelerId}`,
            },
          ],
        }),
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe("idempotency_key_conflict");
    });
  });

  // -----------------------------------------------------------------------
  // (6) Zahlung zuordnen
  // -----------------------------------------------------------------------
  describe("6. Zahlung zuordnen", () => {
    async function seedBankTxAndInvoice() {
      const sql = createRawClient(databaseUrl);
      try {
        const [invoice] = await sql`
          insert into rechnungen (standort_id, schueler_id, betrag_cent, status)
          values (${fixtures.standortId}, ${fixtures.schuelerId}, 10000, 'offen') returning id`;
        const [tx] = await sql`
          insert into banktransaktionen (standort_id, external_id, amount_cent, booked_at, zahlung_status)
          values (${fixtures.standortId}, ${"ext-" + Math.random()}, 10000, current_date, 'review_required')
          returning id`;
        return { invoiceId: invoice.id as string, txId: tx.id as string };
      } finally {
        await sql.end();
      }
    }

    it("replays the assignment instead of creating a second payment", async () => {
      const { invoiceId, txId } = await seedBankTxAndInvoice();
      const first = await app.inject({
        method: "POST",
        url: `/finance/bank/${txId}/resolve`,
        headers: { cookie: financeCookie, "idempotency-key": "assign-1" },
        payload: { rechnungId: invoiceId, betragCent: 10000 },
      });
      expect(first.statusCode).toBe(200);

      const replay = await app.inject({
        method: "POST",
        url: `/finance/bank/${txId}/resolve`,
        headers: { cookie: financeCookie, "idempotency-key": "assign-1" },
        payload: { rechnungId: invoiceId, betragCent: 10000 },
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replayed).toBe(true);

      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select count(*)::int as n from zahlungen where banktransaktion_id = ${txId}`;
        expect(rows[0].n).toBe(1);
      } finally {
        await sql.end();
      }
    });

    it("rejects the same key with a different amount (409)", async () => {
      const { invoiceId, txId } = await seedBankTxAndInvoice();
      const first = await app.inject({
        method: "POST",
        url: `/finance/bank/${txId}/resolve`,
        headers: { cookie: financeCookie, "idempotency-key": "assign-2" },
        payload: { rechnungId: invoiceId, betragCent: 5000 },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: "POST",
        url: `/finance/bank/${txId}/resolve`,
        headers: { cookie: financeCookie, "idempotency-key": "assign-2" },
        payload: { rechnungId: invoiceId, betragCent: 4000 },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe("idempotency_key_conflict");
    });
  });

  // -----------------------------------------------------------------------
  // (7) Dokument einreichen
  // -----------------------------------------------------------------------
  describe("7. Dokument einreichen", () => {
    function upload(key: string, content: string, typ = "sehtest") {
      const { body, contentType } = buildMultipartBody({
        fields: { typ },
        fileFieldName: "datei",
        fileName: "sehtest.pdf",
        fileContent: Buffer.from(content),
        mimeType: "application/pdf",
      });
      return app.inject({
        method: "POST",
        url: "/documents",
        headers: { cookie: studentCookie, "content-type": contentType, "idempotency-key": key },
        payload: body,
      });
    }

    it("replays the stored document for the same key + same file", async () => {
      const first = await upload("doc-1", "inhalt-a");
      expect(first.statusCode).toBe(201);
      const docId = first.json().document.id;

      const replay = await upload("doc-1", "inhalt-a");
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replayed).toBe(true);
      expect(replay.json().document.id).toBe(docId);

      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select count(*)::int as n from dokumente where schueler_id = ${fixtures.schuelerId}`;
        expect(rows[0].n).toBe(1);
      } finally {
        await sql.end();
      }
    });

    it("rejects the same key with DIFFERENT file content (409)", async () => {
      expect((await upload("doc-2", "inhalt-a")).statusCode).toBe(201);
      const second = await upload("doc-2", "voellig-anderer-inhalt");
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe("idempotency_key_conflict");
    });
  });

  // -----------------------------------------------------------------------
  // (8) Prüfung freigeben/anmelden
  // -----------------------------------------------------------------------
  describe("8. Prüfung freigeben/anmelden", () => {
    async function createPruefung() {
      const res = await app.inject({
        method: "POST",
        url: "/pruefungen",
        headers: { cookie: officeCookie },
        payload: { ausbildungId: fixtures.ausbildungId, schuelerId: fixtures.schuelerId, klasse: "B" },
      });
      expect(res.statusCode).toBe(201);
      return res.json().pruefung.id as string;
    }

    it("replays a pipeline transition instead of advancing twice", async () => {
      const id = await createPruefung();
      const first = await app.inject({
        method: "POST",
        url: `/pruefungen/${id}/transition`,
        headers: { cookie: instructorCookie, "idempotency-key": "exam-1" },
        payload: { to: "fahrlehrer_go", grund: "Reif" },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().pruefung.status).toBe("fahrlehrer_go");

      const replay = await app.inject({
        method: "POST",
        url: `/pruefungen/${id}/transition`,
        headers: { cookie: instructorCookie, "idempotency-key": "exam-1" },
        payload: { to: "fahrlehrer_go", grund: "Reif" },
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replayed).toBe(true);

      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`
          select count(*)::int as n from audit_events
           where entitaet = 'pruefung' and entitaet_id = ${id} and aktion = 'pruefungen.transition'`;
        expect(rows[0].n).toBe(1);
      } finally {
        await sql.end();
      }
    });

    it("rejects the same key with a different target state (409)", async () => {
      const id = await createPruefung();
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/pruefungen/${id}/transition`,
            headers: { cookie: instructorCookie, "idempotency-key": "exam-2" },
            payload: { to: "fahrlehrer_go" },
          })
        ).statusCode,
      ).toBe(200);

      const second = await app.inject({
        method: "POST",
        url: `/pruefungen/${id}/transition`,
        headers: { cookie: officeCookie, "idempotency-key": "exam-2" },
        payload: { to: "bueroprüfung" },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe("idempotency_key_conflict");
    });
  });

  // -----------------------------------------------------------------------
  // (9) Fahrzeug blockieren + (10) Nachricht versenden
  // -----------------------------------------------------------------------
  describe("9. Fahrzeug blockieren", () => {
    async function vehicleVersion() {
      const sql = createRawClient(databaseUrl);
      try {
        const [row] = await sql`select version from fahrzeuge where id = ${fixtures.fahrzeugId}`;
        return row.version as number;
      } finally {
        await sql.end();
      }
    }

    it("requires key + version and replays the block result", async () => {
      const version = await vehicleVersion();
      const ohneKey = await app.inject({
        method: "POST",
        url: `/resources/fahrzeuge/${fixtures.fahrzeugId}/block`,
        headers: { cookie: officeCookie },
        payload: { grund: "Bremse", expectedVersion: version },
      });
      expect(ohneKey.statusCode).toBe(400);

      const first = await app.inject({
        method: "POST",
        url: `/resources/fahrzeuge/${fixtures.fahrzeugId}/block`,
        headers: { cookie: officeCookie, "idempotency-key": "block-1" },
        payload: { grund: "Bremse", expectedVersion: version },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().fahrzeug.status).toBe("wartung");

      const replay = await app.inject({
        method: "POST",
        url: `/resources/fahrzeuge/${fixtures.fahrzeugId}/block`,
        headers: { cookie: officeCookie, "idempotency-key": "block-1" },
        payload: { grund: "Bremse", expectedVersion: version },
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replayed).toBe(true);

      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select count(*)::int as n from fahrzeugmaengel where fahrzeug_id = ${fixtures.fahrzeugId}`;
        expect(rows[0].n).toBe(1);
      } finally {
        await sql.end();
      }
    });

    it("rejects the same key with a different reason (409)", async () => {
      const version = await vehicleVersion();
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/resources/fahrzeuge/${fixtures.fahrzeugId}/block`,
            headers: { cookie: officeCookie, "idempotency-key": "block-2" },
            payload: { grund: "Bremse", expectedVersion: version },
          })
        ).statusCode,
      ).toBe(200);

      const second = await app.inject({
        method: "POST",
        url: `/resources/fahrzeuge/${fixtures.fahrzeugId}/block`,
        headers: { cookie: officeCookie, "idempotency-key": "block-2" },
        payload: { grund: "Getriebe", expectedVersion: version },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe("idempotency_key_conflict");
    });
  });

  describe("10. Nachricht versenden", () => {
    const sendBody = (over: Record<string, unknown> = {}) => ({
      kanal: "email",
      to: "schueler@test.local",
      betreff: "Hallo",
      inhalt: "Testnachricht",
      schuelerId: fixtures.schuelerId,
      ...over,
    });

    it("replays instead of sending twice", async () => {
      const first = await app.inject({
        method: "POST",
        url: "/communication/send",
        headers: { cookie: officeCookie, "idempotency-key": "msg-1" },
        payload: sendBody(),
      });
      expect(first.statusCode).toBe(201);

      const replay = await app.inject({
        method: "POST",
        url: "/communication/send",
        headers: { cookie: officeCookie, "idempotency-key": "msg-1" },
        payload: sendBody(),
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replayed).toBe(true);

      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select count(*)::int as n from nachrichten where inhalt = 'Testnachricht'`;
        expect(rows[0].n).toBe(1);
      } finally {
        await sql.end();
      }
    });

    it("rejects the same key with different content (409)", async () => {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/communication/send",
            headers: { cookie: officeCookie, "idempotency-key": "msg-2" },
            payload: sendBody(),
          })
        ).statusCode,
      ).toBe(201);

      const second = await app.inject({
        method: "POST",
        url: "/communication/send",
        headers: { cookie: officeCookie, "idempotency-key": "msg-2" },
        payload: sendBody({ inhalt: "Ganz andere Nachricht" }),
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe("idempotency_key_conflict");
    });
  });

  it("stores exactly one idempotency row per (operation, key) and records the result", async () => {
    const offer = await createOffer(120);
    await app.inject({
      method: "POST",
      url: `/appointment-offers/${offer.id}/accept`,
      headers: { cookie: studentCookie },
      payload: { idempotencyKey: "store-check" },
    });
    const sql = createRawClient(databaseUrl);
    try {
      const rows = await sql`
        select operation, key, status, response_status, entitaet, benutzer_id, request_hash, expires_at
          from idempotency_keys where key = 'store-check'`;
      expect(rows).toHaveLength(1);
      expect(rows[0].operation).toBe("appointment-offers.accept");
      expect(rows[0].status).toBe("completed");
      expect(rows[0].response_status).toBe(201);
      expect(rows[0].entitaet).toBe("terminbuchung");
      expect(rows[0].request_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(new Date(rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
      expect(rows[0].benutzer_id).toBeTruthy();
      expect(financeBenutzerId).toBeTruthy();
    } finally {
      await sql.end();
    }
  });
});
