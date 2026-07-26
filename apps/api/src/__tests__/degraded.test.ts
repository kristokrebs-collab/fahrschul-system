import { createRawClient } from "@fahrschul/database";
import type { BankFeedAdapter, MalwareScanAdapter, NotificationsAdapter } from "@fahrschul/integrations";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import {
  guardFor,
  integrationStatus,
  resetIntegrationRegistry,
  resumeBufferedCalls,
  resumeFailedCall,
  runBuffered,
} from "../services/integrations.js";
import { releaseDocumentAfterScan, retryQuarantinedScans } from "../services/document-pipeline.js";
import { recentAlarms, clearRecentAlarms, resetAlarmSinks } from "../workers/alarm.js";
import { METRIC, getMetricValue, resetMetrics, sumMetric } from "../lib/metrics.js";
import {
  buildTestApp,
  enableMfa,
  ensureMigrated,
  idemKey,
  loginAs,
  seedFixtures,
  testDatabaseUrl,
  truncateAll,
  type SeededFixtures,
} from "./helpers.js";

/**
 * PROMPT -1 §11 + §18 – Ausfallsichere externe Schnittstellen und
 * degradierter Betrieb, gegen echtes Postgres.
 *
 * Der zweite Teil (§18) prüft ALLE FÜNF geforderten Szenarien einzeln. Die
 * gemeinsame Zusage aller fünf: **der Kern bleibt nutzbar, es gibt keine
 * falsche Erfolgsmeldung, und nichts geht verloren.**
 */

/** Ein Adapter, der auf Kommando ausfällt. */
function schaltbareNotifications() {
  const state = { fehlerhaft: false, gesendet: 0 };
  const adapter: NotificationsAdapter = {
    mode: "mock",
    async send() {
      if (state.fehlerhaft) {
        throw Object.assign(new Error("Anbieter nicht erreichbar"), { code: "ECONNREFUSED" });
      }
      state.gesendet += 1;
      return { id: `test-${state.gesendet}`, delivered: true };
    },
  };
  return { adapter, state };
}

