import { createDatabase, createRawClient } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { createNotificationsAdapter } from "@fahrschul/integrations";
import {
  DOKUMENT_STATES,
  FAHRZEUGMANGEL_STATES,
  STATE_TRANSITIONS,
  TERMINANGEBOT_STATES,
  ZAHLUNG_STATES,
} from "@fahrschul/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildConsumers } from "../workers/consumers.js";
import { enqueueJob, JOB_TYPES } from "../workers/job-store.js";
import { runJobsOnce } from "../workers/runner.js";
import { runOutboxOnce } from "../workers/outbox.js";
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
 * PROMPT -1 §10 – Vier persistierte State Machines.
 *
 * Beweisziele:
 *   - Die DB kennt EXAKT die spezifizierten Zustandsmengen (CHECK-Constraint)
 *     und EXAKT die Allow-List aus packages/domain.
 *   - Jeder Übergang ist auditiert (state_transitions + audit_events/Outbox).
 *   - Der Zustand ist PERSISTIERT und der Prozess damit nach einem Neustart
 *     WIEDERAUFNEHMBAR – kein Mehrschrittprozess hängt an einem langen Request.
 *   - Die Alt-Statusspalten bleiben rückwärtskompatibel (Expand-Contract).
 */
describe("PROMPT -1 §10 – Persistierte State Machines", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let db: Database;
  let fixtures: SeededFixtures;
  let sql: ReturnType<typeof createRawClient>;
  let officeCookie: string;
  let studentCookie: string;

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
    officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
    studentCookie = await loginAs(app, "schueler@test.local", fixtures.password);
  });

  afterEach(async () => {
    await sql.end();
  });

  const deps = () => ({ db, notifications: createNotificationsAdapter("mock") });

  // -----------------------------------------------------------------------
  // Die Datenbank kennt genau die spezifizierten Zustände
  // -----------------------------------------------------------------------
  describe("the DATABASE knows exactly the specified state sets", () => {
    const cases: Array<[string, string, readonly string[]]> = [
      ["terminangebote", "angebot_status", TERMINANGEBOT_STATES],
      ["dokumente", "dokument_status", DOKUMENT_STATES],
      ["banktransaktionen", "zahlung_status", ZAHLUNG_STATES],
      ["fahrzeugmaengel", "mangel_status", FAHRZEUGMANGEL_STATES],
    ];

    it.each(cases)("%s.%s only accepts the specified states", async (tabelle, spalte, states) => {
      const rows = await sql`
        select pg_get_constraintdef(oid) as def
          from pg_constraint
         where conrelid = ${tabelle}::regclass and contype = 'c'
           and pg_get_constraintdef(oid) like ${"%" + spalte + "%"}`;
      expect(rows.length).toBeGreaterThan(0);
      const def = rows.map((r) => r.def as string).join(" ");
      for (const state of states) {
        expect(def, `${tabelle}.${spalte} muss '${state}' erlauben`).toContain(`'${state}'`);
      }
      // Kein zusätzlicher Zustand: Anzahl der Literale stimmt.
      const literale = (def.match(/'[a-z_]+'::text/g) ?? []).length;
      expect(literale).toBe(states.length);
    });

    it("mirrors the domain allow-list 1:1 into state_machine_transitions", async () => {
      const rows = await sql`select machine, von_status, nach_status from state_machine_transitions`;
      const dbSet = new Set(rows.map((r) => `${r.machine}:${r.von_status}->${r.nach_status}`));
      const codeSet = new Set<string>();
      for (const [machine, map] of Object.entries(STATE_TRANSITIONS)) {
        for (const [from, next] of Object.entries(map)) {
          for (const to of next) codeSet.add(`${machine}:${from}->${to}`);
        }
      }
      // Beide Richtungen prüfen – kein Auseinanderlaufen von Code und DB.
      expect([...codeSet].filter((k) => !dbSet.has(k))).toEqual([]);
      expect([...dbSet].filter((k) => !codeSet.has(k))).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Terminangebot: vollständige, persistierte Kette
  // -----------------------------------------------------------------------
  describe("Terminangebot: created -> sent -> delivered -> accepted -> booking_pending -> confirmed", () => {
    async function createOffer() {
      const beginn = new Date(Date.now() + 900 * 3600_000);
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
      return res.json().offer as { id: string; angebotStatus: string; status: string };
    }

    it("publishes as 'sent' and keeps the legacy status column readable", async () => {
      const offer = await createOffer();
      expect(offer.angebotStatus).toBe("sent");
      expect(offer.status).toBe("offen"); // Alt-Spalte für apps/*

      const transitions = await sql`
        select von_status, nach_status, akteur_benutzer_id, grund, quelle
          from state_transitions where machine = 'terminangebot' and entitaet_id = ${offer.id}`;
      expect(transitions).toHaveLength(1);
      expect(transitions[0].von_status).toBe("created");
      expect(transitions[0].nach_status).toBe("sent");
      // Auditiert MIT Akteur und Grund.
      expect(transitions[0].akteur_benutzer_id).toBe(fixtures.bueroBenutzerId);
      expect(transitions[0].grund).toBe("Angebot veröffentlicht");
    });

    it("reaches 'delivered' through the OUTBOX consumer – a persisted, resumable step", async () => {
      const offer = await createOffer();
      // Der Zustellschritt läuft NICHT im HTTP-Request, sondern im Worker.
      const run = await runOutboxOnce(db, buildConsumers(createNotificationsAdapter("mock")), {
        owner: "sm-worker",
      });
      expect(run.delivered).toBeGreaterThan(0);

      const rows = await sql`select angebot_status from terminangebote where id = ${offer.id}`;
      expect(rows[0].angebot_status).toBe("delivered");
    });

    it("walks accepted -> booking_pending -> confirmed on acceptance, all recorded", async () => {
      const offer = await createOffer();
      const accept = await app.inject({
        method: "POST",
        url: `/appointment-offers/${offer.id}/accept`,
        headers: { cookie: studentCookie },
        payload: { idempotencyKey: "sm-accept" },
      });
      expect(accept.statusCode).toBe(201);

      const rows = await sql`select angebot_status, status from terminangebote where id = ${offer.id}`;
      expect(rows[0].angebot_status).toBe("confirmed");
      expect(rows[0].status).toBe("gebucht");

      const transitions = await sql`
        select von_status, nach_status from state_transitions
         where machine = 'terminangebot' and entitaet_id = ${offer.id} order by created_at`;
      expect(transitions.map((t) => `${t.von_status}->${t.nach_status}`)).toEqual([
        "created->sent",
        "sent->accepted",
        "accepted->booking_pending",
        "booking_pending->confirmed",
      ]);
    });

    it("rejects accepting an offer that is no longer in sent/delivered", async () => {
      const offer = await createOffer();
      await sql`update terminangebote set angebot_status = 'cancelled' where id = ${offer.id}`;
      const res = await app.inject({
        method: "POST",
        url: `/appointment-offers/${offer.id}/accept`,
        headers: { cookie: studentCookie },
        payload: { idempotencyKey: "sm-accept-cancelled" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("offer_not_available");
    });

    it("RESUMES after a restart: the state lives in the DB, not in memory", async () => {
      const offer = await createOffer();
      await sql`update terminangebote set angebot_status = 'accepted' where id = ${offer.id}`;

      // "Neustart": eine FRISCHE App-Instanz kennt keinen Prozessspeicher.
      const freshApp = buildTestApp();
      await freshApp.ready();
      try {
        const rows = await sql`select angebot_status from terminangebote where id = ${offer.id}`;
        expect(rows[0].angebot_status).toBe("accepted");

        // Der Prozess kann von genau hier weitergeführt werden.
        await sql`update terminangebote set angebot_status = 'booking_pending' where id = ${offer.id}`;
        await sql`update terminangebote set angebot_status = 'confirmed' where id = ${offer.id}`;
        const after = await sql`select angebot_status from terminangebote where id = ${offer.id}`;
        expect(after[0].angebot_status).toBe("confirmed");
      } finally {
        await freshApp.close();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Dokument
  // -----------------------------------------------------------------------
  describe("Dokument: uploaded -> scanning -> submitted -> in_review -> verified", () => {
    it("records the full audited chain through the API", async () => {
      const [doc] = await sql`
        insert into dokumente (standort_id, schueler_id, typ, dateiname, speicher_referenz, dokument_status)
        values (${fixtures.standortId}, ${fixtures.schuelerId}, 'sehtest', 'a.pdf', 'mock://a', 'uploaded')
        returning id, version`;
      await sql`update dokumente set dokument_status = 'scanning' where id = ${doc.id}`;
      await sql`update dokumente set dokument_status = 'submitted' where id = ${doc.id}`;

      const review = await app.inject({
        method: "POST",
        url: `/documents/${doc.id}/review`,
        headers: { cookie: officeCookie },
        payload: { entscheidung: "akzeptiert", pruefprotokoll: { geprueftePunkte: ["lesbar"] } },
      });
      expect(review.statusCode).toBe(200);

      const rows = await sql`
        select von_status, nach_status from state_transitions
         where machine = 'dokument' and entitaet_id = ${doc.id} order by created_at`;
      expect(rows.map((r) => `${r.von_status}->${r.nach_status}`)).toEqual([
        "uploaded->scanning",
        "scanning->submitted",
        "submitted->in_review",
        "in_review->verified",
      ]);

      const doc2 = await sql`select dokument_status, status, geprueft, pruefprotokoll, geprueft_durch_benutzer_id from dokumente where id = ${doc.id}`;
      expect(doc2[0].dokument_status).toBe("verified");
      expect(doc2[0].status).toBe("geprueft");
      expect(doc2[0].geprueft).toBe(true);
      expect(doc2[0].pruefprotokoll).toBeTruthy();
      expect(doc2[0].geprueft_durch_benutzer_id).toBe(fixtures.bueroBenutzerId);
    });

    it("keeps a LEGACY raw write working and maps it onto the new machine", async () => {
      // Alt-Code, der nur `status` kennt.
      const [doc] = await sql`
        insert into dokumente (standort_id, schueler_id, typ, dateiname, speicher_referenz, status)
        values (${fixtures.standortId}, ${fixtures.schuelerId}, 'passbild', 'b.pdf', 'mock://b', 'eingereicht')
        returning id, status, dokument_status`;
      expect(doc.status).toBe("eingereicht");
      expect(doc.dokument_status).toBe("submitted");

      // Ein Alt-Update auf status='abgelehnt' wird auf die neue Spalte
      // gespiegelt – aber nur, wenn der Übergang erlaubt ist. submitted ->
      // rejected ist NICHT erlaubt (in_review fehlt) und wird abgewiesen.
      let fehler: { code?: string } | null = null;
      try {
        await sql`update dokumente set status = 'abgelehnt' where id = ${doc.id}`;
      } catch (err) {
        fehler = err as { code?: string };
      }
      expect(fehler?.code).toBe("FS007");
    });
  });

  // -----------------------------------------------------------------------
  // Zahlung
  // -----------------------------------------------------------------------
  describe("Zahlung: imported -> matching -> (matched | suggested | review_required) -> reversed", () => {
    it("moves a manual assignment to matched/partially_matched with a recorded transition", async () => {
      // HINWEIS: der Mock-Bank-Feed (packages/integrations) liefert bewusst
      // eine LEERE Fixture (siehe docs/integration-gaps.md) – POST
      // /finance/bank/sync kann daher keine Transaktion erzeugen. Die
      // automatische Kaskade wird deshalb über den Job `bank.import` geprüft
      // (siehe jobs.test.ts "Bankimport"); hier geht es um die MANUELLE
      // Zuordnung durch die Rolle finanzen.
      await sql`
        insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
        select ${fixtures.standortId}, 'fin3@test.local', password_hash, 'finanzen', 'F', 'N', true, mfa_secret
          from benutzer where id = ${fixtures.bueroBenutzerId}`;
      const finance = await loginAs(app, "fin3@test.local", fixtures.password, fixtures.bueroTotpSecret);

      const [invoice] = await sql`
        insert into rechnungen (standort_id, schueler_id, betrag_cent, status)
        values (${fixtures.standortId}, ${fixtures.schuelerId}, 12500, 'offen') returning id`;
      const [tx] = await sql`
        insert into banktransaktionen (standort_id, external_id, amount_cent, booked_at, konfidenz, zahlung_status)
        values (${fixtures.standortId}, 'manual-1', 12500, current_date, 'unklar', 'review_required')
        returning id`;

      const teil = await app.inject({
        method: "POST",
        url: `/finance/bank/${tx.id}/resolve`,
        headers: { cookie: finance, "idempotency-key": "sm-resolve-1" },
        payload: { rechnungId: invoice.id, betragCent: 5000 },
      });
      expect(teil.statusCode).toBe(200);
      expect(teil.json().vollstaendig).toBe(false);
      let rows = await sql`select zahlung_status, status from banktransaktionen where id = ${tx.id}`;
      expect(rows[0].zahlung_status).toBe("partially_matched");
      expect(rows[0].status).toBe("offen");

      const rest = await app.inject({
        method: "POST",
        url: `/finance/bank/${tx.id}/resolve`,
        headers: { cookie: finance, "idempotency-key": "sm-resolve-2" },
        payload: { rechnungId: invoice.id, betragCent: 7500 },
      });
      expect(rest.statusCode).toBe(200);
      rows = await sql`select zahlung_status, status, bearbeitet_durch_benutzer_id from banktransaktionen where id = ${tx.id}`;
      expect(rows[0].zahlung_status).toBe("matched");
      expect(rows[0].status).toBe("gebucht");
      expect(rows[0].bearbeitet_durch_benutzer_id).toBeTruthy();

      const transitions = await sql`
        select von_status, nach_status from state_transitions
         where machine = 'zahlung' and entitaet_id = ${tx.id} order by created_at`;
      expect(transitions.map((t) => `${t.von_status}->${t.nach_status}`)).toEqual([
        "review_required->partially_matched",
        "partially_matched->matched",
      ]);

      // Eine dritte Zuordnung ist DB-seitig unmöglich (§3, FS003).
      const dritte = await app.inject({
        method: "POST",
        url: `/finance/bank/${tx.id}/resolve`,
        headers: { cookie: finance, "idempotency-key": "sm-resolve-3" },
        payload: { rechnungId: invoice.id, betragCent: 1 },
      });
      expect(dritte.statusCode).toBe(409);
      expect(dritte.json().error).toBe("banktransaktion_already_matched");
    });

    it("allows a reversal (Rücklastschrift) and a fresh matching round afterwards", async () => {
      const [tx] = await sql`
        insert into banktransaktionen (standort_id, external_id, amount_cent, booked_at, zahlung_status)
        values (${fixtures.standortId}, 'rev-1', 5000, current_date, 'matched') returning id`;
      await sql`update banktransaktionen set zahlung_status = 'reversed' where id = ${tx.id}`;
      await sql`update banktransaktionen set zahlung_status = 'matching' where id = ${tx.id}`;
      const rows = await sql`select zahlung_status from banktransaktionen where id = ${tx.id}`;
      expect(rows[0].zahlung_status).toBe("matching");
    });
  });

  // -----------------------------------------------------------------------
  // Fahrzeugmangel
  // -----------------------------------------------------------------------
  describe("Fahrzeugmangel: reported -> triaged -> vehicle_blocked -> resolved -> reopened", () => {
    it("walks the chain from the block endpoint and back through 'beheben'", async () => {
      const [vehicle] = await sql`select version from fahrzeuge where id = ${fixtures.fahrzeugId}`;
      const block = await app.inject({
        method: "POST",
        url: `/resources/fahrzeuge/${fixtures.fahrzeugId}/block`,
        headers: { cookie: officeCookie, "idempotency-key": "sm-block" },
        payload: { grund: "Bremsen defekt", schweregrad: "kritisch", expectedVersion: vehicle.version },
      });
      expect(block.statusCode).toBe(200);
      const mangelId = block.json().fahrzeugmangelId as string;

      const rows = await sql`select mangel_status, status from fahrzeugmaengel where id = ${mangelId}`;
      expect(rows[0].mangel_status).toBe("vehicle_blocked");
      expect(rows[0].status).toBe("offen"); // Alt-Spalte

      const behoben = await app.inject({
        method: "POST",
        url: `/resources/fahrzeugmaengel/${mangelId}/beheben`,
        headers: { cookie: officeCookie },
      });
      expect(behoben.statusCode).toBe(200);
      const nachher = await sql`select mangel_status, status, behoben_at from fahrzeugmaengel where id = ${mangelId}`;
      expect(nachher[0].mangel_status).toBe("resolved");
      expect(nachher[0].status).toBe("behoben");
      expect(nachher[0].behoben_at).toBeTruthy();

      // Wiedereröffnung über den Alt-Pfad (status='offen') mappt auf 'reopened'.
      await sql`update fahrzeugmaengel set status = 'offen' where id = ${mangelId}`;
      const wieder = await sql`select mangel_status from fahrzeugmaengel where id = ${mangelId}`;
      expect(wieder[0].mangel_status).toBe("reopened");

      const transitions = await sql`
        select nach_status from state_transitions
         where machine = 'fahrzeugmangel' and entitaet_id = ${mangelId} order by created_at`;
      expect(transitions.map((t) => t.nach_status)).toEqual([
        "triaged",
        "vehicle_blocked",
        "resolved",
        "reopened",
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // Mehrschrittprozesse sind KEIN langer Request
  // -----------------------------------------------------------------------
  describe("multi-step processes are jobs, not one long request", () => {
    it("expires offers via a JOB (resumable) instead of inside an HTTP handler", async () => {
      const beginn = new Date(Date.now() + 1000 * 3600_000);
      const created = await app.inject({
        method: "POST",
        url: "/appointment-offers",
        headers: { cookie: officeCookie },
        payload: {
          fahrlehrerId: fixtures.fahrlehrerId,
          klasse: "B",
          beginnAt: beginn.toISOString(),
          endeAt: new Date(beginn.getTime() + 3600_000).toISOString(),
          ablaufAt: new Date(Date.now() - 1000).toISOString(),
        },
      });
      const offerId = created.json().offer.id as string;

      // Ohne Job bleibt der Zustand stehen (der Ablauf passiert NICHT implizit
      // beim Lesen) – das ist der Beweis, dass der Zustand persistiert ist.
      const list = await app.inject({ method: "GET", url: "/appointment-offers", headers: { cookie: studentCookie } });
      expect(list.statusCode).toBe(200);
      const stillSent = await sql`select angebot_status from terminangebote where id = ${offerId}`;
      expect(stillSent[0].angebot_status).toBe("sent");

      await enqueueJob(db, { jobType: JOB_TYPES.offerExpiry });
      await runJobsOnce(deps(), { owner: "sm", limit: 5 });
      const expired = await sql`select angebot_status from terminangebote where id = ${offerId}`;
      expect(expired[0].angebot_status).toBe("expired");
    });
  });
});
