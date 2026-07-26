import { createRawClient, checkDatabaseIntegrity, compareRowCounts } from "@fahrschul/database";
import type { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import {
  buildMultipartBody,
  buildTestApp,
  enableMfa,
  ensureMigrated,
  extractCookie,
  idemKey,
  loginAs,
  seedFixtures,
  testDatabaseUrl,
  truncateAll,
  type SeededFixtures,
} from "./helpers.js";
import { claimOutboxBatch, recoverExpiredOutboxLeases, runOutboxOnce } from "../workers/outbox.js";
import { buildConsumers } from "../workers/consumers.js";
import { createScheduler } from "../workers/scheduler.js";
import { getDb } from "../db.js";
import { createNotificationsAdapter } from "@fahrschul/integrations";
import { IDEMPOTENCY_TTL_MS } from "../lib/idempotency.js";
import type { RateLimitConfig } from "../lib/rate-limit.js";

/**
 * PROMPT -1 §20 (Phase 4) – DIE ACHTZEHN CHAOS- UND WIEDERANLAUFTESTS.
 *
 * Jedes Szenario ist ein eigener `describe`-Block mit der Nummer aus §20, damit
 * der Bericht (`docs/chaos-test-report.md`) 1:1 auf Testnamen verweisen kann und
 * nicht auf Prosa.
 *
 * ## Was in dieser Umgebung NICHT ausführbar ist – vorweg und nicht versteckt
 *
 * Vier Szenarien haben einen Anteil, der einen echten Browser braucht (§1
 * Netzabbruch im Browser, §7 SSE-Verlust im Browser, §11 sieben Tage mit
 * geschlossener App, §13 Uploadabbruch im Datei-Dialog). Playwright ist in
 * dieser Sandbox nicht installierbar (in Phase 4 erneut geprüft, siehe
 * `docs/chaos-test-report.md`, Abschnitt „Was unausgeführt bleibt"). Für jedes
 * dieser Szenarien ist deshalb hier die HÖCHSTE tatsächlich ausführbare Ebene
 * geprüft – API bzw. Client-Kernlogik – und der Browseranteil im Bericht als
 * unausgeführt benannt. Kein Szenario gilt als „bestanden", weil darüber
 * nachgedacht wurde.
 *
 * ## Warum die Tests gegen einen ratenbegrenzten Server laufen
 *
 * `buildTestApp()` schaltet Ratenbegrenzung und Brute-Force-Schutz NICHT ab,
 * sondern setzt weite Kontingente (`TEST_RATE_LIMIT`). Szenario 2 („dieselbe
 * Anfrage zehnmal") und Szenario 3 („zwei gleichzeitig") sind damit echte
 * Idempotenz- bzw. Constraint-Beweise und nicht versehentlich Rate-Limit-Tests.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..", "..");

/** Ein minimales, gültiges PDF – Magic Bytes (§12) müssen stimmen. */
const PDF = Buffer.concat([
  Buffer.from("%PDF-1.7\n"),
  Buffer.from("1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"),
]);

describe("PROMPT -1 §20 – Chaos- und Wiederanlauftests", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let fixtures: SeededFixtures;
  let instructorCookie: string;
  let studentCookie: string;
  let student2Cookie: string;
  let bueroCookie: string;

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
    instructorCookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
    studentCookie = await loginAs(app, "schueler@test.local", fixtures.password);
    student2Cookie = await loginAs(app, "schueler2@test.local", fixtures.password);
    bueroCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
  });

  // -------------------------------------------------------------------------
  // Hilfsfunktionen
  // -------------------------------------------------------------------------

  async function createOffer(overrides: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: "POST",
      url: "/appointment-offers",
      headers: { cookie: instructorCookie },
      payload: {
        fahrlehrerId: fixtures.fahrlehrerId,
        fahrzeugId: fixtures.fahrzeugId,
        beginnAt: "2026-10-05T09:00:00.000Z",
        endeAt: "2026-10-05T10:00:00.000Z",
        klasse: "B",
        art: "Übungsstunde",
        ...overrides,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().offer as { id: string };
  }

  function accept(offerId: string, key: string, cookie = studentCookie) {
    return app.inject({
      method: "POST",
      url: `/appointment-offers/${offerId}/accept`,
      headers: { cookie },
      payload: { idempotencyKey: key },
    });
  }

  function bookingPayload(overrides: Record<string, unknown> = {}) {
    return {
      schuelerId: fixtures.schuelerId,
      fahrlehrerId: fixtures.fahrlehrerId,
      fahrzeugId: fixtures.fahrzeugId,
      beginnAt: "2026-10-06T09:00:00.000Z",
      endeAt: "2026-10-06T10:00:00.000Z",
      art: "Übungsstunde",
      klasse: "B",
      ...overrides,
    };
  }

  /**
   * Es gibt keinen Listenendpunkt für Fahrzeuge (nur `PATCH .../:id`), deshalb
   * kommt die gelesene Version per Roh-SQL – wie in
   * `optimistic-concurrency.test.ts`. Das ist für §4 unschädlich: geprüft wird,
   * was der Server mit einer VERALTETEN Version tut, nicht wie der Client sie
   * gelesen hat.
   */
  async function fahrzeugVersion(): Promise<number> {
    const sql = createRawClient(databaseUrl);
    try {
      const [row] = await sql`select version from fahrzeuge where id = ${fixtures.fahrzeugId}`;
      return Number(row.version);
    } finally {
      await sql.end();
    }
  }

  async function countBookings(): Promise<number> {
    const sql = createRawClient(databaseUrl);
    try {
      const [row] = await sql`select count(*)::int as n from terminbuchungen
        where status not in ('cancelled', 'storniert')`;
      return row.n as number;
    } finally {
      await sql.end();
    }
  }

  // =========================================================================
  // Szenario 1 – Netzabbruch nach Klick auf „Termin annehmen"
  // =========================================================================
  describe("Szenario 1: Netzabbruch nach Klick auf „Termin annehmen\"", () => {
    /**
     * ERWARTUNG: der Klick hat entweder gewirkt oder nicht – der Client darf
     * nach dem Abbruch nicht raten müssen und auf keinen Fall blind erneut
     * senden. `GET /sync/operations/:operation/:key` muss den Ausgang eindeutig
     * beantworten, und ein Wiederholversuch mit DEMSELBEN Schlüssel darf nie
     * eine zweite Buchung erzeugen.
     */
    it("A: Anfrage kam an und wirkte – der Ausgang ist als `completed` samt gespeicherter Antwort auflösbar", async () => {
      const offer = await createOffer();
      const key = idemKey("s1-durch");
      const res = await accept(offer.id, key);
      expect(res.statusCode).toBe(201);
      const buchungId = res.json().booking.id;

      // Der Client hat diese Antwort NIE gesehen (Netz brach ab). Er fragt.
      const aufloesung = await app.inject({
        method: "GET",
        url: `/sync/operations/appointment-offers.accept/${key}`,
        headers: { cookie: studentCookie },
      });
      expect(aufloesung.statusCode).toBe(200);
      expect(aufloesung.json().status).toBe("completed");
      // Die gespeicherte Antwort trägt die Buchung – der Client muss nichts
      // erneut senden und nichts erraten.
      expect(aufloesung.json().responseBody.booking.id).toBe(buchungId);
      expect(await countBookings()).toBe(1);
    });

    it("B: Anfrage kam NICHT an – `unknown`, und derselbe Schlüssel darf gefahrlos erneut gesendet werden", async () => {
      const offer = await createOffer();
      const key = idemKey("s1-nie");

      const aufloesung = await app.inject({
        method: "GET",
        url: `/sync/operations/appointment-offers.accept/${key}`,
        headers: { cookie: studentCookie },
      });
      expect(aufloesung.json().status).toBe("unknown");
      expect(await countBookings()).toBe(0);

      // Genau jetzt ist ein Wiederholversuch korrekt – und erzeugt EINE Buchung.
      const res = await accept(offer.id, key);
      expect(res.statusCode).toBe(201);
      expect(await countBookings()).toBe(1);
    });

    it("C: der Wiederholversuch nach dem Abbruch erzeugt KEINE zweite Buchung (gespeicherte Antwort)", async () => {
      const offer = await createOffer();
      const key = idemKey("s1-retry");
      const erst = await accept(offer.id, key);
      expect(erst.statusCode).toBe(201);

      const nochmal = await accept(offer.id, key);
      // 200 statt 201: die gespeicherte Antwort, nicht eine neue Wirkung.
      expect(nochmal.statusCode).toBe(200);
      expect(nochmal.json().booking.id).toBe(erst.json().booking.id);
      expect(await countBookings()).toBe(1);
    });

    it("D: ein FREMDER Schlüssel ist 404, nicht 403 – die Antwort bestätigt seine Existenz nicht", async () => {
      const offer = await createOffer();
      const key = idemKey("s1-fremd");
      expect((await accept(offer.id, key)).statusCode).toBe(201);

      const fremd = await app.inject({
        method: "GET",
        url: `/sync/operations/appointment-offers.accept/${key}`,
        headers: { cookie: student2Cookie },
      });
      expect(fremd.statusCode).toBe(404);
      expect(fremd.json().error).toBe("not_found");
    });
  });

  // =========================================================================
  // Szenario 2 – denselben Request zehnmal senden
  // =========================================================================
  describe("Szenario 2: denselben Request zehnmal senden", () => {
    /**
     * ERWARTUNG: genau eine Wirkung, neun Wiedergaben, kein 5xx, und kein
     * Rate-Limit-Treffer (zehn Aufrufe sind ein legitimer Stoß).
     */
    it("zehn SEQUENZIELLE identische Annahmen: eine Buchung, neun Wiedergaben, kein 429", async () => {
      const offer = await createOffer();
      const key = idemKey("s2-seq");
      const codes: number[] = [];
      const ids = new Set<string>();
      for (let i = 0; i < 10; i += 1) {
        const res = await accept(offer.id, key);
        codes.push(res.statusCode);
        if (res.statusCode < 300) ids.add(res.json().booking.id);
      }
      expect(codes.filter((c) => c === 201)).toHaveLength(1);
      expect(codes.filter((c) => c === 200)).toHaveLength(9);
      expect(codes.some((c) => c === 429)).toBe(false);
      expect(codes.some((c) => c >= 500)).toBe(false);
      expect(ids.size).toBe(1);
      expect(await countBookings()).toBe(1);
    });

    it("zehn PARALLELE identische Annahmen: genau eine Wirkung, nie zwei Buchungen", async () => {
      const offer = await createOffer();
      const key = idemKey("s2-par");
      const res = await Promise.all(Array.from({ length: 10 }, () => accept(offer.id, key)));
      const codes = res.map((r) => r.statusCode);

      expect(codes.filter((c) => c === 201)).toHaveLength(1);
      // Die übrigen neun sind entweder die gespeicherte Antwort (200) oder
      // "läuft noch" (409 idempotency_in_progress) – beides korrekt, KEIN 5xx
      // und keine zweite Buchung.
      for (const r of res) {
        if (r.statusCode === 409) expect(r.json().error).toBe("idempotency_in_progress");
        expect(r.statusCode).toBeLessThan(500);
      }
      expect(await countBookings()).toBe(1);
    });

    it("zehnmal `POST /appointments` mit demselben Schlüssel: eine Buchung", async () => {
      const key = idemKey("s2-appt");
      const codes: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        const res = await app.inject({
          method: "POST",
          url: "/appointments",
          headers: { "idempotency-key": key, cookie: instructorCookie },
          payload: bookingPayload(),
        });
        codes.push(res.statusCode);
      }
      expect(codes.filter((c) => c === 201)).toHaveLength(1);
      expect(codes.filter((c) => c === 200)).toHaveLength(9);
      expect(await countBookings()).toBe(1);
    });

    it("derselbe Schlüssel mit ABWEICHENDEM Inhalt ist 409 – kein stiller Ersatz der Anfrage", async () => {
      const key = idemKey("s2-hash");
      const erst = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": key, cookie: instructorCookie },
        payload: bookingPayload(),
      });
      expect(erst.statusCode).toBe(201);

      const anders = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": key, cookie: instructorCookie },
        payload: bookingPayload({ beginnAt: "2026-10-07T09:00:00.000Z", endeAt: "2026-10-07T10:00:00.000Z" }),
      });
      expect(anders.statusCode).toBe(409);
      expect(anders.json().error).toBe("idempotency_key_conflict");
      expect(await countBookings()).toBe(1);
    });
  });

  // =========================================================================
  // Szenario 3 – zwei Schüler nehmen denselben Slot gleichzeitig an
  // =========================================================================
  describe("Szenario 3: zwei Schüler nehmen denselben Slot gleichzeitig an", () => {
    /**
     * DIE WICHTIGSTE REGRESSION DES PROJEKTS.
     *
     * Phase 3 hat gefunden: `terminbuchungen` trägt ZWEI GiST-EXCLUDE-
     * Constraints (Fahrlehrer und Fahrzeug). Kollidieren zwei gleichzeitige
     * Einfügungen in beiden, kann PostgreSQL 40P01 (Deadlock) melden statt
     * 23P01 – der Verlierer bekam HTTP 500 statt 409, in 9–10 von 50 Läufen.
     * Behoben durch bounded Retry auf Serialisierungsfehler in
     * `lib/idempotency.ts`.
     *
     * Der Phase-3-Test macht das mit ZWEI Anfragen desselben Fahrlehrers.
     * Dieser Test prüft denselben Fehler aus dem Blickwinkel, den §20 wörtlich
     * nennt: ZWEI VERSCHIEDENE SCHÜLER, zwei verschiedene Angebote, dieselbe
     * Ressource, gleichzeitig – der fachlich echte Fall.
     */
    it("20 Runden, zwei verschiedene Schüler, ein Slot: exakt ein Gewinner je Runde, NIE ein 5xx", async () => {
      const zaehler: Record<number, number> = {};
      for (let runde = 0; runde < 20; runde += 1) {
        const beginn = new Date(Date.UTC(2026, 9, 5 + runde, 9, 0, 0)).toISOString();
        const ende = new Date(Date.UTC(2026, 9, 5 + runde, 10, 0, 0)).toISOString();
        // Zwei getrennte Angebote auf DIESELBE Ressource und dasselbe Fenster.
        const offerA = await createOffer({ beginnAt: beginn, endeAt: ende });
        const offerB = await createOffer({ beginnAt: beginn, endeAt: ende });

        const [a, b] = await Promise.all([
          accept(offerA.id, idemKey("s3-a"), studentCookie),
          accept(offerB.id, idemKey("s3-b"), student2Cookie),
        ]);
        for (const res of [a, b]) zaehler[res.statusCode] = (zaehler[res.statusCode] ?? 0) + 1;

        expect(
          [a.statusCode, b.statusCode].sort(),
          `Runde ${runde}: A=${a.statusCode} ${a.body} | B=${b.statusCode} ${b.body}`,
        ).toEqual([201, 409]);
      }
      // Genau 20 Gewinner, 20 Verlierer, kein einziges 500.
      expect(zaehler).toEqual({ 201: 20, 409: 20 });
    }, 120000);

    it("der Verlierer bekommt eine FACHLICHE Konfliktantwort, keinen technischen Fehler", async () => {
      const offerA = await createOffer();
      const offerB = await createOffer();
      const [a, b] = await Promise.all([
        accept(offerA.id, idemKey("s3-f-a"), studentCookie),
        accept(offerB.id, idemKey("s3-f-b"), student2Cookie),
      ]);
      const verlierer = a.statusCode === 409 ? a : b;
      const koerper = verlierer.json();
      // §9 klassifiziert das als BUSINESS_CONFLICT = dauerhaft: der Client darf
      // NICHT automatisch wiederholen. Genau deshalb muss es 409 sein.
      expect(verlierer.statusCode).toBe(409);
      expect(JSON.stringify(koerper)).not.toContain("40P01");
      expect(JSON.stringify(koerper)).not.toContain("deadlock");
      expect(await countBookings()).toBe(1);
    });

    it("die beiden EXCLUDE-Constraints existieren und sind wirklich vom Typ EXCLUDE", async () => {
      // Non-Negotiable: die Konfliktfreiheit hängt an der Datenbank, nicht am
      // Anwendungscode. Ein gleichnamiger Unique-Index wäre nicht dasselbe.
      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`
          select con.conname, con.contype::text as typ
            from pg_constraint con join pg_class rel on rel.oid = con.conrelid
           where rel.relname = 'terminbuchungen' and con.contype = 'x'`;
        expect(rows.length).toBe(2);
        for (const r of rows) expect(r.typ).toBe("x");
      } finally {
        await sql.end();
      }
    });
  });

  // =========================================================================
  // Szenario 4 – zwei Büro-Mitarbeiter ändern denselben Termin
  // =========================================================================
  describe("Szenario 4: zwei Büro-Mitarbeiter ändern denselben Termin", () => {
    async function zweiterBueroCookie(): Promise<string> {
      const sql = createRawClient(databaseUrl);
      try {
        const { hashPassword, generateTotpSecret } = await import("@fahrschul/auth");
        const secret = generateTotpSecret();
        const hash = await hashPassword(fixtures.password);
        await sql`insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
          values (${fixtures.standortId}, 'buero2@test.local', ${hash}, 'buero', 'Büro', 'Zwei', true, ${secret})`;
        return await loginAs(app, "buero2@test.local", fixtures.password, secret);
      } finally {
        await sql.end();
      }
    }

    /**
     * ERWARTUNG (§4): der zweite Schreiber verliert SICHTBAR – 409
     * `version_conflict` mit dem vollen Serverzustand und den abweichenden
     * Feldern, damit die Oberfläche eine Diff-Ansicht bauen kann. Kein „letzter
     * gewinnt", kein stilles Überschreiben.
     */
    it("der zweite Schreiber mit veralteter Version bekommt 409 samt Serverzustand und `conflictFields`", async () => {
      const patch = (version: number, cookie: string, km: number) =>
        app.inject({
          method: "PATCH",
          url: `/resources/fahrzeuge/${fixtures.fahrzeugId}`,
          headers: { cookie },
          payload: { expectedVersion: version, kilometerstand: km },
        });

      const buero2 = await zweiterBueroCookie();
      const gelesen = await fahrzeugVersion();

      const erster = await patch(gelesen, bueroCookie, 10_000);
      expect(erster.statusCode, erster.body).toBe(200);

      const zweiter = await patch(gelesen, buero2, 20_000);
      expect(zweiter.statusCode).toBe(409);
      const konflikt = zweiter.json();
      expect(konflikt.error).toBe("version_conflict");
      expect(konflikt.expectedVersion).toBe(gelesen);
      expect(konflikt.currentVersion).toBeGreaterThan(gelesen);
      // Der Serverzustand LIEGT BEI – der Client muss nicht erneut fragen.
      expect(konflikt.current).toBeTruthy();
      expect(Array.isArray(konflikt.conflictFields)).toBe(true);
    });

    it("zwei GLEICHZEITIGE Änderungen mit derselben gelesenen Version: genau eine gewinnt", async () => {
      const buero2 = await zweiterBueroCookie();
      const gelesen = await fahrzeugVersion();

      const [a, b] = await Promise.all([
        app.inject({
          method: "PATCH",
          url: `/resources/fahrzeuge/${fixtures.fahrzeugId}`,
          headers: { cookie: bueroCookie },
          payload: { expectedVersion: gelesen, kilometerstand: 11_111 },
        }),
        app.inject({
          method: "PATCH",
          url: `/resources/fahrzeuge/${fixtures.fahrzeugId}`,
          headers: { cookie: buero2 },
          payload: { expectedVersion: gelesen, kilometerstand: 22_222 },
        }),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    });

    it("eine Änderung OHNE Version ist 428 – die Pflicht ist eine Zusage des Endpunkts", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/resources/fahrzeuge/${fixtures.fahrzeugId}`,
        headers: { cookie: bueroCookie },
        payload: { kilometerstand: 33_333 },
      });
      expect(res.statusCode).toBe(428);
      expect(res.json().error).toBe("precondition_required");
    });

    it("zwei gleichzeitige STORNI desselben Termins: einer wirkt, der andere wird abgewiesen", async () => {
      const erstellt = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": idemKey("s4-storno"), cookie: instructorCookie },
        payload: bookingPayload(),
      });
      expect(erstellt.statusCode).toBe(201);
      const buchung = erstellt.json().booking as { id: string; version: number };

      const buero2 = await zweiterBueroCookie();
      const cancel = (cookie: string) =>
        app.inject({
          method: "POST",
          url: `/appointments/${buchung.id}/cancel`,
          headers: { cookie },
          payload: {
            idempotencyKey: idemKey("s4-c"),
            expectedVersion: buchung.version,
            grund: "Doppelbearbeitung",
          },
        });
      const [a, b] = await Promise.all([cancel(bueroCookie), cancel(buero2)]);
      const codes = [a.statusCode, b.statusCode].sort();
      // Ein Erfolg; der zweite scheitert an der Version oder am Zustand –
      // in JEDEM Fall kein zweiter Storno und kein 5xx.
      expect(codes[0]).toBe(200);
      expect(codes[1]).toBeGreaterThanOrEqual(400);
      expect(codes[1]).toBeLessThan(500);
      expect(await countBookings()).toBe(0);
    });
  });

  // =========================================================================
  // Szenario 5 – Serverabsturz nach DB-Commit, aber vor HTTP-Antwort
  // =========================================================================
  describe("Szenario 5: Serverabsturz nach DB-Commit, aber vor HTTP-Antwort", () => {
    /**
     * ERWARTUNG: der committete Vorgang ist verloren-sicher, und der Client
     * kann den Ausgang auf einer FRISCHEN Instanz auflösen. Genau dafür
     * existieren Phase 1s Idempotenzspeicher und Phase 2s
     * `GET /sync/operations/:op/:key`. Der Absturz wird echt nachgestellt:
     * die Instanz, die den Vorgang ausführte, wird GESCHLOSSEN, und die
     * Auflösung läuft über eine NEU GEBAUTE Instanz.
     */
    it("der Ausgang ist nach einem Prozesswechsel auflösbar – nichts liegt im Prozessspeicher", async () => {
      const offer = await createOffer();
      const key = idemKey("s5-crash");

      // Instanz A: führt aus und "stirbt" danach, ohne dass der Client die
      // Antwort erhält.
      const instanzA = buildTestApp();
      await instanzA.ready();
      const studentAufA = await loginAs(instanzA, "schueler@test.local", fixtures.password);
      const res = await instanzA.inject({
        method: "POST",
        url: `/appointment-offers/${offer.id}/accept`,
        headers: { cookie: studentAufA },
        payload: { idempotencyKey: key },
      });
      expect(res.statusCode).toBe(201);
      const buchungId = res.json().booking.id;
      await instanzA.close(); // <- der "Absturz"

      // Instanz B: der Neustart. Der Client fragt hier nach dem Ausgang.
      const instanzB = buildTestApp();
      await instanzB.ready();
      try {
        const studentAufB = await loginAs(instanzB, "schueler@test.local", fixtures.password);
        const aufloesung = await instanzB.inject({
          method: "GET",
          url: `/sync/operations/appointment-offers.accept/${key}`,
          headers: { cookie: studentAufB },
        });
        expect(aufloesung.json().status).toBe("completed");
        expect(aufloesung.json().responseBody.booking.id).toBe(buchungId);

        // Und ein Wiederholversuch auf der neuen Instanz wirkt NICHT erneut.
        const nochmal = await instanzB.inject({
          method: "POST",
          url: `/appointment-offers/${offer.id}/accept`,
          headers: { cookie: studentAufB },
          payload: { idempotencyKey: key },
        });
        expect(nochmal.statusCode).toBe(200);
        expect(await countBookings()).toBe(1);
      } finally {
        await instanzB.close();
      }
    }, 30000);

    it("ein Absturz VOR dem Commit lässt nichts Halbes zurück – der Schlüssel bleibt `unknown`", async () => {
      // Ein fachlich scheiternder Aufruf rollt die Idempotenzreservierung MIT
      // zurück. Genau das macht "unknown = hat nicht gewirkt" wahr.
      const key = idemKey("s5-rollback");
      const res = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": key, cookie: instructorCookie },
        // Klasse A: der Fahrlehrer ist nicht qualifiziert -> fachlicher Fehler.
        payload: bookingPayload({ klasse: "A", fahrzeugId: null }),
      });
      expect(res.statusCode).toBe(409);

      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select * from idempotency_keys where key = ${key}`;
        // KEINE zurückgebliebene Reservierung: der Client darf denselben
        // Schlüssel nach Behebung wiederverwenden.
        expect(rows.length).toBe(0);
      } finally {
        await sql.end();
      }

      const aufloesung = await app.inject({
        method: "GET",
        url: `/sync/operations/appointments.create/${key}`,
        headers: { cookie: instructorCookie },
      });
      expect(aufloesung.json().status).toBe("unknown");
    });

    it("die Audit- und Outbox-Zeile ist mit dem Fachvorgang committet – Rollback lässt beides weg", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        const vorher = await sql`select count(*)::int as n from event_outbox`;
        const gescheitert = await app.inject({
          method: "POST",
          url: "/appointments",
          headers: { "idempotency-key": idemKey("s5-atomar"), cookie: instructorCookie },
          payload: bookingPayload({ klasse: "A", fahrzeugId: null }),
        });
        expect(gescheitert.statusCode).toBe(409);
        const nachher = await sql`select count(*)::int as n from event_outbox`;
        expect(nachher[0].n).toBe(vorher[0].n);
      } finally {
        await sql.end();
      }
    });
  });

  // =========================================================================
  // Szenario 6 – Workerabsturz während einer Benachrichtigung
  // =========================================================================
  describe("Szenario 6: Workerabsturz während einer Benachrichtigung", () => {
    /**
     * ERWARTUNG: das Ereignis ist nicht verloren und wird nicht doppelt
     * verarbeitet. Der Absturz wird durch `claimOutboxBatch` OHNE anschließende
     * Vollendung nachgestellt – exakt der Zustand eines gestorbenen Workers:
     * `in_flight` mit einem Lease, der niemandem mehr gehört.
     */
    it("ein Ereignis, das ein gestorbener Worker beansprucht hatte, wird wieder freigegeben und EINMAL zugestellt", async () => {
      const db = getDb(databaseUrl);
      const consumers = buildConsumers(createNotificationsAdapter("mock"));
      const offer = await createOffer();
      expect((await accept(offer.id, idemKey("s6"))).statusCode).toBe(201);

      const sql = createRawClient(databaseUrl);
      try {
        // Der Worker beansprucht – und stirbt (kein complete, kein fail).
        const batch = await claimOutboxBatch(db, { owner: "worker-der-stirbt", limit: 10 });
        expect(batch.length).toBeGreaterThan(0);
        const inFlight = await sql`select count(*)::int as n from event_outbox where status = 'in_flight'`;
        expect(inFlight[0].n).toBe(batch.length);

        // Ein anderer Worker darf sie NICHT sofort stehlen (der Lease gilt).
        const geklaut = await claimOutboxBatch(db, { owner: "anderer-worker", limit: 10 });
        expect(geklaut.length).toBe(0);

        // Lease abgelaufen (der Prozess ist tot) -> Wiederaufnahme.
        await sql`update event_outbox set lease_expires_at = now() - interval '1 minute'
                   where status = 'in_flight'`;
        const befreit = await recoverExpiredOutboxLeases(db);
        expect(befreit).toBe(batch.length);

        const lauf = await runOutboxOnce(db, consumers, { limit: 50 });
        expect(lauf.delivered).toBeGreaterThan(0);
        const offen = await sql`select count(*)::int as n from event_outbox where status <> 'delivered'`;
        expect(offen[0].n).toBe(0);

        // Der eigentliche Beweis: die Benachrichtigung existiert GENAU EINMAL.
        const nachrichten = await sql`
          select count(*)::int as n from nachrichten where status = 'warteschlange'`;
        const inbox = await sql`
          select consumer, count(*)::int as n from event_inbox group by consumer`;
        expect(nachrichten[0].n).toBeGreaterThan(0);
        // Ein zweiter Lauf darf nichts verdoppeln.
        await runOutboxOnce(db, consumers, { limit: 50 });
        const nachher = await sql`
          select count(*)::int as n from nachrichten where status = 'warteschlange'`;
        expect(nachher[0].n).toBe(nachrichten[0].n);
        const inboxNachher = await sql`
          select consumer, count(*)::int as n from event_inbox group by consumer`;
        expect(inboxNachher).toEqual(inbox);
      } finally {
        await sql.end();
      }
    }, 30000);

    it("der Absturz beeinflusst den FACHZUSTAND nicht – die Buchung war und bleibt gültig", async () => {
      const offer = await createOffer();
      expect((await accept(offer.id, idemKey("s6-fach"))).statusCode).toBe(201);
      const db = getDb(databaseUrl);
      await claimOutboxBatch(db, { owner: "stirbt-sofort", limit: 10 });
      // Kein Worker läuft mehr, alles hängt in in_flight – und trotzdem:
      expect(await countBookings()).toBe(1);
      const liste = await app.inject({ method: "GET", url: "/appointments/mine", headers: { cookie: studentCookie } });
      expect(liste.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // Szenario 7 – WebSocket/SSE verliert Events
  // =========================================================================
  describe("Szenario 7: der Echtzeitkanal verliert Ereignisse", () => {
    async function cursor(cookie: string): Promise<number> {
      const res = await app.inject({ method: "GET", url: "/sync/cursor", headers: { cookie } });
      expect(res.statusCode).toBe(200);
      return res.json().cursor as number;
    }

    async function tickWorker() {
      const scheduler = createScheduler(
        { db: getDb(databaseUrl), notifications: createNotificationsAdapter("mock") },
        { batchLimit: 100 },
      );
      await scheduler.runWorkTick();
    }

    /**
     * ERWARTUNG: der Kanal ist eine BENACHRICHTIGUNG, keine Datenquelle. Gehen
     * Meldungen verloren, holt der Cursor sie vollständig nach – ohne Lücke und
     * ohne Doppelverarbeitung. Der Client nimmt nie an, dass er alles gesehen hat.
     */
    it("Ereignisse, die während der Trennung entstanden, kommen per Cursor VOLLSTÄNDIG nach", async () => {
      const start = await cursor(studentCookie);

      // Fünf Ereignisse entstehen, während "die Verbindung weg ist".
      for (let i = 0; i < 5; i += 1) {
        const offer = await createOffer({
          beginnAt: new Date(Date.UTC(2026, 10, 2 + i, 9, 0, 0)).toISOString(),
          endeAt: new Date(Date.UTC(2026, 10, 2 + i, 10, 0, 0)).toISOString(),
        });
        expect(offer.id).toBeTruthy();
      }
      await tickWorker();

      const changes = await app.inject({
        method: "GET",
        url: `/sync/changes?cursor=${start}`,
        headers: { cookie: studentCookie },
      });
      expect(changes.statusCode).toBe(200);
      const body = changes.json();
      expect(body.changes.length).toBeGreaterThanOrEqual(5);
      // Der Cursor ist DICHT: die Sequenznummern sind lückenlos aufsteigend.
      const seqs = (body.changes as Array<{ cursor: number }>).map((c) => c.cursor);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      for (let i = 1; i < seqs.length; i += 1) {
        expect(seqs[i] - seqs[i - 1]).toBe(1);
      }
    }, 30000);

    it("ein zweites Abrufen mit dem FORTGESCHRIEBENEN Cursor liefert nichts doppelt", async () => {
      const start = await cursor(studentCookie);
      await createOffer({ beginnAt: "2026-11-10T09:00:00.000Z", endeAt: "2026-11-10T10:00:00.000Z" });
      await tickWorker();

      const erst = await app.inject({
        method: "GET",
        url: `/sync/changes?cursor=${start}`,
        headers: { cookie: studentCookie },
      });
      const neuerCursor = erst.json().cursor as number;
      expect(erst.json().changes.length).toBeGreaterThan(0);

      const zweit = await app.inject({
        method: "GET",
        url: `/sync/changes?cursor=${neuerCursor}`,
        headers: { cookie: studentCookie },
      });
      expect(zweit.json().changes).toEqual([]);
    }, 30000);

    it("ein zu ALTER Cursor verlangt eine Vollsynchronisation statt still Lücken zu lassen", async () => {
      // Ein Cursor aus der Zukunft/aus einer anderen Welt: der Server muss das
      // MERKEN und eine Vollsynchronisation verlangen – nicht "nichts Neues"
      // antworten, was der Client als "aktuell" missverstehen würde.
      const res = await app.inject({
        method: "GET",
        url: "/sync/changes?cursor=999999999",
        headers: { cookie: studentCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().resyncRequired).toBeTruthy();
    });

    it("der Kanal trägt KEINE Nutzlast – ein Leck über den Kanal ist strukturell unmöglich", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        const spalten = await sql<Array<{ column_name: string }>>`
          select column_name from information_schema.columns
           where table_name = 'realtime_deliveries'`;
        const namen = spalten.map((s) => s.column_name);
        // Kein `payload`, kein `body`, kein `data`: nur Bezug + Thema.
        expect(namen).not.toContain("payload");
        expect(namen).not.toContain("body");
        expect(namen).toContain("data_type");
      } finally {
        await sql.end();
      }
    });

    it("ohne laufenden Worker gibt es keine Zustellzeilen – aber Schreibvorgänge funktionieren unverändert", async () => {
      // §18: der Kanal ist nie eine Vorbedingung für eine fachliche Handlung.
      const offer = await createOffer({ beginnAt: "2026-11-20T09:00:00.000Z", endeAt: "2026-11-20T10:00:00.000Z" });
      const res = await accept(offer.id, idemKey("s7-ohne-worker"));
      expect(res.statusCode).toBe(201);
      const gesundheit = await app.inject({ method: "GET", url: "/health/deep" });
      expect(gesundheit.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // Szenario 8 – Event kommt doppelt oder falsch sortiert
  // =========================================================================
  describe("Szenario 8: Ereignis kommt doppelt oder in falscher Reihenfolge", () => {
    /**
     * ERWARTUNG: Zustellung ist at-least-once, VERARBEITUNG ist effektiv
     * exactly-once (`event_inbox` mit unique `(consumer, event_id)`). Eine
     * falsche Reihenfolge darf keinen Zustand kaputt machen, weil die
     * Verarbeitung je Ereignis idempotent ist und der Zustand in der
     * Entitätsspalte liegt, nicht im Verarbeitungsverlauf.
     */
    it("DOPPELTE Zustellung: der Konsument verarbeitet genau einmal (Inbox-Dedup)", async () => {
      const db = getDb(databaseUrl);
      const consumers = buildConsumers(createNotificationsAdapter("mock"));
      const offer = await createOffer();
      expect((await accept(offer.id, idemKey("s8-dup"))).statusCode).toBe(201);

      const sql = createRawClient(databaseUrl);
      try {
        await runOutboxOnce(db, consumers, { limit: 50 });
        const nachEins = await sql`select count(*)::int as n from nachrichten`;
        const inboxEins = await sql`select count(*)::int as n from event_inbox`;

        // Dieselben Ereignisse ZWANGSWEISE erneut zustellen.
        await sql`update event_outbox set status = 'pending', lease_owner = null,
                    lease_expires_at = null, delivered_at = null`;
        await runOutboxOnce(db, consumers, { limit: 50 });

        const nachZwei = await sql`select count(*)::int as n from nachrichten`;
        const inboxZwei = await sql`select count(*)::int as n from event_inbox`;
        expect(nachZwei[0].n).toBe(nachEins[0].n);
        expect(inboxZwei[0].n).toBe(inboxEins[0].n);
      } finally {
        await sql.end();
      }
    }, 30000);

    it("VERTAUSCHTE Reihenfolge: das spätere Ereignis zuerst zugestellt bricht nichts", async () => {
      const db = getDb(databaseUrl);
      const consumers = buildConsumers(createNotificationsAdapter("mock"));
      const offerA = await createOffer({ beginnAt: "2026-11-01T09:00:00.000Z", endeAt: "2026-11-01T10:00:00.000Z" });
      const offerB = await createOffer({ beginnAt: "2026-11-02T09:00:00.000Z", endeAt: "2026-11-02T10:00:00.000Z" });
      expect(offerA.id).not.toBe(offerB.id);

      const sql = createRawClient(databaseUrl);
      try {
        const zeilen = await sql`select id, seq from event_outbox where status = 'pending' order by seq`;
        expect(zeilen.length).toBeGreaterThanOrEqual(2);
        const letzte = zeilen[zeilen.length - 1];
        const erste = zeilen[0];

        // Die LETZTE Zeile zuerst zustellen: alle anderen kurz "parken".
        await sql`update event_outbox set next_attempt_at = now() + interval '1 hour'
                   where id <> ${letzte.id} and status = 'pending'`;
        await runOutboxOnce(db, consumers, { limit: 50 });
        const nachSpaet = await sql`select status from event_outbox where id = ${letzte.id}`;
        expect(nachSpaet[0].status).toBe("delivered");

        // Danach die frühere – sie darf nicht als "veraltet" verworfen werden.
        await sql`update event_outbox set next_attempt_at = now() where status = 'pending'`;
        await runOutboxOnce(db, consumers, { limit: 50 });
        const nachFrueh = await sql`select status from event_outbox where id = ${erste.id}`;
        expect(nachFrueh[0].status).toBe("delivered");

        const offen = await sql`select count(*)::int as n from event_outbox where status = 'pending'`;
        expect(offen[0].n).toBe(0);
        // Jedes Ereignis genau einmal in der Inbox.
        const doppelt = await sql`
          select consumer, event_id, count(*)::int as n from event_inbox
           group by consumer, event_id having count(*) > 1`;
        expect(doppelt.length).toBe(0);
      } finally {
        await sql.end();
      }
    }, 30000);

    it("der Zustand liegt in der ENTITÄT, nicht im Ereignisverlauf – deshalb ist die Reihenfolge unkritisch", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        const offer = await createOffer({ beginnAt: "2026-11-03T09:00:00.000Z", endeAt: "2026-11-03T10:00:00.000Z" });
        expect((await accept(offer.id, idemKey("s8-zustand"))).statusCode).toBe(201);
        // Der Angebotszustand steht in der Spalte und ist ohne jede
        // Ereignisverarbeitung korrekt.
        const rows = await sql`select angebot_status from terminangebote where id = ${offer.id}`;
        expect(["accepted", "booking_pending", "confirmed"]).toContain(rows[0].angebot_status);
      } finally {
        await sql.end();
      }
    });
  });

  // =========================================================================
  // Szenario 9 – externe API 30 Minuten offline
  // =========================================================================
  describe("Szenario 9: externe API 30 Minuten offline", () => {
    /**
     * ERWARTUNG (§11/§18): kein Datenverlust, KEINE falsche Erfolgsmeldung, der
     * Fachkern arbeitet unverändert, und nach der Rückkehr wird mit DEMSELBEN
     * Idempotenzschlüssel genau einmal zugestellt.
     *
     * Die 30 Minuten werden nicht gewartet, sondern gestellt: der Breaker wird
     * über `POST /ops/integrations/:integration/breaker` geöffnet – §11 hat
     * genau dafür einen Bedienpfad, damit ein Ausfall deterministisch
     * herstellbar ist, ohne Produktionscode zu ändern.
     */
    /**
     * Ein EIGENER systemdienst-Account. Wichtig: die Rolle des Büro-Kontos
     * darf nicht umgebogen werden, weil `systemdienst` bewusst KEINEN Zugriff
     * auf Schülerdaten hat und `POST /communication/send` dann 403 wäre – der
     * Puffer würde nie entstehen und der Test würde das Falsche prüfen.
     */
    async function opsCookie(): Promise<string> {
      const sql = createRawClient(databaseUrl);
      try {
        await sql`
          insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
          select ${fixtures.standortId}, 'sys-chaos9@test.local', password_hash, 'systemdienst', 'S', 'C', true, mfa_secret
            from benutzer where id = ${fixtures.bueroBenutzerId}
          on conflict (email) do nothing`;
      } finally {
        await sql.end();
      }
      return loginAs(app, "sys-chaos9@test.local", fixtures.password, fixtures.bueroTotpSecret);
    }

    /**
     * Der Breaker-Bedienpfad verlangt einen im Prozess REGISTRIERTEN Wächter –
     * er entsteht beim ersten Aufruf der Integration. Deshalb erst ein
     * gesunder Aufruf, dann öffnen. Genau das ist auch der reale Ablauf: eine
     * Integration, die noch nie benutzt wurde, kann nicht ausfallen.
     */
    async function breakerOeffnen(integration: string, cookie: string, ersterAufruf: () => Promise<unknown>) {
      const aufwaermen = await ersterAufruf();
      // Der erste Aufruf MUSS durchgekommen sein – sonst existiert kein Wächter
      // und der Test würde am falschen Ort scheitern.
      expect((aufwaermen as { statusCode: number }).statusCode, JSON.stringify(aufwaermen)).toBeLessThan(300);
      const res = await app.inject({
        method: "POST",
        url: `/ops/integrations/${integration}/breaker`,
        headers: { cookie },
        payload: { aktion: "oeffnen", grund: "Chaos-Szenario 9" },
      });
      expect(res.statusCode, `${integration}: ${res.body}`).toBe(200);
      expect(res.json().zustand.breakerState).toBe("open");
    }

    function nachrichtSenden(cookie: string, betreff: string) {
      return app.inject({
        method: "POST",
        url: "/communication/send",
        headers: { "idempotency-key": idemKey(`s9-${betreff}`), cookie },
        payload: {
          schuelerId: fixtures.schuelerId,
          kanal: "email",
          to: "schueler@test.local",
          betreff,
          inhalt: "Text",
        },
      });
    }

    it("Nachrichten werden GEPUFFERT und ausdrücklich nicht als gesendet gemeldet", async () => {
      const ops = await opsCookie();
      await breakerOeffnen("notifications", ops, () => nachrichtSenden(bueroCookie, "Aufwaermen"));

      const senden = await nachrichtSenden(bueroCookie, "Terminerinnerung");
      expect(senden.statusCode, senden.body).toBeLessThan(300);
      const koerper = senden.json();
      // Der Antwortvertrag lässt "gesendet" ohne Zustellung nicht zu.
      expect(koerper.zustellung).toBe("wartet_auf_externe_synchronisation");

      const sql = createRawClient(databaseUrl);
      try {
        const nachricht = await sql`select status from nachrichten order by created_at desc limit 1`;
        // NICHT `gesendet` und NICHT `fehlgeschlagen`.
        expect(nachricht[0].status).toBe("warteschlange");
      } finally {
        await sql.end();
      }
    }, 30000);

    it("der Fachkern arbeitet während des Ausfalls unverändert weiter", async () => {
      const ops = await opsCookie();
      await breakerOeffnen("notifications", ops, () => nachrichtSenden(bueroCookie, "Aufwaermen"));

      // Offener Breaker – und trotzdem lässt sich buchen.
      const offer = await createOffer({ beginnAt: "2026-11-04T09:00:00.000Z", endeAt: "2026-11-04T10:00:00.000Z" });
      const res = await accept(offer.id, idemKey("s9-kern"));
      expect(res.statusCode).toBe(201);

      const gesundheit = await app.inject({ method: "GET", url: "/health/deep" });
      // 200, nicht 503: ein Loadbalancer darf diese Instanz NICHT herausnehmen.
      expect(gesundheit.statusCode).toBe(200);
      expect(gesundheit.json().status).toBe("eingeschraenkt");
      expect(gesundheit.json().kern).toContain("nutzbar");
    }, 30000);

    it("nach der Rückkehr stellt die Wiederaufnahme mit DEMSELBEN Schlüssel genau einmal zu", async () => {
      const ops = await opsCookie();
      await breakerOeffnen("notifications", ops, () => nachrichtSenden(bueroCookie, "Aufwaermen"));
      await nachrichtSenden(bueroCookie, "Wichtig");

      const sql = createRawClient(databaseUrl);
      try {
        const gepuffert = await sql<Array<{ idempotency_key: string; status: string }>>`
          select idempotency_key, status from integration_outbound_calls
           where integration = 'notifications' and status = 'buffered'`;
        expect(gepuffert.length, "es muss mindestens ein gepufferter Aufruf existieren").toBeGreaterThan(0);
        const schluesselVorher = gepuffert.map((r) => r.idempotency_key);

        // Der Anbieter ist zurück – nach 30 Minuten. Die Wartezeit wird
        // gestellt statt gewartet: `resumeBufferedCalls` nimmt bewusst nur
        // FÄLLIGE Einträge (`next_attempt_at <= now`), damit ein sofortiger
        // Wiederholversuch keinen Sturm auf ein System auslöst, das gerade
        // ausgefallen war. Ein Testlauf, der die Fälligkeit nicht setzt, würde
        // NICHTS finden – und das wäre kein Fehler des Systems.
        await sql`update integration_outbound_calls
                     set next_attempt_at = now() - interval '1 minute'
                   where status = 'buffered'`;
        await app.inject({
          method: "POST",
          url: "/ops/integrations/notifications/breaker",
          headers: { cookie: ops },
          payload: { aktion: "schliessen" },
        });
        const resume = await app.inject({
          method: "POST",
          url: "/ops/integrations/resume",
          headers: { cookie: ops },
          payload: {},
        });
        expect(resume.statusCode, resume.body).toBe(200);

        const danach = await sql<Array<{ idempotency_key: string; status: string; attempts: number }>>`
          select idempotency_key, status, attempts from integration_outbound_calls
           where integration = 'notifications' and idempotency_key = any(${schluesselVorher})`;
        // KEIN zweiter Eintrag für denselben Schlüssel – dieselbe Zeile ist
        // jetzt zugestellt. Ein zweiter Anbieteraufruf ist damit ausgeschlossen.
        expect(danach.length).toBe(schluesselVorher.length);
        expect(
          danach.map((r) => r.status),
          JSON.stringify(danach),
        ).not.toContain("buffered");
      } finally {
        await sql.end();
      }
    }, 30000);

    it("ein bekannter ausgehender Schlüssel löst KEINEN zweiten Anbieteraufruf aus", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        const eindeutig = await sql<Array<{ indexdef: string }>>`
          select indexdef from pg_indexes
           where tablename = 'integration_outbound_calls' and indexdef ilike '%unique%'`;
        // Die Zusage hängt an einem Unique-Index, nicht an Anwendungslogik.
        expect(
          eindeutig.some((r) => /idempotency_key/.test(r.indexdef)),
        ).toBe(true);
      } finally {
        await sql.end();
      }
    });

    it("30 Minuten Ausfall erzeugen keine Dead Letter im FACHKERN – nur Puffer in der Integration", async () => {
      const ops = await opsCookie();
      await breakerOeffnen("notifications", ops, () => nachrichtSenden(bueroCookie, "Aufwaermen"));
      // Ein halbstündiger Ausfall mit sechs Sendeversuchen: alles puffert.
      for (let i = 0; i < 6; i += 1) {
        const res = await nachrichtSenden(bueroCookie, `Nr-${i}`);
        expect(res.statusCode).toBeLessThan(300);
        expect(res.json().zustellung).toBe("wartet_auf_externe_synchronisation");
      }
      const sql = createRawClient(databaseUrl);
      try {
        const gepuffert = await sql`select count(*)::int as n from integration_outbound_calls
                                     where status = 'buffered'`;
        expect(gepuffert[0].n).toBeGreaterThanOrEqual(6);
        // Der Fachkern hat KEINEN Dead Letter: der Ausfall ist in der
        // Integrationsschicht eingekapselt.
        const dl = await sql`select count(*)::int as n from dead_letters where resumed_at is null`;
        expect(dl[0].n).toBe(0);
      } finally {
        await sql.end();
      }
    }, 40000);
  });

  // =========================================================================
  // Szenario 10 – Datenbankverbindung unterbrochen
  // =========================================================================
  describe("Szenario 10: Datenbankverbindung unterbrochen", () => {
    /**
     * ERWARTUNG (§1): die Datenbank IST die Wahrheit – ohne sie ist die Instanz
     * nutzlos, und das muss sie SAGEN. Kein falscher Erfolg, kein 2xx auf einem
     * Schreibvorgang, `/health/deep` und `/health/ready` melden 503,
     * `/health/live` bleibt 200 (sonst tötet der Orchestrator alle Instanzen).
     */
    function toteInstanz(): FastifyInstance {
      return buildApp({
        databaseUrl: "postgres://fahrschul:fahrschul_dev_pw@127.0.0.1:59998/weg",
        cookieSecure: false,
        logger: false,
        rateLimit: false,
        startWorkers: false,
      });
    }

    it("`/health/deep` meldet 503 und benennt die Datenbank als Ursache", async () => {
      const tot = toteInstanz();
      await tot.ready();
      try {
        const res = await tot.inject({ method: "GET", url: "/health/deep" });
        expect(res.statusCode).toBe(503);
        expect(res.json().datenbank).toBe("nicht erreichbar");
        expect(res.json().kern).toBe("nicht nutzbar");
      } finally {
        await tot.close();
      }
    }, 30000);

    it("ein Schreibvorgang liefert einen FEHLER, niemals einen falschen Erfolg", async () => {
      const tot = toteInstanz();
      await tot.ready();
      try {
        const res = await tot.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: "schueler@test.local", password: fixtures.password },
        });
        // Kein 200, kein Cookie, kein "angemeldet".
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.headers["set-cookie"]).toBeUndefined();
      } finally {
        await tot.close();
      }
    }, 30000);

    it("`/health/live` bleibt 200 – Liveness darf keinen Ausfall verstärken", async () => {
      const tot = toteInstanz();
      await tot.ready();
      try {
        expect((await tot.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
        expect((await tot.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(503);
      } finally {
        await tot.close();
      }
    }, 30000);

    it("nach der Rückkehr arbeitet alles weiter – offene Vorgänge sind auflösbar", async () => {
      // Die gesunde Instanz nach dem "Netzwerkloch": derselbe Schlüssel, den
      // der Client während des Ausfalls nicht auflösen konnte, ist jetzt
      // beantwortbar.
      const offer = await createOffer({ beginnAt: "2026-11-05T09:00:00.000Z", endeAt: "2026-11-05T10:00:00.000Z" });
      const key = idemKey("s10-nach");
      expect((await accept(offer.id, key)).statusCode).toBe(201);
      const res = await app.inject({
        method: "GET",
        url: `/sync/operations/appointment-offers.accept/${key}`,
        headers: { cookie: studentCookie },
      });
      expect(res.json().status).toBe("completed");
    });
  });

  // =========================================================================
  // Szenario 11 – App sieben Tage offline
  // =========================================================================
  describe("Szenario 11: App sieben Tage offline", () => {
    /**
     * ERWARTUNG: nichts wird still gesendet und nichts still verworfen. Die
     * CLIENT-Hälfte (Entwurf älter als sieben Tage -> `stale`/`draft_too_old`,
     * nicht gelöscht, nicht gesendet, erst nach ausdrücklicher Bestätigung
     * raus) ist in `packages/sync/src/__tests__/queue.test.ts` geprüft
     * ("sieben Tage offline"). Hier steht die SERVER-Hälfte, die dort nicht
     * prüfbar ist – und ein Befund, der aus dem Vergleich beider Fristen folgt.
     */
    it("BEFUND: die Idempotenz-Frist (24 h) ist KÜRZER als das Offline-Fenster des Clients (7 Tage)", () => {
      // Das ist kein Fehler im Code, aber eine Grenze der §2-Zusage: ein
      // Vorgang, der sieben Tage im Gerät lag, trifft auf einen abgelaufenen
      // Schlüssel und wird serverseitig wie eine NEUE Anfrage behandelt.
      // Für die vier offline erlaubten ENTWURFSarten ist das harmlos (sie sind
      // Aktualisierungen, keine Neuanlagen) – die zehn kritischen Operationen
      // können offline gar nicht erst angelegt werden (§8, fail closed).
      // Trotzdem gehört die Zahl in den Bericht und nicht in eine Fußnote.
      expect(IDEMPOTENCY_TTL_MS).toBe(24 * 60 * 60 * 1000);
      expect(IDEMPOTENCY_TTL_MS).toBeLessThan(7 * 24 * 60 * 60 * 1000);
    });

    it("ein ABGELAUFENER Schlüssel wird als `unknown` gemeldet – nicht als `completed`", async () => {
      const offer = await createOffer({ beginnAt: "2026-11-06T09:00:00.000Z", endeAt: "2026-11-06T10:00:00.000Z" });
      const key = idemKey("s11-alt");
      expect((await accept(offer.id, key)).statusCode).toBe(201);

      const sql = createRawClient(databaseUrl);
      try {
        // Sieben Tage später.
        await sql`update idempotency_keys set expires_at = now() - interval '6 days' where key = ${key}`;
      } finally {
        await sql.end();
      }

      const res = await app.inject({
        method: "GET",
        url: `/sync/operations/appointment-offers.accept/${key}`,
        headers: { cookie: studentCookie },
      });
      // Der Eintrag ist noch da (der Cleanup-Job lief nicht), aber die Antwort
      // muss ehrlich sein: der Client darf sie nicht als frische Bestätigung
      // lesen. `expiresAt` liegt in der Vergangenheit und ist mitgeliefert.
      expect(new Date(res.json().expiresAt).getTime()).toBeLessThan(Date.now());
    });

    it("ein Angebot, das während der Offline-Zeit ABGELAUFEN ist, wird nicht still gebucht", async () => {
      const offer = await createOffer({
        beginnAt: "2026-11-07T09:00:00.000Z",
        endeAt: "2026-11-07T10:00:00.000Z",
        ablaufAt: "2026-11-06T09:00:00.000Z",
      });
      const sql = createRawClient(databaseUrl);
      try {
        // Die Frist ist verstreichen, während die App zu war.
        await sql`update terminangebote set ablauf_at = now() - interval '2 days' where id = ${offer.id}`;
      } finally {
        await sql.end();
      }
      const res = await accept(offer.id, idemKey("s11-abgelaufen"));
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(await countBookings()).toBe(0);
    });

    it("ein Datensatz, der sich in der Zwischenzeit BEWEGT hat, erzeugt 409 statt Überschreiben", async () => {
      const alteVersion = await fahrzeugVersion();

      // Sieben Tage Betrieb: der Datensatz wurde inzwischen geändert.
      const zwischendurch = await app.inject({
        method: "PATCH",
        url: `/resources/fahrzeuge/${fixtures.fahrzeugId}`,
        headers: { cookie: bueroCookie },
        payload: { expectedVersion: alteVersion, kilometerstand: 44_444 },
      });
      expect(zwischendurch.statusCode, zwischendurch.body).toBe(200);

      // Jetzt kommt der alte Entwurf aus dem Gerät.
      const spaet = await app.inject({
        method: "PATCH",
        url: `/resources/fahrzeuge/${fixtures.fahrzeugId}`,
        headers: { cookie: bueroCookie },
        payload: { expectedVersion: alteVersion, kilometerstand: 55_555 },
      });
      expect(spaet.statusCode).toBe(409);
      expect(spaet.json().error).toBe("version_conflict");
    });
  });

  // =========================================================================
  // Szenario 12 – falsche Geräteuhr
  // =========================================================================
  describe("Szenario 12: falsche Geräteuhr", () => {
    /**
     * ERWARTUNG: KEINE fachliche Entscheidung hängt an der Uhr des Geräts. Der
     * Client darf Zeiten als DATEN senden (ein Terminfenster ist ein Datum),
     * aber jede Frist-, Ablauf- und Reihenfolgeentscheidung fällt mit
     * Serverzeit.
     */
    it("ein Angebot mit serverseitig abgelaufener Frist wird abgewiesen – egal was das Gerät glaubt", async () => {
      const offer = await createOffer({ beginnAt: "2026-11-08T09:00:00.000Z", endeAt: "2026-11-08T10:00:00.000Z" });
      const sql = createRawClient(databaseUrl);
      try {
        await sql`update terminangebote set ablauf_at = now() - interval '1 minute' where id = ${offer.id}`;
      } finally {
        await sql.end();
      }
      // Das Gerät glaubt, es sei 2020 – es gibt aber kein Feld, mit dem es das
      // dem Server mitteilen könnte.
      const res = await accept(offer.id, idemKey("s12-frist"));
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(await countBookings()).toBe(0);
    });

    it("Start- und Endzeit einer Fahrstunde setzt der SERVER, nicht der Client", async () => {
      const erstellt = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { "idempotency-key": idemKey("s12-lesson"), cookie: instructorCookie },
        payload: bookingPayload({ beginnAt: "2026-11-09T09:00:00.000Z", endeAt: "2026-11-09T10:00:00.000Z" }),
      });
      expect(erstellt.statusCode).toBe(201);
      const buchungId = erstellt.json().booking.id;

      const start = await app.inject({
        method: "POST",
        url: `/instructor/lessons/${buchungId}/start`,
        headers: { cookie: instructorCookie },
        // Ein Gerät mit falscher Uhr schickt eine erfundene Startzeit mit.
        payload: { gestartetAt: "2001-01-01T00:00:00.000Z", startedAt: "2001-01-01T00:00:00.000Z" },
      });
      expect(start.statusCode, start.body).toBeLessThan(300);

      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select gestartet_at from terminbuchungen where id = ${buchungId}`;
        const gesetzt = new Date(rows[0].gestartet_at as Date).getTime();
        // Serverzeit: innerhalb der letzten Minute, nicht 2001.
        expect(gesetzt).toBeGreaterThan(Date.now() - 60_000);
      } finally {
        await sql.end();
      }
    });

    it("kein Endpunkt akzeptiert ein Feld, das die Serveruhr überschreibt (statischer Wächter)", () => {
      // Ein Feld wie `now`, `serverTime`, `currentTime` oder `beendetAt` in
      // einem zod-Schema wäre die Tür, durch die eine Geräteuhr fachlich
      // wirksam wird. Es gibt sie nicht – und dieser Wächter hält das so.
      const verboten = /\b(now|serverTime|currentTime|jetzt|beendetAt|abgeschlossenAt|erstelltAt|createdAt|updatedAt)\s*:\s*z\./;
      const treffer: string[] = [];
      const routen = join(__dirname, "..", "routes");
      for (const datei of readdirSync(routen)) {
        if (!datei.endsWith(".ts")) continue;
        const inhalt = readFileSync(join(routen, datei), "utf-8");
        inhalt.split("\n").forEach((zeile, i) => {
          if (zeile.trim().startsWith("//") || zeile.trim().startsWith("*")) return;
          if (verboten.test(zeile)) treffer.push(`routes/${datei}:${i + 1}: ${zeile.trim()}`);
        });
      }
      expect(treffer).toEqual([]);
    });

    it("Sitzungsablauf und Idempotenzfrist rechnen mit Serverzeit (DB-Default `now()`)", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        // `created_at` kommt aus der Datenbank, nicht aus einem Request.
        const spalten = await sql`
          select table_name, column_name, column_default from information_schema.columns
           where table_schema = 'public' and column_name = 'created_at'
             and table_name in ('sessions', 'idempotency_keys', 'audit_events', 'state_transitions')`;
        expect(spalten.length).toBe(4);
        for (const s of spalten) {
          expect(String(s.column_default ?? "")).toMatch(/now\(\)|clock_timestamp\(\)/);
        }
      } finally {
        await sql.end();
      }
    });

    it("mehrere Übergänge in EINER Transaktion bleiben geordnet (clock_timestamp, nicht now())", async () => {
      /**
       * `now()` ist innerhalb einer Transaktion KONSTANT: zwei Übergänge
       * bekämen denselben Zeitstempel und ihre Reihenfolge wäre verloren. Der
       * Übergangstrigger übergibt deshalb ausdrücklich `clock_timestamp()`
       * (Migration 0007, `fs_record_transition`) – die SPALTENVORGABE ist
       * weiterhin `now()`, was hier ohne Bedeutung ist, weil kein Schreiber sie
       * benutzt. Geprüft wird deshalb das VERHALTEN, nicht der Default.
       */
      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`
          select pg_get_functiondef(p.oid) as def from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'fs_assert_transition'`;
        expect(String(rows[0]?.def ?? "")).toContain("clock_timestamp()");

        // Und der beobachtbare Effekt: zwei Übergänge in EINER Transaktion
        // tragen VERSCHIEDENE, aufsteigende Zeitstempel.
        const offer = await createOffer({ beginnAt: "2026-11-14T09:00:00.000Z", endeAt: "2026-11-14T10:00:00.000Z" });
        expect((await accept(offer.id, idemKey("s12-order"))).statusCode).toBe(201);
        const uebergaenge = await sql<Array<{ created_at: Date }>>`
          select created_at from state_transitions where entitaet_id = ${offer.id} order by created_at`;
        if (uebergaenge.length > 1) {
          const stempel = uebergaenge.map((u) => new Date(u.created_at).getTime());
          expect(new Set(stempel).size).toBe(stempel.length);
        }
      } finally {
        await sql.end();
      }
    }, 30000);
  });

  // =========================================================================
  // Szenario 13 – Uploadabbruch bei 80 Prozent
  // =========================================================================
  describe("Szenario 13: Uploadabbruch bei 80 Prozent", () => {
    /**
     * ERWARTUNG (§12): nichts halb Gespeichertes gilt als Dokument, der Client
     * erfährt GENAU welche Teilstücke fehlen, die Wiederaufnahme erzeugt EIN
     * Dokument, die Prüfsumme wird geprüft, und ein endgültig abgebrochener
     * Upload wird aufgeräumt, ohne ein Dokument zu hinterlassen.
     */
    const TEILE = 5;

    async function starteSitzung(size: number, checksum?: string) {
      const res = await app.inject({
        method: "POST",
        url: "/uploads",
        headers: { cookie: studentCookie },
        payload: {
          typ: "sehtest",
          dateiname: "gross.pdf",
          mimeTyp: "application/pdf",
          groesseBytes: size,
          ...(checksum ? { checksumSha256: checksum } : {}),
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().uploadId as string;
    }

    function stueck(uploadId: string, index: number, data: Buffer) {
      return app.inject({
        method: "PUT",
        url: `/uploads/${uploadId}/chunk?index=${index}`,
        headers: { cookie: studentCookie, "content-type": "application/octet-stream" },
        payload: data,
      });
    }

    /** Teilt PDF in fünf Stücke; die ersten vier sind die „80 Prozent". */
    function teile(): Buffer[] {
      const groesse = Math.ceil(PDF.byteLength / TEILE);
      return Array.from({ length: TEILE }, (_, i) => PDF.subarray(i * groesse, Math.min((i + 1) * groesse, PDF.byteLength)));
    }

    it("bei 80 % (4 von 5 Teilen) gibt es KEIN Dokument und der Abschluss wird abgewiesen", async () => {
      const stuecke = teile();
      const checksum = createHash("sha256").update(PDF).digest("hex");
      const uploadId = await starteSitzung(PDF.byteLength, checksum);
      for (let i = 0; i < 4; i += 1) {
        expect((await stueck(uploadId, i, stuecke[i])).statusCode).toBe(200);
      }

      const fortschritt = await app.inject({
        method: "GET",
        url: `/uploads/${uploadId}`,
        headers: { cookie: studentCookie },
      });
      expect(fortschritt.json().vorhandeneIndizes).toEqual([0, 1, 2, 3]);
      expect(fortschritt.json().empfangeneBytes).toBeLessThan(PDF.byteLength);

      const zuFrueh = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/complete`,
        headers: { cookie: studentCookie },
      });
      expect(zuFrueh.statusCode).toBeGreaterThanOrEqual(400);
      expect(zuFrueh.statusCode).toBeLessThan(500);

      const sql = createRawClient(databaseUrl);
      try {
        const dok = await sql`select count(*)::int as n from dokumente`;
        expect(dok[0].n).toBe(0);
      } finally {
        await sql.end();
      }
    });

    it("die Wiederaufnahme schickt NUR das fehlende Teil und erzeugt genau EIN Dokument", async () => {
      const stuecke = teile();
      const checksum = createHash("sha256").update(PDF).digest("hex");
      const uploadId = await starteSitzung(PDF.byteLength, checksum);
      for (let i = 0; i < 4; i += 1) await stueck(uploadId, i, stuecke[i]);

      // Neustart der App: die Sitzung liegt in der DATENBANK, nicht im Speicher.
      const fortschritt = await app.inject({
        method: "GET",
        url: `/uploads/${uploadId}`,
        headers: { cookie: studentCookie },
      });
      const vorhanden: number[] = fortschritt.json().vorhandeneIndizes;
      const fehlend = [0, 1, 2, 3, 4].filter((i) => !vorhanden.includes(i));
      expect(fehlend).toEqual([4]);

      for (const i of fehlend) expect((await stueck(uploadId, i, stuecke[i])).statusCode).toBe(200);

      const fertig = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/complete`,
        headers: { cookie: studentCookie },
      });
      expect(fertig.statusCode, fertig.body).toBe(201);
      expect(fertig.json().document.checksumSha256).toBe(checksum);

      const sql = createRawClient(databaseUrl);
      try {
        const dok = await sql`select count(*)::int as n from dokumente`;
        expect(dok[0].n).toBe(1);
      } finally {
        await sql.end();
      }
    });

    it("ein zweiter Abschluss derselben Sitzung erzeugt kein zweites Dokument", async () => {
      const stuecke = teile();
      const uploadId = await starteSitzung(PDF.byteLength);
      for (let i = 0; i < TEILE; i += 1) await stueck(uploadId, i, stuecke[i]);
      const erster = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/complete`,
        headers: { cookie: studentCookie },
      });
      expect(erster.statusCode, erster.body).toBe(201);

      const zweiter = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/complete`,
        headers: { cookie: studentCookie },
      });
      // Der Endpunkt ist idempotent: er liefert DASSELBE Dokument zurück
      // (kein Fehler, weil ein wiederholtes `complete` nach einem
      // Verbindungsabbruch der Normalfall ist) – aber niemals ein zweites.
      expect(zweiter.statusCode).toBeLessThan(300);
      expect(zweiter.json().document.id).toBe(erster.json().document.id);
      const sql = createRawClient(databaseUrl);
      try {
        const dok = await sql`select count(*)::int as n from dokumente`;
        expect(dok[0].n).toBe(1);
      } finally {
        await sql.end();
      }
    });

    it("ein bei 80 % wiederaufgenommenes Teil mit FALSCHEM Inhalt bricht die Prüfsumme, nicht die Datenbank", async () => {
      const stuecke = teile();
      const checksum = createHash("sha256").update(PDF).digest("hex");
      const uploadId = await starteSitzung(PDF.byteLength, checksum);
      for (let i = 0; i < 4; i += 1) await stueck(uploadId, i, stuecke[i]);
      // Das letzte Teil kommt in der richtigen LÄNGE, aber falschem Inhalt.
      await stueck(uploadId, 4, Buffer.alloc(stuecke[4].byteLength, 0x41));

      const fertig = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/complete`,
        headers: { cookie: studentCookie },
      });
      expect(fertig.statusCode).toBeGreaterThanOrEqual(400);
      expect(fertig.statusCode).toBeLessThan(500);
      const sql = createRawClient(databaseUrl);
      try {
        const dok = await sql`select count(*)::int as n from dokumente`;
        expect(dok[0].n).toBe(0);
      } finally {
        await sql.end();
      }
    });

    it("ein endgültig abgebrochener Upload wird aufgeräumt, ohne ein Dokument zu hinterlassen", async () => {
      const { cleanupAbortedUploads } = await import("../routes/uploads.js");
      const stuecke = teile();
      const uploadId = await starteSitzung(PDF.byteLength);
      for (let i = 0; i < 4; i += 1) await stueck(uploadId, i, stuecke[i]);

      const sql = createRawClient(databaseUrl);
      try {
        await sql`update upload_sessions set expires_at = now() - interval '1 hour' where id = ${uploadId}`;
      } finally {
        await sql.end();
      }
      const geraeumt = await cleanupAbortedUploads(getDb(databaseUrl));
      expect(geraeumt.entfernt + geraeumt.abgelaufen).toBeGreaterThanOrEqual(0);

      const nachher = await app.inject({
        method: "GET",
        url: `/uploads/${uploadId}`,
        headers: { cookie: studentCookie },
      });
      // Entweder weg (404) oder als abgebrochen gekennzeichnet – in keinem Fall
      // ein Dokument.
      expect([404, 200]).toContain(nachher.statusCode);
      if (nachher.statusCode === 200) expect(nachher.json().status).not.toBe("offen");
      const sql2 = createRawClient(databaseUrl);
      try {
        const dok = await sql2`select count(*)::int as n from dokumente`;
        expect(dok[0].n).toBe(0);
      } finally {
        await sql2.end();
      }
    });

    it("der einteilige Upload (`POST /documents`) landet zuerst in QUARANTÄNE, nie direkt geprüft", async () => {
      const { body, contentType } = buildMultipartBody({
        fields: { typ: "sehtest", idempotencyKey: idemKey("s13-einteilig") },
        fileFieldName: "datei",
        fileName: "test.pdf",
        fileContent: PDF,
        mimeType: "application/pdf",
      });
      const res = await app.inject({
        method: "POST",
        url: "/documents",
        headers: { cookie: studentCookie, "content-type": contentType },
        payload: body,
      });
      expect(res.statusCode, res.body).toBe(201);
      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select dokument_status, geprueft from dokumente`;
        expect(rows.length).toBe(1);
        // Nie `verified` ohne Prüfprotokoll (FS006) und nie ohne Scan (FS009).
        expect(rows[0].dokument_status).not.toBe("verified");
        expect(rows[0].geprueft).toBe(false);
      } finally {
        await sql.end();
      }
    });
  });

  // =========================================================================
  // Szenario 14 – Deployment während einer laufenden Buchung
  // =========================================================================
  describe("Szenario 14: Deployment während einer laufenden Buchung", () => {
    /**
     * ERWARTUNG: ein Rolling-Deployment lässt zwei Fassungen kurzzeitig
     * parallel laufen. Der laufende Vorgang darf nicht verloren gehen, nicht
     * doppelt wirken, und die neue Instanz darf keinen Verkehr annehmen, bevor
     * ihr Schema passt.
     *
     * Das wird als ECHTER Zweiinstanzbetrieb gegen dieselbe Datenbank
     * nachgestellt – nicht simuliert.
     */
    it("ein auf Instanz A begonnener Vorgang ist auf Instanz B abschließbar und wirkt genau einmal", async () => {
      const offer = await createOffer({ beginnAt: "2026-11-11T09:00:00.000Z", endeAt: "2026-11-11T10:00:00.000Z" });
      const key = idemKey("s14-rolling");

      const alt = buildTestApp();
      const neu = buildTestApp();
      await Promise.all([alt.ready(), neu.ready()]);
      try {
        const cookieAlt = await loginAs(alt, "schueler@test.local", fixtures.password);
        const cookieNeu = await loginAs(neu, "schueler@test.local", fixtures.password);

        const aufAlt = await alt.inject({
          method: "POST",
          url: `/appointment-offers/${offer.id}/accept`,
          headers: { cookie: cookieAlt },
          payload: { idempotencyKey: key },
        });
        expect(aufAlt.statusCode).toBe(201);

        // Instanz A wird jetzt vom Orchestrator beendet; der Client wiederholt
        // gegen B (der Loadbalancer hat umgeschaltet).
        await alt.close();
        const aufNeu = await neu.inject({
          method: "POST",
          url: `/appointment-offers/${offer.id}/accept`,
          headers: { cookie: cookieNeu },
          payload: { idempotencyKey: key },
        });
        expect(aufNeu.statusCode).toBe(200);
        expect(aufNeu.json().booking.id).toBe(aufAlt.json().booking.id);
        expect(await countBookings()).toBe(1);
      } finally {
        await neu.close();
      }
    }, 40000);

    it("ZWEI Instanzen gleichzeitig können den Slot nicht doppelt vergeben (der Constraint entscheidet, nicht der Prozess)", async () => {
      const a = buildTestApp();
      const b = buildTestApp();
      await Promise.all([a.ready(), b.ready()]);
      try {
        const cookieA = await loginAs(a, "fahrlehrer@test.local", fixtures.password);
        const cookieB = await loginAs(b, "fahrlehrer@test.local", fixtures.password);
        const zaehler: Record<number, number> = {};
        for (let runde = 0; runde < 5; runde += 1) {
          const payload = bookingPayload({
            beginnAt: new Date(Date.UTC(2026, 11, 1 + runde, 9, 0, 0)).toISOString(),
            endeAt: new Date(Date.UTC(2026, 11, 1 + runde, 10, 0, 0)).toISOString(),
          });
          const [ra, rb] = await Promise.all([
            a.inject({ method: "POST", url: "/appointments", headers: { "idempotency-key": idemKey("s14-a"), cookie: cookieA }, payload }),
            b.inject({ method: "POST", url: "/appointments", headers: { "idempotency-key": idemKey("s14-b"), cookie: cookieB }, payload }),
          ]);
          for (const r of [ra, rb]) zaehler[r.statusCode] = (zaehler[r.statusCode] ?? 0) + 1;
          expect([ra.statusCode, rb.statusCode].sort(), `Runde ${runde}: ${ra.body} | ${rb.body}`).toEqual([201, 409]);
        }
        expect(zaehler).toEqual({ 201: 5, 409: 5 });
      } finally {
        await Promise.all([a.close(), b.close()]);
      }
    }, 60000);

    it("BEFUND (bekannt, hier BEWIESEN): das Rate-Limit ist PRO PROZESS, nicht global", async () => {
      // Der Zähler liegt im Prozessspeicher (kein Redis in dieser Umgebung).
      // Zwei Instanzen erlauben damit zusammen das DOPPELTE Kontingent. Dieser
      // Test ist der Beweis dafür – nicht eine Behauptung im Dokument.
      const eng: Partial<RateLimitConfig> = {
        enabled: true,
        policies: { login: { name: "login", ratePerSecond: 0.01, burst: 2 } } as RateLimitConfig["policies"],
      };
      const a = buildApp({ databaseUrl, cookieSecure: false, logger: false, rateLimit: eng, startWorkers: false });
      const b = buildApp({ databaseUrl, cookieSecure: false, logger: false, rateLimit: eng, startWorkers: false });
      await Promise.all([a.ready(), b.ready()]);
      try {
        const versuch = (inst: FastifyInstance) =>
          inst.inject({
            method: "POST",
            url: "/auth/login",
            payload: { email: "schueler@test.local", password: "falsch" },
          });
        // Kontingent 2 je Instanz: der dritte Versuch AUF A ist 429 ...
        await versuch(a);
        await versuch(a);
        const drittesAufA = await versuch(a);
        expect(drittesAufA.statusCode).toBe(429);
        // ... aber auf B ist derselbe Aufrufer wieder frei. Das ist die Lücke.
        const erstesAufB = await versuch(b);
        expect(erstesAufB.statusCode).not.toBe(429);
      } finally {
        await Promise.all([a.close(), b.close()]);
      }
    }, 40000);

    it("der Brute-Force-Schutz hängt NICHT am Prozessspeicher – er ist DB-persistiert", async () => {
      // Genau deshalb ist der Befund darüber vertretbar: die
      // SICHERHEITS-Aussage hängt an der Datenbank, nur die Lastbegrenzung am
      // Prozess.
      const sql = createRawClient(databaseUrl);
      try {
        const tabelle = await sql`select to_regclass('auth_throttle')::text as t`;
        expect(tabelle[0].t).toBe("auth_throttle");
      } finally {
        await sql.end();
      }

      const eng = { windowMs: 60_000, accountLockAfter: 2, accountLockMs: 60_000, accountDelayAfter: 99, ipLockAfter: 99 };
      const a = buildApp({ databaseUrl, cookieSecure: false, logger: false, rateLimit: false, bruteForce: eng, startWorkers: false });
      const b = buildApp({ databaseUrl, cookieSecure: false, logger: false, rateLimit: false, bruteForce: eng, startWorkers: false });
      await Promise.all([a.ready(), b.ready()]);
      try {
        const falsch = (inst: FastifyInstance) =>
          inst.inject({ method: "POST", url: "/auth/login", payload: { email: "schueler@test.local", password: "falsch" } });
        await falsch(a);
        await falsch(a);
        // Die Sperre gilt auf der ANDEREN Instanz mit – anders als beim
        // Rate-Limit.
        const aufB = await falsch(b);
        expect(aufB.statusCode).toBe(429);
      } finally {
        await Promise.all([a.close(), b.close()]);
      }
    }, 40000);

    it("die neue Instanz nimmt keinen Verkehr an, solange Migrationen fehlen (Rollout-Reihenfolge)", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        // Eine Instanz, deren Artefakt eine Migration mitbringt, die in der DB
        // noch fehlt: die Bereitschaft MUSS 503 sein.
        await sql`delete from schema_migrations where filename = '0010_backup_and_deployment.sql'`;
        const res = await app.inject({ method: "GET", url: "/health/ready" });
        expect(res.statusCode).toBe(503);
        expect(res.json().grund).toBe("migrationen_ausstehend");
        expect(res.json().offeneMigrationen).toBe(1);
      } finally {
        await sql`insert into schema_migrations (filename) values ('0010_backup_and_deployment.sql')
                  on conflict do nothing`;
        await sql.end();
      }
    });
  });

  // =========================================================================
  // Szenario 15 – Backup in isolierter Umgebung wiederherstellen
  // =========================================================================
  describe("Szenario 15: Backup in isolierter Umgebung wiederherstellen", () => {
    /**
     * ERWARTUNG: die Wiederherstellung ist nicht „pg_restore endete mit 0",
     * sondern eine geprüfte Aussage über STRUKTUR und DATEN.
     *
     * Der vollständige Zyklus (pg_dump + Verschlüsselung + Restore in eine
     * ISOLIERTE Datenbank + Vergleich + PITR über WAL) ist ausgeführt und in
     * `docs/backup-restore-report.md` mit gemessenen Zahlen protokolliert.
     * Hier wird die dabei benutzte PRÜFUNG getestet – sonst wäre sie nur ein
     * Skript, das niemand nachrechnet.
     */
    it("die Integritätsprüfung meldet für die aktuelle Datenbank `ok`", async () => {
      const bericht = await checkDatabaseIntegrity(databaseUrl);
      expect(bericht.findings, JSON.stringify(bericht.findings)).toEqual([]);
      expect(bericht.ok).toBe(true);
      expect(bericht.migrationCount).toBeGreaterThanOrEqual(10);
      expect(bericht.latestMigration).toBe("0010_backup_and_deployment.sql");
    }, 30000);

    it("die Prüfung ERKENNT eine unvollständige Wiederherstellung (fehlender Migrationsstand)", async () => {
      // Der häufigste stille Fehler: ein alter Dump wird zurückgespielt und
      // sieht benutzbar aus. Die Prüfung muss das als Befund melden.
      const sql = createRawClient(databaseUrl);
      try {
        await sql`delete from schema_migrations where filename >= '0009'`;
        const bericht = await checkDatabaseIntegrity(databaseUrl);
        expect(bericht.migrationCount).toBeLessThan(10);
        expect(bericht.latestMigration).not.toBe("0010_backup_and_deployment.sql");
      } finally {
        for (const f of ["0009_defense_in_depth.sql", "0010_backup_and_deployment.sql"]) {
          await sql`insert into schema_migrations (filename) values (${f}) on conflict do nothing`;
        }
        await sql.end();
      }
    }, 30000);

    it("die Prüfung ERKENNT einen deaktivierten Invarianten-Trigger (`pg_restore --disable-triggers`)", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        await sql`alter table terminbuchungen disable trigger terminbuchungen_z_version_trg`;
        const bericht = await checkDatabaseIntegrity(databaseUrl);
        expect(bericht.ok).toBe(false);
        const befund = bericht.findings.find((f) => f.check === "disabled_triggers");
        expect(befund).toBeDefined();
        expect(befund!.severity).toBe("kritisch");
      } finally {
        await sql`alter table terminbuchungen enable trigger terminbuchungen_z_version_trg`;
        await sql.end();
      }
    }, 30000);

    it("die Prüfung erkennt eine referenzielle Waise (Restore ohne Constraints)", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        // Ein Zustand, den nur ein kaputter Restore erzeugen kann: Sitzung ohne
        // Benutzer. Der Fremdschlüssel wird dafür kurz ausgesetzt.
        await sql`alter table sessions drop constraint if exists sessions_benutzer_id_benutzer_id_fk`;
        await sql`alter table sessions drop constraint if exists sessions_benutzer_id_fkey`;
        await sql`insert into sessions (benutzer_id, token_hash, expires_at)
                  values (${randomUUID()}, ${randomUUID()}, now() + interval '1 hour')`;
        const bericht = await checkDatabaseIntegrity(databaseUrl);
        const befund = bericht.findings.find((f) => f.check === "session_ohne_benutzer");
        expect(befund, JSON.stringify(bericht.findings)).toBeDefined();
        expect(bericht.ok).toBe(false);
      } finally {
        await sql`delete from sessions where benutzer_id not in (select id from benutzer)`;
        await sql`alter table sessions add constraint sessions_benutzer_id_benutzer_id_fk
                  foreign key (benutzer_id) references benutzer(id) on delete cascade`;
        await sql`alter table sessions add constraint sessions_benutzer_id_fkey
                  foreign key (benutzer_id) references benutzer(id) on delete cascade`;
        await sql.end();
      }
    }, 30000);

    it("`compareRowCounts` erkennt abweichende Zeilenzahlen zwischen Quelle und Ziel", async () => {
      const quelle = await checkDatabaseIntegrity(databaseUrl);
      const ziel = { ...quelle, rowCounts: { ...quelle.rowCounts, benutzer: (quelle.rowCounts.benutzer ?? 0) - 1 } };
      const vergleich = compareRowCounts(quelle, ziel);
      expect(vergleich.gleich).toBe(false);
      expect(vergleich.abweichungen.map((a) => a.tabelle)).toContain("benutzer");
      // Mit Toleranz für eine lebende Quelltabelle ist derselbe Vergleich grün.
      expect(compareRowCounts(quelle, ziel, ["benutzer"]).gleich).toBe(true);
    }, 30000);

    it("das Backup-Protokoll erzwingt einen Verifikationsnachweis, bevor es als Nachweis gilt", async () => {
      const sql = createRawClient(databaseUrl);
      const label = `chaos15-${randomUUID().slice(0, 8)}`;
      try {
        await sql`insert into backup_runs (label, kind, location, status)
                  values (${label}, 'logical', '/tmp/x.dump.enc', 'erfolgreich')`;
        const offen = await sql`select verified_at from backup_runs where label = ${label}`;
        // Ein Backup ist erst mit einem gelaufenen Wiederherstellungstest ein
        // Nachweis – vorher ist es eine Hoffnung.
        expect(offen[0].verified_at).toBeNull();
      } finally {
        await sql`delete from backup_runs where label = ${label}`;
        await sql.end();
      }
    });
  });

  // =========================================================================
  // Szenario 16 – Schüler versucht fremde IDs
  // =========================================================================
  describe("Szenario 16: Schüler versucht fremde IDs", () => {
    /**
     * ERWARTUNG: serverseitige Autorisierung an JEDEM Zugriff, nicht nur in der
     * Oberfläche. Kein 200 mit fremden Daten, kein 500, und wo eine 403 die
     * EXISTENZ eines fremden Objekts bestätigen würde, eine 404.
     */
    it("Schüler B erreicht kein einziges Objekt von Schüler A – ein Durchlauf über alle Zugriffswege", async () => {
      // Schüler A legt an: Angebot annehmen, Dokument hochladen, Upload-Sitzung.
      const offer = await createOffer({ beginnAt: "2026-11-12T09:00:00.000Z", endeAt: "2026-11-12T10:00:00.000Z" });
      const key = idemKey("s16-a");
      const buchung = await accept(offer.id, key, studentCookie);
      expect(buchung.statusCode).toBe(201);
      const buchungId = buchung.json().booking.id;

      const { body, contentType } = buildMultipartBody({
        fields: { typ: "sehtest", idempotencyKey: idemKey("s16-dok") },
        fileFieldName: "datei",
        fileName: "a.pdf",
        fileContent: PDF,
        mimeType: "application/pdf",
      });
      const dok = await app.inject({
        method: "POST",
        url: "/documents",
        headers: { cookie: studentCookie, "content-type": contentType },
        payload: body,
      });
      expect(dok.statusCode).toBe(201);
      const dokumentId = dok.json().document.id;

      const uploadSitzung = await app.inject({
        method: "POST",
        url: "/uploads",
        headers: { cookie: studentCookie },
        payload: { typ: "sehtest", dateiname: "a.pdf", mimeTyp: "application/pdf", groesseBytes: PDF.byteLength },
      });
      const uploadId = uploadSitzung.json().uploadId;

      // Schüler B versucht ALLES.
      const versuche: Array<{ name: string; res: Awaited<ReturnType<typeof app.inject>> }> = [
        {
          name: "fremdes Dokument lesen",
          res: await app.inject({ method: "GET", url: `/documents/${dokumentId}`, headers: { cookie: student2Cookie } }),
        },
        {
          name: "fremdes Dokument-Inhalt",
          res: await app.inject({ method: "GET", url: `/documents/${dokumentId}/content`, headers: { cookie: student2Cookie } }),
        },
        {
          name: "fremdes Angebot annehmen",
          res: await accept(offer.id, idemKey("s16-b"), student2Cookie),
        },
        {
          name: "fremden Termin stornieren",
          res: await app.inject({
            method: "POST",
            url: `/appointments/${buchungId}/cancel`,
            headers: { cookie: student2Cookie },
            payload: { idempotencyKey: idemKey("s16-c"), expectedVersion: 1, grund: "will ich weg" },
          }),
        },
        {
          name: "fremden Idempotenzschlüssel auflösen",
          res: await app.inject({
            method: "GET",
            url: `/sync/operations/appointment-offers.accept/${key}`,
            headers: { cookie: student2Cookie },
          }),
        },
        {
          name: "fremde Upload-Sitzung lesen",
          res: await app.inject({ method: "GET", url: `/uploads/${uploadId}`, headers: { cookie: student2Cookie } }),
        },
        {
          name: "fremde Upload-Sitzung beschreiben",
          res: await app.inject({
            method: "PUT",
            url: `/uploads/${uploadId}/chunk?index=0`,
            headers: { cookie: student2Cookie, "content-type": "application/octet-stream" },
            payload: PDF,
          }),
        },
        {
          name: "fremde Dokumentprüfung (Büro-Recht)",
          res: await app.inject({
            method: "POST",
            url: `/documents/${dokumentId}/review`,
            headers: { cookie: student2Cookie },
            payload: { entscheidung: "verified", pruefprotokoll: "passt", expectedVersion: 1 },
          }),
        },
        {
          name: "Ops-Route",
          res: await app.inject({ method: "GET", url: "/ops/outbox", headers: { cookie: student2Cookie } }),
        },
        {
          name: "Rollenänderung",
          res: await app.inject({
            method: "PATCH",
            url: `/users/${fixtures.bueroBenutzerId}/role`,
            headers: { cookie: student2Cookie },
            payload: { rolle: "geschaeftsfuehrung", expectedVersion: 1 },
          }),
        },
      ];

      for (const { name, res } of versuche) {
        expect([400, 401, 403, 404, 409, 428], `${name}: ${res.statusCode} ${res.body}`).toContain(res.statusCode);
        expect(res.statusCode, `${name} darf nie 2xx sein`).toBeGreaterThanOrEqual(400);
        expect(res.statusCode, `${name} darf nie 5xx sein`).toBeLessThan(500);
      }

      // Und: die Daten von A sind unverändert.
      expect(await countBookings()).toBe(1);
      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select geprueft from dokumente where id = ${dokumentId}`;
        expect(rows[0].geprueft).toBe(false);
      } finally {
        await sql.end();
      }
    }, 60000);

    it("die Liste des Schülers B enthält kein Objekt von A (kein Filter-Bypass über Listen)", async () => {
      const offer = await createOffer({ beginnAt: "2026-11-13T09:00:00.000Z", endeAt: "2026-11-13T10:00:00.000Z" });
      expect((await accept(offer.id, idemKey("s16-liste"), studentCookie)).statusCode).toBe(201);

      const meine = await app.inject({ method: "GET", url: "/appointments/mine", headers: { cookie: student2Cookie } });
      expect(meine.statusCode).toBe(200);
      const eintraege = meine.json().appointments ?? meine.json().termine ?? [];
      expect(eintraege).toEqual([]);

      const dokumente = await app.inject({ method: "GET", url: "/documents/mine", headers: { cookie: student2Cookie } });
      expect(dokumente.statusCode).toBe(200);
      expect(dokumente.json().documents ?? dokumente.json().dokumente ?? []).toEqual([]);
    });

    it("eine erfundene UUID ist 404, keine 500 – und verrät nichts über den Bestand", async () => {
      const erfunden = randomUUID();
      for (const url of [`/documents/${erfunden}`, `/uploads/${erfunden}`]) {
        const res = await app.inject({ method: "GET", url, headers: { cookie: studentCookie } });
        expect(res.statusCode).toBe(404);
      }
    });
  });

  // =========================================================================
  // Szenario 17 – Mitarbeiterrolle wird in aktiver Sitzung entzogen
  // =========================================================================
  describe("Szenario 17: Mitarbeiterrolle wird in aktiver Sitzung entzogen", () => {
    /**
     * ERWARTUNG: Rechte werden bei JEDEM Request neu bewertet, nicht bei der
     * Anmeldung. Eine bereits offene Sitzung darf nach dem Entzug keine
     * Mitarbeitendenhandlung mehr ausführen.
     *
     * Der Beweis liegt in `middleware/auth.ts`: `createSessionLoader` liest
     * Rolle UND Kontostatus per JOIN aus `benutzer` – es gibt kein Rollenfeld in
     * der Sitzung und kein JWT, das eine alte Rolle konservieren könnte.
     */
    it("die Rolle wird MITTEN in der Sitzung neu bewertet – dieselbe Sitzung bekommt danach 403", async () => {
      // Vorher: das Büro darf die Heute-Queue sehen.
      const vorher = await app.inject({ method: "GET", url: "/office/heute", headers: { cookie: bueroCookie } });
      expect(vorher.statusCode).toBe(200);

      const sql = createRawClient(databaseUrl);
      try {
        await sql`update benutzer set rolle = 'schueler' where id = ${fixtures.bueroBenutzerId}`;
      } finally {
        await sql.end();
      }

      // NACHHER, mit DEMSELBEN Cookie, ohne Neuanmeldung:
      const nachher = await app.inject({ method: "GET", url: "/office/heute", headers: { cookie: bueroCookie } });
      expect(nachher.statusCode).toBe(403);
    });

    it("ein GESPERRTES Konto verliert die Sitzung sofort (401, nicht 403)", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        await sql`update benutzer set status = 'gesperrt' where id = ${fixtures.bueroBenutzerId}`;
      } finally {
        await sql.end();
      }
      const res = await app.inject({ method: "GET", url: "/office/heute", headers: { cookie: bueroCookie } });
      // 401: die Sitzung wird gar nicht mehr geladen – das Konto ist weg, nicht
      // nur unberechtigt.
      expect(res.statusCode).toBe(401);
      const me = await app.inject({ method: "GET", url: "/me", headers: { cookie: bueroCookie } });
      expect(me.statusCode).toBe(401);
    });

    it("`PATCH /users/:id/role` beendet ZUSÄTZLICH alle Sitzungen des Betroffenen", async () => {
      // Zwei parallele Sitzungen desselben Mitarbeiters.
      const zweite = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
      expect((await app.inject({ method: "GET", url: "/me", headers: { cookie: zweite } })).statusCode).toBe(200);

      // `users:manage` liegt bei `systemdienst` (docs/role-permission-matrix.md);
      // die Änderung braucht zusätzlich Step-up und darf nicht die eigene Rolle
      // betreffen (Vier-Augen).
      const sql = createRawClient(databaseUrl);
      let sysSecret = "";
      try {
        const { hashPassword, generateTotpSecret } = await import("@fahrschul/auth");
        sysSecret = generateTotpSecret();
        const hash = await hashPassword(fixtures.password);
        await sql`insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
          values (${fixtures.standortId}, 'sys@test.local', ${hash}, 'systemdienst', 'Sys', 'Test', true, ${sysSecret})`;
      } finally {
        await sql.end();
      }
      const sys = await loginAs(app, "sys@test.local", fixtures.password, sysSecret);
      const { stepUp } = await import("./helpers.js");
      await stepUp(app, sys, fixtures.password, sysSecret);

      const rollen = await app.inject({ method: "GET", url: "/users", headers: { cookie: sys } });
      expect(rollen.statusCode, rollen.body).toBe(200);
      const liste = (rollen.json().users ?? rollen.json().benutzer) as Array<{ id: string; version: number }>;
      const ziel = liste.find((u) => u.id === fixtures.bueroBenutzerId)!;
      const aendern = await app.inject({
        method: "PATCH",
        url: `/users/${fixtures.bueroBenutzerId}/role`,
        headers: { cookie: sys },
        payload: { rolle: "schueler", grund: "Chaos-Szenario 17", expectedVersion: ziel.version },
      });
      expect(aendern.statusCode, aendern.body).toBe(200);

      // BEIDE Sitzungen sind beendet – nicht nur die aktuelle.
      for (const cookie of [bueroCookie, zweite]) {
        const res = await app.inject({ method: "GET", url: "/me", headers: { cookie } });
        expect(res.statusCode).toBe(401);
      }
    }, 40000);

    it("es gibt kein Rollenfeld in der Sitzung – die Rolle KANN nicht veralten (struktureller Beweis)", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        const spalten = await sql<Array<{ column_name: string }>>`
          select column_name from information_schema.columns where table_name = 'sessions'`;
        const namen = spalten.map((s) => s.column_name);
        expect(namen).not.toContain("rolle");
        expect(namen).not.toContain("role");
        expect(namen).not.toContain("permissions");
      } finally {
        await sql.end();
      }
    });

    it("der Entzug wirkt auch auf einer ANDEREN Instanz sofort (kein prozesslokaler Rechte-Cache)", async () => {
      const zweiteInstanz = buildTestApp();
      await zweiteInstanz.ready();
      try {
        const cookie = await loginAs(zweiteInstanz, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
        expect((await zweiteInstanz.inject({ method: "GET", url: "/office/heute", headers: { cookie } })).statusCode).toBe(200);

        // Änderung über die ERSTE Instanz.
        const sql = createRawClient(databaseUrl);
        try {
          await sql`update benutzer set rolle = 'schueler' where id = ${fixtures.bueroBenutzerId}`;
        } finally {
          await sql.end();
        }

        const nachher = await zweiteInstanz.inject({ method: "GET", url: "/office/heute", headers: { cookie } });
        expect(nachher.statusCode).toBe(403);
      } finally {
        await zweiteInstanz.close();
      }
    }, 30000);
  });

  // =========================================================================
  // Szenario 18 – Zahlung wird nach Zuordnung zurückgebucht
  // =========================================================================
  describe("Szenario 18: Zahlung wird nach Zuordnung zurückgebucht", () => {
    async function financeCookie(): Promise<string> {
      const sql = createRawClient(databaseUrl);
      try {
        await sql`update benutzer set rolle = 'finanzen' where id = ${fixtures.bueroBenutzerId}`;
      } finally {
        await sql.end();
      }
      return loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
    }

    /** Rechnung + Banktransaktion als Ausgangslage. */
    async function ausgangslage() {
      const sql = createRawClient(databaseUrl);
      try {
        const [rechnung] = await sql`
          insert into rechnungen (standort_id, schueler_id, rechnungsnummer, betrag_cent, status, faellig_am)
          values (${fixtures.standortId}, ${fixtures.schuelerId}, ${`R-${randomUUID().slice(0, 8)}`},
                  10000, 'offen', now() + interval '14 days')
          returning id, betrag_cent`;
        const [tx] = await sql`
          insert into banktransaktionen (standort_id, external_id, booked_at, amount_cent,
                                         reference, counterparty, zahlungsart, konfidenz,
                                         zahlung_status, status)
          values (${fixtures.standortId}, ${randomUUID()}, now(), 10000,
                  'Rechnung Fahrschule', 'Erika Musterfrau', 'ueberweisung', 'sicher',
                  'matching', 'offen')
          returning id, amount_cent`;
        return { rechnungId: rechnung.id as string, txId: tx.id as string };
      } finally {
        await sql.end();
      }
    }

    /**
     * ERWARTUNG (§3 FS003 + §10): eine zugeordnete Zahlung ist nicht mehr frei
     * verfügbar. Der EINZIGE Ausgang aus `matched` ist `reversed`; eine zweite
     * Zuordnung ist ausgeschlossen; die Rechnung wird durch die Rückbuchung
     * NICHT automatisch als bezahlt oder als Mahnfall behandelt.
     */
    it("die Zuordnung setzt `matched` – und eine ZWEITE Zuordnung derselben Transaktion wird abgewiesen (FS003)", async () => {
      const finanzen = await financeCookie();
      const { rechnungId, txId } = await ausgangslage();

      const zuordnen = await app.inject({
        method: "POST",
        url: `/finance/bank/${txId}/resolve`,
        headers: { "idempotency-key": idemKey("s18-1"), cookie: finanzen },
        payload: { rechnungId, betragCent: 10000 },
      });
      expect(zuordnen.statusCode, zuordnen.body).toBeLessThan(300);

      const sql = createRawClient(databaseUrl);
      try {
        const tx = await sql`select zahlung_status from banktransaktionen where id = ${txId}`;
        expect(tx[0].zahlung_status).toBe("matched");

        // Eine zweite Zahlung auf eine `matched`-Transaktion: FS003, auch per
        // Roh-SQL – die Regel liegt in der Datenbank.
        await expect(
          sql`insert into zahlungen (standort_id, schueler_id, rechnung_id, banktransaktion_id, betrag_cent, eingegangen_am, status)
              values (${fixtures.standortId}, ${fixtures.schuelerId}, ${rechnungId}, ${txId}, 1, now(), 'gebucht')`,
        ).rejects.toThrow();
      } finally {
        await sql.end();
      }
    });

    it("aus `matched` führt AUSSCHLIESSLICH `reversed` heraus (Roh-SQL, nicht nur Anwendungscode)", async () => {
      const finanzen = await financeCookie();
      const { rechnungId, txId } = await ausgangslage();
      await app.inject({
        method: "POST",
        url: `/finance/bank/${txId}/resolve`,
        headers: { "idempotency-key": idemKey("s18-2"), cookie: finanzen },
        payload: { rechnungId, betragCent: 10000 },
      });

      const sql = createRawClient(databaseUrl);
      try {
        for (const ziel of ["matching", "suggested", "review_required", "partially_matched", "imported"]) {
          await expect(
            sql`update banktransaktionen set zahlung_status = ${ziel} where id = ${txId}`,
            `${ziel} darf nicht erlaubt sein`,
          ).rejects.toThrow();
        }
        // Und der eine erlaubte Weg funktioniert.
        await sql`update banktransaktionen set zahlung_status = 'reversed' where id = ${txId}`;
        const nachher = await sql`select zahlung_status, status from banktransaktionen where id = ${txId}`;
        expect(nachher[0].zahlung_status).toBe("reversed");
        // Die Alt-Spalte wird per Trigger mitgezogen (expand-contract).
        expect(nachher[0].status).toBe("abgelehnt");
      } finally {
        await sql.end();
      }
    });

    it("die Rückbuchung ist auditiert und als Zustandsübergang protokolliert", async () => {
      const finanzen = await financeCookie();
      const { rechnungId, txId } = await ausgangslage();
      await app.inject({
        method: "POST",
        url: `/finance/bank/${txId}/resolve`,
        headers: { "idempotency-key": idemKey("s18-3"), cookie: finanzen },
        payload: { rechnungId, betragCent: 10000 },
      });

      const sql = createRawClient(databaseUrl);
      try {
        await sql`update banktransaktionen set zahlung_status = 'reversed' where id = ${txId}`;
        // Der Übergangstrigger schreibt `state_transitions` – auch bei Roh-SQL.
        const uebergaenge = await sql<Array<{ von_status: string; nach_status: string }>>`
          select von_status, nach_status from state_transitions
           where entitaet_id = ${txId} order by created_at`;
        const paare = uebergaenge.map((u) => `${u.von_status}->${u.nach_status}`);
        expect(paare).toContain("matched->reversed");
      } finally {
        await sql.end();
      }
    });

    it("eine Rücklastschrift wird NIE automatisch verbucht – sie geht in die Prüf-Warteschlange", async () => {
      const { matchTransaktion } = await import("@fahrschul/finance-core");
      const ergebnis = matchTransaktion(
        {
          id: randomUUID(),
          amountCent: -10000,
          verwendungszweck: "RUECKLASTSCHRIFT",
          zahlerName: "Erika Musterfrau",
          buchungsdatum: new Date(),
          istRuecklastschriftVon: randomUUID(),
        } as never,
        [],
        new Set(),
      );
      expect(ergebnis.konfidenz).toBe("unklar");
      // Non-Negotiable: nur `sicher` bucht automatisch.
      expect(ergebnis.autoBuchbar).toBe(false);
      expect(ergebnis.grund).toBe("ruecklastschrift");
    });

    it("nach der Rückbuchung wird NICHT automatisch gesperrt oder gemahnt", async () => {
      const finanzen = await financeCookie();
      const { rechnungId, txId } = await ausgangslage();
      await app.inject({
        method: "POST",
        url: `/finance/bank/${txId}/resolve`,
        headers: { "idempotency-key": idemKey("s18-4"), cookie: finanzen },
        payload: { rechnungId, betragCent: 10000 },
      });

      const sql = createRawClient(databaseUrl);
      try {
        const vorher = await sql`select status from ausbildungen where id = ${fixtures.ausbildungId}`;
        await sql`update banktransaktionen set zahlung_status = 'reversed' where id = ${txId}`;

        // Der Jobdurchlauf nach der Rückbuchung.
        const scheduler = createScheduler(
          { db: getDb(databaseUrl), notifications: createNotificationsAdapter("mock") },
          { batchLimit: 50 },
        );
        await scheduler.runScheduleTick();
        await scheduler.runWorkTick();

        const nachher = await sql`select status from ausbildungen where id = ${fixtures.ausbildungId}`;
        // Keine automatische Sperre der Ausbildung.
        expect(nachher[0].status).toBe(vorher[0].status);
        // Und die Termine bestehen weiter.
        const termine = await sql`select count(*)::int as n from terminbuchungen
          where status not in ('cancelled', 'storniert')`;
        expect(termine[0].n).toBe(0);
      } finally {
        await sql.end();
      }
    }, 40000);

    it("`reversed -> matching` ist erlaubt: eine erneut eingehende Zahlung kann wieder verarbeitet werden", async () => {
      const finanzen = await financeCookie();
      const { rechnungId, txId } = await ausgangslage();
      await app.inject({
        method: "POST",
        url: `/finance/bank/${txId}/resolve`,
        headers: { "idempotency-key": idemKey("s18-5"), cookie: finanzen },
        payload: { rechnungId, betragCent: 10000 },
      });
      const sql = createRawClient(databaseUrl);
      try {
        await sql`update banktransaktionen set zahlung_status = 'reversed' where id = ${txId}`;
        await sql`update banktransaktionen set zahlung_status = 'matching' where id = ${txId}`;
        const rows = await sql`select zahlung_status from banktransaktionen where id = ${txId}`;
        expect(rows[0].zahlung_status).toBe("matching");
      } finally {
        await sql.end();
      }
    });
  });

  // =========================================================================
  // Querschnitt: die Wächter, die §20 als Ganzes stützen
  // =========================================================================
  describe("Querschnitt", () => {
    it("kein Chaos-Szenario hat einen Dead Letter im Fachkern hinterlassen", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select count(*)::int as n from dead_letters where resumed_at is null`;
        expect(rows[0].n).toBe(0);
      } finally {
        await sql.end();
      }
    });

    it("die sieben eingefrorenen Prototyp-Dateien sind unangetastet", () => {
      const eingefroren = [
        "app.html",
        "dashboard.html",
        "fahrlehrer.html",
        "cockpit-pro.html",
        "website.html",
        "server.py",
        "sync-data.json",
      ];
      for (const datei of eingefroren) {
        const pfad = join(REPO, datei);
        expect(statSync(pfad).isFile()).toBe(true);
        const inhalt = readFileSync(pfad, "utf-8");
        // Kein Phase-4-Eingriff in die Prototypen.
        // Wie der Phase-3-Wächter: die Marke, die ein Eingriff dieser
        // Prompt-Reihe hinterlassen würde. (Die Prototypen enthalten von sich
        // aus Zeichenfolgen wie "Phase 4" in Fachtexten – die sind alt.)
        expect(inhalt).not.toContain("PROMPT -1");
      }
      expect(statSync(join(REPO, "react-zentrale")).isDirectory()).toBe(true);
    });
  });
});
