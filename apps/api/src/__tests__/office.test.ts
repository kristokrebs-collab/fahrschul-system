import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRawClient } from "@fahrschul/database";
import {
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

describe("apps/office – Prompt 2", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let fixtures: SeededFixtures;
  let studentCookie: string;
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
    instructorCookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
    await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);
    officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);

    // Zweiter Schüler bekommt eine laufende Ausbildung Klasse B, damit er in
    // Storno-Retter-Kandidatenberechnungen/Matching-Tests als Kandidat gilt
    // (Prompt-0/1-Fixtures legen das für schueler2 bewusst nicht an).
    const sql = createRawClient(databaseUrl);
    try {
      await sql`insert into ausbildungen (standort_id, schueler_id, klasse) values (${fixtures.standortId}, ${fixtures.schueler2Id}, 'B')`;
    } finally {
      await sql.end();
    }
  });

  // -------------------------------------------------------------------
  // Rollen: nur Büro darf die Büro-Endpunkte nutzen
  // -------------------------------------------------------------------
  describe("role guard (office-only endpoints)", () => {
    it("rejects a student hitting office-only endpoints (403, not 500/200)", async () => {
      for (const url of ["/office/heute", "/leads", "/resources/raeume", "/office/audit"]) {
        const res = await app.inject({ method: "GET", url, headers: { cookie: studentCookie } });
        expect(res.statusCode).toBe(403);
      }
    });

    it("rejects an instructor hitting office-only endpoints (403)", async () => {
      for (const url of ["/office/heute", "/leads", "/resources/raeume", "/office/audit"]) {
        const res = await app.inject({ method: "GET", url, headers: { cookie: instructorCookie } });
        expect(res.statusCode).toBe(403);
      }
    });

    it("rejects unauthenticated requests with 401, not 403", async () => {
      const res = await app.inject({ method: "GET", url: "/office/heute" });
      expect(res.statusCode).toBe(401);
    });

    it("allows buero to reach the office dashboard", async () => {
      const res = await app.inject({ method: "GET", url: "/office/heute", headers: { cookie: officeCookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty("counts");
    });
  });

  // -------------------------------------------------------------------
  // Lead -> Schüler
  // -------------------------------------------------------------------
  describe("Leads/CRM", () => {
    it("creates a lead, converts it to a real Schüler record, and audits both steps", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/leads",
        headers: { cookie: officeCookie },
        payload: { vorname: "Neu", nachname: "Interessent", email: "neu@example.com", quelle: "webseite" },
      });
      expect(created.statusCode).toBe(201);
      const leadId = created.json().lead.id;

      const converted = await app.inject({
        method: "POST",
        url: `/leads/${leadId}/convert`,
        headers: { cookie: officeCookie },
      });
      expect(converted.statusCode).toBe(201);
      expect(converted.json().schueler.vorname).toBe("Neu");
      expect(converted.json().lead.status).toBe("konvertiert");

      // Konvertierung ist nicht zweimal möglich.
      const secondAttempt = await app.inject({
        method: "POST",
        url: `/leads/${leadId}/convert`,
        headers: { cookie: officeCookie },
      });
      expect(secondAttempt.statusCode).toBe(409);

      const audit = await app.inject({ method: "GET", url: "/office/audit", headers: { cookie: officeCookie } });
      const actions = audit.json().events.map((e: { aktion: string }) => e.aktion);
      expect(actions).toContain("leads.create");
      expect(actions).toContain("leads.convert");
    });

    it("a student cannot manage leads", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/leads",
        headers: { cookie: studentCookie },
        payload: { vorname: "X", nachname: "Y" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // Dokumentprüfung (Büro-Gegenstück zum Schüler-Upload aus Prompt 1)
  // -------------------------------------------------------------------
  describe("document verification", () => {
    it("lets office accept a submitted document and reflects it in the queue", async () => {
      const sql = createRawClient(databaseUrl);
      let docId: string;
      try {
        // Phase 3 (§12): `scan_status = 'sauber'` ist neu – FS009 verbietet
        // "verified" ohne sauberen Scan, und ein echter Upload durchläuft den
        // Scan immer. `dokument_status = 'submitted'` ist die Neuschreibung
        // derselben Absicht in der §10-Statusmenge (die Alt-Spalte `status`
        // wird per Trigger daraus abgeleitet).
        const [doc] = await sql`
          insert into dokumente (standort_id, schueler_id, typ, dateiname, speicher_referenz, dokument_status, scan_status)
          values (${fixtures.standortId}, ${fixtures.schuelerId}, 'sehtest', 'sehtest.pdf', 'mock://doc1', 'submitted', 'sauber')
          returning id`;
        docId = doc.id;
      } finally {
        await sql.end();
      }

      const before = await app.inject({ method: "GET", url: "/office/heute", headers: { cookie: officeCookie } });
      const queueItem = before
        .json()
        .items.find((i: { entitaetId: string }) => i.entitaetId === docId);
      expect(queueItem).toBeDefined();
      /**
       * Phase 3 (§4): die Heute-Queue liefert jetzt die VERSION je Zeile mit,
       * und `POST /documents/:id/review` VERLANGT sie (Umschaltpunkt
       * `readExpectedVersion` -> `requireExpectedVersion`). Genau diese
       * Reihenfolge – Liste liefert Version, Schreibvorgang sendet sie – war
       * Phase 2s dokumentierte Voraussetzung für die Umschaltung. Der Test
       * beweist damit zusätzlich, dass die Büro-Oberfläche die Version
       * überhaupt bekommen kann.
       */
      expect(typeof queueItem.version).toBe("number");
      expect(queueItem.etag).toBe(`W/"${queueItem.version}"`);

      const review = await app.inject({
        method: "POST",
        url: `/documents/${docId}/review`,
        headers: { cookie: officeCookie, "if-match": queueItem.etag },
        payload: { entscheidung: "akzeptiert" },
      });
      expect(review.statusCode, review.body).toBe(200);
      expect(review.json().document.status).toBe("geprueft");

      const after = await app.inject({ method: "GET", url: "/office/heute", headers: { cookie: officeCookie } });
      expect(after.json().items.some((i: { entitaetId: string }) => i.entitaetId === docId)).toBe(false);
    });

    it("a student cannot verify documents", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/documents/${fixtures.schuelerId}/review`,
        headers: { cookie: studentCookie },
        payload: { entscheidung: "akzeptiert" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // Matching: harte Regeln (Ablehnung) + Fahrzeugausfall
  // -------------------------------------------------------------------
  describe("hard matching rules on booking (server-side, not just UI)", () => {
    it("rejects a booking for a class the instructor is not qualified for", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": idemKey(), cookie: officeCookie },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          fahrzeugId: fixtures.fahrzeugId,
          beginnAt: "2026-08-03T09:00:00.000Z",
          endeAt: "2026-08-03T10:00:00.000Z",
          art: "Übungsstunde",
          klasse: "A", // Fixture-Fahrlehrer ist nur für B qualifiziert
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().reasons).toContain("INSTRUCTOR_NOT_QUALIFIED");
    });

    it("rejects a booking where the vehicle class does not match", async () => {
      const sql = createRawClient(databaseUrl);
      let wrongClassVehicleId: string;
      try {
        const [vehicle] = await sql`
          insert into fahrzeuge (standort_id, kennzeichen, klasse, bezeichnung)
          values (${fixtures.standortId}, 'FD-KR 9', 'A', 'Falsches Fahrzeug') returning id`;
        wrongClassVehicleId = vehicle.id;
      } finally {
        await sql.end();
      }
      const res = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": idemKey(), cookie: officeCookie },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          fahrzeugId: wrongClassVehicleId,
          beginnAt: "2026-08-03T09:00:00.000Z",
          endeAt: "2026-08-03T10:00:00.000Z",
          art: "Übungsstunde",
          klasse: "B",
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().reasons).toContain("VEHICLE_WRONG_CLASS");
    });

    it("rejects overlapping room bookings (location/room conflict)", async () => {
      const sql = createRawClient(databaseUrl);
      let raumId: string;
      let secondInstructorId: string;
      try {
        const [raum] = await sql`insert into raeume (standort_id, name) values (${fixtures.standortId}, 'Theorieraum 1') returning id`;
        raumId = raum.id;
        const [secondInstructorBenutzer] = await sql`
          insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname)
          values (${fixtures.standortId}, 'fahrlehrer2@test.local', (select password_hash from benutzer where id = ${fixtures.fahrlehrerBenutzerId}), 'fahrlehrer', 'Zweiter', 'Fahrlehrer')
          returning id`;
        const [secondInstructor] = await sql`
          insert into fahrlehrer (standort_id, benutzer_id, vorname, nachname, klassen)
          values (${fixtures.standortId}, ${secondInstructorBenutzer.id}, 'Zweiter', 'Fahrlehrer', '["B"]'::jsonb)
          returning id`;
        secondInstructorId = secondInstructor.id;
      } finally {
        await sql.end();
      }

      const first = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": idemKey(), cookie: officeCookie },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          raumId,
          beginnAt: "2026-08-03T09:00:00.000Z",
          endeAt: "2026-08-03T10:00:00.000Z",
          art: "Theorie",
          klasse: "B",
        },
      });
      expect(first.statusCode).toBe(201);

      const conflicting = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": idemKey(), cookie: officeCookie },
        payload: {
          schuelerId: fixtures.schueler2Id,
          fahrlehrerId: secondInstructorId,
          raumId,
          beginnAt: "2026-08-03T09:30:00.000Z",
          endeAt: "2026-08-03T10:30:00.000Z",
          art: "Theorie",
          klasse: "B",
        },
      });
      expect(conflicting.statusCode).toBe(409);
      expect(conflicting.json().reasons).toContain("ROOM_DOUBLE_BOOKED");
    });

    it("rejects a booking that violates the minimum break (working-time conflict)", async () => {
      const first = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": idemKey(), cookie: officeCookie },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          fahrzeugId: fixtures.fahrzeugId,
          beginnAt: "2026-08-03T09:00:00.000Z",
          endeAt: "2026-08-03T10:00:00.000Z",
          art: "Übungsstunde",
          klasse: "B",
        },
      });
      expect(first.statusCode).toBe(201);

      const backToBack = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": idemKey(), cookie: officeCookie },
        payload: {
          schuelerId: fixtures.schueler2Id,
          fahrlehrerId: fixtures.fahrlehrerId,
          fahrzeugId: fixtures.fahrzeugId,
          beginnAt: "2026-08-03T10:00:00.000Z",
          endeAt: "2026-08-03T11:00:00.000Z",
          art: "Übungsstunde",
          klasse: "B",
        },
      });
      expect(backToBack.statusCode).toBe(409);
      expect(backToBack.json().reasons).toContain("MIN_BREAK_VIOLATED");
    });

    it("rejects booking a vehicle that is not einsatzbereit after an outage report, and the outage surfaces in the Heute-Queue", async () => {
      const outage = await app.inject({
        method: "POST",
        url: "/resources/fahrzeugmaengel",
        headers: { cookie: officeCookie },
        payload: { fahrzeugId: fixtures.fahrzeugId, grund: "Reifenschaden" },
      });
      expect(outage.statusCode).toBe(201);

      const queue = await app.inject({ method: "GET", url: "/office/heute", headers: { cookie: officeCookie } });
      expect(
        queue.json().items.some((i: { grund: string }) => i.grund.includes("Fahrzeugausfall")),
      ).toBe(true);

      const res = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": idemKey(), cookie: officeCookie },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          fahrzeugId: fixtures.fahrzeugId,
          beginnAt: "2026-08-03T09:00:00.000Z",
          endeAt: "2026-08-03T10:00:00.000Z",
          art: "Übungsstunde",
          klasse: "B",
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().reasons).toContain("VEHICLE_NOT_READY");
    });

    it("a student cannot report a vehicle outage", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/resources/fahrzeugmaengel",
        headers: { cookie: studentCookie },
        payload: { fahrzeugId: fixtures.fahrzeugId, grund: "x" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // Krankheit/Ausfall (Fahrlehrer)
  // -------------------------------------------------------------------
  describe("Krankheit/Ausfall", () => {
    it("surfaces a sick instructor in the Sofort bucket and blocks new bookings for them", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        await sql`update fahrlehrer set status = 'krank' where id = ${fixtures.fahrlehrerId}`;
      } finally {
        await sql.end();
      }

      const queue = await app.inject({ method: "GET", url: "/office/heute", headers: { cookie: officeCookie } });
      const sofort = queue.json().items.filter((i: { bucket: string }) => i.bucket === "sofort");
      expect(sofort.some((i: { grund: string }) => i.grund.includes("Fahrlehrerausfall"))).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // Storno-Retter
  // -------------------------------------------------------------------
  describe("Storno-Retter (11-step flow)", () => {
    async function bookOriginal() {
      const res = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": idemKey(), cookie: officeCookie },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          fahrzeugId: fixtures.fahrzeugId,
          beginnAt: "2026-08-05T09:00:00.000Z",
          endeAt: "2026-08-05T10:00:00.000Z",
          art: "Übungsstunde",
          klasse: "B",
        },
      });
      expect(res.statusCode).toBe(201);
      return res.json().booking.id as string;
    }

    it("runs the full flow: raise -> candidates -> broadcast offers -> first valid acceptance wins -> rest closed -> minutes/revenue measured -> audited", async () => {
      const terminbuchungId = await bookOriginal();

      const raised = await app.inject({
        method: "POST",
        url: "/storno",
        headers: { cookie: officeCookie },
        payload: { terminbuchungId, klasse: "B" },
      });
      expect(raised.statusCode).toBe(201);
      const eventId = raised.json().event.id;
      expect(raised.json().event.status).toBe("slot_gesperrt");

      const candidatesRes = await app.inject({
        method: "GET",
        url: `/storno/${eventId}/kandidaten?klasse=B&beginnAt=2026-08-05T09:00:00.000Z&endeAt=2026-08-05T10:00:00.000Z&excludeSchuelerId=${fixtures.schuelerId}`,
        headers: { cookie: officeCookie },
      });
      expect(candidatesRes.statusCode).toBe(200);
      const candidateIds = candidatesRes.json().candidates.map((c: { schuelerId: string }) => c.schuelerId);
      expect(candidateIds).toContain(fixtures.schueler2Id);

      const offersRes = await app.inject({
        method: "POST",
        url: `/storno/${eventId}/angebote`,
        headers: { cookie: officeCookie },
        payload: { kandidatenSchuelerIds: candidateIds, modus: "broadcast" },
      });
      expect(offersRes.statusCode).toBe(201);
      const offers = offersRes.json().offers as Array<{ id: string; schuelerId: string }>;
      const offerForStudent2 = offers.find((o) => o.schuelerId === fixtures.schueler2Id)!;

      const student2Cookie = await loginAs(app, "schueler2@test.local", fixtures.password);
      const accept = await app.inject({
        method: "POST",
        url: `/storno-angebote/${offerForStudent2.id}/accept`,
        headers: { cookie: student2Cookie },
        payload: { idempotencyKey: "storno-accept-1" },
      });
      expect(accept.statusCode).toBe(201);
      expect(accept.json().geretteteMinuten).toBe(60);
      expect(accept.json().geretteterUmsatzCent).toBeGreaterThan(0);

      const audit = await app.inject({ method: "GET", url: "/office/audit", headers: { cookie: officeCookie } });
      const actions = audit.json().events.map((e: { aktion: string }) => e.aktion);
      expect(actions).toContain("storno.raised");
      expect(actions).toContain("storno.offers_sent");
      expect(actions).toContain("storno.accepted");
    });

    it("RACE: two simultaneous acceptances for offers of the same storno event yield exactly one winner", async () => {
      const terminbuchungId = await bookOriginal();
      const raised = await app.inject({
        method: "POST",
        url: "/storno",
        headers: { cookie: officeCookie },
        payload: { terminbuchungId, klasse: "B" },
      });
      const eventId = raised.json().event.id;

      // Dritten Schüler anlegen, damit zwei UNTERSCHIEDLICHE Angebote
      // (unterschiedliche Empfänger) parallel angenommen werden können -
      // das ist der schärfere Race-Test: nicht zwei Requests auf DASSELBE
      // Angebot, sondern zwei GÜLTIGE Angebote desselben Events, von denen
      // trotzdem nur eines zu einer Buchung führen darf.
      const sql = createRawClient(databaseUrl);
      let schueler3Id: string;
      try {
        const [benutzer3] = await sql`
          insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname)
          values (${fixtures.standortId}, 'schueler3@test.local', (select password_hash from benutzer where id = ${fixtures.schuelerBenutzerId}), 'schueler', 'Dritte', 'Schuelerin')
          returning id`;
        const [schueler3] = await sql`
          insert into schueler (standort_id, benutzer_id, vorname, nachname)
          values (${fixtures.standortId}, ${benutzer3.id}, 'Dritte', 'Schuelerin') returning id`;
        schueler3Id = schueler3.id;
        await sql`insert into ausbildungen (standort_id, schueler_id, klasse) values (${fixtures.standortId}, ${schueler3Id}, 'B')`;
      } finally {
        await sql.end();
      }

      const offersRes = await app.inject({
        method: "POST",
        url: `/storno/${eventId}/angebote`,
        headers: { cookie: officeCookie },
        payload: { kandidatenSchuelerIds: [fixtures.schueler2Id, schueler3Id], modus: "broadcast" },
      });
      const offers = offersRes.json().offers as Array<{ id: string; schuelerId: string }>;
      const offerA = offers.find((o) => o.schuelerId === fixtures.schueler2Id)!;
      const offerB = offers.find((o) => o.schuelerId === schueler3Id)!;

      const student2Cookie = await loginAs(app, "schueler2@test.local", fixtures.password);
      const student3Cookie = await loginAs(app, "schueler3@test.local", fixtures.password);

      const [resA, resB] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/storno-angebote/${offerA.id}/accept`,
          headers: { cookie: student2Cookie },
          payload: { idempotencyKey: "race-a" },
        }),
        app.inject({
          method: "POST",
          url: `/storno-angebote/${offerB.id}/accept`,
          headers: { cookie: student3Cookie },
          payload: { idempotencyKey: "race-b" },
        }),
      ]);

      const statuses = [resA.statusCode, resB.statusCode].sort();
      expect(statuses).toEqual([201, 409]);

      // Es existiert am Ende GENAU eine aktive Buchung auf diesem Slot.
      const rawSql = createRawClient(databaseUrl);
      try {
        const bookings = await rawSql`
          select * from terminbuchungen
          where beginn_at = '2026-08-05T09:00:00.000Z' and status <> 'cancelled'`;
        expect(bookings).toHaveLength(1);
      } finally {
        await rawSql.end();
      }
    });

    it("a student cannot raise a storno event (storno:manage is office-only)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/storno",
        headers: { cookie: studentCookie },
        payload: { terminbuchungId: fixtures.schuelerId, klasse: "B" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // Prüfungs-Pipeline
  // -------------------------------------------------------------------
  describe("exam pipeline transitions with authorization checks", () => {
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

    it("rejects buero attempting the fahrlehrer_go transition (403, transition-specific role check)", async () => {
      const id = await createPruefung();
      const res = await app.inject({
        method: "POST",
        url: `/pruefungen/${id}/transition`,
        headers: { "idempotency-key": idemKey(), cookie: officeCookie },
        payload: { to: "fahrlehrer_go" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("FORBIDDEN_ROLE");
    });

    it("allows an instructor to set fahrlehrer_go, then buero to advance through the rest of the pipeline", async () => {
      const id = await createPruefung();
      const go = await app.inject({
        method: "POST",
        url: `/pruefungen/${id}/transition`,
        headers: { "idempotency-key": idemKey(), cookie: instructorCookie },
        payload: { to: "fahrlehrer_go" },
      });
      expect(go.statusCode).toBe(200);
      expect(go.json().pruefung.status).toBe("fahrlehrer_go");

      // Fahrlehrer darf NICHT den nächsten (büro-only) Schritt setzen.
      const wrongActor = await app.inject({
        method: "POST",
        url: `/pruefungen/${id}/transition`,
        headers: { "idempotency-key": idemKey(), cookie: instructorCookie },
        payload: { to: "bueroprüfung" },
      });
      expect(wrongActor.statusCode).toBe(403);

      const advance = await app.inject({
        method: "POST",
        url: `/pruefungen/${id}/transition`,
        headers: { "idempotency-key": idemKey(), cookie: officeCookie },
        payload: { to: "bueroprüfung" },
      });
      expect(advance.statusCode).toBe(200);
    });

    it("rejects an invalid/skipped transition with a reasoned error", async () => {
      const id = await createPruefung();
      const res = await app.inject({
        method: "POST",
        url: `/pruefungen/${id}/transition`,
        headers: { "idempotency-key": idemKey(), cookie: officeCookie },
        payload: { to: "ergebnis_dokumentiert" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("INVALID_TRANSITION");
    });

    it("a student cannot advance the exam pipeline", async () => {
      const id = await createPruefung();
      const res = await app.inject({
        method: "POST",
        url: `/pruefungen/${id}/transition`,
        headers: { "idempotency-key": idemKey(), cookie: studentCookie },
        payload: { to: "fahrlehrer_go" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // Zahlungen: Büro ist lesend, keine Mutationsroute
  // -------------------------------------------------------------------
  describe("payments visibility (office is read-mostly, Finance owns mutation)", () => {
    it("office cannot mutate an invoice/payment (403 – Finance owns financial mutation)", async () => {
      // PROMPT -1 §2 hat POST /invoices + PATCH /invoices/:id eingeführt
      // ("Rechnung erzeugen" ist eine der neun idempotenzpflichtigen
      // Operationen). Die Route EXISTIERT daher jetzt – die fachliche Aussage
      // dieses Tests ist unverändert und wird sogar schärfer geprüft: Büro
      // wird von der Rollenmatrix abgewiesen (403 invoices:manage), nicht nur
      // durch eine fehlende Route (404).
      const res = await app.inject({
        method: "PATCH",
        url: "/invoices/some-id",
        headers: { cookie: officeCookie },
        payload: { status: "bezahlt" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().requiredPermission).toBe("invoices:manage");

      const create = await app.inject({
        method: "POST",
        url: "/invoices",
        headers: { cookie: officeCookie, "idempotency-key": "office-darf-nicht" },
        payload: { schuelerId: fixtures.schuelerId, positionen: [] },
      });
      expect(create.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // Schüler-360 + großes Seed-Set
  // -------------------------------------------------------------------
  describe("Schüler list & 360 view with a larger seeded dataset", () => {
    it("paginates sanely across 100+ seeded students", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        const rows = Array.from({ length: 105 }, (_, i) => ({
          standort_id: fixtures.standortId,
          vorname: `Vorname${i}`,
          nachname: `Nachname${i}`,
        }));
        await sql`insert into schueler ${sql(rows)}`;
      } finally {
        await sql.end();
      }

      const page1 = await app.inject({ method: "GET", url: "/office/schueler?page=1&pageSize=50", headers: { cookie: officeCookie } });
      expect(page1.statusCode).toBe(200);
      const body1 = page1.json();
      expect(body1.schueler).toHaveLength(50);
      expect(body1.total).toBeGreaterThanOrEqual(107); // 105 + 2 aus den Fixtures

      const page3 = await app.inject({ method: "GET", url: "/office/schueler?page=3&pageSize=50", headers: { cookie: officeCookie } });
      expect(page3.json().schueler.length).toBeGreaterThan(0);
      expect(page3.json().schueler.length).toBeLessThanOrEqual(50);
    });

    it("returns a 360 header with only nächstes Ziel/Blocker/nächster Termin/empfohlene Aktion", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/office/schueler/${fixtures.schuelerId}`,
        headers: { cookie: officeCookie },
      });
      expect(res.statusCode).toBe(200);
      const header = res.json().header;
      expect(Object.keys(header).sort()).toEqual(["blocker", "empfohleneAktion", "naechsterTermin", "naechstesZiel"].sort());
      expect(res.json().ausbildungen).toBeDefined();
      expect(res.json().dokumente).toBeDefined();
    });

    it("a fahrlehrer cannot read the office 360 view of an arbitrary student", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/office/schueler/${fixtures.schuelerId}`,
        headers: { cookie: instructorCookie },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // Audit-Trail-Präsenz allgemein
  // -------------------------------------------------------------------
  describe("audit trail", () => {
    it("writes an audit event for a resource booking made by the office", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": idemKey(), cookie: officeCookie },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          fahrzeugId: fixtures.fahrzeugId,
          beginnAt: "2026-08-06T09:00:00.000Z",
          endeAt: "2026-08-06T10:00:00.000Z",
          art: "Übungsstunde",
          klasse: "B",
        },
      });
      expect(res.statusCode).toBe(201);
      const audit = await app.inject({ method: "GET", url: "/office/audit", headers: { cookie: officeCookie } });
      const bookingEvent = audit.json().events.find((e: { entitaet: string; entitaetId: string }) => e.entitaetId === res.json().booking.id);
      expect(bookingEvent).toBeDefined();
      expect(bookingEvent.entitaet).toBe("terminbuchung");
    });

    it("a fahrlehrer cannot read the office audit log (narrower audit:read:office permission)", async () => {
      const res = await app.inject({ method: "GET", url: "/office/audit", headers: { cookie: instructorCookie } });
      expect(res.statusCode).toBe(403);
    });
  });
});
