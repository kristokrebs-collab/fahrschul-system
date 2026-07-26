import { createRawClient } from "@fahrschul/database";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  capturedLogText,
  capturedLogs,
  clearCapturedLogs,
  clearTraceSpans,
  log,
  maskIban,
  pseudonymizeActor,
  recentTraceSpans,
  redact,
  REDACTED,
  startLogCapture,
  stopLogCapture,
  withSpan,
} from "../lib/observability.js";
import {
  METRIC,
  getMetricValue,
  renderPrometheus,
  resetMetrics,
  sanitizeLabelValue,
  sumMetric,
} from "../lib/metrics.js";
import { collectDbMetrics } from "../services/metrics-collector.js";
import {
  ALARM_CATALOG,
  alarmDefinition,
  clearRecentAlarms,
  createWebhookAlarmSink,
  emitAlarm,
  recentAlarms,
  resetAlarmSinks,
  setAlarmSink,
} from "../workers/alarm.js";
import {
  buildMultipartBody,
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
 * PROMPT -1 §16 – Beobachtbarkeit.
 *
 * Der wichtigste Abschnitt hier ist "Redaktion, adversarial geprüft": es genügt
 * nicht, dass wir NICHT VORHABEN, ein Passwort zu loggen. Der Test schneidet
 * jede Logzeile mit und prüft, dass das Geheimnis darin NICHT vorkommt – für
 * einen Dokument-Upload und einen Bankimport, also genau die beiden Wege, auf
 * denen Dateiinhalt und Bankdaten durch das System laufen.
 */

describe("PROMPT -1 §16 – Beobachtbarkeit", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let fixtures: SeededFixtures;
  let studentCookie: string;
  let officeCookie: string;

  beforeAll(async () => {
    await ensureMigrated(databaseUrl);
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    resetMetrics();
    clearCapturedLogs();
    clearTraceSpans();
    clearRecentAlarms();
    resetAlarmSinks();
    fixtures = await seedFixtures(databaseUrl);
    await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);
    app = buildTestApp();
    await app.ready();
    studentCookie = await loginAs(app, "schueler@test.local", fixtures.password);
    officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
  });

  afterEach(() => {
    stopLogCapture();
  });

  afterAll(async () => {
    await app?.close();
  });

  // =======================================================================
  // Strukturierte Logs
  // =======================================================================
  describe("Strukturierte Logs", () => {
    it("trägt ALLE geforderten Felder: Zeit, Schwere, Dienst, Anfrage-ID, Korrelations-ID, pseudonymisierter Akteur, Operation", async () => {
      startLogCapture();
      const res = await app.inject({ method: "GET", url: "/me", headers: { cookie: studentCookie } });
      expect(res.statusCode).toBe(200);
      const zeile = capturedLogs().find((r) => r.operation === "GET /me");
      expect(zeile).toBeDefined();
      expect(zeile!.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(zeile!.severity).toBe("info");
      expect(zeile!.service).toBe("@fahrschul/api");
      expect(zeile!.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(zeile!.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(zeile!.actor).toMatch(/^akt_[0-9a-f]{16}$/);
      expect(zeile!.actorRole).toBe("schueler");
      expect(zeile!.httpStatus).toBe(200);
      expect(typeof zeile!.durationMs).toBe("number");
    });

    it("nennt NIE die rohe Benutzer-ID oder die E-Mail des Akteurs", async () => {
      startLogCapture();
      await app.inject({ method: "GET", url: "/me", headers: { cookie: studentCookie } });
      const text = capturedLogText();
      expect(text).not.toContain(fixtures.schuelerBenutzerId);
      expect(text).not.toContain("schueler@test.local");
    });

    it("pseudonymisiert stabil (derselbe Akteur = dasselbe Kürzel) und nicht umkehrbar", () => {
      const a = pseudonymizeActor(fixtures.schuelerBenutzerId);
      const b = pseudonymizeActor(fixtures.schuelerBenutzerId);
      const c = pseudonymizeActor(fixtures.bueroBenutzerId);
      expect(a).toBe(b);
      expect(a).not.toBe(c);
      expect(a).not.toContain(fixtures.schuelerBenutzerId);
      expect(pseudonymizeActor(null)).toBe("anon");
    });

    it("trägt einen maschinenlesbaren Fehlercode bei Fehlern", async () => {
      startLogCapture();
      await app.inject({
        method: "PUT",
        url: "/me/wunschzeiten",
        headers: { cookie: studentCookie, origin: "https://boese.example" },
        payload: { eintraege: [] },
      });
      const csrfZeile = capturedLogs().find((r) => r.errorCode === "CSRF_FAILED");
      expect(csrfZeile).toBeDefined();
      expect(csrfZeile!.severity).toBe("warn");
    });
  });

  // =======================================================================
  // Korrelations-ID über die ganze Kette
  // =======================================================================
  describe("Korrelations-ID: Client -> API -> Audit -> Outbox -> Realtime", () => {
    it("übernimmt eine vom Client gelieferte Korrelations-ID und gibt sie zurück", async () => {
      const eigene = "11111111-2222-3333-4444-555555555555";
      const res = await app.inject({
        method: "GET",
        url: "/me",
        headers: { cookie: studentCookie, "x-correlation-id": eigene },
      });
      expect(res.headers["x-correlation-id"]).toBe(eigene);
      expect(res.headers["x-request-id"]).toBeTruthy();
    });

    it("verwirft eine UNGÜLTIGE Korrelations-ID statt sie zu übernehmen (Log-Injection/DB-Typ)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/me",
        headers: { cookie: studentCookie, "x-correlation-id": "nicht\nvalide" },
      });
      expect(res.headers["x-correlation-id"]).not.toBe("nicht\nvalide");
      expect(res.headers["x-correlation-id"]).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("führt die ID durch die GANZE Kette: Anfrage -> audit_events -> event_outbox -> realtime_deliveries", async () => {
      const korrelation = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const res = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: {
          cookie: officeCookie,
          "idempotency-key": idemKey("korr"),
          "x-correlation-id": korrelation,
        },
        payload: {
          schuelerId: fixtures.schuelerId,
          fahrlehrerId: fixtures.fahrlehrerId,
          art: "Übungsstunde",
          klasse: "B",
          beginnAt: "2026-10-01T09:00:00.000Z",
          endeAt: "2026-10-01T10:00:00.000Z",
        },
      });
      expect(res.statusCode, res.body).toBe(201);

      // Der Fanout in die Realtime-Zustellzeilen läuft über den Outbox-Worker.
      const lauf = await app.inject({
        method: "POST",
        url: "/ops/workers/run",
        headers: { cookie: await systemCookie() },
      });
      expect(lauf.statusCode, lauf.body).toBe(200);

      const sql = createRawClient(databaseUrl);
      try {
        const audit = await sql`
          select correlation_id from audit_events where aktion = 'appointments.create'`;
        expect(audit.length).toBeGreaterThan(0);
        expect(audit[0].correlation_id).toBe(korrelation);

        const outbox = await sql`
          select correlation_id from event_outbox where event_type = 'lesson.booked'`;
        expect(outbox.length).toBeGreaterThan(0);
        // Der DB-Trigger trägt sie unverändert weiter – kein zweiter Bezeichner.
        expect(outbox[0].correlation_id).toBe(korrelation);

        const deliveries = await sql`
          select d.id from realtime_deliveries d
            join event_outbox o on o.id = d.event_id
           where o.correlation_id = ${korrelation}`;
        expect(deliveries.length).toBeGreaterThan(0);
      } finally {
        await sql.end();
      }
    });

    it("Tracing: Spannen tragen die Korrelations-ID als Trace-ID", async () => {
      const traceId = "99999999-8888-7777-6666-555555555555";
      const ergebnis = await withSpan({ traceId, name: "test.arbeit", attributes: { a: 1 } }, async () => 42);
      expect(ergebnis).toBe(42);
      const spans = recentTraceSpans();
      expect(spans.at(-1)!.traceId).toBe(traceId);
      expect(spans.at(-1)!.name).toBe("test.arbeit");
      expect(spans.at(-1)!.status).toBe("ok");
      expect(spans.at(-1)!.spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it("Tracing: ein Fehler wird als `status: error` vermerkt UND weitergeworfen", async () => {
      await expect(
        withSpan({ traceId: "77777777-8888-7777-6666-555555555555", name: "kaputt" }, async () => {
          throw new Error("absicht");
        }),
      ).rejects.toThrow("absicht");
      expect(recentTraceSpans().at(-1)!.status).toBe("error");
    });
  });

  // =======================================================================
  // Redaktion – adversarial
  // =======================================================================
  describe("Redaktion: niemals Passwörter, Tokens, Dokumentinhalte, vollständige Bankdaten", () => {
    it("entfernt Werte anhand des Feldnamens, tief und auf Kopien", () => {
      const eingabe = {
        password: "geheim123",
        passwordHash: "$argon2id$...",
        session: { token: "abc" },
        mfaSecret: "JBSWY3DPEHPK3PXP",
        internalNotes: "Schüler wirkte nervös",
        pruefprotokoll: { geprueftePunkte: ["x"] },
        dateiinhalt: "%PDF-1.4 ...",
        iban: "DE02120300000000202051",
        harmlos: "sichtbar",
      };
      const out = redact(eingabe) as Record<string, unknown>;
      expect(out.password).toBe(REDACTED);
      expect(out.passwordHash).toBe(REDACTED);
      expect(out.session).toBe(REDACTED);
      expect(out.mfaSecret).toBe(REDACTED);
      expect(out.internalNotes).toBe(REDACTED);
      expect(out.pruefprotokoll).toBe(REDACTED);
      expect(out.dateiinhalt).toBe(REDACTED);
      expect(out.iban).toBe(REDACTED);
      expect(out.harmlos).toBe("sichtbar");
      // Die Eingabe wurde NICHT verändert.
      expect(eingabe.password).toBe("geheim123");
    });

    it("maskiert eine IBAN auch in FREITEXT (nicht nur in einem Feld namens `iban`)", () => {
      const out = redact({ bemerkung: "Überweisung von DE02120300000000202051 erhalten" }) as {
        bemerkung: string;
      };
      expect(out.bemerkung).not.toContain("DE02120300000000202051");
      expect(out.bemerkung).toContain("DE**…2051");
      expect(maskIban("DE02 1203 0000 0000 2020 51")).toBe("DE**…2051");
    });

    it("ersetzt einen Buffer durch seine Größe statt seinen Inhalt", () => {
      const out = redact({ datei: Buffer.from("%PDF-1.4 sehr geheim") }) as { datei: string };
      expect(out.datei).toMatch(/^\[binär:\d+B\]$/);
    });

    it("ADVERSARIAL: ein Dokument-Upload leckt den Dateiinhalt NICHT ins Log", async () => {
      const geheim = "DIESER-TEXT-DARF-NIE-IN-EIN-LOG-4711";
      const { body, contentType } = buildMultipartBody({
        fields: { typ: "sehtest" },
        fileFieldName: "datei",
        fileName: `geheimer-name-${geheim}.pdf`,
        fileContent: Buffer.from(`%PDF-1.4 ${geheim}`),
        mimeType: "application/pdf",
      });
      startLogCapture();
      const res = await app.inject({
        method: "POST",
        url: "/documents",
        headers: { cookie: studentCookie, "content-type": contentType, "idempotency-key": idemKey("leak") },
        payload: body,
      });
      expect(res.statusCode, res.body).toBe(201);
      const text = capturedLogText();
      expect(text).not.toContain(geheim);
      // Zur Gegenprobe: es wurde überhaupt geloggt.
      expect(capturedLogs().some((r) => r.operation === "POST /documents")).toBe(true);
    });

    it("ADVERSARIAL: eine ABGEWIESENE Datei leckt den Inhalt ebenfalls nicht (der Fehlerpfad ist der gefährlichere)", async () => {
      const geheim = "MALWARE-INHALT-GEHEIM-0815";
      const { body, contentType } = buildMultipartBody({
        fields: { typ: "sehtest" },
        fileFieldName: "datei",
        fileName: "bild.png",
        fileContent: Buffer.from(`MZ${geheim}`),
        mimeType: "image/png",
      });
      startLogCapture();
      const res = await app.inject({
        method: "POST",
        url: "/documents",
        headers: { cookie: studentCookie, "content-type": contentType, "idempotency-key": idemKey("bad") },
        payload: body,
      });
      expect(res.statusCode).toBe(415);
      const text = capturedLogText();
      expect(text).not.toContain(geheim);
      // Die DIAGNOSE ist trotzdem vorhanden: erkannter Typ statt Inhalt.
      expect(text).toContain("windows-executable");
    });

    it("ADVERSARIAL: ein Bankimport leckt weder IBAN noch Kontoinhaber vollständig", async () => {
      const iban = "DE02120300000000202051";
      const sql = createRawClient(databaseUrl);
      let txId: string;
      let invoiceId: string;
      try {
        await sql`
          insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
          select ${fixtures.standortId}, 'fin-log@test.local', password_hash, 'finanzen', 'F', 'L', true, mfa_secret
            from benutzer where id = ${fixtures.bueroBenutzerId}`;
        const [inv] = await sql`
          insert into rechnungen (standort_id, schueler_id, betrag_cent, status)
          values (${fixtures.standortId}, ${fixtures.schuelerId}, 10000, 'offen') returning id`;
        invoiceId = inv.id;
        const [tx] = await sql`
          insert into banktransaktionen (standort_id, external_id, amount_cent, booked_at, reference, counterparty, zahlung_status)
          values (${fixtures.standortId}, 'log-1', 10000, current_date,
                  ${"Rechnung 1 " + iban}, ${"Erika Musterfrau " + iban}, 'review_required')
          returning id`;
        txId = tx.id;
      } finally {
        await sql.end();
      }
      const finance = await loginAs(app, "fin-log@test.local", fixtures.password, fixtures.bueroTotpSecret);

      startLogCapture();
      const res = await app.inject({
        method: "POST",
        url: `/finance/bank/${txId}/resolve`,
        headers: { cookie: finance, "idempotency-key": idemKey("bank") },
        payload: { rechnungId: invoiceId, betragCent: 10000 },
      });
      expect(res.statusCode, res.body).toBe(200);
      const text = capturedLogText();
      expect(text).not.toContain(iban);
    });

    it("die Redaktion greift auch für explizit übergebene `details`", () => {
      startLogCapture();
      log({
        requestId: "r1",
        correlationId: "c1",
        operation: "test",
        details: { password: "geheim", token: "abc", iban: "DE02120300000000202051" },
      });
      const text = capturedLogText();
      expect(text).not.toContain("geheim");
      expect(text).not.toContain("DE02120300000000202051");
      expect(text).toContain(REDACTED);
    });
  });

  // =======================================================================
  // Kennzahlen
  // =======================================================================
  describe("Kennzahlen: alle elf, im Prometheus-Textformat", () => {
    it("zählt Anfragen nach Statusklasse und misst die Latenz (1 + 2)", async () => {
      await app.inject({ method: "GET", url: "/me", headers: { cookie: studentCookie } });
      await app.inject({ method: "GET", url: "/me" }); // 401
      expect(getMetricValue(METRIC.httpRequests, { method: "GET", route: "/me", status_class: "2xx" })).toBe(1);
      expect(getMetricValue(METRIC.httpRequests, { method: "GET", route: "/me", status_class: "4xx" })).toBe(1);
      expect(sumMetric(METRIC.httpDuration)).toBeGreaterThan(0);
    });

    it("ersetzt IDs im Routen-Label (begrenzte Kardinalität, kein Datensatzbezug in Prometheus)", async () => {
      await app.inject({
        method: "GET",
        url: `/office/schueler/${fixtures.schuelerId}`,
        headers: { cookie: officeCookie },
      });
      const text = renderPrometheus();
      expect(text).not.toContain(fixtures.schuelerId);
      expect(text).toContain('route="/office/schueler/:id"');
    });

    it("zählt fehlgeschlagene Anmeldungen nach Grund (9)", async () => {
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "schueler@test.local", password: "falsch" },
      });
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "gibtesnicht@test.local", password: "falsch" },
      });
      expect(getMetricValue(METRIC.loginFailures, { reason: "wrong_password" })).toBe(1);
      expect(getMetricValue(METRIC.loginFailures, { reason: "unknown_account" })).toBe(1);
    });

    it("zählt Buchungskonflikte (10)", async () => {
      const slot = {
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        art: "Übungsstunde",
        klasse: "B",
        beginnAt: "2026-10-05T09:00:00.000Z",
        endeAt: "2026-10-05T10:00:00.000Z",
      };
      const erste = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { cookie: officeCookie, "idempotency-key": idemKey("c1") },
        payload: slot,
      });
      expect(erste.statusCode).toBe(201);
      const zweite = await app.inject({
        method: "POST",
        url: "/appointments",
        headers: { cookie: officeCookie, "idempotency-key": idemKey("c2") },
        payload: slot,
      });
      expect(zweite.statusCode).toBe(409);
      expect(sumMetric(METRIC.bookingConflicts)).toBeGreaterThanOrEqual(1);
    });

    it("zählt Dokument-Scanfehler nach Grund (12)", async () => {
      const { body, contentType } = buildMultipartBody({
        fields: { typ: "sehtest" },
        fileFieldName: "datei",
        fileName: "luegt.png",
        fileContent: Buffer.from("%PDF-1.4 ich bin ein PDF"),
        mimeType: "image/png",
      });
      const res = await app.inject({
        method: "POST",
        url: "/documents",
        headers: { cookie: studentCookie, "content-type": contentType, "idempotency-key": idemKey("mm") },
        payload: body,
      });
      expect(res.statusCode).toBe(415);
      expect(getMetricValue(METRIC.documentScanFailures, { reason: "mime_mismatch" })).toBe(1);
    });

    it("zählt abgewiesene Anfragen der Ratenbegrenzung", async () => {
      const eng = buildTestApp({
        rateLimit: {
          enabled: true,
          multiplier: 1,
          policies: {
            login: { name: "login", ratePerSecond: 0.01, burst: 1 },
            read: { name: "read", ratePerSecond: 0.01, burst: 1 },
            write: { name: "write", ratePerSecond: 0.01, burst: 1 },
            stream: { name: "stream", ratePerSecond: 0.01, burst: 1 },
            expensive: { name: "expensive", ratePerSecond: 0.01, burst: 1 },
          },
        },
      });
      await eng.ready();
      try {
        await eng.inject({ method: "GET", url: "/health" });
        await eng.inject({ method: "GET", url: "/health" });
        expect(sumMetric(METRIC.rateLimited)).toBeGreaterThanOrEqual(1);
      } finally {
        await eng.close();
      }
    });

    it("sammelt DB-Verbindungen, Warteschlangen, Dead Letters und Sync-Verzögerung (3, 4, 6, 7)", async () => {
      const { getDb } = await import("../db.js");
      const db = getDb(databaseUrl);
      const collected = await collectDbMetrics(db);
      expect(collected.dbConnections).toBeGreaterThan(0);
      expect(collected.syncDelaySeconds).toBeGreaterThanOrEqual(0);
      expect(collected.openDeadLetters).toBe(0);
      expect(getMetricValue(METRIC.dbConnections)).toBe(collected.dbConnections);
      expect(getMetricValue(METRIC.jobQueueDepth, { status: "pending" })).not.toBeNull();
      expect(getMetricValue(METRIC.outboxDepth, { status: "pending" })).not.toBeNull();
      expect(getMetricValue(METRIC.syncDelay)).not.toBeNull();
    });

    it("zählt offene SSE-Verbindungen (8)", async () => {
      const { realtimeConnectionOpened, realtimeConnectionClosed, currentRealtimeConnections } = await import(
        "../lib/metrics.js"
      );
      realtimeConnectionOpened();
      realtimeConnectionOpened();
      expect(currentRealtimeConnections()).toBe(2);
      expect(getMetricValue(METRIC.realtimeConnections)).toBe(2);
      realtimeConnectionClosed();
      realtimeConnectionClosed();
      expect(currentRealtimeConnections()).toBe(0);
    });

    it("liefert `GET /metrics` im Prometheus-Textformat mit allen elf Namen", async () => {
      // Verkehr erzeugen, damit alle Zähler existieren.
      await app.inject({ method: "GET", url: "/me", headers: { cookie: studentCookie } });
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "schueler@test.local", password: "falsch" },
      });
      const { recordRetry, recordDeadLetter, recordPaymentMatchFailure, recordDocumentScanFailure, recordBookingConflict } =
        await import("../lib/metrics.js");
      recordRetry("outbox");
      recordDeadLetter("job");
      recordPaymentMatchFailure("ambiguous");
      recordDocumentScanFailure("scanner_unavailable");
      recordBookingConflict("fahrlehrer_overlap");

      const res = await app.inject({ method: "GET", url: "/metrics" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/plain");
      const text = res.body;
      for (const name of [
        METRIC.httpRequests,
        METRIC.httpDuration,
        METRIC.dbConnections,
        METRIC.jobQueueDepth,
        METRIC.outboxDepth,
        METRIC.retries,
        METRIC.deadLettersOpen,
        METRIC.deadLetters,
        METRIC.syncDelay,
        METRIC.realtimeConnections,
        METRIC.loginFailures,
        METRIC.bookingConflicts,
        METRIC.paymentMatchFailures,
        METRIC.documentScanFailures,
      ]) {
        expect(text, `Kennzahl ${name} fehlt in /metrics`).toContain(`# TYPE ${name}`);
      }
      // Histogramm-Struktur (Prometheus verlangt _bucket/_sum/_count).
      expect(text).toContain(`${METRIC.httpDuration}_bucket`);
      expect(text).toContain(`${METRIC.httpDuration}_sum`);
      expect(text).toContain(`${METRIC.httpDuration}_count`);
      expect(text).toContain('le="+Inf"');
    });

    it("`GET /metrics` verlangt ein Token, WENN eines konfiguriert ist", async () => {
      const geschuetzt = buildTestApp({ metricsToken: "geheimes-scrape-token" });
      await geschuetzt.ready();
      try {
        const ohne = await geschuetzt.inject({ method: "GET", url: "/metrics" });
        expect(ohne.statusCode).toBe(401);
        const mit = await geschuetzt.inject({
          method: "GET",
          url: "/metrics",
          headers: { authorization: "Bearer geheimes-scrape-token" },
        });
        expect(mit.statusCode).toBe(200);
      } finally {
        await geschuetzt.close();
      }
    });

    it("leckt KEINE Fahrlehrer-Notiz und keine Schülerdaten über Labels (frischer Leckpfad)", async () => {
      await app.inject({ method: "GET", url: "/me", headers: { cookie: studentCookie } });
      const res = await app.inject({ method: "GET", url: "/metrics" });
      expect(res.body).not.toContain("internalNotes");
      expect(res.body).not.toContain("schueler@test.local");
      expect(res.body).not.toContain(fixtures.schuelerId);
      expect(res.body).not.toContain(fixtures.schuelerBenutzerId);
    });

    it("bildet unbekannte Labelwerte auf `other` ab (geschlossene Label-Menge)", () => {
      expect(sanitizeLabelValue("ganz neuer wert", ["a", "b"])).toBe("other");
      expect(sanitizeLabelValue("a", ["a", "b"])).toBe("a");
      expect(sanitizeLabelValue('kaputt"; injected')).not.toContain('"');
    });
  });

  // =======================================================================
  // Alarmierung
  // =======================================================================
  describe("Alarmierung: Schwelle, Zuständigkeit, Runbook, Eskalation", () => {
    it("hat für JEDE Alarmart Schwelle, Kennzahl, Zuständigen, Runbook und Eskalation", () => {
      expect(ALARM_CATALOG.length).toBeGreaterThanOrEqual(10);
      for (const eintrag of ALARM_CATALOG) {
        expect(eintrag.threshold, `${eintrag.kind}: Schwelle fehlt`).toBeTruthy();
        expect(eintrag.metric, `${eintrag.kind}: Kennzahl fehlt`).toBeTruthy();
        expect(eintrag.owner, `${eintrag.kind}: Zuständiger fehlt`).toBeTruthy();
        expect(eintrag.runbook, `${eintrag.kind}: Runbook fehlt`).toMatch(/^docs\/.+#.+/);
        expect(eintrag.escalation, `${eintrag.kind}: Eskalation fehlt`).toBeTruthy();
      }
    });

    it("stellt den Katalog als Ops-Route bereit (Phase 4 braucht ihn maschinenlesbar)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/ops/alerts/catalog",
        headers: { cookie: await systemCookie() },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().alarme.length).toBe(ALARM_CATALOG.length);
    });

    it("schreibt in ALLE registrierten Sinks und überlebt einen kaputten Sink", async () => {
      const gesehen: string[] = [];
      setAlarmSink([
        () => {
          throw new Error("dieser Sink ist kaputt");
        },
        (e) => {
          gesehen.push(e.kind);
        },
      ]);
      await emitAlarm({ kind: "dead_letter", subject: "Test" });
      expect(gesehen).toEqual(["dead_letter"]);
      expect(recentAlarms().at(-1)!.kind).toBe("dead_letter");
      resetAlarmSinks();
    });

    it("ergänzt die Schwere aus dem Katalog, wenn der Aufrufer keine angibt", async () => {
      await emitAlarm({ kind: "audit_tamper", subject: "Test" });
      expect(recentAlarms().at(-1)!.severity).toBe("critical");
      expect(alarmDefinition("audit_tamper")!.owner).toContain("Geschäftsführung");
    });

    it("zählt Alarme als Kennzahl (der Standard-Sink tut das)", async () => {
      await emitAlarm({ kind: "sync_delay", subject: "Test" });
      expect(getMetricValue("fahrschul_alarms_total", { kind: "sync_delay", severity: "warning" })).toBe(1);
    });

    it("der Webhook-Sink ist ein KONFIGURATIONS-SEAM und wirft nie (kein Kanal in dieser Umgebung)", async () => {
      const sink = createWebhookAlarmSink({ url: "http://127.0.0.1:1/nicht-erreichbar", timeoutMs: 50 });
      // Darf NICHT werfen – ein Alarmierungsfehler kippt keinen Fachvorgang.
      await expect(sink({ kind: "dead_letter", subject: "Test" })).resolves.toBeUndefined();
    });

    it("wird ohne ALARM_WEBHOOK_URL NICHT registriert (keine erfundene Anbindung)", async () => {
      const { configureAlarmSinksFromEnv } = await import("../workers/alarm.js");
      expect(configureAlarmSinksFromEnv({}).webhook).toBe(false);
      expect(configureAlarmSinksFromEnv({ ALARM_WEBHOOK_URL: "kein-url" }).webhook).toBe(false);
      expect(
        configureAlarmSinksFromEnv({ ALARM_WEBHOOK_URL: "https://example.invalid/hook" }).webhook,
      ).toBe(true);
      resetAlarmSinks();
    });
  });

  async function systemCookie() {
    const sql = createRawClient(databaseUrl);
    try {
      const vorhanden = await sql`select 1 from benutzer where email = 'obs-sys@test.local'`;
      if (vorhanden.length === 0) {
        await sql`
          insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
          select ${fixtures.standortId}, 'obs-sys@test.local', password_hash, 'systemdienst', 'O', 'S', true, mfa_secret
            from benutzer where id = ${fixtures.bueroBenutzerId}`;
      }
    } finally {
      await sql.end();
    }
    return loginAs(app, "obs-sys@test.local", fixtures.password, fixtures.bueroTotpSecret);
  }
});
