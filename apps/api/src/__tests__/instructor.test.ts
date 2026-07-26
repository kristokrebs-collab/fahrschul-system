import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createRawClient } from "@fahrschul/database";
import type { FastifyInstance } from "fastify";
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

const databaseUrl = testDatabaseUrl();
let app: FastifyInstance;
let fixtures: SeededFixtures;

async function insertBooking(opts: {
  standortId: string;
  schuelerId: string;
  fahrlehrerId: string;
  fahrzeugId?: string | null;
  beginnAt: Date;
  endeAt: Date;
  art?: string;
}) {
  const sql = createRawClient(databaseUrl);
  try {
    const [row] = await sql`
      insert into terminbuchungen (standort_id, schueler_id, fahrlehrer_id, fahrzeug_id, beginn_at, ende_at, art)
      values (${opts.standortId}, ${opts.schuelerId}, ${opts.fahrlehrerId}, ${opts.fahrzeugId ?? null}, ${opts.beginnAt.toISOString()}, ${opts.endeAt.toISOString()}, ${opts.art ?? "Übungsstunde"})
      returning *`;
    return row;
  } finally {
    await sql.end();
  }
}

beforeEach(async () => {
  await ensureMigrated(databaseUrl);
  await truncateAll(databaseUrl);
  fixtures = await seedFixtures(databaseUrl);
  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

function todayAt(hour: number, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

describe("apps/instructor – Prompt 3", () => {
  it("role guard: a student cannot hit instructor-only endpoints (403, not 500/200)", async () => {
    const cookie = await loginAs(app, "schueler@test.local", fixtures.password);
    const res = await app.inject({ method: "GET", url: "/instructor/heute", headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it("role guard: unauthenticated requests get 401", async () => {
    const res = await app.inject({ method: "GET", url: "/instructor/heute" });
    expect(res.statusCode).toBe(401);
  });

  it("Heute: shows today's own bookings live from the office booking data, not another instructor's", async () => {
    await insertBooking({
      standortId: fixtures.standortId,
      schuelerId: fixtures.schuelerId,
      fahrlehrerId: fixtures.fahrlehrerId,
      fahrzeugId: fixtures.fahrzeugId,
      beginnAt: todayAt(10),
      endeAt: todayAt(11),
    });
    const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
    const res = await app.inject({ method: "GET", url: "/instructor/heute", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.termine).toHaveLength(1);
    expect(body.termine[0].schueler.id).toBe(fixtures.schuelerId);
  });

  describe("Stunde starten (server-side validation)", () => {
    it("starts a valid lesson", async () => {
      const booking = await insertBooking({
        standortId: fixtures.standortId,
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        fahrzeugId: fixtures.fahrzeugId,
        beginnAt: todayAt(9),
        endeAt: todayAt(10),
      });
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const res = await app.inject({ method: "POST", url: `/instructor/lessons/${booking.id}/start`, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json().termin.status).toBe("gestartet");
    });

    it("rejects starting a lesson that belongs to a different instructor", async () => {
      const sql = createRawClient(databaseUrl);
      const [otherFahrlehrer] = await sql`
        insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname)
        values (${fixtures.standortId}, 'other-fahrlehrer@test.local', (select password_hash from benutzer where id = ${fixtures.fahrlehrerBenutzerId}), 'fahrlehrer', 'Other', 'Instructor')
        returning id`;
      const [otherFahrlehrerRow] = await sql`
        insert into fahrlehrer (standort_id, benutzer_id, vorname, nachname, klassen)
        values (${fixtures.standortId}, ${otherFahrlehrer.id}, 'Other', 'Instructor', '["B"]'::jsonb)
        returning id`;
      await sql.end();

      const booking = await insertBooking({
        standortId: fixtures.standortId,
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: otherFahrlehrerRow.id,
        beginnAt: todayAt(9),
        endeAt: todayAt(10),
      });
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const res = await app.inject({ method: "POST", url: `/instructor/lessons/${booking.id}/start`, headers: { cookie } });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("NOT_OWN_BOOKING");
    });

    it("rejects starting a lesson whose vehicle is not einsatzbereit (conflict)", async () => {
      // Reihenfolge geändert wegen PROMPT -1 §3: ein GESPERRTES Fahrzeug kann
      // seit Migration 0007 gar nicht mehr verplant werden (DB-Trigger
      // fs_kein_gesperrtes_fahrzeug, SQLSTATE FS005) – der frühere Ablauf
      // "erst sperren, dann Termin einfügen" ist jetzt selbst eine
      // Invariantenverletzung. Der fachliche Fall dieses Tests ist der
      // realistische: der Termin existiert BEREITS und das Fahrzeug fällt
      // danach aus. Die geprüfte Aussage (Start wird mit 409
      // VEHICLE_NOT_READY abgelehnt) ist unverändert.
      const booking = await insertBooking({
        standortId: fixtures.standortId,
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        fahrzeugId: fixtures.fahrzeugId,
        beginnAt: todayAt(9),
        endeAt: todayAt(10),
      });
      const sql = createRawClient(databaseUrl);
      await sql`update fahrzeuge set status = 'wartung' where id = ${fixtures.fahrzeugId}`;
      await sql.end();
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const res = await app.inject({ method: "POST", url: `/instructor/lessons/${booking.id}/start`, headers: { cookie } });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("VEHICLE_NOT_READY");
    });

    it("rejects starting a second lesson while one is already running (conflict detection)", async () => {
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const b1 = await insertBooking({
        standortId: fixtures.standortId,
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        beginnAt: todayAt(9),
        endeAt: todayAt(10),
      });
      const b2 = await insertBooking({
        standortId: fixtures.standortId,
        schuelerId: fixtures.schueler2Id,
        fahrlehrerId: fixtures.fahrlehrerId,
        beginnAt: todayAt(11),
        endeAt: todayAt(12),
      });
      const start1 = await app.inject({ method: "POST", url: `/instructor/lessons/${b1.id}/start`, headers: { cookie } });
      expect(start1.statusCode).toBe(200);
      const start2 = await app.inject({ method: "POST", url: `/instructor/lessons/${b2.id}/start`, headers: { cookie } });
      expect(start2.statusCode).toBe(409);
      expect(start2.json().error).toBe("INSTRUCTOR_ALREADY_IN_LESSON");
    });
  });

  describe("Stunde beenden (mandatory ordered flow)", () => {
    async function startedBooking(cookie: string) {
      const booking = await insertBooking({
        standortId: fixtures.standortId,
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        fahrzeugId: fixtures.fahrzeugId,
        beginnAt: todayAt(9),
        endeAt: todayAt(10),
      });
      await app.inject({ method: "POST", url: `/instructor/lessons/${booking.id}/start`, headers: { cookie } });
      return booking;
    }

    const fullPayload = {
      tatsaechlicheDauerMinuten: 55,
      stundenart: "Übungsstunde",
      lernziele: ["Einparken"],
      beobachteteKompetenzfelder: [{ feld: "abstand", kompetenzstatus: "in_uebung", beobachtung: "hält Abstand meist ein" }],
      kurznotiz: "Guter Fortschritt heute.",
      naechstesZiel: "Kreisverkehr üben",
      schuelerfeedback: "Fühlte sich sicherer.",
      bestaetigung: true,
    };

    it("rejects an incomplete completion payload (missing field -> completion rejected, no event)", async () => {
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const booking = await startedBooking(cookie);
      const { kurznotiz, ...incomplete } = fullPayload;
      const res = await app.inject({
        method: "POST",
        url: `/instructor/lessons/${booking.id}/complete`,
        headers: { "idempotency-key": idemKey(), cookie },
        payload: incomplete,
      });
      expect(res.statusCode).toBe(400);

      const sql = createRawClient(databaseUrl);
      const events = await sql`select * from audit_events where type = 'lesson.completed' and entitaet_id = ${booking.id}`;
      const stillRunning = await sql`select status from terminbuchungen where id = ${booking.id}`;
      await sql.end();
      expect(events).toHaveLength(0);
      expect(stillRunning[0].status).toBe("gestartet");
    });

    it("rejects completion with bestaetigung=false (confirmation step is mandatory)", async () => {
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const booking = await startedBooking(cookie);
      const res = await app.inject({
        method: "POST",
        url: `/instructor/lessons/${booking.id}/complete`,
        headers: { "idempotency-key": idemKey(), cookie },
        payload: { ...fullPayload, bestaetigung: false },
      });
      expect(res.statusCode).toBe(400);
    });

    it("completes a lesson with a full payload, emits lesson.completed, and persists Kompetenzraster observations", async () => {
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const booking = await startedBooking(cookie);
      const res = await app.inject({
        method: "POST",
        url: `/instructor/lessons/${booking.id}/complete`,
        headers: { "idempotency-key": idemKey(), cookie },
        payload: fullPayload,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().termin.status).toBe("abgeschlossen");

      const sql = createRawClient(databaseUrl);
      const events = await sql`select * from audit_events where type = 'lesson.completed' and entitaet_id = ${booking.id}`;
      const kompetenzen = await sql`select * from kompetenzbeobachtungen where terminbuchung_id = ${booking.id}`;
      await sql.end();
      expect(events).toHaveLength(1);
      expect(kompetenzen).toHaveLength(1);
      expect(kompetenzen[0].feld).toBe("abstand");
    });

    it("refuses to complete a lesson that was never started", async () => {
      const booking = await insertBooking({
        standortId: fixtures.standortId,
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        beginnAt: todayAt(9),
        endeAt: todayAt(10),
      });
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const res = await app.inject({
        method: "POST",
        url: `/instructor/lessons/${booking.id}/complete`,
        headers: { "idempotency-key": idemKey(), cookie },
        payload: fullPayload,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("NOT_STARTED");
    });
  });

  describe("no-show and Verspätung", () => {
    it("marks a booking as no-show", async () => {
      const booking = await insertBooking({
        standortId: fixtures.standortId,
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        beginnAt: todayAt(9),
        endeAt: todayAt(10),
      });
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const res = await app.inject({ method: "POST", url: `/instructor/lessons/${booking.id}/no-show`, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json().termin.status).toBe("no_show");
    });

    it("records Verspätung minutes", async () => {
      const booking = await insertBooking({
        standortId: fixtures.standortId,
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        beginnAt: todayAt(9),
        endeAt: todayAt(10),
      });
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const res = await app.inject({
        method: "POST",
        url: `/instructor/lessons/${booking.id}/verspaetung`,
        headers: { cookie },
        payload: { minuten: 12 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().termin.verspaetungMinuten).toBe(12);
    });
  });

  describe("Sprachprotokoll (voice log) split-save", () => {
    it("never leaks the internal summary to any student-facing surface, only released fields, and nothing is visible before confirm", async () => {
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const booking = await insertBooking({
        standortId: fixtures.standortId,
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        beginnAt: todayAt(9),
        endeAt: todayAt(10),
      });

      const created = await app.inject({
        method: "POST",
        url: "/instructor/voice-logs",
        headers: { cookie },
        payload: { terminbuchungId: booking.id, audioReferenzOderDiktat: "Heute gut vorwärts gefahren." },
      });
      expect(created.statusCode).toBe(201);
      const logId = created.json().sprachprotokoll.id;
      expect(created.json().sprachprotokoll.transcriptOriginal).toBe("Heute gut vorwärts gefahren.");

      // Vor Bestätigung: Schüler sieht noch KEIN Feedback.
      const studentCookie = await loginAs(app, "schueler@test.local", fixtures.password);
      const before = await app.inject({ method: "GET", url: "/feedback/mine", headers: { cookie: studentCookie } });
      expect(before.json().feedback).toHaveLength(0);

      const edited = await app.inject({
        method: "PATCH",
        url: `/instructor/voice-logs/${logId}`,
        headers: { cookie },
        payload: {
          internZusammenfassung: "GEHEIME interne Einschätzung, niemals für Schüler.",
          schuelerseitigZusammenfassung: "Weiter an Kreisverkehren üben.",
          naechstesZiel: "Autobahn",
        },
      });
      expect(edited.statusCode).toBe(200);

      const confirmed = await app.inject({ method: "POST", url: `/instructor/voice-logs/${logId}/confirm`, headers: { cookie } });
      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json().sprachprotokoll.sprachprotokollStatus).toBe("bestaetigt");

      const after = await app.inject({ method: "GET", url: "/feedback/mine", headers: { cookie: studentCookie } });
      const feedback = after.json().feedback;
      expect(feedback).toHaveLength(1);
      expect(feedback[0].workOn).toBe("Weiter an Kreisverkehren üben.");
      expect(feedback[0].nextGoal).toBe("Autobahn");
      // Internal summary NIE Teil der schülerseitigen Antwort.
      expect(JSON.stringify(feedback[0])).not.toContain("GEHEIME interne Einschätzung");
      expect(feedback[0].internalNotes).toBeUndefined();
    });

    it("refuses to edit or re-confirm an already-confirmed voice log", async () => {
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const booking = await insertBooking({
        standortId: fixtures.standortId,
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        beginnAt: todayAt(9),
        endeAt: todayAt(10),
      });
      const created = await app.inject({
        method: "POST",
        url: "/instructor/voice-logs",
        headers: { cookie },
        payload: { terminbuchungId: booking.id, audioReferenzOderDiktat: "Notiz." },
      });
      const logId = created.json().sprachprotokoll.id;
      await app.inject({ method: "POST", url: `/instructor/voice-logs/${logId}/confirm`, headers: { cookie } });
      const reconfirm = await app.inject({ method: "POST", url: `/instructor/voice-logs/${logId}/confirm`, headers: { cookie } });
      expect(reconfirm.statusCode).toBe(409);
    });
  });

  describe("Fahrzeug: Mangelmeldung + outage blocks new bookings", () => {
    it("an instructor-reported Mangel with einsatzbereit=false blocks new bookings for that vehicle", async () => {
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const report = await app.inject({
        method: "POST",
        url: "/instructor/vehicle-issues",
        headers: { cookie },
        payload: {
          fahrzeugId: fixtures.fahrzeugId,
          grund: "Reifen platt",
          schweregrad: "kritisch",
          einsatzbereit: false,
          warnleuchten: ["reifendruck"],
        },
      });
      expect(report.statusCode).toBe(201);

      const bookingAttempt = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": idemKey(), cookie },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          fahrzeugId: fixtures.fahrzeugId,
          beginnAt: todayAt(14).toISOString(),
          endeAt: todayAt(15).toISOString(),
          art: "Übungsstunde",
          klasse: "B",
        },
      });
      expect(bookingAttempt.statusCode).toBe(409);
      expect(bookingAttempt.json().reasons ?? bookingAttempt.json().error).toBeDefined();
    });

    it("a student cannot report a vehicle issue", async () => {
      const cookie = await loginAs(app, "schueler@test.local", fixtures.password);
      const res = await app.inject({
        method: "POST",
        url: "/instructor/vehicle-issues",
        headers: { cookie },
        payload: { fahrzeugId: fixtures.fahrzeugId, grund: "x", einsatzbereit: true, warnleuchten: [] },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("Prüfungs-Go authorization (reusing packages/domain pipeline)", () => {
    it("wrong role (buero) is rejected for the fahrlehrer_go transition even from the instructor route surface", async () => {
      const [pruefung] = await (async () => {
        const sql = createRawClient(databaseUrl);
        try {
          return await sql`
            insert into pruefungen (standort_id, ausbildung_id, schueler_id, klasse)
            values (${fixtures.standortId}, ${fixtures.ausbildungId}, ${fixtures.schuelerId}, 'B')
            returning *`;
        } finally {
          await sql.end();
        }
      })();
      await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);
      const bueroCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
      const res = await app.inject({
        method: "POST",
        url: `/pruefungen/${pruefung.id}/transition`,
        headers: { "idempotency-key": idemKey(), cookie: bueroCookie },
        payload: { to: "fahrlehrer_go" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("FORBIDDEN_ROLE");
    });
  });

  describe("Arbeitszeit (own view)", () => {
    it("shows plan vs. actual for today, no ranking of other instructors", async () => {
      await insertBooking({
        standortId: fixtures.standortId,
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        beginnAt: todayAt(9),
        endeAt: todayAt(10),
      });
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const res = await app.inject({ method: "GET", url: "/instructor/arbeitszeit", headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.heute.planMinuten).toBe(60);
      expect(body).not.toHaveProperty("ranking");
    });
  });

  describe("remote logout (session invalidation)", () => {
    it("logout-all invalidates every session for the user, not just the current one", async () => {
      const cookieA = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const cookieB = await loginAs(app, "fahrlehrer@test.local", fixtures.password);

      const stillOkA = await app.inject({ method: "GET", url: "/me", headers: { cookie: cookieA } });
      expect(stillOkA.statusCode).toBe(200);

      const logoutAll = await app.inject({ method: "POST", url: "/auth/logout-all", headers: { cookie: cookieB } });
      expect(logoutAll.statusCode).toBe(200);
      expect(logoutAll.json().revokedSessions).toBeGreaterThanOrEqual(2);

      const afterA = await app.inject({ method: "GET", url: "/me", headers: { cookie: cookieA } });
      expect(afterA.statusCode).toBe(401);
      const afterB = await app.inject({ method: "GET", url: "/me", headers: { cookie: cookieB } });
      expect(afterB.statusCode).toBe(401);
    });
  });

  describe("Schülerbriefing", () => {
    it("returns the ~15s briefing content (heute üben, darauf achten, offene Lernziele, nächster formaler Schritt)", async () => {
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      await insertBooking({
        standortId: fixtures.standortId,
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        beginnAt: todayAt(9),
        endeAt: todayAt(10),
      });
      const res = await app.inject({ method: "GET", url: `/instructor/schueler/${fixtures.schuelerId}/briefing`, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("heuteUeben");
      expect(body).toHaveProperty("daraufAchten");
      expect(body).toHaveProperty("offeneLernziele");
      expect(body).toHaveProperty("naechsterFormalerSchritt");
    });

    it("rejects a fahrlehrer briefing request for a student they never had a booking with (own-scope)", async () => {
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const res = await app.inject({
        method: "GET",
        url: `/instructor/schueler/${fixtures.schueler2Id}/briefing`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
