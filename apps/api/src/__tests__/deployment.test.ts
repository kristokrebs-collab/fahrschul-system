import { createRawClient } from "@fahrschul/database";
import {
  DestructiveMigrationBlocked,
  findDestructiveStatements,
  pendingMigrations,
  runMigrations,
} from "@fahrschul/database";
import type { FastifyInstance } from "fastify";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { deploymentIdentity, resetDeploymentIdentity, uptimeSeconds } from "../lib/deployment.js";
import { capturedLogs, clearCapturedLogs, startLogCapture, stopLogCapture } from "../lib/observability.js";
import { createScheduler } from "../workers/scheduler.js";
import { ALARM_CATALOG, clearRecentAlarms, recentAlarms } from "../workers/alarm.js";
import { getDb } from "../db.js";
import { createNotificationsAdapter } from "@fahrschul/integrations";

/**
 * PROMPT -1 §15 (Phase 4) – Sichere Deployments.
 *
 * Diese Datei prüft die fünf Zusagen, die §15 macht und die vor Phase 4
 * entweder fehlten oder nur behauptet waren:
 *
 *  1. **Deployment-ID in Logs und Fehlerberichten.**
 *  2. **Bereitschafts- und Lebendprüfung, korrekt getrennt** – Liveness ohne
 *     I/O, Readiness mit DB UND Migrationsstand, `/health/deep` weiterhin 200
 *     bei degradierten Integrationen.
 *  3. **Der Scheduler läuft wirklich** – die von Phase 1–3 verschobene
 *     Verdrahtung, mit einem tatsächlich beobachteten Effekt in der Datenbank.
 *  4. **Rückwärtskompatible Migrationen** – nicht nur für 0009 (Phase 3 prüfte
 *     nur diese eine Datei), sondern für ALLE Migrationen dieses Projekts.
 *  5. **Keine zerstörende Migration ohne Backup und Freigabe** – als Tor im
 *     Läufer, nicht als Absichtserklärung im Dokument.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "packages", "database", "migrations");

describe("PROMPT -1 §15 – Deployment-Identität", () => {
  const alt = { ...process.env };

  afterEach(() => {
    process.env = { ...alt };
    resetDeploymentIdentity();
  });

  it("übernimmt DEPLOYMENT_ID, GIT_COMMIT, RELEASE_CHANNEL und APP_VERSION aus der Umgebung", () => {
    process.env.DEPLOYMENT_ID = "rel-2026-07-26-01";
    process.env.GIT_COMMIT = "abcdef1234567890";
    process.env.RELEASE_CHANNEL = "staging";
    process.env.APP_VERSION = "1.2.3";
    resetDeploymentIdentity();

    const id = deploymentIdentity();
    expect(id.deploymentId).toBe("rel-2026-07-26-01");
    expect(id.gitCommit).toBe("abcdef1234567890");
    expect(id.releaseChannel).toBe("staging");
    expect(id.version).toBe("1.2.3");
    expect(uptimeSeconds()).toBeGreaterThanOrEqual(0);
  });

  it("fällt ohne DEPLOYMENT_ID auf den Commit zurück und markiert eine erfundene ID als `dev-`", () => {
    delete process.env.DEPLOYMENT_ID;
    process.env.GIT_COMMIT = "0123456789abcdef";
    resetDeploymentIdentity();
    expect(deploymentIdentity().deploymentId).toBe("0123456789ab");

    delete process.env.GIT_COMMIT;
    resetDeploymentIdentity();
    // Eine generierte ID MUSS als solche erkennbar sein – sonst sieht ein
    // Entwicklungslauf in einer Auswertung wie ein echtes Release aus.
    expect(deploymentIdentity().deploymentId).toMatch(/^dev-[0-9a-f]{8}$/);
  });

  it("fällt bei unbekanntem RELEASE_CHANNEL auf `unknown` zurück, NICHT auf `production`", () => {
    process.env.RELEASE_CHANNEL = "irgendwas";
    resetDeploymentIdentity();
    expect(deploymentIdentity().releaseChannel).toBe("unknown");

    delete process.env.RELEASE_CHANNEL;
    resetDeploymentIdentity();
    expect(deploymentIdentity().releaseChannel).toBe("unknown");
  });

  it("unterscheidet instanceId je Prozess von der deploymentId je Rollout", () => {
    process.env.DEPLOYMENT_ID = "rel-gleich";
    resetDeploymentIdentity();
    const a = deploymentIdentity();
    resetDeploymentIdentity();
    const b = deploymentIdentity();
    // Zwei "Prozesse", dasselbe Release: Rollout-ID gleich, Instanz-ID nicht.
    expect(b.deploymentId).toBe(a.deploymentId);
    expect(b.instanceId).not.toBe(a.instanceId);
  });
});

describe("PROMPT -1 §15 – Deployment-ID in Logs, Kopfzeilen und Fehlerberichten", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let fixtures: SeededFixtures;

  beforeAll(async () => {
    await ensureMigrated(databaseUrl);
    process.env.DEPLOYMENT_ID = "rel-test-deploy";
    process.env.RELEASE_CHANNEL = "staging";
    resetDeploymentIdentity();
    app = buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DEPLOYMENT_ID;
    delete process.env.RELEASE_CHANNEL;
    resetDeploymentIdentity();
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    fixtures = await seedFixtures(databaseUrl);
  });

  it("setzt `x-deployment-id` auf JEDER Antwort – auch auf einer 401", async () => {
    const ok = await app.inject({ method: "GET", url: "/health" });
    expect(ok.headers["x-deployment-id"]).toBe("rel-test-deploy");

    const abgewiesen = await app.inject({ method: "GET", url: "/sync/cursor" });
    expect(abgewiesen.statusCode).toBe(401);
    // Genau der Fall, der bei einer onSend-Implementierung verloren gehen
    // würde: eine früh abgebrochene Anfrage.
    expect(abgewiesen.headers["x-deployment-id"]).toBe("rel-test-deploy");
  });

  it("hängt deploymentId, instanceId und releaseChannel an JEDE Logzeile", async () => {
    startLogCapture();
    clearCapturedLogs();
    try {
      await app.inject({ method: "GET", url: "/health" });
      const zeilen = capturedLogs();
      expect(zeilen.length).toBeGreaterThan(0);
      for (const zeile of zeilen) {
        expect(zeile.deploymentId).toBe("rel-test-deploy");
        expect(zeile.releaseChannel).toBe("staging");
        expect(typeof zeile.instanceId).toBe("string");
      }
    } finally {
      stopLogCapture();
    }
  });

  it("liefert einen Fehlerbericht mit deploymentId, requestId und correlationId – ohne Interna", async () => {
    // Kaputtes JSON erzeugt einen Fastify-Parserfehler, der VOR jedem Handler
    // auftritt und deshalb ausschließlich vom globalen Fehlerbehandler bedient
    // wird (vorher: Fastifys Standardantwort ohne Deployment-Bezug).
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      payload: '{"email": "kaputt',
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const body = res.json();
    expect(body.deploymentId).toBe("rel-test-deploy");
    expect(body.requestId).toBeTruthy();
    expect(body.correlationId).toBeTruthy();
  });

  it("liefert bei einem UNBEHANDELTEN Fehler 500 `internal_error` ohne die Originalmeldung", async () => {
    const eigen = buildTestApp();
    eigen.get("/__boom", async () => {
      throw new Error("interne Spaltennamen und Nutzlastfetzen: schueler.geheim");
    });
    await eigen.ready();
    try {
      const res = await eigen.inject({ method: "GET", url: "/__boom" });
      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.error).toBe("internal_error");
      expect(body.deploymentId).toBe("rel-test-deploy");
      // Die Originalmeldung gehört ins Log, nicht in die Antwort.
      expect(res.body).not.toContain("schueler.geheim");
    } finally {
      await eigen.close();
    }
  });
});

describe("PROMPT -1 §15 – Bereitschaft und Lebendigkeit", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;

  beforeAll(async () => {
    await ensureMigrated(databaseUrl);
    app = buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("`GET /health/live` antwortet 200 und trägt Deployment- und Instanzangaben", async () => {
    const res = await app.inject({ method: "GET", url: "/health/live" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.deploymentId).toBeTruthy();
    expect(body.instanceId).toBeTruthy();
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("`GET /health/ready` antwortet 200, wenn Datenbank erreichbar UND Schema aktuell ist", async () => {
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ready");
    expect(body.datenbank).toBe("erreichbar");
    expect(body.offeneMigrationen).toBe(0);
  });

  it("`GET /health/ready` antwortet 503 mit Grund, wenn die Datenbank nicht erreichbar ist", async () => {
    // Ein Port, auf dem nichts lauscht – die Bereitschaft muss das MERKEN und
    // darf nicht 200 melden, sonst schickt ein Loadbalancer Verkehr ins Leere.
    const kaputt = buildTestApp();
    // Eigene App mit unerreichbarer DB nur für die Readiness-Prüfung:
    const { buildApp } = await import("../app.js");
    const unerreichbar = buildApp({
      databaseUrl: "postgres://fahrschul:fahrschul_dev_pw@127.0.0.1:59999/nichts",
      cookieSecure: false,
      logger: false,
      rateLimit: false,
      startWorkers: false,
    });
    await unerreichbar.ready();
    try {
      const res = await unerreichbar.inject({ method: "GET", url: "/health/ready" });
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.status).toBe("not_ready");
      expect(body.datenbank).toBe("nicht erreichbar");
      expect(body.grund).toBe("datenbank_nicht_erreichbar");
      // Die wichtigste Zeile der Antwort: NICHT neu starten.
      expect(body.hinweis).toContain("NICHT neu starten");
    } finally {
      await unerreichbar.close();
      await kaputt.close();
    }
  }, 20000);

  it("`GET /health/live` fasst die Datenbank NICHT an (kein Ausfallverstärker)", async () => {
    const { buildApp } = await import("../app.js");
    const unerreichbar = buildApp({
      databaseUrl: "postgres://fahrschul:fahrschul_dev_pw@127.0.0.1:59999/nichts",
      cookieSecure: false,
      logger: false,
      rateLimit: false,
      startWorkers: false,
    });
    await unerreichbar.ready();
    try {
      // Genau der Fall, in dem eine DB-abhängige Liveness-Probe ALLE Instanzen
      // töten und beim Zurückkommen der DB eine Kaltstartwelle erzeugen würde.
      const res = await unerreichbar.inject({ method: "GET", url: "/health/live" });
      expect(res.statusCode).toBe(200);
    } finally {
      await unerreichbar.close();
    }
  }, 20000);

  it("`GET /health/deep` bleibt 200, wenn nur eine INTEGRATION ausgefallen ist (Phase-3-Zusage, hier nachgeprüft)", async () => {
    await truncateAll(databaseUrl);
    const fixtures = await seedFixtures(databaseUrl);
    await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);

    // Breaker von Hand öffnen – §11 stellt einen Ausfall deterministisch her.
    const sql = createRawClient(databaseUrl);
    try {
      await sql`update integration_health set breaker_state = 'open', opened_at = now(),
        probe_after = now() + interval '5 minutes' where integration = 'notifications'`;
    } finally {
      await sql.end();
    }

    const res = await app.inject({ method: "GET", url: "/health/deep" });
    // 503 wäre hier ein Fehler: der Loadbalancer würde eine funktionierende
    // Instanz herausnehmen und aus der Degradation einen Totalausfall machen.
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("eingeschraenkt");
    expect(body.datenbank).toBe("erreichbar");
    expect(body.ausgefallen).toContain("notifications");
    expect(body.kern).toContain("nutzbar");
  });
});

describe("PROMPT -1 §15 – der Scheduler (die von Phase 1–3 verschobene Verdrahtung)", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let fixtures: SeededFixtures;

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
    clearRecentAlarms();
  });

  function bauScheduler(overrides: Parameters<typeof createScheduler>[1] = {}) {
    return createScheduler(
      { db: getDb(databaseUrl), notifications: createNotificationsAdapter("mock") },
      { batchLimit: 25, ...overrides },
    );
  }

  it("plant die wiederkehrenden Jobs per Einplanungstakt TATSÄCHLICH ein (vorher rief das niemand)", async () => {
    const sql = createRawClient(databaseUrl);
    try {
      const vorher = await sql`select count(*)::int as n from jobs`;
      expect(vorher[0].n).toBe(0);

      const scheduler = bauScheduler();
      await scheduler.runScheduleTick();

      const nachher = await sql`select distinct job_type from jobs order by job_type`;
      const typen = nachher.map((r: { job_type: string }) => r.job_type);
      // Die Jobs, deren Fehlen ohne Scheduler am meisten weh tut.
      expect(typen).toContain("outbox.dispatch");
      expect(typen).toContain("appointment_offer.expire");
      expect(typen).toContain("integration.resume");
      expect(typen).toContain("consistency.check");
      expect(typen).toContain("audit.verify");
      expect(scheduler.stats().scheduledJobs).toBeGreaterThanOrEqual(14);
    } finally {
      await sql.end();
    }
  });

  it("ist im Einplanungstakt idempotent: ein zweiter Takt im selben Fenster legt nichts Neues an", async () => {
    const scheduler = bauScheduler();
    await scheduler.runScheduleTick();
    const sql = createRawClient(databaseUrl);
    try {
      const nach1 = await sql`select count(*)::int as n from jobs`;
      await scheduler.runScheduleTick();
      const nach2 = await sql`select count(*)::int as n from jobs`;
      expect(nach2[0].n).toBe(nach1[0].n);
    } finally {
      await sql.end();
    }
  });

  it("stellt im Arbeitstakt ein committetes Ereignis wirklich zu (Outbox -> Realtime)", async () => {
    const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
    const res = await app.inject({
      method: "POST",
      url: "/appointments",
      headers: { "idempotency-key": `sched-${Date.now()}`, cookie },
      payload: {
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        fahrzeugId: fixtures.fahrzeugId,
        beginnAt: "2026-09-20T09:00:00.000Z",
        endeAt: "2026-09-20T10:00:00.000Z",
        art: "Übungsstunde",
        klasse: "B",
      },
    });
    expect(res.statusCode).toBe(201);

    const sql = createRawClient(databaseUrl);
    try {
      const offen = await sql`select count(*)::int as n from event_outbox where status = 'pending'`;
      expect(offen[0].n).toBeGreaterThan(0);

      const scheduler = bauScheduler();
      await scheduler.runWorkTick();

      const danach = await sql`select count(*)::int as n from event_outbox where status = 'pending'`;
      expect(danach[0].n).toBe(0);
      // Der eigentliche Beweis: der Realtime-Fanout ist gelaufen.
      const zustellungen = await sql`select count(*)::int as n from realtime_deliveries`;
      expect(zustellungen[0].n).toBeGreaterThan(0);
      expect(scheduler.stats().workTicks).toBe(1);
      expect(scheduler.stats().workFailures).toBe(0);
    } finally {
      await sql.end();
    }
  });

  it("stirbt NICHT an einem fehlgeschlagenen Takt und alarmiert nach der Schwelle", async () => {
    const kaputt = createScheduler(
      { db: getDb("postgres://fahrschul:fahrschul_dev_pw@127.0.0.1:59999/nichts"), notifications: createNotificationsAdapter("mock") },
      { alarmAfterConsecutiveFailures: 2 },
    );
    // Zwei Fehlschläge in Folge: der Aufruf wirft NICHT (das ist die Zusage),
    // und der Alarm kommt genau einmal.
    await kaputt.runScheduleTick();
    await kaputt.runScheduleTick();

    expect(kaputt.stats().scheduleFailures).toBe(2);
    expect(kaputt.stats().lastError).toBeTruthy();
    const alarme = recentAlarms().filter((a) => a.kind === "scheduler_stalled");
    expect(alarme.length).toBe(1);

    await kaputt.runScheduleTick();
    // Kein Alarmsturm: derselbe Zustand alarmiert nicht bei jedem Takt erneut.
    expect(recentAlarms().filter((a) => a.kind === "scheduler_stalled").length).toBe(1);
  }, 30000);

  it("`scheduler_stalled` steht im Alarmkatalog mit Runbook und Zuständigem", () => {
    const eintrag = ALARM_CATALOG.find((a) => a.kind === "scheduler_stalled");
    expect(eintrag).toBeDefined();
    expect(eintrag!.severity).toBe("critical");
    expect(eintrag!.runbook).toMatch(/^docs\/.+#.+/);
    expect(eintrag!.owner).toContain("systemdienst");
  });

  it("`GET /ops/scheduler` sagt, ob DIESER Prozess einen Takt fährt – und ist rechtegeschützt", async () => {
    await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);
    const buero = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
    const verboten = await app.inject({ method: "GET", url: "/ops/scheduler", headers: { cookie: buero } });
    expect(verboten.statusCode).toBe(403);

    // Die Test-App fährt bewusst KEINEN Takt (die Tests treiben ihn selbst) –
    // und genau das muss die Route ehrlich melden, statt "läuft" zu behaupten.
    const sql = createRawClient(databaseUrl);
    try {
      await sql`update benutzer set rolle = 'systemdienst' where id = ${fixtures.bueroBenutzerId}`;
    } finally {
      await sql.end();
    }
    const ops = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
    const res = await app.inject({ method: "GET", url: "/ops/scheduler", headers: { cookie: ops } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.aktiv).toBe(false);
    expect(body.konfiguriert).toBe(false);
    expect(body.hinweis).toContain("KEINE Jobs");
    expect(body.takte.arbeit).toHaveProperty("alterSekunden");
  });

  it("startet und stoppt die Timer, ohne einen Takt zu erzwingen", () => {
    const ticks: Array<() => void> = [];
    const scheduler = bauScheduler({
      // Timer werden injiziert: kein echtes Warten, kein Flackern.
      setTimer: (fn) => {
        ticks.push(fn);
        return ticks.length;
      },
      clearTimer: () => undefined,
    });
    expect(scheduler.running).toBe(false);
    scheduler.start();
    expect(scheduler.running).toBe(true);
    // Zwei Timer: Arbeitstakt und Einplanungstakt – getrennt, nicht einer.
    expect(ticks.length).toBe(2);
    scheduler.stop();
    expect(scheduler.running).toBe(false);
  });
});

describe("PROMPT -1 §14/§15 – rückwärtskompatible Migrationen (ALLE, nicht nur 0009)", () => {
  const dateien = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

  it("findet die Migrationsdateien überhaupt (Selbsttest)", () => {
    expect(dateien.length).toBeGreaterThanOrEqual(10);
    expect(dateien).toContain("0010_backup_and_deployment.sql");
  });

  /**
   * Phase 3 hat diesen Wächter nur für `0009` gebaut. Damit war die
   * expand-contract-Zusage für 0007 und 0008 (und für jede künftige Datei) eine
   * Momentaufnahme. Hier gilt sie für ALLE Migrationen ab 0007 – ab dem Punkt,
   * an dem vier Frontends im Feld waren und ein Schemabruch echte Aufrufer
   * getroffen hätte.
   */
  it("keine Migration ab 0007 enthält eine zerstörende Anweisung", () => {
    const befunde: string[] = [];
    for (const datei of dateien) {
      if (datei < "0007") continue;
      const treffer = findDestructiveStatements(readFileSync(join(MIGRATIONS_DIR, datei), "utf-8"));
      if (treffer.length > 0) befunde.push(`${datei}: ${treffer.join(", ")}`);
    }
    expect(befunde).toEqual([]);
  });

  it("erkennt zerstörende Anweisungen zuverlässig – und ein Muster im KOMMENTAR ist kein Befund", () => {
    expect(findDestructiveStatements("alter table t drop column c;")).toContain("drop column");
    expect(findDestructiveStatements("drop table alt;")).toContain("drop table");
    expect(findDestructiveStatements("alter table t rename column a to b;")).toContain("rename column");
    expect(findDestructiveStatements("alter table t alter column c set not null;")).toContain("set not null");
    expect(findDestructiveStatements("truncate table x;")).toContain("truncate");
    // Der Standardweg, einen Trigger zu ersetzen, ist NICHT zerstörend – sonst
    // wären 0007–0009 falsch positiv.
    expect(findDestructiveStatements("drop trigger if exists t on x; create trigger t ...")).toEqual([]);
    expect(findDestructiveStatements("drop index if exists idx;")).toEqual([]);
    // Kommentare zählen nicht.
    expect(findDestructiveStatements("-- wir könnten hier drop column machen\nselect 1;")).toEqual([]);
    expect(findDestructiveStatements("/* drop table alt; */ select 1;")).toEqual([]);
  });

  it("`pendingMigrations` meldet für eine aktuelle Datenbank null offene Schritte", async () => {
    const databaseUrl = testDatabaseUrl();
    await ensureMigrated(databaseUrl);
    expect(await pendingMigrations(databaseUrl)).toEqual([]);
  });
});