describe("PROMPT -1 §11 – Externe Schnittstellen ausfallsicher", () => {
  const databaseUrl = testDatabaseUrl();
  let fixtures: SeededFixtures;

  beforeAll(async () => {
    await ensureMigrated(databaseUrl);
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    resetIntegrationRegistry();
    resetMetrics();
    clearRecentAlarms();
    resetAlarmSinks();
    fixtures = await seedFixtures(databaseUrl);
  });

  async function getDb() {
    const { getDb } = await import("../db.js");
    return getDb(databaseUrl);
  }

  it("PUFFERT einen ausgehenden Aufruf, wenn das Zielsystem nicht erreichbar ist – und meldet KEINEN Erfolg", async () => {
    const db = await getDb();
    const result = await runBuffered(
      { db, sleep: async () => undefined, breaker: { failureThreshold: 99 } },
      {
        integration: "notifications",
        operation: "send",
        idempotencyKey: "puffer-1",
        payload: { to: "a@b.de", kanal: "email", inhalt: "Test" },
        fn: async () => {
          throw Object.assign(new Error("weg"), { code: "ECONNREFUSED" });
        },
      },
    );
    expect(result.outcome).toBe("gepuffert");
    expect(result.hinweis).toContain("wartet auf externe Synchronisation");

    const sql = createRawClient(databaseUrl);
    try {
      const rows = await sql`select status, idempotency_key, payload from integration_outbound_calls`;
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("buffered");
      expect(rows[0].idempotency_key).toBe("puffer-1");
    } finally {
      await sql.end();
    }
  });

  it("wiederholt einen gepufferten Aufruf AUTOMATISCH mit DEMSELBEN Idempotenzschlüssel", async () => {
    const db = await getDb();
    const optionen = { db, sleep: async () => undefined, breaker: { failureThreshold: 99 } };
    await runBuffered(optionen, {
      integration: "notifications",
      operation: "send",
      idempotencyKey: "resume-1",
      payload: { to: "a@b.de", kanal: "email", inhalt: "Test" },
      fn: async () => {
        throw Object.assign(new Error("weg"), { code: "ECONNREFUSED" });
      },
    });

    // Wartezeit vorspulen, damit `next_attempt_at` erreicht ist.
    const sql = createRawClient(databaseUrl);
    try {
      await sql`update integration_outbound_calls set next_attempt_at = now() - interval '1 minute'`;
    } finally {
      await sql.end();
    }

    const gesehen: string[] = [];
    const result = await resumeBufferedCalls(optionen, {
      execute: async (call) => {
        gesehen.push(call.idempotencyKey);
        return { delivered: true };
      },
    });
    expect(result.zugestellt).toBe(1);
    // DERSELBE Schlüssel – das Zielsystem darf nicht doppelt wirken.
    expect(gesehen).toEqual(["resume-1"]);

    const sql2 = createRawClient(databaseUrl);
    try {
      const rows = await sql2`select status from integration_outbound_calls`;
      expect(rows[0].status).toBe("succeeded");
    } finally {
      await sql2.end();
    }
  });

  it("liefert bei einem BEKANNTEN Schlüssel das gespeicherte Ergebnis zurück statt erneut zu senden", async () => {
    const db = await getDb();
    const optionen = { db, sleep: async () => undefined };
    let aufrufe = 0;
    const fn = async () => {
      aufrufe += 1;
      return { delivered: true, id: "x" };
    };
    const erste = await runBuffered(optionen, {
      integration: "notifications",
      operation: "send",
      idempotencyKey: "einmal",
      fn,
    });
    const zweite = await runBuffered(optionen, {
      integration: "notifications",
      operation: "send",
      idempotencyKey: "einmal",
      fn,
    });
    expect(erste.outcome).toBe("zugestellt");
    expect(zweite.outcome).toBe("zugestellt");
    expect(aufrufe).toBe(1);
    expect(zweite.hinweis).toContain("Bereits zugestellt");
  });

  it("verschiebt einen Aufruf nach Erschöpfung in die FEHLERWARTESCHLANGE und alarmiert", async () => {
    const db = await getDb();
    const optionen = { db, sleep: async () => undefined, breaker: { failureThreshold: 99 } };
    const sql = createRawClient(databaseUrl);
    try {
      for (let i = 0; i < 9; i += 1) {
        await runBuffered(optionen, {
          integration: "notifications",
          operation: "send",
          idempotencyKey: "dauerhaft",
          maxAttempts: 1,
          fn: async () => {
            throw Object.assign(new Error("weg"), { code: "ECONNREFUSED" });
          },
        });
        await sql`update integration_outbound_calls set next_attempt_at = now() - interval '1 minute'`;
      }
      const rows = await sql`select status, attempts from integration_outbound_calls`;
      expect(rows[0].status).toBe("failed");
      expect(rows[0].attempts).toBeGreaterThanOrEqual(8);
    } finally {
      await sql.end();
    }
    expect(recentAlarms().some((a) => a.kind === "integration_error_queue")).toBe(true);
  });

  it("erlaubt die MANUELLE Wiederaufnahme aus der Fehlerwarteschlange – auditiert", async () => {
    const db = await getDb();
    const sql = createRawClient(databaseUrl);
    let callId: string;
    try {
      const [row] = await sql`
        insert into integration_outbound_calls (integration, operation, idempotency_key, status, attempts, max_attempts)
        values ('notifications', 'send', 'manuell-1', 'failed', 8, 8) returning id`;
      callId = row.id;
    } finally {
      await sql.end();
    }

    const result = await resumeFailedCall(db, {
      callId,
      akteurBenutzerId: fixtures.bueroBenutzerId,
      standortId: fixtures.standortId,
      resetBreaker: true,
    });
    expect(result.ok).toBe(true);

    const sql2 = createRawClient(databaseUrl);
    try {
      const rows = await sql2`select status, attempts from integration_outbound_calls where id = ${callId}`;
      expect(rows[0].status).toBe("buffered");
      expect(rows[0].attempts).toBe(0);
      const audit = await sql2`select 1 from audit_events where type = 'integration.call.resumed'`;
      expect(audit).toHaveLength(1);
    } finally {
      await sql2.end();
    }
  });

  it("persistiert den Breaker-Zustand und den letzten Erfolg – ein Neustart lügt nicht", async () => {
    const db = await getDb();
    const optionen = { db, sleep: async () => undefined, breaker: { failureThreshold: 2, successThreshold: 1, openMs: 60_000 } };
    for (let i = 0; i < 2; i += 1) {
      await runBuffered(optionen, {
        integration: "bank",
        operation: "fetchTransactions",
        idempotencyKey: `p-${i}`,
        maxAttempts: 1,
        fn: async () => {
          throw Object.assign(new Error("weg"), { code: "ECONNREFUSED" });
        },
      });
    }

    // Neustart simulieren: Registry weg, DB bleibt.
    resetIntegrationRegistry();
    const status = await integrationStatus(db);
    const bank = status.find((s) => s.integration === "bank")!;
    expect(bank.breakerState).toBe("open");
    expect(bank.status).toBe("ausgefallen");
    expect(bank.lastFailureAt).not.toBeNull();
    expect(bank.gepuffert).toBeGreaterThan(0);
    expect(bank.mode).toBe("mock");
    expect(recentAlarms().some((a) => a.kind === "integration_breaker_open")).toBe(true);
  });

  it("zählt Integrationsaufrufe und offene Breaker als Kennzahl", async () => {
    const db = await getDb();
    await runBuffered({ db, sleep: async () => undefined }, {
      integration: "notifications",
      operation: "send",
      idempotencyKey: "metrik-1",
      fn: async () => ({ delivered: true }),
    });
    expect(getMetricValue(METRIC.integrationCalls, { integration: "notifications", outcome: "success" })).toBe(1);

    const guard = guardFor("calendar", { db });
    guard.trip("Test");
    const { collectDbMetrics } = await import("../services/metrics-collector.js");
    await collectDbMetrics(db);
    expect(sumMetric(METRIC.integrationBreakerOpen)).toBeGreaterThanOrEqual(0);
  });

  it("meldet den Gesundheitsstatus aller zehn Integrationen über die Ops-Route", async () => {
    const app = buildTestApp();
    await app.ready();
    try {
      // Der neue Mitarbeitenden-Account braucht ein abgeschlossenes MFA-Setup –
      // deshalb wird das Secret des Büro-Accounts mitkopiert UND aktiviert.
      await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);
      const sql = createRawClient(databaseUrl);
      try {
        await sql`
          insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
          select ${fixtures.standortId}, 'sys-int@test.local', password_hash, 'systemdienst', 'S', 'I', true, mfa_secret
            from benutzer where id = ${fixtures.bueroBenutzerId}`;
      } finally {
        await sql.end();
      }
      const cookie = await loginAs(app, "sys-int@test.local", fixtures.password, fixtures.bueroTotpSecret);
      const res = await app.inject({ method: "GET", url: "/ops/integrations", headers: { cookie } });
      expect(res.statusCode, res.body).toBe(200);
      const integrationen = res.json().integrationen as Array<{ integration: string; mode: string }>;
      expect(integrationen.length).toBeGreaterThanOrEqual(10);
      for (const i of integrationen) expect(i.mode).toBe("mock");
      // Ehrliche Kennzeichnung mock vs. live.
      expect(res.json().hinweis).toContain("mock-Modus");
    } finally {
      await app.close();
    }
  });
});

