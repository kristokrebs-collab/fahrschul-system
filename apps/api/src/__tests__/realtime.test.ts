import { createDatabase, createRawClient } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { generateTotpSecret } from "@fahrschul/auth";
import { createNotificationsAdapter } from "@fahrschul/integrations";
import {
  EVENT_TYPE_DATA_TYPE,
  resolveSyncDataType,
  SYNC_DATA_TYPES,
  MAX_REPLAY_EVENTS,
} from "@fahrschul/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  expandAudienceToBenutzer,
  resolveAudience,
  subscriberDeliveryKey,
} from "../services/realtime-audience.js";
import {
  latestCursor,
  pruneRealtimeDeliveries,
  readChanges,
} from "../services/realtime.js";
import { runWorkersOnce } from "../workers/runner.js";
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
 * PROMPT -1 §6 – ECHTZEIT-SYNCHRONISATION (Serverseite).
 *
 * Bewiesen wird hier:
 *   1. Der geforderte Ablauf: Commit -> Outbox -> Kanal sendet NUR
 *      Ereignis-ID/Thema -> Client lädt neu.
 *   2. Der Kanal trägt KEINE Nutzlast. Kein Feldwert einer Fachtabelle
 *      erscheint in einer Zustellzeile.
 *   3. AUTORISIERUNG je Abonnent: ein Schüler erhält NIEMALS die Ereignis-IDs
 *      eines anderen Schülers, und Ereignis-IDs verraten keine Datensätze,
 *      die der Abonnent nicht lesen darf.
 *   4. Cursor-Wiederaufnahme, zu große Lücke -> Vollsynchronisation,
 *      aufgeräumter Cursor -> Vollsynchronisation.
 *   5. Polling-Fallback liefert dasselbe Ergebnis wie der Stream.
 *   6. Der SSE-Kanal selbst (echter Listener, echtes `text/event-stream`,
 *      Heartbeat, Wiederaufnahme über `Last-Event-ID`).
 *   7. Der Redaktionsvertrag (interne Notizen) bleibt auch auf dem neuen
 *      Refetch-Pfad unangetastet.
 */
