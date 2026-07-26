import { createRawClient } from "@fahrschul/database";
import type postgres from "postgres";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

/**
 * PROMPT -1 §3 – Die restlichen DB-Invarianten.
 *
 * Jede Prüfung greift die Datenbank DIREKT an (Roh-SQL, kein API-Aufruf), um
 * zu beweisen, dass die Invariante wirklich in der Datenbank steckt und nicht
 * nur im Servicecode: ein Angreifer mit DB-Zugriff, ein Bug oder eine
 * künftige Route können sie nicht umgehen.
 *
 * Zusätzlich wird für jede Invariante die HTTP-Übersetzung geprüft, damit
 * apps/* einen verwertbaren Fehler bekommen statt eines 500.
 */
describe("PROMPT -1 §3 – DB-Invarianten (direkt gegen Postgres geprüft)", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let fixtures: SeededFixtures;
  let sql: ReturnType<typeof createRawClient>;

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
    sql = createRawClient(databaseUrl);
  });

  afterEach(async () => {
    await sql.end();
  });

  async function expectSqlstate(fn: () => Promise<unknown>, code: string) {
    let caught: (postgres.PostgresError & { code?: string }) | null = null;
    try {
      await fn();
    } catch (err) {
      caught = err as postgres.PostgresError;
    }
    expect(caught, `expected SQLSTATE ${code}, but the statement succeeded`).not.toBeNull();
    expect(caught?.code, `message: ${caught?.message}`).toBe(code);
  }

  async function insertBooking(over: Record<string, unknown> = {}) {
    const beginn = new Date(Date.now() + 300 * 3600_000);
    const [row] = await sql`
      insert into terminbuchungen (standort_id, schueler_id, fahrlehrer_id, fahrzeug_id, beginn_at, ende_at, art)
      values (${fixtures.standortId}, ${fixtures.schuelerId}, ${fixtures.fahrlehrerId},
              ${(over.fahrzeugId as string | null) ?? null},
              ${beginn.toISOString()}, ${new Date(beginn.getTime() + 3600_000).toISOString()}, 'Übungsstunde')
      returning *`;
    return row as { id: string; version: number };
  }

  // -----------------------------------------------------------------------
  // (a) Eine Fahrstunde kann nur EINMAL endgültig abgeschlossen werden
  // -----------------------------------------------------------------------
  describe("(a) a lesson can be finally completed only once", () => {
    it("rejects a second completion at the DATABASE level (FS001)", async () => {
      const booking = await insertBooking();
      await sql`update terminbuchungen set status = 'gestartet', gestartet_at = now() where id = ${booking.id}`;
      await sql`update terminbuchungen set status = 'abgeschlossen', beendet_at = now(), tatsaechliche_dauer_minuten = 45 where id = ${booking.id}`;

      await expectSqlstate(
        () =>
          sql`update terminbuchungen set status = 'abgeschlossen', beendet_at = now(), tatsaechliche_dauer_minuten = 90 where id = ${booking.id}`,
        "FS001",
      );
    });

    it("rejects re-opening a completed lesson and freezes the completion data (FS001)", async () => {
      const booking = await insertBooking();
      await sql`update terminbuchungen set status = 'gestartet' where id = ${booking.id}`;
      await sql`update terminbuchungen set status = 'abgeschlossen', beendet_at = now(), tatsaechliche_dauer_minuten = 45 where id = ${booking.id}`;

      await expectSqlstate(
        () => sql`update terminbuchungen set status = 'gestartet' where id = ${booking.id}`,
        "FS001",
      );
      await expectSqlstate(
        () => sql`update terminbuchungen set tatsaechliche_dauer_minuten = 10 where id = ${booking.id}`,
        "FS001",
      );
      // Stornieren bleibt erlaubt (fachlich nötig, z. B. Fehlbuchung).
      await sql`update terminbuchungen set status = 'cancelled' where id = ${booking.id}`;
    });

    it("returns 409 (not 500) through the API when a completed lesson is completed again", async () => {
      const instructorCookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const booking = await insertBooking();
      const start = await app.inject({
        method: "POST",
        url: `/instructor/lessons/${booking.id}/start`,
        headers: { cookie: instructorCookie },
      });
      expect(start.statusCode).toBe(200);

      const payload = {
        tatsaechlicheDauerMinuten: 45,
        stundenart: "Übungsstunde",
        lernziele: ["Anfahren"],
        beobachteteKompetenzfelder: [{ feld: "abstand", kompetenzstatus: "in_uebung", beobachtung: null }],
        kurznotiz: "ok",
        naechstesZiel: "Autobahn",
        schuelerfeedback: "gut",
        bestaetigung: true,
      };
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/instructor/lessons/${booking.id}/complete`,
            headers: { "idempotency-key": idemKey(), cookie: instructorCookie },
            payload,
          })
        ).statusCode,
      ).toBe(200);

      // Ohne Idempotenzschlüssel (also ein echter zweiter Abschlussversuch):
      // die Route lehnt mit 409 ab, nicht mit 500.
      const second = await app.inject({
        method: "POST",
        url: `/instructor/lessons/${booking.id}/complete`,
        headers: { "idempotency-key": idemKey(), cookie: instructorCookie },
        payload,
      });
      expect(second.statusCode).toBe(409);
    });
  });

  // -----------------------------------------------------------------------
  // (b) Keine doppelte Rechnung für dieselbe Leistung
  // -----------------------------------------------------------------------
  describe("(b) no duplicate invoice for the same Leistung", () => {
    it("rejects a second non-cancelled invoice position for the same Leistung (unique index)", async () => {
      const booking = await insertBooking();
      const [r1] = await sql`insert into rechnungen (standort_id, schueler_id, betrag_cent) values (${fixtures.standortId}, ${fixtures.schuelerId}, 6500) returning id`;
      const [r2] = await sql`insert into rechnungen (standort_id, schueler_id, betrag_cent) values (${fixtures.standortId}, ${fixtures.schuelerId}, 6500) returning id`;

      await sql`insert into rechnungspositionen (rechnung_id, bezeichnung, einzelpreis_cent, gesamtpreis_cent, leistung_terminbuchung_id)
                values (${r1.id}, 'Fahrstunde', 6500, 6500, ${booking.id})`;

      await expectSqlstate(
        () =>
          sql`insert into rechnungspositionen (rechnung_id, bezeichnung, einzelpreis_cent, gesamtpreis_cent, leistung_terminbuchung_id)
              values (${r2.id}, 'Fahrstunde', 6500, 6500, ${booking.id})`,
        "23505",
      );

      // Nach Storno der ersten Rechnung ist die Leistung wieder fakturierbar –
      // der Trigger propagiert `storniert` auf die Positionen.
      await sql`update rechnungen set status = 'storniert' where id = ${r1.id}`;
      await sql`insert into rechnungspositionen (rechnung_id, bezeichnung, einzelpreis_cent, gesamtpreis_cent, leistung_terminbuchung_id)
                values (${r2.id}, 'Fahrstunde', 6500, 6500, ${booking.id})`;
    });

    it("returns 409 duplicate_invoice_for_leistung through POST /invoices", async () => {
      const booking = await insertBooking();
      // Reihenfolge: erst MFA am Büro-Konto aktivieren, dann das
      // Finanz-Testkonto daraus klonen (sonst wird ein NULL-Secret kopiert).
      await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);
      await sql`
        insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
        select ${fixtures.standortId}, 'fin2@test.local', password_hash, 'finanzen', 'F', 'N', true, mfa_secret
          from benutzer where id = ${fixtures.bueroBenutzerId}`;
      const finance = await loginAs(app, "fin2@test.local", fixtures.password, fixtures.bueroTotpSecret);

      const body = {
        schuelerId: fixtures.schuelerId,
        positionen: [
          {
            bezeichnung: "Fahrstunde",
            einzelpreisCent: 6500,
            gesamtpreisCent: 6500,
            leistungTerminbuchungId: booking.id,
          },
        ],
      };

      const first = await app.inject({
        method: "POST",
        url: "/invoices",
        headers: { cookie: finance, "idempotency-key": "inv-dup-1" },
        payload: body,
      });
      expect(first.statusCode).toBe(201);

      // Anderer Idempotenzschlüssel (also KEIN Retry) -> echte Dopplung.
      const second = await app.inject({
        method: "POST",
        url: "/invoices",
        headers: { cookie: finance, "idempotency-key": "inv-dup-2" },
        payload: body,
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe("duplicate_invoice_for_leistung");
    });
  });

  // -----------------------------------------------------------------------
  // (c) Eine Banktransaktion darf nicht mehrfach vollständig zugeordnet werden
  // -----------------------------------------------------------------------
  describe("(c) a Banktransaktion cannot be fully matched more than once", () => {
    async function bankTx(amount = 10000, state = "review_required") {
      const [row] = await sql`
        insert into banktransaktionen (standort_id, external_id, amount_cent, booked_at, zahlung_status)
        values (${fixtures.standortId}, ${"ext-" + Math.random()}, ${amount}, current_date, ${state})
        returning *`;
      return row as { id: string; amount_cent: number };
    }

    it("rejects a second payment allocation once the transaction is matched (FS003)", async () => {
      const tx = await bankTx();
      const [invoice] = await sql`insert into rechnungen (standort_id, schueler_id, betrag_cent) values (${fixtures.standortId}, ${fixtures.schuelerId}, 10000) returning id`;
      await sql`insert into zahlungen (standort_id, rechnung_id, betrag_cent, banktransaktion_id, zugeordnet)
                values (${fixtures.standortId}, ${invoice.id}, 10000, ${tx.id}, true)`;
      await sql`update banktransaktionen set zahlung_status = 'matched' where id = ${tx.id}`;

      await expectSqlstate(
        () =>
          sql`insert into zahlungen (standort_id, rechnung_id, betrag_cent, banktransaktion_id, zugeordnet)
              values (${fixtures.standortId}, ${invoice.id}, 1, ${tx.id}, true)`,
        "FS003",
      );
    });

    it("rejects overbooking the transaction amount (FS003)", async () => {
      const tx = await bankTx(10000, "review_required");
      const [invoice] = await sql`insert into rechnungen (standort_id, schueler_id, betrag_cent) values (${fixtures.standortId}, ${fixtures.schuelerId}, 10000) returning id`;
      await sql`insert into zahlungen (standort_id, rechnung_id, betrag_cent, banktransaktion_id, zugeordnet)
                values (${fixtures.standortId}, ${invoice.id}, 9000, ${tx.id}, true)`;
      await expectSqlstate(
        () =>
          sql`insert into zahlungen (standort_id, rechnung_id, betrag_cent, banktransaktion_id, zugeordnet)
              values (${fixtures.standortId}, ${invoice.id}, 2000, ${tx.id}, true)`,
        "FS003",
      );
    });

    it("rejects leaving 'matched' for anything but 'reversed' (FS003 – the specific code wins over the generic allow-list)", async () => {
      const tx = await bankTx(10000, "matched");
      await expectSqlstate(
        () => sql`update banktransaktionen set zahlung_status = 'review_required' where id = ${tx.id}`,
        "FS003",
      );
      // Storno ist der EINZIGE Ausweg.
      await sql`update banktransaktionen set zahlung_status = 'reversed' where id = ${tx.id}`;
    });
  });

  // -----------------------------------------------------------------------
  // (d) Prüfung nur mit gültiger Freigabekette anmeldbar
  // -----------------------------------------------------------------------
  describe("(d) an exam can only be registered with a valid clearance chain", () => {
    async function pipelineTo(status: string) {
      const [p] = await sql`
        insert into pruefungen (standort_id, ausbildung_id, schueler_id, klasse)
        values (${fixtures.standortId}, ${fixtures.ausbildungId}, ${fixtures.schuelerId}, 'B') returning id`;
      for (const step of ["fahrlehrer_go", "bueroprüfung", "unterlagen_vollstaendig"]) {
        await sql`update pruefungen set status = ${step} where id = ${p.id}`;
        if (step === status) break;
      }
      return p.id as string;
    }

    it("rejects registration without Fahrlehrer-Go (FS004)", async () => {
      const id = await pipelineTo("unterlagen_vollstaendig");
      await expectSqlstate(
        () => sql`update pruefungen set status = 'termin_angefragt' where id = ${id}`,
        "FS004",
      );
    });

    it("rejects registration with Fahrlehrer-Go but without Büroprüfung (FS004)", async () => {
      const id = await pipelineTo("unterlagen_vollstaendig");
      await sql`insert into pruefungsfreigaben (standort_id, ausbildung_id, schueler_id, status)
                values (${fixtures.standortId}, ${fixtures.ausbildungId}, ${fixtures.schuelerId}, 'freigegeben')`;
      await expectSqlstate(
        () => sql`update pruefungen set status = 'termin_angefragt' where id = ${id}`,
        "FS004",
      );
    });

    it("accepts registration once BOTH clearances exist, and never grants one automatically", async () => {
      const id = await pipelineTo("unterlagen_vollstaendig");
      await sql`insert into pruefungsfreigaben (standort_id, ausbildung_id, schueler_id, status, buerofreigabe_status)
                values (${fixtures.standortId}, ${fixtures.ausbildungId}, ${fixtures.schuelerId}, 'freigegeben', 'freigegeben')`;
      await sql`update pruefungen set status = 'termin_angefragt' where id = ${id}`;
      const rows = await sql`select status from pruefungen where id = ${id}`;
      expect(rows[0].status).toBe("termin_angefragt");

      // Der Trigger hat KEINE Freigabe erzeugt – er verweigert nur.
      const freigaben = await sql`select count(*)::int as n from pruefungsfreigaben where ausbildung_id = ${fixtures.ausbildungId}`;
      expect(freigaben[0].n).toBe(1);
    });

    it("also enforces the pipeline ORDER in the database (FS004 on a skipped step)", async () => {
      const [p] = await sql`
        insert into pruefungen (standort_id, ausbildung_id, schueler_id, klasse)
        values (${fixtures.standortId}, ${fixtures.ausbildungId}, ${fixtures.schuelerId}, 'B') returning id`;
      await expectSqlstate(
        () => sql`update pruefungen set status = 'ergebnis_dokumentiert' where id = ${p.id}`,
        "FS004",
      );
    });

    it("returns 409 exam_clearance_chain_missing through the API", async () => {
      await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);
      const office = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
      const instructor = await loginAs(app, "fahrlehrer@test.local", fixtures.password);

      const created = await app.inject({
        method: "POST",
        url: "/pruefungen",
        headers: { cookie: office },
        payload: { ausbildungId: fixtures.ausbildungId, schuelerId: fixtures.schuelerId, klasse: "B" },
      });
      const id = created.json().pruefung.id;
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/pruefungen/${id}/transition`,
            headers: { "idempotency-key": idemKey(), cookie: instructor },
            payload: { to: "fahrlehrer_go" },
          })
        ).statusCode,
      ).toBe(200);
      for (const to of ["bueroprüfung", "unterlagen_vollstaendig"]) {
        expect(
          (
            await app.inject({
              method: "POST",
              url: `/pruefungen/${id}/transition`,
              headers: { "idempotency-key": idemKey(), cookie: office },
              payload: { to },
            })
          ).statusCode,
        ).toBe(200);
      }

      const anmeldung = await app.inject({
        method: "POST",
        url: `/pruefungen/${id}/transition`,
        headers: { "idempotency-key": idemKey(), cookie: office },
        payload: { to: "termin_angefragt" },
      });
      expect(anmeldung.statusCode).toBe(409);
      expect(anmeldung.json().error).toBe("exam_clearance_chain_missing");
      expect(anmeldung.json().sqlstate).toBe("FS004");
    });
  });

  // -----------------------------------------------------------------------
  // (e) Ein gesperrtes Fahrzeug kann nicht verplant werden
  // -----------------------------------------------------------------------
  describe("(e) a blocked vehicle cannot be scheduled (DB level, not only the rule function)", () => {
    it("rejects inserting a booking for a blocked vehicle via RAW SQL (FS005)", async () => {
      await sql`update fahrzeuge set status = 'wartung' where id = ${fixtures.fahrzeugId}`;
      const beginn = new Date(Date.now() + 400 * 3600_000);
      await expectSqlstate(
        () =>
          sql`insert into terminbuchungen (standort_id, schueler_id, fahrlehrer_id, fahrzeug_id, beginn_at, ende_at, art)
              values (${fixtures.standortId}, ${fixtures.schuelerId}, ${fixtures.fahrlehrerId}, ${fixtures.fahrzeugId},
                      ${beginn.toISOString()}, ${new Date(beginn.getTime() + 3600_000).toISOString()}, 'Übungsstunde')`,
        "FS005",
      );
    });

    it("rejects MOVING an existing booking onto a blocked vehicle (FS005)", async () => {
      const booking = await insertBooking();
      await sql`update fahrzeuge set status = 'wartung' where id = ${fixtures.fahrzeugId}`;
      await expectSqlstate(
        () => sql`update terminbuchungen set fahrzeug_id = ${fixtures.fahrzeugId} where id = ${booking.id}`,
        "FS005",
      );
    });

    it("rejects offering a blocked vehicle (FS005 on terminangebote)", async () => {
      await sql`update fahrzeuge set status = 'wartung' where id = ${fixtures.fahrzeugId}`;
      const beginn = new Date(Date.now() + 500 * 3600_000);
      await expectSqlstate(
        () =>
          sql`insert into terminangebote (standort_id, fahrlehrer_id, fahrzeug_id, beginn_at, ende_at, klasse)
              values (${fixtures.standortId}, ${fixtures.fahrlehrerId}, ${fixtures.fahrzeugId},
                      ${beginn.toISOString()}, ${new Date(beginn.getTime() + 3600_000).toISOString()}, 'B')`,
        "FS005",
      );
    });

    it("still ALLOWS blocking a vehicle that has future bookings (reported by §19, never auto-cancelled)", async () => {
      const booking = await insertBooking({ fahrzeugId: fixtures.fahrzeugId });
      await sql`update fahrzeuge set status = 'wartung' where id = ${fixtures.fahrzeugId}`;
      const rows = await sql`select status from terminbuchungen where id = ${booking.id}`;
      // Der Termin bleibt bestehen – keine automatische, riskante Reparatur.
      expect(rows[0].status).toBe("bestaetigt");
    });
  });

  // -----------------------------------------------------------------------
  // (f) Dokumentstatus folgt einer erlaubten State Machine
  // -----------------------------------------------------------------------
  describe("(f) document statuses follow the allowed state machine", () => {
    async function newDoc(state = "uploaded") {
      const [row] = await sql`
        insert into dokumente (standort_id, schueler_id, typ, dateiname, speicher_referenz, dokument_status)
        values (${fixtures.standortId}, ${fixtures.schuelerId}, 'sehtest', 'a.pdf', 'mock://a', ${state})
        returning *`;
      return row as { id: string; status: string; dokument_status: string };
    }

    it("rejects skipping straight from uploaded to verified (FS007)", async () => {
      const doc = await newDoc();
      await expectSqlstate(
        () => sql`update dokumente set dokument_status = 'verified' where id = ${doc.id}`,
        "FS007",
      );
    });

    it("rejects verified/rejected without a Prüfprotokoll (FS006)", async () => {
      const doc = await newDoc();
      await sql`update dokumente set dokument_status = 'scanning' where id = ${doc.id}`;
      await sql`update dokumente set dokument_status = 'submitted' where id = ${doc.id}`;
      await sql`update dokumente set dokument_status = 'in_review' where id = ${doc.id}`;
      await expectSqlstate(
        () => sql`update dokumente set dokument_status = 'verified' where id = ${doc.id}`,
        "FS006",
      );
      // Phase 3 (§12): FS009 verlangt zusätzlich einen SAUBEREN Scan, bevor ein
      // Dokument als geprüft gelten darf. Der Zustand "geprüft, aber nie
      // gescannt" ist seit Migration 0009 eine verbotene Kombination. Was
      // dieser Test prüft, bleibt unverändert (FS006: Prüfprotokoll + Prüfer
      // sind Pflicht) – die Zeile setzt nur zusätzlich die Voraussetzung, die
      // ein echter Upload ohnehin erfüllt.
      await sql`update dokumente set dokument_status = 'verified',
                    scan_status = 'sauber',
                    pruefprotokoll = '{"geprueftePunkte":["vollstaendig"]}'::jsonb,
                    geprueft_durch_benutzer_id = ${fixtures.bueroBenutzerId},
                    geprueft_at = now()
                 where id = ${doc.id}`;
      const rows = await sql`select dokument_status, status from dokumente where id = ${doc.id}`;
      expect(rows[0].dokument_status).toBe("verified");
      // Alt-Spalte wird per Trigger synchron gehalten (Expand-Contract).
      expect(rows[0].status).toBe("geprueft");
    });

    it("rejects any transition out of the terminal 'deleted' state (FS007)", async () => {
      const doc = await newDoc();
      await sql`update dokumente set dokument_status = 'deleted' where id = ${doc.id}`;
      await expectSqlstate(
        () => sql`update dokumente set dokument_status = 'submitted' where id = ${doc.id}`,
        "FS007",
      );
    });

    it("records every transition in state_transitions, even for RAW SQL writes", async () => {
      const doc = await newDoc();
      await sql`update dokumente set dokument_status = 'scanning' where id = ${doc.id}`;
      await sql`update dokumente set dokument_status = 'quarantined' where id = ${doc.id}`;
      const rows = await sql`
        select von_status, nach_status from state_transitions
         where machine = 'dokument' and entitaet_id = ${doc.id} order by created_at`;
      expect(rows.map((r) => `${r.von_status}->${r.nach_status}`)).toEqual([
        "uploaded->scanning",
        "scanning->quarantined",
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // §3 Geldbeträge: ausschließlich Integer-Cent
  // -----------------------------------------------------------------------
  describe("§3 money is integer cents everywhere (no float/numeric crept in)", () => {
    it("has no float/double/money column anywhere in the schema", async () => {
      const rows = await sql`
        select table_name, column_name, data_type
          from information_schema.columns
         where table_schema = 'public'
           and data_type in ('double precision', 'real', 'money')`;
      expect(rows).toEqual([]);
    });

    it("stores every *_cent column as integer", async () => {
      const rows = await sql`
        select table_name, column_name, data_type
          from information_schema.columns
         where table_schema = 'public' and column_name like '%\\_cent'`;
      expect(rows.length).toBeGreaterThan(10);
      for (const row of rows) {
        expect(row.data_type, `${row.table_name}.${row.column_name}`).toBe("integer");
      }
    });

    it("uses numeric ONLY for non-money quantities (tax rate, working-time hours)", async () => {
      const rows = await sql`
        select table_name, column_name
          from information_schema.columns
         where table_schema = 'public' and data_type = 'numeric'
         order by table_name, column_name`;
      const erlaubt = new Set([
        "rechnungen.steuersatz",
        "produkte.steuersatz",
        "arbeitszeitregeln.max_stunden_pro_tag",
        "arbeitszeitregeln.max_stunden_pro_woche",
      ]);
      for (const row of rows) {
        expect(erlaubt, `unerwartete numeric-Spalte ${row.table_name}.${row.column_name}`).toContain(
          `${row.table_name}.${row.column_name}`,
        );
      }
    });
  });
});
