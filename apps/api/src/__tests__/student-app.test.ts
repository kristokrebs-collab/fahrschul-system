import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRawClient } from "@fahrschul/database";
import {
  buildMultipartBody,
  buildTestApp,
  enableMfa,
  idemKey,
  ensureMigrated,
  loginAs,
  seedFixtures,
  testDatabaseUrl,
  truncateAll,
  type SeededFixtures,
} from "./helpers.js";

describe("apps/student – Prompt 1", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let fixtures: SeededFixtures;
  let studentCookie: string;
  let student2Cookie: string;
  let instructorCookie: string;
  let officeCookie: string;

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
    studentCookie = await loginAs(app, "schueler@test.local", fixtures.password);
    student2Cookie = await loginAs(app, "schueler2@test.local", fixtures.password);
    instructorCookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
    await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);
    officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
  });

  // ---------------------------------------------------------------------
  // Onboarding / eigenes Profil / leere Konten
  // ---------------------------------------------------------------------
  describe("onboarding & profile", () => {
    it("returns the student's own profile with ausbildung", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/me/schueler",
        headers: { cookie: studentCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.schueler.id).toBe(fixtures.schuelerId);
      expect(body.ausbildungen).toHaveLength(1);
      expect(body.ausbildungen[0].klasse).toBe("B");
    });

    it("shows an empty state for a student without appointments/documents/invoices yet", async () => {
      const appts = await app.inject({
        method: "GET",
        url: "/appointments/mine",
        headers: { cookie: student2Cookie },
      });
      expect(appts.json().appointments).toEqual([]);

      const docs = await app.inject({
        method: "GET",
        url: "/documents/mine",
        headers: { cookie: student2Cookie },
      });
      expect(docs.json().documents).toEqual([]);

      const invoices = await app.inject({
        method: "GET",
        url: "/invoices/mine",
        headers: { cookie: student2Cookie },
      });
      expect(invoices.json().invoices).toEqual([]);
    });

    it("returns 404 (not a fabricated readiness view) for a student without an ausbildung", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/me/exam-readiness",
        headers: { cookie: student2Cookie },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // Rollen-/Sichtbarkeitsgrenzen
  // ---------------------------------------------------------------------
  describe("role permissions & data isolation", () => {
    it("student cannot create arbitrary appointments (only accept offers)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": idemKey(), cookie: studentCookie },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          beginnAt: "2026-08-10T09:00:00.000Z",
          endeAt: "2026-08-10T10:00:00.000Z",
          art: "Übungsstunde",
          klasse: "B",
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it("student cannot set an exam clearance (server-enforced, not just hidden in UI)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/exam-clearance",
        headers: { cookie: studentCookie },
        payload: { ausbildungId: fixtures.ausbildungId, entscheidung: "freigegeben" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("fahrlehrer cannot accept an offer as if they were a student (no appointments:accept:own)", async () => {
      const offerRes = await app.inject({
        method: "POST",
        url: "/appointment-offers",
        headers: { cookie: instructorCookie },
        payload: {
          fahrlehrerId: fixtures.fahrlehrerId,
          fahrzeugId: fixtures.fahrzeugId,
          beginnAt: "2026-08-11T09:00:00.000Z",
          endeAt: "2026-08-11T10:00:00.000Z",
          klasse: "B",
        },
      });
      const offerId = offerRes.json().offer.id;
      const accept = await app.inject({
        method: "POST",
        url: `/appointment-offers/${offerId}/accept`,
        headers: { cookie: instructorCookie },
        payload: { idempotencyKey: "instructor-should-not-accept" },
      });
      expect(accept.statusCode).toBe(403);
    });

    it("a student never sees another student's uploaded documents", async () => {
      const upload = buildMultipartBody({
        fields: { typ: "sehtest" },
        fileFieldName: "file",
        fileName: "sehtest.pdf",
        fileContent: Buffer.from("%PDF-1.4 test content"),
        mimeType: "application/pdf",
      });
      const uploadRes = await app.inject({
        method: "POST",
        url: "/documents",
        headers: { "idempotency-key": idemKey(), cookie: student2Cookie, "content-type": upload.contentType },
        payload: upload.body,
      });
      expect(uploadRes.statusCode).toBe(201);

      const ownList = await app.inject({
        method: "GET",
        url: "/documents/mine",
        headers: { cookie: studentCookie },
      });
      expect(ownList.json().documents).toEqual([]);

      const otherList = await app.inject({
        method: "GET",
        url: "/documents/mine",
        headers: { cookie: student2Cookie },
      });
      expect(otherList.json().documents).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------
  // Wunschzeiten (Verfügbarkeit)
  // ---------------------------------------------------------------------
  describe("wunschzeiten (availability entry)", () => {
    it("lets a student save and read back desired time windows", async () => {
      const put = await app.inject({
        method: "PUT",
        url: "/me/wunschzeiten",
        headers: { cookie: studentCookie },
        payload: {
          eintraege: [
            { wochentag: 1, startzeit: "16:00", endzeit: "18:00" },
            { wochentag: 6, startzeit: "09:00", endzeit: "12:00" },
          ],
        },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().wunschzeiten).toHaveLength(2);

      const get = await app.inject({
        method: "GET",
        url: "/me/wunschzeiten",
        headers: { cookie: studentCookie },
      });
      expect(get.json().wunschzeiten).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------
  // Terminangebote: Liste, Annahme, Race-Sicherheit, Ablauf
  // ---------------------------------------------------------------------
  describe("appointment offers", () => {
    async function createOffer(overrides: Record<string, unknown> = {}) {
      const res = await app.inject({
        method: "POST",
        url: "/appointment-offers",
        headers: { cookie: instructorCookie },
        payload: {
          fahrlehrerId: fixtures.fahrlehrerId,
          fahrzeugId: fixtures.fahrzeugId,
          beginnAt: "2026-08-12T09:00:00.000Z",
          endeAt: "2026-08-12T10:00:00.000Z",
          klasse: "B",
          treffpunkt: "Fahrschule Fulda",
          ...overrides,
        },
      });
      return res.json().offer;
    }

    it("lists open offers with exact time windows and filters", async () => {
      await createOffer();
      const res = await app.inject({
        method: "GET",
        url: "/appointment-offers",
        headers: { cookie: studentCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.offers).toHaveLength(1);
      expect(body.offers[0].treffpunkt).toBe("Fahrschule Fulda");
      expect(body.dataAsOf).toBeDefined();
    });

    it("accepts an offer via the server-side booking endpoint (no local booking)", async () => {
      const offer = await createOffer();
      const res = await app.inject({
        method: "POST",
        url: `/appointment-offers/${offer.id}/accept`,
        headers: { cookie: studentCookie },
        payload: { idempotencyKey: "accept-1" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().booking.schuelerId).toBe(fixtures.schuelerId);

      const mine = await app.inject({
        method: "GET",
        url: "/appointments/mine",
        headers: { cookie: studentCookie },
      });
      expect(mine.json().appointments).toHaveLength(1);
    });

    it("is idempotent: accepting twice with the same key returns the same booking", async () => {
      const offer = await createOffer();
      const first = await app.inject({
        method: "POST",
        url: `/appointment-offers/${offer.id}/accept`,
        headers: { cookie: studentCookie },
        payload: { idempotencyKey: "idem-accept" },
      });
      const second = await app.inject({
        method: "POST",
        url: `/appointment-offers/${offer.id}/accept`,
        headers: { cookie: studentCookie },
        payload: { idempotencyKey: "idem-accept" },
      });
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(second.json().booking.id).toBe(first.json().booking.id);
    });

    it("PARALLEL acceptance of the same offer by two students yields exactly one booking", async () => {
      const offer = await createOffer();
      const [a, b] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/appointment-offers/${offer.id}/accept`,
          headers: { cookie: studentCookie },
          payload: { idempotencyKey: "race-a" },
        }),
        app.inject({
          method: "POST",
          url: `/appointment-offers/${offer.id}/accept`,
          headers: { cookie: student2Cookie },
          payload: { idempotencyKey: "race-b" },
        }),
      ]);
      const statuses = [a.statusCode, b.statusCode].sort();
      expect(statuses).toEqual([201, 409]);
    });

    it("rejects accepting an already-expired offer", async () => {
      const offer = await createOffer({
        beginnAt: "2020-01-01T09:00:00.000Z",
        endeAt: "2020-01-01T10:00:00.000Z",
        ablaufAt: "2020-01-01T08:00:00.000Z",
      });
      const res = await app.inject({
        method: "POST",
        url: `/appointment-offers/${offer.id}/accept`,
        headers: { cookie: studentCookie },
        payload: { idempotencyKey: "expired-accept" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().reason).toBe("expired");
    });

    it("declining an offer keeps it open for another student", async () => {
      const offer = await createOffer();
      const decline = await app.inject({
        method: "POST",
        url: `/appointment-offers/${offer.id}/decline`,
        headers: { cookie: studentCookie },
      });
      expect(decline.statusCode).toBe(200);

      const accept = await app.inject({
        method: "POST",
        url: `/appointment-offers/${offer.id}/accept`,
        headers: { cookie: student2Cookie },
        payload: { idempotencyKey: "after-decline" },
      });
      expect(accept.statusCode).toBe(201);
    });
  });

  // ---------------------------------------------------------------------
  // Dokumente: Upload / Ablehnung / Re-Upload
  // ---------------------------------------------------------------------
  describe("documents", () => {
    it("uploads, rejects, and allows a re-upload without losing the audit trail", async () => {
      const upload = buildMultipartBody({
        fields: { typ: "erste-hilfe" },
        fileFieldName: "file",
        fileName: "nachweis.pdf",
        fileContent: Buffer.from("%PDF-1.4 erste-hilfe"),
        mimeType: "application/pdf",
      });
      const uploadRes = await app.inject({
        method: "POST",
        url: "/documents",
        headers: { "idempotency-key": idemKey(), cookie: studentCookie, "content-type": upload.contentType },
        payload: upload.body,
      });
      expect(uploadRes.statusCode).toBe(201);
      const doc = uploadRes.json().document;
      expect(doc.speicherReferenz).not.toContain("base64");
      expect(doc.scanStatus).toBe("sauber");

      const reject = await app.inject({
        method: "POST",
        url: `/documents/${doc.id}/review`,
        headers: { cookie: officeCookie },
        payload: { entscheidung: "abgelehnt", ablehnungsgrund: "Foto unscharf" },
      });
      expect(reject.statusCode).toBe(200);
      expect(reject.json().document.ablehnungsgrund).toBe("Foto unscharf");

      const reupload = buildMultipartBody({
        fields: {},
        fileFieldName: "file",
        fileName: "nachweis-v2.pdf",
        fileContent: Buffer.from("%PDF-1.4 erste-hilfe v2"),
        mimeType: "application/pdf",
      });
      const reuploadRes = await app.inject({
        method: "POST",
        url: `/documents/${doc.id}/reupload`,
        headers: { cookie: studentCookie, "content-type": reupload.contentType },
        payload: reupload.body,
      });
      expect(reuploadRes.statusCode).toBe(201);

      const list = await app.inject({
        method: "GET",
        url: "/documents/mine",
        headers: { cookie: studentCookie },
      });
      const docs = list.json().documents;
      expect(docs).toHaveLength(2);
      const original = docs.find((d: { id: string }) => d.id === doc.id);
      expect(original.ersetztVonDokumentId).toBe(reuploadRes.json().document.id);
    });

    it("rejects an oversized/unsupported file before it ever reaches storage", async () => {
      const badType = buildMultipartBody({
        fields: { typ: "sehtest" },
        fileFieldName: "file",
        fileName: "malware.exe",
        fileContent: Buffer.from("MZ..."),
        mimeType: "application/x-msdownload",
      });
      const res = await app.inject({
        method: "POST",
        url: "/documents",
        headers: { "idempotency-key": idemKey(), cookie: studentCookie, "content-type": badType.contentType },
        payload: badType.body,
      });
      expect(res.statusCode).toBe(415);
    });
  });

  // ---------------------------------------------------------------------
  // Rechnungen: read-only
  // ---------------------------------------------------------------------
  describe("invoices (read-only)", () => {
    it("shows invoice + line items and offers no mutation route", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        const [rechnung] = await sql`
          insert into rechnungen (standort_id, schueler_id, betrag_cent, faellig_am)
          values (${fixtures.standortId}, ${fixtures.schuelerId}, 45000, '2026-09-01')
          returning id`;
        await sql`
          insert into rechnungspositionen (rechnung_id, bezeichnung, menge_cent, einzelpreis_cent, gesamtpreis_cent)
          values (${rechnung.id}, 'Grundgebühr', null, 45000, 45000)`;
      } finally {
        await sql.end();
      }

      const res = await app.inject({
        method: "GET",
        url: "/invoices/mine",
        headers: { cookie: studentCookie },
      });
      expect(res.statusCode).toBe(200);
      const invoices = res.json().invoices;
      expect(invoices).toHaveLength(1);
      expect(invoices[0].positionen).toHaveLength(1);

      const invoiceId = invoices[0].id;
      const paymentLink = await app.inject({
        method: "GET",
        url: `/invoices/${invoiceId}/payment-link`,
        headers: { cookie: studentCookie },
      });
      expect(paymentLink.statusCode).toBe(200);
      expect(paymentLink.json().paymentLink.mode).toBe("mock");

      const inquiry = await app.inject({
        method: "POST",
        url: `/invoices/${invoiceId}/inquiry`,
        headers: { cookie: studentCookie },
        payload: { nachricht: "Warum ist die Rechnung so hoch?" },
      });
      expect(inquiry.statusCode).toBe(200);

      // Die Schüler-App bleibt bei Rechnungen strikt READ-ONLY. Seit
      // PROMPT -1 §2 existiert PATCH /invoices/:id (Rolle finanzen), deshalb
      // ist die Antwort 403 statt 404 – die fachliche Aussage ("Schüler kann
      // eine Rechnung nicht verändern") ist identisch und wird jetzt von der
      // Rollenmatrix bewiesen statt von einer fehlenden Route.
      const mutate = await app.inject({
        method: "PATCH",
        url: `/invoices/${invoiceId}`,
        headers: { cookie: studentCookie },
        payload: { status: "bezahlt" },
      });
      expect(mutate.statusCode).toBe(403);
      expect(mutate.json().requiredPermission).toBe("invoices:manage");
    });
  });

  // ---------------------------------------------------------------------
  // PrüfungsReady
  // ---------------------------------------------------------------------
  describe("exam readiness (PrüfungsReady)", () => {
    it("never returns a pass-probability score, only individual facts", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/me/exam-readiness",
        headers: { cookie: studentCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const serialized = JSON.stringify(body).toLowerCase();
      for (const forbidden of ["score", "prozent", "wahrscheinlichkeit", "percentage"]) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(body.instructorClearance.status).toBe("offen");
      expect(body.officeReview.status).toBe("offen");
      expect(body.dataAsOf).toBeDefined();
    });

    it("reflects an instructor/office clearance decision as read-only data for the student", async () => {
      const grant = await app.inject({
        method: "POST",
        url: "/exam-clearance",
        headers: { cookie: instructorCookie },
        payload: { ausbildungId: fixtures.ausbildungId, entscheidung: "freigegeben" },
      });
      expect(grant.statusCode).toBe(200);

      const readiness = await app.inject({
        method: "GET",
        url: "/me/exam-readiness",
        headers: { cookie: studentCookie },
      });
      expect(readiness.json().instructorClearance.status).toBe("freigegeben");
      expect(readiness.json().officeReview.status).toBe("offen");
    });
  });

  // ---------------------------------------------------------------------
  // Feedback: interne Notizen dürfen NIE in einer schülerseitigen Antwort
  // auftauchen.
  // ---------------------------------------------------------------------
  describe("fahrstundenfeedback", () => {
    it("never leaks internal instructor notes to the student, only released fields", async () => {
      const bookRes = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": idemKey(), cookie: instructorCookie },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          fahrzeugId: fixtures.fahrzeugId,
          beginnAt: "2026-08-13T09:00:00.000Z",
          endeAt: "2026-08-13T10:00:00.000Z",
          art: "Übungsstunde",
          klasse: "B",
        },
      });
      const bookingId = bookRes.json().booking.id;

      const feedbackRes = await app.inject({
        method: "POST",
        url: `/appointments/${bookingId}/feedback`,
        headers: { cookie: instructorCookie },
        payload: {
          wentWell: "Einparken hat gut geklappt",
          workOn: "Kreisverkehr Blickführung",
          nextGoal: "Autobahnauffahrt üben",
          internalNotes: "Schüler wirkte sehr nervös, im Auge behalten",
          releasedFields: ["wentWell", "nextGoal"],
        },
      });
      expect(feedbackRes.statusCode).toBe(201);

      const mine = await app.inject({
        method: "GET",
        url: "/feedback/mine",
        headers: { cookie: studentCookie },
      });
      expect(mine.statusCode).toBe(200);
      const raw = JSON.stringify(mine.json());
      expect(raw).not.toContain("internalNotes");
      expect(raw).not.toContain("nervös");

      const feedback = mine.json().feedback[0];
      expect(feedback.wentWell).toBe("Einparken hat gut geklappt");
      expect(feedback.nextGoal).toBe("Autobahnauffahrt üben");
      // workOn wurde NICHT freigegeben -> muss null sein, obwohl gespeichert.
      expect(feedback.workOn).toBeNull();

      const selfAssessment = await app.inject({
        method: "PATCH",
        url: `/feedback/${feedback.id}/self-assessment`,
        headers: { cookie: studentCookie },
        payload: { text: "Ich fand die Stunde gut, Kreisverkehr ist noch wackelig." },
      });
      expect(selfAssessment.statusCode).toBe(200);
      expect(selfAssessment.json().feedback.studentSelfAssessment).toContain("Kreisverkehr");
    });
  });

  // ---------------------------------------------------------------------
  // Lernen
  // ---------------------------------------------------------------------
  describe("learning resources", () => {
    it("lists class-appropriate resources and tracks visited status", async () => {
      const sql = createRawClient(databaseUrl);
      let resourceId: string;
      try {
        const [resource] = await sql`
          insert into lernressourcen (standort_id, titel, typ, klassen, ort)
          values (${fixtures.standortId}, 'Gefahrentraining Fulda', 'gefahrentraining', '["B"]'::jsonb, 'Fulda')
          returning id`;
        resourceId = resource.id;
      } finally {
        await sql.end();
      }

      const list = await app.inject({
        method: "GET",
        url: "/learning/resources",
        headers: { cookie: studentCookie },
      });
      expect(list.statusCode).toBe(200);
      const resources = list.json().resources;
      expect(resources).toHaveLength(1);
      expect(resources[0].fortschritt).toBe("offen");

      const visit = await app.inject({
        method: "POST",
        url: `/learning/resources/${resourceId}/visit`,
        headers: { cookie: studentCookie },
      });
      expect(visit.statusCode).toBe(200);
      expect(visit.json().fortschritt.status).toBe("besucht");
    });
  });

  // ---------------------------------------------------------------------
  // Krebs Flex – Feature-Flag defaults to hidden
  // ---------------------------------------------------------------------
  describe("krebs flex (feature-flagged)", () => {
    it("defaults to hidden and blocks opt-in until piloted", async () => {
      const flags = await app.inject({
        method: "GET",
        url: "/flags",
        headers: { cookie: studentCookie },
      });
      expect(flags.json().flags.krebs_flex).toBe("hidden");

      const optIn = await app.inject({
        method: "POST",
        url: "/flex/opt-in",
        headers: { cookie: studentCookie },
      });
      expect(optIn.statusCode).toBe(403);
      expect(optIn.json().error).toBe("feature_disabled");
    });

    it("works end-to-end once piloted: opt-in, list, accept, metric", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        await sql`update feature_flags set state = 'pilot' where key = 'krebs_flex' and standort_id is null`;
      } finally {
        await sql.end();
      }

      const optIn = await app.inject({
        method: "POST",
        url: "/flex/opt-in",
        headers: { cookie: studentCookie },
      });
      expect(optIn.statusCode).toBe(200);

      const created = await app.inject({
        method: "POST",
        url: "/flex/offers",
        headers: { cookie: instructorCookie },
        payload: {
          fahrlehrerId: fixtures.fahrlehrerId,
          fahrzeugId: fixtures.fahrzeugId,
          beginnAt: "2026-08-14T09:00:00.000Z",
          endeAt: "2026-08-14T10:00:00.000Z",
          klasse: "B",
          ablaufAt: "2099-01-01T00:00:00.000Z",
        },
      });
      expect(created.statusCode).toBe(201);
      const flexId = created.json().flex.id;

      const listOffers = await app.inject({
        method: "GET",
        url: "/flex/offers",
        headers: { cookie: studentCookie },
      });
      expect(listOffers.json().offers).toHaveLength(1);

      const accept = await app.inject({
        method: "POST",
        url: `/flex/offers/${flexId}/accept`,
        headers: { cookie: studentCookie },
        payload: { idempotencyKey: "flex-accept-1" },
      });
      expect(accept.statusCode).toBe(201);

      const metrics = await app.inject({
        method: "GET",
        url: "/flex/metrics",
        headers: { cookie: studentCookie },
      });
      expect(metrics.json().acceptedOffers).toBe(1);
      expect(metrics.json().hoursSaved).toBeGreaterThan(0);
    });
  });
});
