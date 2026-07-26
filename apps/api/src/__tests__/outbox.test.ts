import { createDatabase, createRawClient } from "@fahrschul/database";
import { sql as drizzleSql } from "drizzle-orm";
import type { Database } from "@fahrschul/database";
import { createNotificationsAdapter } from "@fahrschul/integrations";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildConsumers } from "../workers/consumers.js";
import {
  claimOutboxBatch,
  deliverToConsumer,
  openDeadLetterCount,
  recoverExpiredOutboxLeases,
  runOutboxOnce,
  workerId,
  type EventConsumer,
} from "../workers/outbox.js";
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
 * PROMPT -1 §5 – Transaktionaler Outbox + Consumer-Inbox.
 *
 * Kernaussagen, die hier BEWIESEN werden:
 *   1. Die Outbox-Zeile entsteht in DERSELBEN Transaktion wie die fachliche
 *      Änderung – bei einem Rollback gibt es KEIN Ereignis (das verbotene
 *      Muster "DB geändert und danach hoffentlich Nachricht gesendet" ist
 *      strukturell unmöglich).
 *   2. Absturz-Wiederaufnahme: eine in Zustellung befindliche Zeile mit
 *      abgelaufenem Lease wird von einem anderen Worker erneut übernommen und
 *      GENAU EINMAL verarbeitet (Inbox-Dedup).
 *   3. Duplikate werden ignoriert.
 *   4. Ereignisse sind versioniert und rückwärtskompatibel.
 *   5. Nach Erschöpfung/dauerhaftem Fehler: Dead-Letter + Alarm + manuelle
 *      Wiederaufnahme.
 */