describe("PROMPT -1 §15 – keine zerstörende Migration ohne Backup und Freigabe", () => {
  const databaseUrl = testDatabaseUrl();

  beforeAll(async () => {
    await ensureMigrated(databaseUrl);
  });

  beforeEach(async () => {
    const sql = createRawClient(databaseUrl);
    try {
      await sql`delete from backup_runs where label like 'test-gate-%'`;
    } finally {
      await sql.end();
    }
  });

  async function pruefeTor(gate: { approvedBy?: string | null; backupRef?: string | null }) {
    const { assertDestructiveAllowed } = await import("@fahrschul/database");
    const postgres = (await import("postgres")).default;
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      await assertDestructiveAllowed(sql, "9999_contract.sql", ["drop column"], gate);
      return null;
    } catch (err) {
      return err as DestructiveMigrationBlocked;
    } finally {
      await sql.end();
    }
  }

  it("blockt ohne Freigabe (`MIGRATION_APPROVED_BY`)", async () => {
    const err = await pruefeTor({ approvedBy: null, backupRef: "test-gate-1" });
    expect(err).toBeInstanceOf(DestructiveMigrationBlocked);
    expect(err!.reason).toBe("no_approval");
    expect(err!.message).toContain("MIGRATION_APPROVED_BY");
  });

  it("blockt ohne Backupnachweis (`MIGRATION_BACKUP_REF`)", async () => {
    const err = await pruefeTor({ approvedBy: "M. Krebs", backupRef: null });
    expect(err!.reason).toBe("no_backup_ref");
    expect(err!.message).toContain("MIGRATION_BACKUP_REF");
  });

  it("blockt bei einem BEHAUPTETEN Backup, das es nicht gibt", async () => {
    const err = await pruefeTor({ approvedBy: "M. Krebs", backupRef: "test-gate-erfunden" });
    expect(err!.reason).toBe("backup_not_found");
    // Der Kern der Regel: eine Umgebungsvariable ist kein Nachweis.
    expect(err!.message).toContain("kein Backup");
  });

  it("blockt bei einem Backup, das existiert aber NICHT verifiziert ist", async () => {
    const sql = createRawClient(databaseUrl);
    try {
      await sql`insert into backup_runs (label, kind, location, status)
        values ('test-gate-unverifiziert', 'logical', '/tmp/x.dump', 'erfolgreich')`;
    } finally {
      await sql.end();
    }
    const err = await pruefeTor({ approvedBy: "M. Krebs", backupRef: "test-gate-unverifiziert" });
    expect(err!.reason).toBe("backup_not_verified");
    expect(err!.message).toContain("NICHT verifiziert");
  });

  it("lässt durch, wenn Freigabe UND verifiziertes Backup vorliegen", async () => {
    const sql = createRawClient(databaseUrl);
    try {
      await sql`insert into backup_runs (label, kind, location, status, verified_at, verify_method)
        values ('test-gate-ok', 'logical', '/tmp/x.dump', 'erfolgreich', now(), 'restore-verify')`;
    } finally {
      await sql.end();
    }
    expect(await pruefeTor({ approvedBy: "M. Krebs", backupRef: "test-gate-ok" })).toBeNull();
  });

  it("die Datenbank verhindert ein 'verifiziertes' Backup, das fehlgeschlagen ist (Roh-SQL)", async () => {
    const sql = createRawClient(databaseUrl);
    try {
      // Der einzige Weg, das Tor zu unterlaufen, wäre eine per Hand als
      // verifiziert markierte FEHLGESCHLAGENE Sicherung. Die CHECK-Constraint
      // verbietet es – auch ohne Anwendungscode.
      await expect(
        sql`insert into backup_runs (label, kind, location, status, verified_at)
            values ('test-gate-luege', 'logical', '/tmp/x', 'fehlgeschlagen', now())`,
      ).rejects.toThrow(/backup_runs_verified_needs_success/);
    } finally {
      await sql.end();
    }
  });

  it("`runMigrations` bleibt für die bestehenden (additiven) Migrationen unverändert idempotent", async () => {
    // Wichtig: das neue Tor darf den Normalfall nicht anfassen.
    expect(await runMigrations(databaseUrl)).toEqual([]);
  });
});