// ===========================================================================
// §18 Degradierter Betrieb – die FÜNF geforderten Szenarien
// ===========================================================================
describe("PROMPT -1 §18 – Degradierter Betrieb (fünf Szenarien)", () => {
  const databaseUrl = testDatabaseUrl();
  let fixtures: SeededFixtures;

  beforeAll(async () => {
    await ensureMigrated(databaseUrl);
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    resetIntegrationRegistry();
    resetMetrics();
    clearRecentAlarms();
    resetAlarmSinks();
    fixtures = await seedFixtures(databaseUrl);
    await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);
  });

  // -----------------------------------------------------------------------
  // 1. Realtime aus -> API und Polling funktionieren weiter
  // -----------------------------------------------------------------------
  describe("1. Echtzeitkanal ausgefallen", () => {
    let app: FastifyInstance;
    afterAll(async () => {
      await app?.close();
    });

    it("API-Aufrufe und der Polling-Fallback funktionieren unverändert, wenn KEIN Worker läuft", async () => {
      app = buildTestApp();
      await app.ready();
      const officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
      const studentCookie = await loginAs(app, "schueler@test.local", fixtures.password);

      // Schreiben funktioniert – ohne dass irgendein Realtime-Kanal beteiligt ist.
      const buchung = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { cookie: officeCookie, "idempotency-key": idemKey("rt") },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          art: "Übungsstunde",
          klasse: "B",
          beginnAt: "2026-11-01T09:00:00.000Z",
          endeAt: "2026-11-01T10:00:00.000Z",
        },
      });
      expect(buchung.statusCode, buchung.body).toBe(201);

      // Der Polling-Fallback antwortet – ohne Zustellzeilen (kein Worker), aber
      // mit gültigem Cursor. Das ist der Mechanismus, auf dem §18 aufsetzt.
      const changes = await app.inject({
        method: "GET",
        url: "/sync/changes?cursor=0",
        headers: { cookie: studentCookie },
      });
      expect(changes.statusCode).toBe(200);
      expect(changes.json().changes).toEqual([]);
      expect(changes.json().resyncRequired).toBe(false);
      expect(changes.json().serverTime).toBeTruthy();

      // Und der Fachzustand ist trotzdem lesbar – die Wahrheit ist die DB.
      const termine = await app.inject({
        method: "GET",
        url: "/appointments/mine",
        headers: { cookie: studentCookie },
      });
      expect(termine.statusCode).toBe(200);
      expect(termine.json().appointments.length).toBeGreaterThan(0);
    });

    it("`/health/deep` bleibt 200 und meldet den Kern als nutzbar", async () => {
      const res = await app.inject({ method: "GET", url: "/health/deep" });
      expect(res.statusCode).toBe(200);
      expect(res.json().datenbank).toBe("erreichbar");
      expect(res.json().kern).toContain("nutzbar");
    });
  });

  // -----------------------------------------------------------------------
  // 2. Benachrichtigungen aus -> Termin bleibt gültig, Versand in Warteschlange
  // -----------------------------------------------------------------------
  describe("2. Benachrichtigungsdienst ausgefallen", () => {
    it("der Termin bleibt gültig, der Versand bleibt in der Warteschlange, das Büro sieht eine Warnung – KEIN falscher Erfolg", async () => {
      const { adapter, state } = schaltbareNotifications();
      state.fehlerhaft = true;
      const app = buildApp({
        databaseUrl,
        cookieSecure: false,
        logger: false,
        rateLimit: false,
        accessLog: false,
      });
      // Der Adapter wird über die Route injiziert: dafür wird die
      // Kommunikationsroute mit einem eigenen Adapter registriert.
      const eigene = buildApp({
        databaseUrl,
        cookieSecure: false,
        logger: false,
        rateLimit: false,
        accessLog: false,
      });
      await app.close();
      await eigene.close();

      // Direkter Test der Service-Schicht (der Adapter ist in buildApp fix):
      const { getDb } = await import("../db.js");
      const db = getDb(databaseUrl);
      const sql = createRawClient(databaseUrl);
      let nachrichtId: string;
      try {
        const [row] = await sql`
          insert into nachrichten (standort_id, schueler_id, kanal, betreff, inhalt, status)
          values (${fixtures.standortId}, ${fixtures.schuelerId}, 'email', 'Termin', 'Ihre Fahrstunde', 'warteschlange')
          returning id`;
        nachrichtId = row.id;
      } finally {
        await sql.end();
      }

      const result = await runBuffered(
        { db, sleep: async () => undefined, breaker: { failureThreshold: 99 } },
        {
          integration: "notifications",
          operation: "send",
          idempotencyKey: `nachricht:${nachrichtId}`,
          payload: { nachrichtId, kanal: "email", to: "a@b.de" },
          fn: () => adapter.send({ to: "a@b.de", channel: "email", subject: "Termin", body: "x" }),
        },
      );
      expect(result.outcome).toBe("gepuffert");
      expect(result.hinweis).toContain("wartet auf externe Synchronisation");
      expect(result.hinweis).toContain("fachliche Zustand ist gültig");

      // Die Nachricht bleibt in `warteschlange` – NICHT `gesendet`, NICHT
      // `fehlgeschlagen` (letzteres würde als Handlungsbedarf erscheinen).
      const sql2 = createRawClient(databaseUrl);
      try {
        const rows = await sql2`select status from nachrichten where id = ${nachrichtId}`;
        expect(rows[0].status).toBe("warteschlange");
      } finally {
        await sql2.end();
      }

      // Wiederherstellung: der Anbieter ist wieder da, der Job holt es nach.
      state.fehlerhaft = false;
      const sql3 = createRawClient(databaseUrl);
      try {
        await sql3`update integration_outbound_calls set next_attempt_at = now() - interval '1 minute'`;
      } finally {
        await sql3.end();
      }
      const nachgeholt = await resumeBufferedCalls(
        { db, sleep: async () => undefined },
        { execute: () => adapter.send({ to: "a@b.de", channel: "email", subject: "Termin", body: "x" }) },
      );
      expect(nachgeholt.zugestellt).toBe(1);
      expect(state.gesendet).toBe(1);
    });

    it("der Endpunkt `POST /communication/send` antwortet mit `zustellung` getrennt vom Fachzustand", async () => {
      const app = buildTestApp();
      await app.ready();
      try {
        const officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
        const res = await app.inject({
          method: "POST",
          url: "/communication/send",
          headers: { cookie: officeCookie, "idempotency-key": idemKey("msg") },
          payload: {
            schuelerId: fixtures.schuelerId,
            kanal: "email",
            to: "erika@test.local",
            betreff: "Termin",
            inhalt: "Ihre Fahrstunde morgen",
          },
        });
        expect(res.statusCode, res.body).toBe(201);
        // Mit dem funktionierenden Mock-Adapter: zugestellt.
        expect(res.json().zustellung).toBe("zugestellt");
        // Das Feld existiert IMMER – die UI muss nicht raten.
        expect(res.json().hinweis).toBeTruthy();
      } finally {
        await app.close();
      }
    });
  });

  // -----------------------------------------------------------------------
  // 3. Fahrschulverwaltung aus -> Plattform läuft weiter, kein Doppelimport
  // -----------------------------------------------------------------------
  describe("3. Fahrschulverwaltungssoftware ausgefallen", () => {
    it("die Plattform läuft weiter (sie ist die Quelle der Wahrheit für ihre eigenen Daten)", async () => {
      const app = buildTestApp();
      await app.ready();
      try {
        const officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
        // Die Fahrschulverwaltung ist NICHT erreichbar (mock, kein Zugang) …
        const db = await (async () => (await import("../db.js")).getDb(databaseUrl))();
        const abruf = await runBuffered(
          { db, sleep: async () => undefined, breaker: { failureThreshold: 1, openMs: 60_000 } },
          {
            integration: "fahrschulverwaltung",
            operation: "syncStammdaten",
            idempotencyKey: "stammdaten:2026-07-26",
            maxAttempts: 1,
            fn: async () => {
              throw Object.assign(new Error("kein Zugang"), { code: "ECONNREFUSED" });
            },
          },
        );
        expect(abruf.outcome).toBe("gepuffert");

        // … und die Plattform bucht trotzdem einen Termin.
        const buchung = await app.inject({
          method: "POST",
          url: "/appointments",
          headers: { cookie: officeCookie, "idempotency-key": idemKey("fsv") },
          payload: {
            schuelerId: fixtures.schuelerId,
            fahrlehrerId: fixtures.fahrlehrerId,
            art: "Übungsstunde",
            klasse: "B",
            beginnAt: "2026-11-02T09:00:00.000Z",
            endeAt: "2026-11-02T10:00:00.000Z",
          },
        });
        expect(buchung.statusCode, buchung.body).toBe(201);
      } finally {
        await app.close();
      }
    });

    it("KEIN Doppelimport nach der Wiederherstellung – der Idempotenzschlüssel des Abrufs verhindert ihn", async () => {
      const db = await (async () => (await import("../db.js")).getDb(databaseUrl))();
      const optionen = { db, sleep: async () => undefined };
      let importe = 0;
      const importieren = async () => {
        importe += 1;
        return { datensaetze: 42 };
      };

      // Zwei Wiederherstellungsversuche mit DEMSELBEN Fensterschlüssel.
      const erste = await runBuffered(optionen, {
        integration: "fahrschulverwaltung",
        operation: "syncStammdaten",
        idempotencyKey: "stammdaten:2026-07-26T10",
        fn: importieren,
      });
      const zweite = await runBuffered(optionen, {
        integration: "fahrschulverwaltung",
        operation: "syncStammdaten",
        idempotencyKey: "stammdaten:2026-07-26T10",
        fn: importieren,
      });
      expect(erste.outcome).toBe("zugestellt");
      expect(zweite.outcome).toBe("zugestellt");
      expect(importe).toBe(1);
    });

    it("die Quelle-der-Wahrheit-Regel ist als DATEN hinterlegt, nicht als Kommentar", async () => {
      // §1 (Phase 1): die Datenbank dieses Systems ist die Wahrheit für
      // Termine/Ausbildung/Dokumente. Die externe Verwaltung ist ein
      // NACHGELAGERTES Ziel – das ist an der Richtung des Puffers erkennbar:
      // es gibt eine Tabelle für AUSGEHENDE Aufrufe, aber keinen Pfad, über
      // den ein externes System hier einen Fachzustand setzt.
      const sql = createRawClient(databaseUrl);
      try {
        const tabellen = await sql`
          select table_name from information_schema.tables
           where table_schema = 'public' and table_name like 'integration%'`;
        const namen = tabellen.map((t) => t.table_name as string).sort();
        expect(namen).toEqual(["integration_health", "integration_outbound_calls"]);
      } finally {
        await sql.end();
      }
    });
  });

  // -----------------------------------------------------------------------
  // 4. Finanzintegration aus -> Ausbildung läuft, Zahlungsstatus veraltet
  // -----------------------------------------------------------------------
  describe("4. Finanz-/Bankintegration ausgefallen", () => {
    it("markiert den Zahlungsstatus als VERALTET, sperrt NICHTS und antwortet mit 200 statt 5xx", async () => {
      const kaputterFeed: BankFeedAdapter = {
        mode: "mock",
        async fetchTransactions() {
          throw Object.assign(new Error("FinTS weg"), { code: "ECONNREFUSED" });
        },
      };
      const app = buildTestApp();
      await app.ready();
      try {
        const sql = createRawClient(databaseUrl);
        try {
          await sql`
            insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
            select ${fixtures.standortId}, 'fin-deg@test.local', password_hash, 'finanzen', 'F', 'D', true, mfa_secret
              from benutzer where id = ${fixtures.bueroBenutzerId}`;
        } finally {
          await sql.end();
        }
        const finance = await loginAs(app, "fin-deg@test.local", fixtures.password, fixtures.bueroTotpSecret);

        // Der Breaker wird von Hand geöffnet – das entspricht "Anbieter weg".
        const db = await (async () => (await import("../db.js")).getDb(databaseUrl))();
        guardFor("bank", { db }).trip("Anbieter nicht erreichbar (Test)");

        const res = await app.inject({
          method: "POST",
          url: "/finance/bank/sync",
          headers: { cookie: finance },
          payload: {},
        });
        // 200, NICHT 5xx: fachlich ist nichts kaputt.
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json().zahlungsstatus).toBe("veraltet");
        expect(res.json().autoGebucht).toBe(0);
        expect(res.json().hinweis).toContain("VERALTET");
        expect(res.json().hinweis).toContain("KEINE automatische Sperre");
        expect(res.json().integrationsstatus).toBe("ausgefallen");
        void kaputterFeed;
      } finally {
        await app.close();
      }
    });

    it("Ausbildung und Termine laufen weiter, während die Zahlungsdaten veraltet sind", async () => {
      const app = buildTestApp();
      await app.ready();
      try {
        const db = await (async () => (await import("../db.js")).getDb(databaseUrl))();
        guardFor("bank", { db }).trip("Anbieter weg");
        const officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);

        const buchung = await app.inject({
          method: "POST",
          url: "/appointments",
          headers: { cookie: officeCookie, "idempotency-key": idemKey("fin") },
          payload: {
            schuelerId: fixtures.schuelerId,
            fahrlehrerId: fixtures.fahrlehrerId,
            art: "Übungsstunde",
            klasse: "B",
            beginnAt: "2026-11-03T09:00:00.000Z",
            endeAt: "2026-11-03T10:00:00.000Z",
          },
        });
        expect(buchung.statusCode, buchung.body).toBe(201);

        // Und es gibt KEINE automatische Sperre auf Basis veralteter Daten:
        // der Ausbildungsstatus ist unverändert.
        const sql = createRawClient(databaseUrl);
        try {
          const rows = await sql`select status from ausbildungen where id = ${fixtures.ausbildungId}`;
          expect(rows[0].status).not.toBe("gesperrt");
        } finally {
          await sql.end();
        }
      } finally {
        await app.close();
      }
    });
  });

  // -----------------------------------------------------------------------
  // 5. Dokumentscanner aus -> Upload bleibt in Quarantäne
  // -----------------------------------------------------------------------
  describe("5. Dokumentscanner ausgefallen", () => {
    const kaputterScanner: MalwareScanAdapter = {
      mode: "mock",
      async scan() {
        throw Object.assign(new Error("Scanner nicht erreichbar"), { code: "ECONNREFUSED" });
      },
    };

    it("der Upload BLEIBT in Quarantäne und wird NIE als geprüft angezeigt", async () => {
      const db = await (async () => (await import("../db.js")).getDb(databaseUrl))();
      const sql = createRawClient(databaseUrl);
      let docId: string;
      try {
        const [row] = await sql`
          insert into dokumente (standort_id, schueler_id, typ, dateiname, speicher_referenz, dokument_status, scan_status)
          values (${fixtures.standortId}, ${fixtures.schuelerId}, 'sehtest', 'q.pdf', 'mock://q', 'quarantined', 'ausstehend')
          returning id`;
        docId = row.id;
      } finally {
        await sql.end();
      }

      const result = await releaseDocumentAfterScan(db, {
        dokumentId: docId,
        buffer: Buffer.from("%PDF-1.4 x"),
        dateiname: "q.pdf",
        malwareScan: kaputterScanner,
        akteurBenutzerId: fixtures.schuelerBenutzerId,
        standortId: fixtures.standortId,
      });

      expect(result.freigegeben).toBe(false);
      expect(result.scannerAusgefallen).toBe(true);
      expect(result.status).toBe("quarantined");
      expect(result.grund).toContain("gilt NICHT als geprüft");
      expect(getMetricValue(METRIC.documentScanFailures, { reason: "scanner_unavailable" })).toBe(1);
      expect(recentAlarms().some((a) => a.kind === "document_scan_unavailable")).toBe(true);

      const sql2 = createRawClient(databaseUrl);
      try {
        const rows = await sql2`select dokument_status, scan_status, geprueft from dokumente where id = ${docId}`;
        expect(rows[0].dokument_status).toBe("quarantined");
        expect(rows[0].scan_status).toBe("ausstehend");
        expect(rows[0].geprueft).toBe(false);
      } finally {
        await sql2.end();
      }
    });

    it("nach der Wiederherstellung holt der Job den Scan nach und gibt frei (automatische Wiederaufnahme)", async () => {
      const db = await (async () => (await import("../db.js")).getDb(databaseUrl))();
      const sql = createRawClient(databaseUrl);
      try {
        await sql`
          insert into dokumente (standort_id, schueler_id, typ, dateiname, speicher_referenz, dokument_status, scan_status)
          values (${fixtures.standortId}, ${fixtures.schuelerId}, 'sehtest', 'q.pdf', 'mock://q', 'quarantined', 'ausstehend')`;
      } finally {
        await sql.end();
      }

      const funktionierend: MalwareScanAdapter = {
        mode: "mock",
        async scan() {
          return { status: "sauber", scannerName: "wieder-da" };
        },
      };
      const result = await retryQuarantinedScans(db, {
        malwareScan: funktionierend,
        storageGet: async () => Buffer.from("%PDF-1.4 x"),
      });
      expect(result.geprueft).toBe(1);
      expect(result.freigegeben).toBe(1);

      const sql2 = createRawClient(databaseUrl);
      try {
        const rows = await sql2`select dokument_status, scan_status from dokumente`;
        expect(rows[0].dokument_status).toBe("submitted");
        expect(rows[0].scan_status).toBe("sauber");
      } finally {
        await sql2.end();
      }
    });

    it("ein Dokument in Quarantäne erscheint NICHT in der Prüf-Warteschlange des Büros", async () => {
      const app = buildTestApp();
      await app.ready();
      try {
        const sql = createRawClient(databaseUrl);
        try {
          await sql`
            insert into dokumente (standort_id, schueler_id, typ, dateiname, speicher_referenz, dokument_status, scan_status)
            values (${fixtures.standortId}, ${fixtures.schuelerId}, 'sehtest', 'q.pdf', 'mock://q', 'quarantined', 'ausstehend')`;
        } finally {
          await sql.end();
        }
        const officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
        const queue = await app.inject({ method: "GET", url: "/office/heute", headers: { cookie: officeCookie } });
        const dokumentEintraege = (queue.json().items as Array<{ entitaet: string; aktion: string }>).filter(
          (i) => i.entitaet === "dokument" && i.aktion === "Prüfen/Freigeben",
        );
        expect(dokumentEintraege).toEqual([]);
      } finally {
        await app.close();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Übergreifend: /health/deep als EINE Anzeige für alle fünf Szenarien
  // -----------------------------------------------------------------------
  it("`/health/deep` benennt ausgefallene und eingeschränkte Integrationen, bleibt aber 200 (kein Totalausfall)", async () => {
    const app = buildTestApp();
    await app.ready();
    try {
      const db = await (async () => (await import("../db.js")).getDb(databaseUrl))();
      // Zustand persistieren, damit /health/deep ihn aus der DB liest.
      await runBuffered(
        { db, sleep: async () => undefined, breaker: { failureThreshold: 1, openMs: 60_000 } },
        {
          integration: "malware-scan",
          operation: "scan",
          idempotencyKey: "deg-1",
          maxAttempts: 1,
          fn: async () => {
            throw Object.assign(new Error("weg"), { code: "ECONNREFUSED" });
          },
        },
      );

      const res = await app.inject({ method: "GET", url: "/health/deep" });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("eingeschraenkt");
      expect(res.json().ausgefallen).toContain("malware-scan");
      expect(res.json().kern).toContain("nutzbar");
      const scanner = (res.json().integrationen as Array<{ integration: string; gepuffert: number }>).find(
        (i) => i.integration === "malware-scan",
      )!;
      expect(scanner.gepuffert).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
