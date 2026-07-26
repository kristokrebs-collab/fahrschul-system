import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, ensureMigrated, extractCookie, idemKey, seedFixtures, testDatabaseUrl, truncateAll, type SeededFixtures } from "./helpers.js";

describe("appointment booking – server-side conflict check (non-negotiable)", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let fixtures: SeededFixtures;
  let cookie: string;

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
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "fahrlehrer@test.local", password: fixtures.password },
    });
    cookie = extractCookie(loginRes.headers["set-cookie"]);
  });

  function bookingPayload(overrides: Record<string, unknown> = {}) {
    return {
      schuelerId: fixtures.schuelerId,
      fahrlehrerId: fixtures.fahrlehrerId,
      fahrzeugId: fixtures.fahrzeugId,
      beginnAt: "2026-08-03T09:00:00.000Z",
      endeAt: "2026-08-03T10:00:00.000Z",
      art: "Übungsstunde",
      klasse: "B",
      ...overrides,
    };
  }

  it("creates a booking when the instructor is free", async () => {
    const res = await app.inject({ method: "POST", url: "/appointments", headers: { "idempotency-key": idemKey(), cookie }, payload: bookingPayload() });
    expect(res.statusCode).toBe(201);
    expect(res.json().booking.fahrlehrerId).toBe(fixtures.fahrlehrerId);
  });

  it("REJECTS booking the same instructor for an overlapping slot a second time (the critical test)", async () => {
    const first = await app.inject({ method: "POST", url: "/appointments", headers: { "idempotency-key": idemKey(), cookie }, payload: bookingPayload() });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/appointments",
      headers: { "idempotency-key": idemKey(), cookie },
      payload: bookingPayload({
        beginnAt: "2026-08-03T09:30:00.000Z",
        endeAt: "2026-08-03T10:30:00.000Z",
      }),
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("booking_conflict");
  });

  it("REJECTS an exact duplicate double-booking attempt (same instructor, same slot)", async () => {
    const first = await app.inject({ method: "POST", url: "/appointments", headers: { "idempotency-key": idemKey(), cookie }, payload: bookingPayload() });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({ method: "POST", url: "/appointments", headers: { "idempotency-key": idemKey(), cookie }, payload: bookingPayload() });
    expect(second.statusCode).toBe(409);
  });

  it("allows a non-overlapping booking for the same instructor once the minimum break has passed", async () => {
    const first = await app.inject({ method: "POST", url: "/appointments", headers: { "idempotency-key": idemKey(), cookie }, payload: bookingPayload() });
    expect(first.statusCode).toBe(201);

    // Prompt 2 ergänzt "Pause/Arbeitszeit" als harte Regel (siehe
    // packages/scheduling MIN_BREAK_VIOLATED): unmittelbar back-to-back
    // (10:00 direkt nach 10:00-Ende) ist seitdem KEIN gültiger Slot mehr für
    // denselben Fahrlehrer, siehe office.test.ts
    // "rejects a booking that violates the minimum break". Dieser Test prüft
    // weiterhin das ursprüngliche Non-Negotiable (nicht-überschneidende
    // Folgebuchung ist erlaubt), nur mit einem Abstand, der die neue
    // Mindestpause einhält.
    const second = await app.inject({
      method: "POST",
      url: "/appointments",
      headers: { "idempotency-key": idemKey(), cookie },
      payload: bookingPayload({
        fahrzeugId: null,
        beginnAt: "2026-08-03T10:15:00.000Z",
        endeAt: "2026-08-03T11:15:00.000Z",
      }),
    });
    expect(second.statusCode).toBe(201);
  });

  it("rejects when the instructor is not qualified for the requested class", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/appointments",
      headers: { "idempotency-key": idemKey(), cookie },
      payload: bookingPayload({ klasse: "A", fahrzeugId: null }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().reasons).toContain("INSTRUCTOR_NOT_QUALIFIED");
  });

  it("allows two concurrent requests for the same slot and rejects exactly one (DB-level race safety)", async () => {
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/appointments", headers: { "idempotency-key": idemKey(), cookie }, payload: bookingPayload() }),
      app.inject({ method: "POST", url: "/appointments", headers: { "idempotency-key": idemKey(), cookie }, payload: bookingPayload() }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([201, 409]);
  });

  /**
   * PROMPT -1 Phase 3: derselbe Fall ZWANZIGMAL.
   *
   * ## Warum dieser Test existiert
   *
   * Der Test darüber macht genau EINEN Versuch – und war deshalb blind für
   * einen echten Fehler: `terminbuchungen` trägt ZWEI GiST-EXCLUDE-Constraints
   * (Fahrlehrer und Fahrzeug). Kollidieren zwei gleichzeitige Einfügungen in
   * BEIDEN, kann PostgreSQL einen **Deadlock** (40P01) melden statt der
   * erwarteten Constraint-Verletzung (23P01) – Transaktion A wartet in Index 1
   * auf B, B in Index 2 auf A. Der Verlierer bekam dann HTTP 500 statt 409.
   *
   * Gemessen vor der Behebung: **9–10 von 50** Durchläufen. Der Fehler
   * existiert seit Phase 1 und ist gegen den Stand von Commit `1db1118`
   * reproduziert; er war nur unauffällig, weil ein einzelner Versuch ihn in
   * ~80 % der Fälle nicht trifft.
   *
   * Behoben in `lib/idempotency.ts`: ein Serialisierungsfehler wird bis zu
   * viermal wiederholt (Klassifikation und Backoff aus §9, keine zweite
   * Politik). Ein Deadlock-Opfer wird vollständig zurückgerollt, ein
   * Wiederholversuch ist daher sicher und trifft den committeten Gewinner.
   *
   * Zwanzig Runden reichen: bei einer Fehlerquote von ~20 % je Runde wäre die
   * Wahrscheinlichkeit, einen Rückfall NICHT zu bemerken, unter 2 %.
   */
  it("bleibt über 20 Runden gleichzeitiger Doppelbuchung deterministisch (kein 500 durch Deadlock)", async () => {
    const zaehler: Record<number, number> = {};
    for (let runde = 0; runde < 20; runde += 1) {
      const beginn = new Date(Date.UTC(2026, 8, 1 + runde, 9, 0, 0)).toISOString();
      const ende = new Date(Date.UTC(2026, 8, 1 + runde, 10, 0, 0)).toISOString();
      const payload = bookingPayload({ beginnAt: beginn, endeAt: ende });
      const [a, b] = await Promise.all([
        app.inject({ method: "POST", url: "/appointments", headers: { "idempotency-key": idemKey(), cookie }, payload }),
        app.inject({ method: "POST", url: "/appointments", headers: { "idempotency-key": idemKey(), cookie }, payload }),
      ]);
      for (const res of [a, b]) {
        zaehler[res.statusCode] = (zaehler[res.statusCode] ?? 0) + 1;
      }
      expect([a.statusCode, b.statusCode].sort(), `Runde ${runde}: ${a.body} | ${b.body}`).toEqual([201, 409]);
    }
    // Genau ein Gewinner und genau ein Verlierer je Runde – nie ein 5xx.
    expect(zaehler).toEqual({ 201: 20, 409: 20 });
  }, 60000);

  it("idempotency key: submitting the same booking twice with the same key returns the same booking, not two", async () => {
    const idempotencyKey = "test-idempotency-key-1";
    const first = await app.inject({
      method: "POST",
      url: "/appointments",
      headers: { cookie },
      payload: bookingPayload({ idempotencyKey }),
    });
    expect(first.statusCode).toBe(201);
    const firstBookingId = first.json().booking.id;

    const second = await app.inject({
      method: "POST",
      url: "/appointments",
      headers: { cookie },
      payload: bookingPayload({ idempotencyKey }),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().booking.id).toBe(firstBookingId);
    expect(second.json().reused).toBe(true);
  });

  it("idempotency key does not mask conflicts for a genuinely different booking", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/appointments",
      headers: { cookie },
      payload: bookingPayload({ idempotencyKey: "key-a" }),
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/appointments",
      headers: { cookie },
      payload: bookingPayload({ idempotencyKey: "key-b" }),
    });
    expect(second.statusCode).toBe(409);
  });
});
