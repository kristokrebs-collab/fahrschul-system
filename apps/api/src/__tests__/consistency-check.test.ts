import { createDatabase, createRawClient } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { createNotificationsAdapter } from "@fahrschul/integrations";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { consistencyCheckCatalog, runConsistencyCheck } from "../services/consistency-check.js";
import { enqueueJob, JOB_TYPES } from "../workers/job-store.js";
import { runJobsOnce } from "../workers/runner.js";
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
 * PROMPT -1 §19 – Täglicher Konsistenzcheck als lauffähiger Job mit Bericht.
 *
 * Für jede der elf geforderten Prüfungen wird eine echte Inkonsistenz erzeugt
 * und der Befund nachgewiesen. Zusätzlich das Non-Negotiable: riskante
 * Reparaturen sind AUSSCHLIESSLICH Vorschläge und werden NIE angewendet.
 */
describe("PROMPT -1 §19 – Täglicher Konsistenzcheck", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let db: Database;
  let fixtures: SeededFixtures;
  let sql: ReturnType<typeof createRawClient>;
  let opsCookie: string;
  let officeCookie: string;

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
    opsCookie = await loginAs(app, "systemdienst@test.local", fixtures.password, fixtures.bueroTotpSecret);
    officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
  });

  afterEach(async () => {
    await sql.end();
  });

  async function befundeFuer(pruefung: string) {
    const run = await runConsistencyCheck(db, { ausgeloestDurch: "test" });
    return run.findings.filter((f) => f.pruefung === pruefung);
  }

  async function insertBooking(over: { fahrzeugId?: string | null; status?: string; beginnOffsetH?: number } = {}) {
    const beginn = new Date(Date.now() + (over.beginnOffsetH ?? 1100) * 3600_000);
    const [row] = await sql`
      insert into terminbuchungen (standort_id, schueler_id, fahrlehrer_id, fahrzeug_id, beginn_at, ende_at, art, status)
      values (${fixtures.standortId}, ${fixtures.schuelerId}, ${fixtures.fahrlehrerId},
              ${over.fahrzeugId ?? null}, ${beginn.toISOString()},
              ${new Date(beginn.getTime() + 3600_000).toISOString()}, 'Übungsstunde',
              ${over.status ?? "bestaetigt"})
      returning id`;
    return row.id as string;
  }

  // -----------------------------------------------------------------------
  // Katalog & Grundverhalten
  // -----------------------------------------------------------------------
  it("declares exactly the eleven mandated checks", () => {
    const keys = consistencyCheckCatalog().map((c) => c.key);
    expect(keys).toEqual([
      "termin_ohne_gueltige_referenz",
      "terminueberschneidung",
      "bestaetigtes_angebot_ohne_termin",
      "leistung_ohne_rechnung",
      "doppelte_rechnung_fuer_leistung",
      "zahlung_ueber_restbetrag",
      "blockiertes_fahrzeug_mit_zukunftstermin",
      "pruefungsstatus_ohne_freigabe",
      "dokumentstatus_ohne_pruefprotokoll",
      "verwaiste_uploads",
      "unverarbeitete_ereignisse",
    ]);
    expect(keys).toHaveLength(11);
  });

  it("reports zero findings on a clean database and stores a complete report", async () => {
    const run = await runConsistencyCheck(db, { ausgeloestDurch: "test" });
    expect(run.fehlerhaftePruefungen).toEqual([]);
    expect(run.findings).toEqual([]);
    expect(run.zusammenfassung).toHaveLength(11);

    const rows = await sql`select status, anzahl_befunde, bericht, beendet_at from consistency_check_runs where id = ${run.runId}`;
    expect(rows[0].status).toBe("fertig");
    expect(rows[0].anzahl_befunde).toBe(0);
    expect(rows[0].beendet_at).toBeTruthy();
    expect((rows[0].bericht as { pruefungen: number }).pruefungen).toBe(11);
  });

  // -----------------------------------------------------------------------
  // Die elf Prüfungen, jede mit einer echten Inkonsistenz
  // -----------------------------------------------------------------------
  it("1. Termin ohne gültigen Schüler/Fahrlehrer/Fahrzeug", async () => {
    const id = await insertBooking();
    await sql`update schueler set status = 'inaktiv' where id = ${fixtures.schuelerId}`;
    const befunde = await befundeFuer("termin_ohne_gueltige_referenz");
    expect(befunde).toHaveLength(1);
    expect(befunde[0].entitaetId).toBe(id);
    expect(befunde[0].schweregrad).toBe("kritisch");
    expect(befunde[0].vorschlagRiskant).toBe(true);
  });

  it("2. Überschneidungen", async () => {
    // Die EXCLUDE-Constraints aus Migration 0002 verhindern eine NEUE
    // Überschneidung – der Befund existiert für Altdaten. Um ihn zu erzeugen,
    // werden die Constraints kurzzeitig gelöst (nur in diesem Test).
    const a = await insertBooking();
    await sql`alter table terminbuchungen drop constraint terminbuchungen_no_overlap_fahrlehrer`;
    try {
      const beginn = await sql`select beginn_at, ende_at from terminbuchungen where id = ${a}`;
      await sql`
        insert into terminbuchungen (standort_id, schueler_id, fahrlehrer_id, beginn_at, ende_at, art)
        values (${fixtures.standortId}, ${fixtures.schueler2Id}, ${fixtures.fahrlehrerId},
                ${beginn[0].beginn_at}, ${beginn[0].ende_at}, 'Übungsstunde')`;
      const befunde = await befundeFuer("terminueberschneidung");
      expect(befunde).toHaveLength(1);
      expect(befunde[0].schweregrad).toBe("kritisch");
    } finally {
      await sql`delete from terminbuchungen where schueler_id = ${fixtures.schueler2Id}`;
      await sql`alter table terminbuchungen
        add constraint terminbuchungen_no_overlap_fahrlehrer
        exclude using gist (fahrlehrer_id with =, tstzrange(beginn_at, ende_at) with &&)
        where (status <> 'cancelled')`;
    }
  });

  it("3. Bestätigtes Angebot ohne Termin", async () => {
    const beginn = new Date(Date.now() + 1200 * 3600_000);
    const [offer] = await sql`
      insert into terminangebote (standort_id, fahrlehrer_id, beginn_at, ende_at, klasse, angebot_status)
      values (${fixtures.standortId}, ${fixtures.fahrlehrerId}, ${beginn.toISOString()},
              ${new Date(beginn.getTime() + 3600_000).toISOString()}, 'B', 'sent')
      returning id`;
    for (const to of ["accepted", "booking_pending", "confirmed"]) {
      await sql`update terminangebote set angebot_status = ${to} where id = ${offer.id}`;
    }
    const befunde = await befundeFuer("bestaetigtes_angebot_ohne_termin");
    expect(befunde).toHaveLength(1);
    expect(befunde[0].entitaetId).toBe(offer.id);
    expect(befunde[0].vorschlag).toContain("failed_review");
  });

  it("4. Leistung ohne Rechnung", async () => {
    const id = await insertBooking();
    await sql`update terminbuchungen set status = 'gestartet' where id = ${id}`;
    await sql`update terminbuchungen set status = 'abgeschlossen', beendet_at = now(), tatsaechliche_dauer_minuten = 45 where id = ${id}`;
    const befunde = await befundeFuer("leistung_ohne_rechnung");
    expect(befunde).toHaveLength(1);
    expect(befunde[0].entitaetId).toBe(id);
    // Der Vorschlag ist ungefährlich – wird aber trotzdem nicht ausgeführt.
    expect(befunde[0].vorschlagRiskant).toBe(false);
  });

  it("5. Doppelte Rechnung für Leistung", async () => {
    const id = await insertBooking();
    const [r1] = await sql`insert into rechnungen (standort_id, schueler_id, betrag_cent) values (${fixtures.standortId}, ${fixtures.schuelerId}, 6500) returning id`;
    const [r2] = await sql`insert into rechnungen (standort_id, schueler_id, betrag_cent) values (${fixtures.standortId}, ${fixtures.schuelerId}, 6500) returning id`;
    await sql`insert into rechnungspositionen (rechnung_id, bezeichnung, einzelpreis_cent, gesamtpreis_cent, leistung_terminbuchung_id)
              values (${r1.id}, 'Fahrstunde', 6500, 6500, ${id})`;
    // Der Unique-Index verhindert die Dopplung – für den Befund wird er
    // kurzzeitig gelöst (Altdaten-Szenario).
    await sql`drop index rechnungspositionen_leistung_once_idx`;
    try {
      await sql`insert into rechnungspositionen (rechnung_id, bezeichnung, einzelpreis_cent, gesamtpreis_cent, leistung_terminbuchung_id)
                values (${r2.id}, 'Fahrstunde', 6500, 6500, ${id})`;
      const befunde = await befundeFuer("doppelte_rechnung_fuer_leistung");
      expect(befunde).toHaveLength(1);
      expect(befunde[0].beschreibung).toContain("2-fach fakturiert");
    } finally {
      await sql`delete from rechnungspositionen where rechnung_id = ${r2.id}`;
      await sql`create unique index rechnungspositionen_leistung_once_idx
                  on rechnungspositionen (leistung_terminbuchung_id)
                  where leistung_terminbuchung_id is not null and storniert = false`;
    }
  });

  it("6. Zahlung über Restbetrag", async () => {
    const [invoice] = await sql`insert into rechnungen (standort_id, schueler_id, betrag_cent, status) values (${fixtures.standortId}, ${fixtures.schuelerId}, 5000, 'offen') returning id`;
    await sql`insert into zahlungen (standort_id, rechnung_id, betrag_cent, zugeordnet, status)
              values (${fixtures.standortId}, ${invoice.id}, 6000, true, 'zugeordnet')`;
    const befunde = await befundeFuer("zahlung_ueber_restbetrag");
    expect(befunde).toHaveLength(1);
    expect(befunde[0].entitaetId).toBe(invoice.id);
    expect(befunde[0].beschreibung).toContain("6000");
    expect(befunde[0].vorschlag).toContain("Keine automatische Rückbuchung");
  });

  it("7. Blockiertes Fahrzeug mit zukünftigem Termin", async () => {
    const id = await insertBooking({ fahrzeugId: fixtures.fahrzeugId });
    await sql`update fahrzeuge set status = 'wartung' where id = ${fixtures.fahrzeugId}`;
    const befunde = await befundeFuer("blockiertes_fahrzeug_mit_zukunftstermin");
    expect(befunde).toHaveLength(1);
    expect(befunde[0].entitaetId).toBe(id);

    // Non-Negotiable: der Termin wurde NICHT automatisch storniert.
    const rows = await sql`select status from terminbuchungen where id = ${id}`;
    expect(rows[0].status).toBe("bestaetigt");
  });

  it("8. Prüfungsstatus ohne Freigabe", async () => {
    const [p] = await sql`
      insert into pruefungen (standort_id, ausbildung_id, schueler_id, klasse)
      values (${fixtures.standortId}, ${fixtures.ausbildungId}, ${fixtures.schuelerId}, 'B') returning id`;
    // Direkter Statussprung ist DB-seitig verboten (FS004) – für den
    // Altdaten-Befund wird der Trigger kurzzeitig deaktiviert.
    await sql`alter table pruefungen disable trigger pruefungen_a_freigabekette_trg`;
    try {
      await sql`update pruefungen set status = 'termin_angefragt' where id = ${p.id}`;
      const befunde = await befundeFuer("pruefungsstatus_ohne_freigabe");
      expect(befunde).toHaveLength(1);
      expect(befunde[0].beschreibung).toContain("Freigabekette unvollständig");
      expect(befunde[0].vorschlag).toContain("NIEMALS automatisch freigeben");
    } finally {
      await sql`alter table pruefungen enable trigger pruefungen_a_freigabekette_trg`;
    }
  });

  it("9. Dokumentstatus ohne Prüfprotokoll", async () => {
    const [doc] = await sql`
      insert into dokumente (standort_id, schueler_id, typ, dateiname, speicher_referenz, dokument_status)
      values (${fixtures.standortId}, ${fixtures.schuelerId}, 'sehtest', 'a.pdf', 'mock://a', 'in_review')
      returning id`;
    await sql`alter table dokumente disable trigger dokumente_b_pruefprotokoll_trg`;
    try {
      await sql`update dokumente set dokument_status = 'verified' where id = ${doc.id}`;
      const befunde = await befundeFuer("dokumentstatus_ohne_pruefprotokoll");
      expect(befunde).toHaveLength(1);
      expect(befunde[0].entitaetId).toBe(doc.id);
    } finally {
      await sql`alter table dokumente enable trigger dokumente_b_pruefprotokoll_trg`;
    }
  });

  it("10. Verwaiste Uploads", async () => {
    const [doc] = await sql`
      insert into dokumente (standort_id, schueler_id, typ, dateiname, speicher_referenz, dokument_status, created_at)
      values (${fixtures.standortId}, ${fixtures.schuelerId}, 'passbild', 'b.pdf', 'mock://b', 'uploaded', now() - interval '3 days')
      returning id`;
    const befunde = await befundeFuer("verwaiste_uploads");
    expect(befunde).toHaveLength(1);
    expect(befunde[0].entitaetId).toBe(doc.id);
    expect(befunde[0].schweregrad).toBe("niedrig");
  });

  it("11. Unverarbeitete Ereignisse", async () => {
    await sql`
      insert into audit_events (type, aktion, entitaet, entitaet_id, source, correlation_id, created_at)
      values ('lesson.booked', 'x', 'terminbuchung', null, 'test', gen_random_uuid(), now() - interval '1 hour')`;
    await sql`update event_outbox set created_at = now() - interval '1 hour'`;
    const befunde = await befundeFuer("unverarbeitete_ereignisse");
    expect(befunde).toHaveLength(1);
    expect(befunde[0].entitaet).toBe("event_outbox");
    expect(befunde[0].beschreibung).toContain("nicht zugestellt");
  });

  // -----------------------------------------------------------------------
  // Non-Negotiable: nur Vorschläge, keine Reparatur
  // -----------------------------------------------------------------------
  describe("risky repairs are SUGGESTIONS ONLY", () => {
    it("persists every finding with vorschlag_angewendet = false and a suggestion text", async () => {
      const id = await insertBooking({ fahrzeugId: fixtures.fahrzeugId });
      await sql`update fahrzeuge set status = 'wartung' where id = ${fixtures.fahrzeugId}`;
      await sql`update terminbuchungen set status = 'gestartet' where id = ${id}`;

      const run = await runConsistencyCheck(db, { ausgeloestDurch: "test" });
      expect(run.findings.length).toBeGreaterThan(0);

      const rows = await sql`select vorschlag, vorschlag_angewendet, vorschlag_riskant from consistency_findings where run_id = ${run.runId}`;
      expect(rows.length).toBe(run.findings.length);
      for (const row of rows) {
        expect(row.vorschlag_angewendet).toBe(false);
        expect(String(row.vorschlag).length).toBeGreaterThan(20);
      }
    });

    it("exposes NO endpoint that applies a suggestion", async () => {
      const run = await runConsistencyCheck(db, { ausgeloestDurch: "test" });
      const befund = await sql`select id from consistency_findings where run_id = ${run.runId} limit 1`;
      const kandidaten = [
        `/ops/consistency/findings/${befund[0]?.id ?? "x"}/apply`,
        `/ops/consistency/runs/${run.runId}/repair`,
        `/ops/consistency/repair`,
      ];
      for (const url of kandidaten) {
        const res = await app.inject({ method: "POST", url, headers: { cookie: opsCookie } });
        expect(res.statusCode, url).toBe(404);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Als Job und über die Ops-Route lauffähig
  // -----------------------------------------------------------------------
  describe("runnable as a job and over HTTP", () => {
    it("runs as the consistency.check job and stores the report", async () => {
      await insertBooking({ fahrzeugId: fixtures.fahrzeugId });
      await sql`update fahrzeuge set status = 'wartung' where id = ${fixtures.fahrzeugId}`;

      await enqueueJob(db, { jobType: JOB_TYPES.consistencyCheck });
      const result = await runJobsOnce({ db, notifications: createNotificationsAdapter("mock") }, { limit: 5 });
      expect(result.succeeded).toBe(1);
      const ergebnis = result.ergebnisse[0].result as { runId: string; anzahlBefunde: number };
      expect(ergebnis.anzahlBefunde).toBeGreaterThan(0);

      const rows = await sql`select ausgeloest_durch, status from consistency_check_runs where id = ${ergebnis.runId}`;
      expect(rows[0].ausgeloest_durch).toBe("job");
      expect(rows[0].status).toBe("fertig");
    });

    it("runs over POST /ops/consistency/run and is readable afterwards", async () => {
      const run = await app.inject({
        method: "POST",
        url: "/ops/consistency/run",
        headers: { cookie: opsCookie },
      });
      expect(run.statusCode).toBe(201);
      expect(run.json().hinweis).toContain("ausschließlich Vorschläge");
      const runId = run.json().runId as string;

      const detail = await app.inject({
        method: "GET",
        url: `/ops/consistency/runs/${runId}`,
        headers: { cookie: opsCookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().run.id).toBe(runId);

      const catalog = await app.inject({
        method: "GET",
        url: "/ops/consistency/catalog",
        headers: { cookie: opsCookie },
      });
      expect(catalog.statusCode).toBe(200);
      expect(catalog.json().pruefungen).toHaveLength(11);
    });

    it("denies the consistency surface to non-ops roles", async () => {
      for (const url of ["/ops/consistency/catalog", "/ops/consistency/runs"]) {
        const res = await app.inject({ method: "GET", url, headers: { cookie: officeCookie } });
        expect(res.statusCode).toBe(403);
      }
      const run = await app.inject({
        method: "POST",
        url: "/ops/consistency/run",
        headers: { cookie: officeCookie },
      });
      expect(run.statusCode).toBe(403);
    });

    it("fires an alarm when critical findings appear", async () => {
      const id = await insertBooking();
      await sql`update schueler set status = 'inaktiv' where id = ${fixtures.schuelerId}`;
      const run = await runConsistencyCheck(db, { ausgeloestDurch: "test" });
      expect(run.findings.some((f) => f.schweregrad === "kritisch")).toBe(true);
      expect(id).toBeTruthy();

      const view = await app.inject({ method: "GET", url: "/ops/dead-letters", headers: { cookie: opsCookie } });
      expect(
        view.json().alarme.some((a: { kind: string }) => a.kind === "consistency_findings"),
      ).toBe(true);
    });
  });
});