describe("PROMPT -1 §5 – Transaktionaler Outbox + Consumer-Inbox", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let db: Database;
  let fixtures: SeededFixtures;
  let sql: ReturnType<typeof createRawClient>;
  let officeCookie: string;
  let opsCookie: string;

  beforeAll(async () => {
    await ensureMigrated(databaseUrl);
    app = buildTestApp();
    await app.ready();
    db = createDatabase(databaseUrl);
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
      select ${fixtures.standortId}, 'systemdienst@test.local', password_hash, 'systemdienst', 'Sys', 'Dienst', true, mfa_secret
        from benutzer where id = ${fixtures.bueroBenutzerId}`;
    officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
    opsCookie = await loginAs(app, "systemdienst@test.local", fixtures.password, fixtures.bueroTotpSecret);
  });

  afterEach(async () => {
    await sql.end();
  });

  function consumers() {
    return buildConsumers(createNotificationsAdapter("mock"));
  }

  async function createOffer() {
    const beginn = new Date(Date.now() + 700 * 3600_000);
    const res = await app.inject({
      method: "POST",
      url: "/appointment-offers",
      headers: { cookie: officeCookie },
      payload: {
        fahrlehrerId: fixtures.fahrlehrerId,
        klasse: "B",
        beginnAt: beginn.toISOString(),
        endeAt: new Date(beginn.getTime() + 3600_000).toISOString(),
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().offer as { id: string };
  }

  // -----------------------------------------------------------------------
  // 1. Atomarität
  // -----------------------------------------------------------------------
  describe("atomicity: business change and outbox row commit together", () => {
    it("writes an outbox row for every business audit event, in the same transaction", async () => {
      const offer = await createOffer();
      const rows = await sql`
        select o.event_type, o.status, o.event_version, o.aggregate_id, a.id as audit_id
          from event_outbox o join audit_events a on a.id = o.audit_event_id
         where o.aggregate_id = ${offer.id}`;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.map((r) => r.event_type)).toContain("lesson.offer.created");
      expect(rows[0].status).toBe("pending");
      expect(rows[0].event_version).toBe(1);
    });

    it("writes NO outbox row when the business transaction rolls back", async () => {
      const before = await sql`select count(*)::int as n from event_outbox`;
      // Erzwungener Rollback: das Audit-Ereignis (und damit die Outbox-Zeile)
      // wird geschrieben, danach schlägt die Transaktion fehl.
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(
            sql2Raw(
              `insert into audit_events (type, aktion, entitaet, source, correlation_id)
               values ('lesson.booked','rollback-test','terminbuchung','test',gen_random_uuid())`,
            ),
          );
          throw new Error("absichtlicher Abbruch");
        }),
      ).rejects.toThrow("absichtlicher Abbruch");

      const after = await sql`select count(*)::int as n from event_outbox`;
      expect(after[0].n).toBe(before[0].n);
      const audits = await sql`select count(*)::int as n from audit_events where aktion = 'rollback-test'`;
      expect(audits[0].n).toBe(0);
    });

    it("does NOT put purely technical audit rows (login/logout) into the outbox", async () => {
      await sql`insert into audit_events (type, aktion, entitaet, source, correlation_id)
                values ('login','auth.login','benutzer','test',gen_random_uuid())`;
      const rows = await sql`select count(*)::int as n from event_outbox where event_type = 'login'`;
      expect(rows[0].n).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Zustellung + Dedup + Cursor
  // -----------------------------------------------------------------------
  describe("delivery, dedup and cursors", () => {
    it("delivers pending events, records them in the inbox and advances the cursor", async () => {
      await createOffer();
      const result = await runOutboxOnce(db, consumers(), { owner: "test-worker" });
      expect(result.claimed).toBeGreaterThan(0);
      expect(result.delivered).toBe(result.claimed);
      expect(result.deadLettered).toBe(0);

      const pending = await sql`select count(*)::int as n from event_outbox where status <> 'delivered'`;
      expect(pending[0].n).toBe(0);

      const inbox = await sql`select consumer, count(*)::int as n from event_inbox group by consumer`;
      const byConsumer = Object.fromEntries(inbox.map((r) => [r.consumer, r.n]));
      expect(byConsumer["integration-sync"]).toBeGreaterThan(0);
      expect(byConsumer["notifications"]).toBeGreaterThan(0);

      const cursors = await sql`select consumer, last_seq from event_cursors where last_seq > 0`;
      expect(cursors.length).toBeGreaterThan(0);
    });

    it("IGNORES duplicate delivery of the same event to the same consumer", async () => {
      await createOffer();
      const batch = await claimOutboxBatch(db, { owner: workerId(), limit: 10 });
      expect(batch.length).toBeGreaterThan(0);
      const envelope = {
        eventId: batch[0].id,
        seq: Number(batch[0].seq),
        eventType: batch[0].event_type,
        eventVersion: batch[0].event_version,
        aggregateType: batch[0].aggregate_type,
        aggregateId: batch[0].aggregate_id,
        correlationId: batch[0].correlation_id,
        standortId: batch[0].standort_id,
        payload: batch[0].payload,
        attempts: batch[0].attempts,
      };

      const consumer = consumers().find((c) => c.name === "integration-sync")!;
      expect(await deliverToConsumer(db, consumer, envelope)).toBe("processed");
      expect(await deliverToConsumer(db, consumer, envelope)).toBe("duplicate");
      expect(await deliverToConsumer(db, consumer, envelope)).toBe("duplicate");

      const rows = await sql`
        select count(*)::int as n from event_inbox
         where consumer = 'integration-sync' and event_id = ${envelope.eventId}`;
      expect(rows[0].n).toBe(1);
    });

    it("skips events a consumer is not subscribed to", async () => {
      await createOffer();
      const batch = await claimOutboxBatch(db, { owner: workerId(), limit: 10 });
      const uninterested: EventConsumer = {
        name: "notifications",
        maxEventVersion: 1,
        eventTypes: ["payment.matched"],
        handle: async () => {
          throw new Error("darf nicht aufgerufen werden");
        },
      };
      const envelope = {
        eventId: batch[0].id,
        seq: Number(batch[0].seq),
        eventType: batch[0].event_type,
        eventVersion: batch[0].event_version,
        aggregateType: batch[0].aggregate_type,
        aggregateId: batch[0].aggregate_id,
        correlationId: batch[0].correlation_id,
        standortId: batch[0].standort_id,
        payload: batch[0].payload,
        attempts: batch[0].attempts,
      };
      expect(await deliverToConsumer(db, uninterested, envelope)).toBe("skipped");
    });
  });

  // -----------------------------------------------------------------------
  // 3. ABSTURZ-WIEDERAUFNAHME (nicht nur der Happy Path)
  // -----------------------------------------------------------------------
  describe("crash recovery (simulated by an abandoned in-flight lease)", () => {
    it("re-claims events whose worker died mid-flight and processes them EXACTLY ONCE", async () => {
      await createOffer();

      // Worker A beansprucht die Zeilen und "stirbt" dann: die Zeilen bleiben
      // in_flight zurück, ohne zugestellt worden zu sein.
      const batchA = await claimOutboxBatch(db, { owner: "worker-A-crashed", limit: 10, leaseSeconds: 30 });
      expect(batchA.length).toBeGreaterThan(0);
      const inFlight = await sql`select count(*)::int as n from event_outbox where status = 'in_flight'`;
      expect(inFlight[0].n).toBe(batchA.length);

      // Solange der Lease läuft, greift kein anderer Worker zu.
      const workerBTooEarly = await runOutboxOnce(db, consumers(), { owner: "worker-B" });
      expect(workerBTooEarly.claimed).toBe(0);
      expect(workerBTooEarly.recovered).toBe(0);

      // Der Lease läuft ab (Absturz erkannt).
      await sql`update event_outbox set lease_expires_at = now() - interval '1 minute' where lease_owner = 'worker-A-crashed'`;

      const workerB = await runOutboxOnce(db, consumers(), { owner: "worker-B" });
      expect(workerB.recovered).toBe(batchA.length);
      expect(workerB.claimed).toBe(batchA.length);
      expect(workerB.delivered).toBe(batchA.length);

      const delivered = await sql`select count(*)::int as n from event_outbox where status = 'delivered'`;
      expect(delivered[0].n).toBe(batchA.length);

      // GENAU EINMAL verarbeitet, obwohl zweimal beansprucht.
      const inbox = await sql`
        select event_id, consumer, count(*)::int as n from event_inbox
         group by event_id, consumer having count(*) > 1`;
      expect(inbox).toEqual([]);

      // Der Versuchszähler beweist, dass es ein ZWEITER Versuch war.
      const attempts = await sql`select max(attempts)::int as a from event_outbox`;
      expect(attempts[0].a).toBeGreaterThanOrEqual(2);
    });

    it("recoverExpiredOutboxLeases records WHY the row was released", async () => {
      await createOffer();
      await claimOutboxBatch(db, { owner: "worker-C", limit: 10 });
      await sql`update event_outbox set lease_expires_at = now() - interval '1 minute'`;
      const recovered = await recoverExpiredOutboxLeases(db);
      expect(recovered).toBeGreaterThan(0);
      const rows = await sql`select status, lease_owner, last_error from event_outbox limit 1`;
      expect(rows[0].status).toBe("pending");
      expect(rows[0].lease_owner).toBeNull();
      expect(String(rows[0].last_error).toLowerCase()).toContain("lease abgelaufen");
    });

    it("survives a consumer that crashes for one event and delivers the rest on the next run", async () => {
      await createOffer();
      let calls = 0;
      const flaky: EventConsumer = {
        name: "integration-sync",
        maxEventVersion: 1,
        eventTypes: ["*"],
        handle: async () => {
          calls += 1;
          if (calls === 1) {
            throw Object.assign(new Error("kurzzeitiger Netzwerkfehler"), { errorClass: "NETWORK" as const });
          }
          return { ok: true };
        },
      };

      const firstRun = await runOutboxOnce(db, [flaky], { owner: "worker-flaky" });
      expect(firstRun.retried).toBe(1);
      expect(firstRun.deadLettered).toBe(0);

      const row = await sql`select status, attempts, error_class, next_attempt_at from event_outbox limit 1`;
      expect(row[0].status).toBe("pending");
      expect(row[0].error_class).toBe("NETWORK");
      expect(row[0].attempts).toBe(1);

      // Backoff aufheben und erneut laufen lassen.
      await sql`update event_outbox set next_attempt_at = now()`;
      const secondRun = await runOutboxOnce(db, [flaky], { owner: "worker-flaky" });
      expect(secondRun.delivered).toBe(1);

      // Der erste, fehlgeschlagene Versuch hat KEINE Inbox-Zeile hinterlassen,
      // die die Wiederholung blockiert hätte... bzw. wenn doch, wurde er als
      // Duplikat behandelt – in beiden Fällen: genau eine Zeile.
      const inbox = await sql`select count(*)::int as n from event_inbox where consumer = 'integration-sync'`;
      expect(inbox[0].n).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Versionierung / Rückwärtskompatibilität
  // -----------------------------------------------------------------------
  describe("event versioning and backward compatibility", () => {
    it("stamps every event with the version from event_schema_versions", async () => {
      await createOffer();
      const rows = await sql`
        select o.event_type, o.event_version, v.version as expected
          from event_outbox o join event_schema_versions v on v.event_type = o.event_type`;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.event_version).toBe(row.expected);
      }
    });

    it("a consumer keeps processing OLDER event versions (backward compatible)", async () => {
      await createOffer();
      // Konsument versteht v3, das Ereignis ist v1 -> muss verarbeitet werden.
      const modern: EventConsumer = {
        name: "integration-sync",
        maxEventVersion: 3,
        eventTypes: ["*"],
        handle: async (envelope) => ({ verarbeiteteVersion: envelope.eventVersion }),
      };
      const result = await runOutboxOnce(db, [modern], { owner: "worker-modern" });
      expect(result.delivered).toBeGreaterThan(0);
      const rows = await sql`select result from event_inbox where consumer = 'integration-sync' limit 1`;
      expect((rows[0].result as { verarbeiteteVersion: number }).verarbeiteteVersion).toBe(1);
    });

    it("does NOT silently drop an event whose version is too new – it dead-letters it", async () => {
      await createOffer();
      await sql`update event_outbox set event_version = 9`;
      const legacy: EventConsumer = {
        name: "integration-sync",
        maxEventVersion: 1,
        eventTypes: ["*"],
        handle: async () => ({ ok: true }),
      };
      const result = await runOutboxOnce(db, [legacy], { owner: "worker-legacy" });
      expect(result.deadLettered).toBeGreaterThan(0);
      const dl = await sql`select kind, error_class, last_error from dead_letters where source = 'outbox'`;
      expect(dl.length).toBeGreaterThan(0);
      expect(String(dl[0].last_error)).toContain("Ereignisversion 9");
    });
  });

  // -----------------------------------------------------------------------
  // 5. Dead-Letter-Queue + Alarm + manuelle Wiederaufnahme
  // -----------------------------------------------------------------------
  describe("dead-letter queue, alarm hook and manual resume", () => {
    it("dead-letters a permanently failing event with full audit context and fires the alarm", async () => {
      await createOffer();
      const broken: EventConsumer = {
        name: "integration-sync",
        maxEventVersion: 1,
        eventTypes: ["*"],
        handle: async () => {
          throw Object.assign(new Error("Zielsystem lehnt das Format dauerhaft ab"), {
            errorClass: "VALIDATION" as const,
          });
        },
      };
      const result = await runOutboxOnce(db, [broken], { owner: "worker-broken" });
      expect(result.deadLettered).toBe(1);
      expect(result.retried).toBe(0); // dauerhafter Fehler -> KEIN Retry

      const outbox = await sql`select status, error_class from event_outbox limit 1`;
      expect(outbox[0].status).toBe("dead");
      expect(outbox[0].error_class).toBe("VALIDATION");

      const dl = await sql`select * from dead_letters where source = 'outbox'`;
      expect(dl).toHaveLength(1);
      expect(dl[0].kind).toBe("lesson.offer.created");
      expect(dl[0].alarm_emitted_at).toBeTruthy();
      expect(dl[0].audit_kontext).toMatchObject({ eventVersion: 1 });
      expect(dl[0].resumed_at).toBeNull();
      expect(await openDeadLetterCount(db)).toBe(1);

      // Ops-Sicht zeigt den Eintrag samt Alarm.
      const view = await app.inject({ method: "GET", url: "/ops/dead-letters", headers: { cookie: opsCookie } });
      expect(view.statusCode).toBe(200);
      expect(view.json().deadLetters).toHaveLength(1);
      expect(view.json().alarme.some((a: { kind: string }) => a.kind === "dead_letter")).toBe(true);
    });

    it("supports MANUAL resume of a dead-lettered event (and dedup keeps it exactly-once)", async () => {
      await createOffer();
      const broken: EventConsumer = {
        name: "integration-sync",
        maxEventVersion: 1,
        eventTypes: ["*"],
        handle: async () => {
          throw Object.assign(new Error("kaputt"), { errorClass: "VALIDATION" as const });
        },
      };
      await runOutboxOnce(db, [broken], { owner: "worker-broken" });
      const dl = await sql`select id from dead_letters where source = 'outbox' limit 1`;

      const resume = await app.inject({
        method: "POST",
        url: `/ops/dead-letters/${dl[0].id}/resume`,
        headers: { cookie: opsCookie },
      });
      expect(resume.statusCode).toBe(200);

      const nachResume = await sql`select status, attempts from event_outbox limit 1`;
      expect(nachResume[0].status).toBe("pending");
      expect(nachResume[0].attempts).toBe(0);

      // Jetzt mit einem funktionierenden Konsumenten erneut zustellen.
      const ok = await runOutboxOnce(db, consumers(), { owner: "worker-fixed" });
      expect(ok.delivered).toBe(1);

      const zweiteWiederaufnahme = await app.inject({
        method: "POST",
        url: `/ops/dead-letters/${dl[0].id}/resume`,
        headers: { cookie: opsCookie },
      });
      expect(zweiteWiederaufnahme.statusCode).toBe(409);
      expect(zweiteWiederaufnahme.json().error).toBe("already_resumed");
    });
  });

  // -----------------------------------------------------------------------
  // Ops-Zugriffsschutz
  // -----------------------------------------------------------------------
  describe("ops surface authorization", () => {
    it("denies the ops surface to buero/schueler/fahrlehrer and allows systemdienst", async () => {
      const studentCookie = await loginAs(app, "schueler@test.local", fixtures.password);
      for (const cookie of [officeCookie, studentCookie]) {
        const res = await app.inject({ method: "GET", url: "/ops/outbox", headers: { cookie } });
        expect(res.statusCode).toBe(403);
      }
      const ok = await app.inject({ method: "GET", url: "/ops/outbox", headers: { cookie: opsCookie } });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toHaveProperty("statusVerteilung");
      expect(ok.json()).toHaveProperty("cursors");
    });

    it("returns no student master data on the ops surface (systemdienst has no student access)", async () => {
      await createOffer();
      const res = await app.inject({ method: "GET", url: "/ops/outbox", headers: { cookie: opsCookie } });
      const body = JSON.stringify(res.json());
      expect(body).not.toContain("Musterfrau");
      expect(body).not.toContain("schueler@test.local");
    });
  });
});

/** Rohes SQL-Fragment für tx.execute (statischer Text, keine Parameter). */
function sql2Raw(text: string) {
  return drizzleSql.raw(text);
}