describe("PROMPT -1 §6 – Echtzeit-Synchronisation (Server)", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let db: Database;
  let sql: ReturnType<typeof createRawClient>;
  let fixtures: SeededFixtures;
  const notifications = createNotificationsAdapter("mock");

  beforeAll(async () => {
    await ensureMigrated(databaseUrl);
    // Kurze Intervalle nur für den Test (siehe helpers.buildTestApp).
    app = buildTestApp({ realtime: { pollIntervalMs: 40, heartbeatIntervalMs: 80 } });
    await app.ready();
    db = createDatabase(databaseUrl);
    sql = createRawClient(databaseUrl);
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    fixtures = await seedFixtures(databaseUrl);
    await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);
  });

  afterEach(async () => {
    await truncateAll(databaseUrl);
  });

  async function schuelerCookie() {
    return loginAs(app, "schueler@test.local", fixtures.password);
  }
  async function schueler2Cookie() {
    return loginAs(app, "schueler2@test.local", fixtures.password);
  }
  async function fahrlehrerCookie() {
    return loginAs(app, "fahrlehrer@test.local", fixtures.password);
  }
  async function bueroCookie() {
    return loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
  }

  /** Erzeugt eine echte Terminbuchung über die API (Commit + Outbox-Ereignis). */
  async function bucheTermin(cookie: string, offsetStunden = 24) {
    const beginn = new Date(Date.now() + offsetStunden * 3600_000);
    const ende = new Date(beginn.getTime() + 90 * 60_000);
    const res = await app.inject({
      method: "POST",
      url: "/appointments",
      headers: { cookie, "idempotency-key": `test-${Math.random().toString(36).slice(2)}` },
      payload: {
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        fahrzeugId: fixtures.fahrzeugId,
        beginnAt: beginn.toISOString(),
        endeAt: ende.toISOString(),
        art: "Übungsstunde",
        klasse: "B",
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().booking as { id: string };
  }

  // =======================================================================
  // 1) Der geforderte Ablauf
  // =======================================================================
  describe("Ablauf: Commit -> Outbox -> nur Ereignis-ID/Thema -> Client lädt neu", () => {
    it("eine committete fachliche Änderung erzeugt Zustellzeilen für die berechtigten Abonnenten", async () => {
      const buero = await bueroCookie();
      const booking = await bucheTermin(buero);

      // Vor dem Worker-Lauf gibt es das Outbox-Ereignis, aber noch keine
      // Zustellung – der Fanout reitet auf der Outbox, ist kein zweiter Pfad.
      const outboxVorher = await sql`select count(*)::int as n from event_outbox where event_type = 'lesson.booked'`;
      expect(outboxVorher[0].n).toBe(1);
      const vorher = await sql`select count(*)::int as n from realtime_deliveries`;
      expect(vorher[0].n).toBe(0);

      await runWorkersOnce({ db, notifications });

      const zeilen = await sql`
        select audience_key, audience_seq, event_id, event_type, data_type
          from realtime_deliveries order by audience_key`;
      expect(zeilen.length).toBeGreaterThan(0);
      for (const z of zeilen) {
        expect(z.event_type).toBe("lesson.booked");
        expect(z.data_type).toBe("termine");
        expect(z.audience_key.startsWith("benutzer:")).toBe(true);
      }
      expect(booking.id).toBeTruthy();
    });

    it("die Zustellzeile trägt KEINE Nutzlast – nur Ereignis-ID und grobes Thema", async () => {
      const buero = await bueroCookie();
      await bucheTermin(buero);
      await runWorkersOnce({ db, notifications });

      // Alle Spalten prüfen: nichts Fachliches darf durchsickern.
      const spalten = await sql`
        select column_name from information_schema.columns
         where table_name = 'realtime_deliveries' order by column_name`;
      expect(spalten.map((s) => s.column_name)).toEqual([
        "audience_key",
        "audience_seq",
        "created_at",
        "data_type",
        "event_id",
        "event_type",
        "id",
        "standort_id",
      ]);
      // Insbesondere: kein payload/jsonb-Feld.
      expect(spalten.map((s) => s.column_name)).not.toContain("payload");

      // Und die Werte enthalten keine Fach-IDs des Aggregats.
      const zeilen = await sql`select * from realtime_deliveries limit 5`;
      for (const z of zeilen) {
        const serialisiert = JSON.stringify(z);
        expect(serialisiert).not.toContain(fixtures.schuelerId);
        expect(serialisiert).not.toContain(fixtures.fahrlehrerId);
        expect(serialisiert).not.toContain(fixtures.fahrzeugId);
      }
    });

    it("jeder in event_schema_versions eingetragene Ereignistyp hat ein Thema (kein stiller Ausfall)", async () => {
      const typen = await sql`select event_type from event_schema_versions order by event_type`;
      const ohneThema = typen
        .map((t) => t.event_type as string)
        .filter((t) => !EVENT_TYPE_DATA_TYPE[t]);
      expect(ohneThema).toEqual([]);
      // Und jedes verwendete Thema ist in der Liste erlaubter Themen.
      for (const thema of Object.values(EVENT_TYPE_DATA_TYPE)) {
        expect(SYNC_DATA_TYPES).toContain(thema);
      }
      // Aggregat-Überschreibung greift: Wunschzeiten != Fahrlehrerverfügbarkeit.
      expect(resolveSyncDataType("availability.updated", "verfuegbarkeit")).toBe("verfuegbarkeit");
      expect(resolveSyncDataType("availability.updated", "schueler_verfuegbarkeit")).toBe(
        "wunschzeiten",
      );
      // Ein Nicht-Fachereignis (Job-Lauf) erhält KEIN Thema und wird nicht zugestellt.
      expect(resolveSyncDataType("job.reporting.daily", "job")).toBeNull();
    });
  });

  // =======================================================================
  // 2) Autorisierung – das eigentliche Leck-Risiko
  // =======================================================================
  describe("Autorisierung je Abonnent", () => {
    it("ein Schüler erhält NIEMALS die Ereignis-IDs eines anderen Schülers", async () => {
      const buero = await bueroCookie();
      // Termin für Schüler 1.
      await bucheTermin(buero);
      await runWorkersOnce({ db, notifications });

      const cookie1 = await schuelerCookie();
      const cookie2 = await schueler2Cookie();

      const res1 = await app.inject({ method: "GET", url: "/sync/changes?cursor=0", headers: { cookie: cookie1 } });
      const res2 = await app.inject({ method: "GET", url: "/sync/changes?cursor=0", headers: { cookie: cookie2 } });
      expect(res1.statusCode).toBe(200);
      expect(res2.statusCode).toBe(200);

      const changes1 = res1.json().changes as Array<{ eventId: string; dataType: string }>;
      const changes2 = res2.json().changes as Array<{ eventId: string; dataType: string }>;

      // Schüler 1 sieht sein Termin-Ereignis …
      expect(changes1.some((c) => c.dataType === "termine")).toBe(true);
      // … Schüler 2 sieht KEINE Termin-Ereignisse (es gibt keine für ihn).
      expect(changes2.filter((c) => c.dataType === "termine")).toEqual([]);
      // Und garantiert keine Überschneidung der Ereignis-IDs bei `termine`.
      const ids1 = new Set(changes1.filter((c) => c.dataType === "termine").map((c) => c.eventId));
      for (const c of changes2) expect(ids1.has(c.eventId)).toBe(false);
    });

    it("der Cursor eines Abonnenten ist DICHT – er verrät kein fremdes Ereignisvolumen", async () => {
      const buero = await bueroCookie();
      // Viele Ereignisse, die den Schüler 2 NICHT betreffen.
      await bucheTermin(buero, 24);
      await bucheTermin(buero, 30);
      await bucheTermin(buero, 36);
      await runWorkersOnce({ db, notifications });

      const cookie2 = await schueler2Cookie();
      const res = await app.inject({ method: "GET", url: "/sync/changes?cursor=0", headers: { cookie: cookie2 } });
      const changes = res.json().changes as Array<{ cursor: number }>;
      // Falls Schüler 2 überhaupt etwas sieht (Angebotspool), dann als
      // lückenlose 1,2,3-Folge – nicht als globale Sprungnummern.
      const cursors = changes.map((c) => c.cursor);
      expect(cursors).toEqual(cursors.map((_, i) => i + 1));
    });

    it("Abonnentenschlüssel kommen aus der Sitzung – ein manipulierter Query-Parameter hilft nicht", async () => {
      const buero = await bueroCookie();
      await bucheTermin(buero);
      await runWorkersOnce({ db, notifications });

      const cookie2 = await schueler2Cookie();
      // Versuch, sich als anderer Abonnent auszugeben.
      const res = await app.inject({
        method: "GET",
        url: `/sync/changes?cursor=0&audienceKey=${encodeURIComponent(
          subscriberDeliveryKey(fixtures.schuelerBenutzerId),
        )}&benutzerId=${fixtures.schuelerBenutzerId}`,
        headers: { cookie: cookie2 },
      });
      expect(res.statusCode).toBe(200);
      const changes = res.json().changes as Array<{ dataType: string }>;
      expect(changes.filter((c) => c.dataType === "termine")).toEqual([]);
    });

    it("ohne Sitzung gibt es keinen Kanal", async () => {
      for (const url of ["/sync/changes", "/sync/cursor", "/sync/stream"]) {
        const res = await app.inject({ method: "GET", url });
        expect(res.statusCode, url).toBe(401);
      }
    });

    it("systemdienst erhält keine fachlichen Zustellungen (Non-Negotiable bleibt gültig)", async () => {
      await sql`
        insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled)
        values (${fixtures.standortId}, 'sys@test.local',
                (select password_hash from benutzer where email = 'buero@test.local'),
                'systemdienst', 'Sys', 'Dienst', false)`;
      const buero = await bueroCookie();
      await bucheTermin(buero);
      await runWorkersOnce({ db, notifications });

      const [sysUser] = await sql`select id from benutzer where email = 'sys@test.local'`;
      const zeilen = await sql`
        select count(*)::int as n from realtime_deliveries
         where audience_key = ${subscriberDeliveryKey(sysUser.id)}`;
      expect(zeilen[0].n).toBe(0);
    });

    it("Zielgruppenauflösung: ein Termin geht an Schüler, Fahrlehrer, Büro und Geschäftsführung – nicht weiter", async () => {
      const buero = await bueroCookie();
      const booking = await bucheTermin(buero);
      const [outbox] = await sql`
        select id, seq, event_type, event_version, aggregate_type, aggregate_id,
               correlation_id, standort_id, payload, attempts
          from event_outbox where event_type = 'lesson.booked' limit 1`;

      const audience = await resolveAudience(db, {
        eventId: outbox.id,
        seq: Number(outbox.seq),
        eventType: outbox.event_type,
        eventVersion: outbox.event_version,
        aggregateType: outbox.aggregate_type,
        aggregateId: outbox.aggregate_id,
        correlationId: outbox.correlation_id,
        standortId: outbox.standort_id,
        payload: outbox.payload,
        attempts: outbox.attempts,
      });

      expect(audience).not.toBeNull();
      expect(audience!.fallback).toBe(false);
      expect(audience!.dataType).toBe("termine");
      expect(audience!.audienceKeys.sort()).toEqual(
        [
          `fahrlehrer:${fixtures.fahrlehrerId}`,
          `rolle:geschaeftsfuehrung`,
          `schueler:${fixtures.schuelerId}`,
          `standort:${fixtures.standortId}:buero`,
        ].sort(),
      );
      expect(booking.id).toBeTruthy();

      // Auflösung auf konkrete Benutzer.
      const benutzerIds = await expandAudienceToBenutzer(db, audience!.audienceKeys);
      expect(benutzerIds).toContain(fixtures.schuelerBenutzerId);
      expect(benutzerIds).toContain(fixtures.fahrlehrerBenutzerId);
      expect(benutzerIds).toContain(fixtures.bueroBenutzerId);
      expect(benutzerIds).not.toContain(fixtures.schueler2BenutzerId);
    });

    it("ein anderer Standort bekommt nichts (Mandanten-/Standorttrennung)", async () => {
      const [org2] = await sql`insert into organisationen (name) values ('Zweite Org') returning id`;
      const [standort2] = await sql`
        insert into standorte (organisation_id, name) values (${org2.id}, 'Bad Hersfeld') returning id`;
      const [buero2] = await sql`
        insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname)
        values (${standort2.id}, 'buero2@test.local',
                (select password_hash from benutzer where email = 'buero@test.local'),
                'buero', 'Büro', 'Zwei')
        returning id`;

      const buero = await bueroCookie();
      await bucheTermin(buero);
      await runWorkersOnce({ db, notifications });

      const zeilen = await sql`
        select count(*)::int as n from realtime_deliveries
         where audience_key = ${subscriberDeliveryKey(buero2.id)}`;
      expect(zeilen[0].n).toBe(0);
    });

    it("ein Sprachprotokoll erreicht ausschließlich seinen Fahrlehrer – nicht den Schüler", async () => {
      const fahrlehrer = await fahrlehrerCookie();
      const booking = await bucheTermin(await bueroCookie());
      const angelegt = await app.inject({
        method: "POST",
        url: "/instructor/voice-logs",
        headers: { cookie: fahrlehrer },
        payload: { terminbuchungId: booking.id, audioReferenzOderDiktat: "Interne Rohnotiz" },
      });
      expect([200, 201]).toContain(angelegt.statusCode);
      const logId = angelegt.json().sprachprotokoll.id as string;
      const bestaetigt = await app.inject({
        method: "POST",
        url: `/instructor/voice-logs/${logId}/confirm`,
        headers: { cookie: fahrlehrer },
      });
      expect(bestaetigt.statusCode).toBe(200);

      await runWorkersOnce({ db, notifications });

      const zeilen = await sql`
        select audience_key from realtime_deliveries where event_type = 'voice_log.confirmed'`;
      const keys = zeilen.map((z) => z.audience_key as string);
      expect(keys).toContain(subscriberDeliveryKey(fixtures.fahrlehrerBenutzerId));
      expect(keys).not.toContain(subscriberDeliveryKey(fixtures.schuelerBenutzerId));
      expect(keys).not.toContain(subscriberDeliveryKey(fixtures.bueroBenutzerId));
    });
  });

  // =======================================================================
  // 3) Redaktionsvertrag auf dem neuen Refetch-Pfad
  // =======================================================================
  describe("Redaktionsvertrag: interne Notizen bleiben unerreichbar", () => {
    it("der Kanal meldet nur das Thema 'feedback'; der Refetch redigiert weiterhin", async () => {
      const fahrlehrer = await fahrlehrerCookie();
      const booking = await bucheTermin(await bueroCookie());
      const feedback = await app.inject({
        method: "POST",
        url: `/appointments/${booking.id}/feedback`,
        headers: { cookie: fahrlehrer },
        payload: {
          wentWell: "Sichere Spurführung",
          workOn: "Schulterblick",
          nextGoal: "Autobahn",
          internalNotes: "GEHEIME INTERNE NOTIZ – niemals schülersichtbar",
          releasedFields: ["wentWell", "nextGoal"],
        },
      });
      expect([200, 201]).toContain(feedback.statusCode);

      await runWorkersOnce({ db, notifications });

      // Der Kanal: nur Thema, keine Inhalte.
      const zeilen = await sql`select * from realtime_deliveries where event_type = 'feedback.given'`;
      expect(zeilen.length).toBeGreaterThan(0);
      for (const z of zeilen) {
        expect(z.data_type).toBe("feedback");
        expect(JSON.stringify(z)).not.toContain("GEHEIME");
      }
      // Auch nicht im Outbox-Ereignis selbst (Phase 1 hat das schon so gebaut –
      // hier wird es nach der Phase-2-Änderung erneut geprüft).
      const outbox = await sql`select payload from event_outbox where event_type = 'feedback.given'`;
      expect(JSON.stringify(outbox)).not.toContain("GEHEIME");

      // Und der anschließende Refetch des Schülers redigiert wie bisher.
      const schueler = await schuelerCookie();
      const gelesen = await app.inject({ method: "GET", url: "/feedback/mine", headers: { cookie: schueler } });
      expect(gelesen.statusCode).toBe(200);
      expect(gelesen.body).not.toContain("GEHEIME");
      expect(gelesen.body).not.toContain("internalNotes");
      expect(gelesen.body).not.toContain("Schulterblick"); // nicht freigegeben
      expect(gelesen.body).toContain("Sichere Spurführung"); // freigegeben
    });
  });

  // =======================================================================
  // 4) Cursor, Wiederaufnahme, Lücke, Aufräumen
  // =======================================================================
  describe("Cursor / Wiederaufnahme / Vollsynchronisation", () => {
    it("Wiederaufnahme ab dem letzten bestätigten Cursor liefert genau die neuen Ereignisse", async () => {
      const buero = await bueroCookie();
      await bucheTermin(buero, 24);
      await runWorkersOnce({ db, notifications });

      const erste = await readChanges(db, { benutzerId: fixtures.schuelerBenutzerId, cursor: 0 });
      expect(erste.changes.length).toBeGreaterThan(0);
      const cursorNachErster = erste.cursor;

      await bucheTermin(buero, 30);
      await runWorkersOnce({ db, notifications });

      const zweite = await readChanges(db, {
        benutzerId: fixtures.schuelerBenutzerId,
        cursor: cursorNachErster,
      });
      expect(zweite.changes.length).toBeGreaterThan(0);
      // Keine Wiederholung des bereits gesehenen Bereichs …
      for (const c of zweite.changes) expect(c.cursor).toBeGreaterThan(cursorNachErster);
      // … und die Nummern sind dicht.
      expect(zweite.changes[0].cursor).toBe(cursorNachErster + 1);
    });

    it("`hasMore` + Limit erlauben blockweises Nachholen", async () => {
      const buero = await bueroCookie();
      await bucheTermin(buero, 24);
      await bucheTermin(buero, 30);
      await bucheTermin(buero, 36);
      await runWorkersOnce({ db, notifications });

      const seite1 = await readChanges(db, {
        benutzerId: fixtures.schuelerBenutzerId,
        cursor: 0,
        limit: 1,
      });
      expect(seite1.changes).toHaveLength(1);
      expect(seite1.hasMore).toBe(true);
      const seite2 = await readChanges(db, {
        benutzerId: fixtures.schuelerBenutzerId,
        cursor: seite1.cursor,
        limit: 10,
      });
      expect(seite2.changes.length).toBeGreaterThan(0);
      expect(seite2.hasMore).toBe(false);
    });

    it("zu große Lücke -> Vollsynchronisation statt Replay", async () => {
      const buero = await bueroCookie();
      await bucheTermin(buero, 24);
      await bucheTermin(buero, 30);
      await runWorkersOnce({ db, notifications });

      // Künstlich eine große Lücke erzeugen: die JÜNGSTE Zustellzeile bekommt
      // eine sehr hohe Nummer, die älteste bleibt bei 1. Genau die Lage nach
      // "eine Woche offline, seitdem sehr viel passiert".
      const key = subscriberDeliveryKey(fixtures.schuelerBenutzerId);
      const zeilen = await sql`
        select id, audience_seq from realtime_deliveries
         where audience_key = ${key} order by audience_seq`;
      expect(zeilen.length).toBeGreaterThanOrEqual(2);
      const hoch = MAX_REPLAY_EVENTS + 10;
      await sql`update realtime_deliveries set audience_seq = ${hoch}
                 where id = ${zeilen[zeilen.length - 1].id}`;

      const result = await readChanges(db, { benutzerId: fixtures.schuelerBenutzerId, cursor: 0 });
      expect(result.resyncRequired).toBe(true);
      expect(result.resyncReason).toBe("gap_too_large");
      expect(result.changes).toEqual([]);
      expect(result.cursor).toBe(hoch);
    });

    it("aufgeräumter Cursor -> Vollsynchronisation (`cursor_pruned`)", async () => {
      const buero = await bueroCookie();
      await bucheTermin(buero, 24);
      await runWorkersOnce({ db, notifications });
      await bucheTermin(buero, 30);
      await runWorkersOnce({ db, notifications });

      const key = subscriberDeliveryKey(fixtures.schuelerBenutzerId);
      // Aufbewahrungsjob entfernt die ältesten Zeilen …
      await sql`update realtime_deliveries set created_at = now() - interval '30 days'
                 where audience_key = ${key} and audience_seq = 1`;
      const entfernt = await pruneRealtimeDeliveries(db, { olderThanMs: 7 * 24 * 3600_000 });
      expect(entfernt).toBeGreaterThan(0);

      // … ein Client mit Cursor 0 kann nicht mehr lückenlos nachholen.
      const result = await readChanges(db, { benutzerId: fixtures.schuelerBenutzerId, cursor: 0 });
      expect(result.resyncRequired).toBe(true);
      expect(result.resyncReason).toBe("cursor_pruned");

      // Der Zähler wird NICHT zurückgesetzt: neue Ereignisse zählen weiter.
      const [zaehler] = await sql`
        select next_seq from realtime_audience_counters where audience_key = ${key}`;
      expect(Number(zaehler.next_seq)).toBeGreaterThanOrEqual(2);
    });

    it("Cursor VOR dem Serverstand -> Vollsynchronisation (`cursor_ahead_of_server`)", async () => {
      const result = await readChanges(db, {
        benutzerId: fixtures.schuelerBenutzerId,
        cursor: 999,
      });
      expect(result.resyncRequired).toBe(true);
      expect(result.resyncReason).toBe("cursor_ahead_of_server");
    });

    it("doppelter Fanout desselben Ereignisses erzeugt keine zweite Zustellzeile und keine Cursorlücke", async () => {
      const buero = await bueroCookie();
      await bucheTermin(buero);
      // Zweimal laufen lassen: der zweite Lauf darf nichts verdoppeln
      // (Inbox-Dedup + Unique-Index).
      await runWorkersOnce({ db, notifications });
      await sql`delete from event_inbox where consumer = 'realtime-fanout'`;
      await sql`update event_outbox set status = 'pending', next_attempt_at = now(), lease_owner = null`;
      await runWorkersOnce({ db, notifications });

      const key = subscriberDeliveryKey(fixtures.schuelerBenutzerId);
      const zeilen = await sql`
        select audience_seq from realtime_deliveries where audience_key = ${key} order by audience_seq`;
      const seqs = zeilen.map((z) => Number(z.audience_seq));
      // Dicht und ohne Duplikate.
      expect(seqs).toEqual(seqs.map((_, i) => i + 1));
      expect(new Set(seqs).size).toBe(seqs.length);
    });

    it("`GET /sync/cursor` liefert den Startpunkt und die Betriebsparameter", async () => {
      const cookie = await schuelerCookie();
      const res = await app.inject({ method: "GET", url: "/sync/cursor", headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.cursor).toBe(0);
      expect(body.maxReplayEvents).toBe(MAX_REPLAY_EVENTS);
      expect(typeof body.serverTime).toBe("string");
      expect(body.heartbeatIntervalMs).toBe(80);
    });
  });

  // =======================================================================
  // 5) Polling-Fallback konvergiert genauso
  // =======================================================================
  describe("Polling-Fallback (§6, Mechanismus für §18 in Phase 3)", () => {
    it("liefert bei ausgefallenem Stream dieselben Änderungen wie der Stream", async () => {
      const buero = await bueroCookie();
      await bucheTermin(buero);
      await runWorkersOnce({ db, notifications });

      const cookie = await schuelerCookie();
      let cursor = 0;
      const gesammelt: string[] = [];
      // Zwei Poll-Runden, wie ein Client im eingeschränkten Betrieb.
      for (let runde = 0; runde < 2; runde += 1) {
        const res = await app.inject({
          method: "GET",
          url: `/sync/changes?cursor=${cursor}`,
          headers: { cookie },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json() as {
          changes: Array<{ cursor: number; dataType: string }>;
          cursor: number;
          resyncRequired: boolean;
        };
        expect(body.resyncRequired).toBe(false);
        for (const c of body.changes) gesammelt.push(c.dataType);
        cursor = body.cursor;
      }
      expect(gesammelt).toContain("termine");

      // Konvergenz: eine weitere Runde ohne neue Ereignisse liefert nichts.
      const leer = await app.inject({
        method: "GET",
        url: `/sync/changes?cursor=${cursor}`,
        headers: { cookie },
      });
      expect(leer.json().changes).toEqual([]);
    });

    it("weist ungültige Query ab statt sie zu erraten", async () => {
      const cookie = await schuelerCookie();
      const res = await app.inject({
        method: "GET",
        url: "/sync/changes?cursor=-5",
        headers: { cookie },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_query");
    });
  });

  // =======================================================================
  // 6) Der echte SSE-Kanal
  // =======================================================================
  describe("SSE-Kanal gegen einen echten Listener", () => {
    it("liefert text/event-stream, Hello, Änderungen mit id: und Heartbeat – und nimmt Last-Event-ID an", async () => {
      const streamApp = buildTestApp({ realtime: { pollIntervalMs: 40, heartbeatIntervalMs: 80 } });
      await streamApp.listen({ port: 0, host: "127.0.0.1" });
      const addr = streamApp.server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;

      try {
        const cookie = await loginAs(streamApp, "schueler@test.local", fixtures.password);
        const controller = new AbortController();
        const res = await fetch(`${base}/sync/stream?cursor=0`, {
          headers: { cookie },
          signal: controller.signal,
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/event-stream");
        expect(res.headers.get("cache-control")).toContain("no-cache");
        expect(res.headers.get("x-accel-buffering")).toBe("no");

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let puffer = "";
        const lese = async (bedingung: (text: string) => boolean, timeoutMs = 8000) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            if (bedingung(puffer)) return true;
            const { value, done } = await reader.read();
            if (done) break;
            puffer += decoder.decode(value, { stream: true });
          }
          return bedingung(puffer);
        };

        // 1) Hello + retry-Direktive (automatischer Reconnect im Protokoll).
        expect(await lese((t) => t.includes("event: hello"))).toBe(true);
        expect(puffer).toContain("retry: 3000");

        // 2) Eine echte fachliche Änderung erzeugen und zustellen lassen.
        const buero = await loginAs(
          streamApp,
          "buero@test.local",
          fixtures.password,
          fixtures.bueroTotpSecret,
        );
        const beginn = new Date(Date.now() + 26 * 3600_000);
        const buchung = await streamApp.inject({
          method: "POST",
          url: "/appointments",
          headers: { cookie: buero, "idempotency-key": `sse-${Math.random().toString(36).slice(2)}` },
          payload: {
            schuelerId: fixtures.schuelerId,
            fahrlehrerId: fixtures.fahrlehrerId,
            fahrzeugId: fixtures.fahrzeugId,
            beginnAt: beginn.toISOString(),
            endeAt: new Date(beginn.getTime() + 90 * 60_000).toISOString(),
            art: "Übungsstunde",
            klasse: "B",
          },
        });
        expect(buchung.statusCode, buchung.body).toBe(201);
        await runWorkersOnce({ db, notifications });

        expect(await lese((t) => t.includes("event: change"))).toBe(true);
        // Die Nachricht trägt Thema + Ereignis-ID + id:-Zeile für die
        // Wiederaufnahme, aber keine Nutzlast.
        expect(puffer).toContain('"dataType":"termine"');
        expect(puffer).toMatch(/\nid: \d+\n/);
        expect(puffer).not.toContain(fixtures.schuelerId);
        expect(puffer).not.toContain("Übungsstunde");

        // 3) Heartbeat kommt (80 ms Intervall im Test).
        expect(await lese((t) => t.includes("event: heartbeat"))).toBe(true);

        // Cursor aus der id:-Zeile lesen – das ist der Wert, den der Browser
        // beim automatischen Reconnect als Last-Event-ID zurückschickt.
        const cursorTreffer = [...puffer.matchAll(/\nid: (\d+)\n/g)].map((m) => Number(m[1]));
        const letzterCursor = Math.max(...cursorTreffer);
        expect(letzterCursor).toBeGreaterThan(0);

        controller.abort();
        await reader.cancel().catch(() => {});

        // 4) Wiederaufnahme über Last-Event-ID: keine Wiederholung des
        //    bereits Gesehenen.
        const controller2 = new AbortController();
        const res2 = await fetch(`${base}/sync/stream`, {
          headers: { cookie, "last-event-id": String(letzterCursor) },
          signal: controller2.signal,
        });
        expect(res2.status).toBe(200);
        const reader2 = res2.body!.getReader();
        let puffer2 = "";
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline && !puffer2.includes("event: hello")) {
          const { value, done } = await reader2.read();
          if (done) break;
          puffer2 += decoder.decode(value, { stream: true });
        }
        expect(puffer2).toContain("event: hello");
        expect(puffer2).toContain(`"cursor":${letzterCursor}`);
        expect(puffer2).toContain('"resyncRequired":false');
        controller2.abort();
        await reader2.cancel().catch(() => {});
      } finally {
        await streamApp.close();
      }
    }, 30000);

    it("ordnet bei zu großer Lücke eine Vollsynchronisation über den Kanal an", async () => {
      const buero = await bueroCookie();
      await bucheTermin(buero);
      await runWorkersOnce({ db, notifications });

      const streamApp = buildTestApp({ realtime: { pollIntervalMs: 40, heartbeatIntervalMs: 500 } });
      await streamApp.listen({ port: 0, host: "127.0.0.1" });
      const addr = streamApp.server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      try {
        const cookie = await loginAs(streamApp, "schueler@test.local", fixtures.password);
        const controller = new AbortController();
        // Cursor deutlich VOR dem Serverstand.
        const res = await fetch(`http://127.0.0.1:${port}/sync/stream?cursor=99999`, {
          headers: { cookie },
          signal: controller.signal,
        });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let puffer = "";
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && !puffer.includes("event: resync")) {
          const { value, done } = await reader.read();
          if (done) break;
          puffer += decoder.decode(value, { stream: true });
        }
        expect(puffer).toContain("event: resync");
        expect(puffer).toContain("cursor_ahead_of_server");
        controller.abort();
        await reader.cancel().catch(() => {});
      } finally {
        await streamApp.close();
      }
    }, 30000);
  });

  // =======================================================================
  // 7) §7 Auflösung offener Vorgänge über den Idempotenzschlüssel
  // =======================================================================
  describe("§7 GET /sync/operations/:operation/:key", () => {
    it("`completed` liefert die gespeicherte Antwort des abgeschlossenen Vorgangs", async () => {
      const buero = await bueroCookie();
      const key = `resolve-${Math.random().toString(36).slice(2)}`;
      const beginn = new Date(Date.now() + 40 * 3600_000);
      const res = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { cookie: buero, "idempotency-key": key },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          beginnAt: beginn.toISOString(),
          endeAt: new Date(beginn.getTime() + 90 * 60_000).toISOString(),
          art: "Übungsstunde",
          klasse: "B",
        },
      });
      expect(res.statusCode).toBe(201);

      const lookup = await app.inject({
        method: "GET",
        url: `/sync/operations/appointments.create/${key}`,
        headers: { cookie: buero },
      });
      expect(lookup.statusCode).toBe(200);
      const body = lookup.json();
      expect(body.status).toBe("completed");
      expect(body.responseStatus).toBe(201);
      expect(body.entitaet).toBe("terminbuchung");
      expect(body.entitaetId).toBeTruthy();
    });

    it("`unknown` für einen unbekannten Schlüssel – der Vorgang hat nicht gewirkt", async () => {
      const buero = await bueroCookie();
      const lookup = await app.inject({
        method: "GET",
        url: "/sync/operations/appointments.create/nie-gesendet",
        headers: { cookie: buero },
      });
      expect(lookup.statusCode).toBe(200);
      expect(lookup.json().status).toBe("unknown");
    });

    it("ein FREMDER Schlüssel wird als nicht vorhanden behandelt (keine Existenzbestätigung)", async () => {
      const buero = await bueroCookie();
      const key = `fremd-${Math.random().toString(36).slice(2)}`;
      const beginn = new Date(Date.now() + 44 * 3600_000);
      const angelegt = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { cookie: buero, "idempotency-key": key },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          beginnAt: beginn.toISOString(),
          endeAt: new Date(beginn.getTime() + 90 * 60_000).toISOString(),
          art: "Übungsstunde",
          klasse: "B",
        },
      });
      expect(angelegt.statusCode).toBe(201);

      const schueler = await schuelerCookie();
      const lookup = await app.inject({
        method: "GET",
        url: `/sync/operations/appointments.create/${key}`,
        headers: { cookie: schueler },
      });
      expect(lookup.statusCode).toBe(404);
      expect(lookup.json().error).toBe("not_found");
    });

    it("nur die zehn §2-Operationen sind abfragbar (kein freies Sondieren)", async () => {
      const buero = await bueroCookie();
      const res = await app.inject({
        method: "GET",
        url: "/sync/operations/beliebig.erfunden/abc",
        headers: { cookie: buero },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("unknown_operation");
      expect(res.json().erlaubt).toHaveLength(10);
    });
  });

  // =======================================================================
  // 8) Aufbewahrung
  // =======================================================================
  describe("Aufbewahrung", () => {
    it("der Job `realtime.prune` entfernt alte Zustellzeilen, ohne den Zähler zurückzusetzen", async () => {
      const buero = await bueroCookie();
      await bucheTermin(buero);
      await runWorkersOnce({ db, notifications });
      const key = subscriberDeliveryKey(fixtures.schuelerBenutzerId);
      const vorher = await latestCursor(db, fixtures.schuelerBenutzerId);
      expect(vorher).toBeGreaterThan(0);

      await sql`update realtime_deliveries set created_at = now() - interval '60 days'`;
      const gfSecret = generateTotpSecret();
      const [gf] = await sql`
        insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname)
        values (${fixtures.standortId}, 'gf@test.local',
                (select password_hash from benutzer where email = 'buero@test.local'),
                'geschaeftsfuehrung', 'Chef', 'In')
        returning id`;
      await enableMfa(databaseUrl, gf.id, gfSecret);
      const gfCookie = await loginAs(app, "gf@test.local", fixtures.password, gfSecret);

      const jobRes = await app.inject({
        method: "POST",
        url: "/ops/jobs",
        headers: { cookie: gfCookie },
        payload: { jobType: "realtime.prune", payload: { olderThanMs: 1000 } },
      });
      expect([200, 201]).toContain(jobRes.statusCode);
      await runWorkersOnce({ db, notifications });

      const uebrig = await sql`select count(*)::int as n from realtime_deliveries where audience_key = ${key}`;
      expect(uebrig[0].n).toBe(0);
      const [zaehler] = await sql`select next_seq from realtime_audience_counters where audience_key = ${key}`;
      expect(Number(zaehler.next_seq)).toBe(vorher);
    });
  });
});
