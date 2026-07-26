import { createRawClient } from "@fahrschul/database";
import type { FastifyInstance } from "fastify";
import { deploymentIdentity, uptimeSeconds } from "../lib/deployment.js";
import { pendingMigrations } from "@fahrschul/database";

/**
 * PROMPT -1 §15 (Phase 4) – Bereitschafts- und Lebendprüfung.
 *
 * ## Warum drei Endpunkte und nicht einer
 *
 * Phase 3 hat `GET /health/deep` gebaut: eine reichhaltige Gesamtanzeige für
 * die vier Frontends (§18) und für den Betrieb. Sie ist als Orchestrator-Probe
 * aber aus zwei Gründen ungeeignet:
 *
 *  - Sie fragt bei jedem Aufruf mehrere Aggregate ab (`collectDbMetrics`,
 *    `integrationStatus`). Als Liveness-Probe im Sekundentakt wäre das eine
 *    Dauerlast, die einen bereits belasteten Prozess zusätzlich drückt.
 *  - Sie beantwortet nicht die eine Frage, die ein Rolling-Deployment stellt:
 *    "darf diese Instanz Verkehr bekommen?" Dazu gehört, ob das Schema zu
 *    diesem Artefakt passt – und das prüft `/health/deep` nicht.
 *
 * Deshalb die klassische Dreiteilung, jede mit EINER Aufgabe:
 *
 * | Endpunkt | Frage | Prüft | Fehlerfolge |
 * |---|---|---|---|
 * | `GET /health` | "läuft der Prozess?" | nichts (kein I/O) | Prozess neu starten |
 * | `GET /health/live` | dasselbe, ausdrücklich benannt | nichts (kein I/O) | Prozess neu starten |
 * | `GET /health/ready` | "darf sie Verkehr bekommen?" | DB-Roundtrip **und** Migrationsstand | aus dem Loadbalancer nehmen, NICHT neu starten |
 * | `GET /health/deep` | "wie geht es dem Gesamtsystem?" | DB + alle 10 Integrationen | Anzeige/Alarm, KEIN Verkehrsentzug |
 *
 * ## Die wichtigste Entscheidung: Liveness prüft NICHTS
 *
 * Eine Liveness-Probe, die die Datenbank anfasst, ist ein Ausfallverstärker:
 * fällt die Datenbank aus, tötet der Orchestrator ALLE Anwendungsinstanzen –
 * und wenn die Datenbank zurückkommt, treffen sie sie gleichzeitig als
 * Kaltstartwelle. Liveness beantwortet ausschließlich "ist dieser Prozess
 * noch handlungsfähig". Für eine unerreichbare Abhängigkeit ist Readiness
 * zuständig, und die entzieht Verkehr, ohne zu töten.
 *
 * ## Warum Readiness den Migrationsstand prüft
 *
 * §15 verlangt rückwärtskompatible Migrationen und Rolling-Deployment. Beim
 * Rollout gilt: erst Migration (expand), dann neue Instanzen. Eine neue
 * Instanz, die vor ihrer Migration startet, würde Verkehr annehmen und an
 * fehlenden Spalten scheitern. `pendingMigrations() > 0` ⇒ **503**, also kein
 * Verkehr, bis der Schemaschritt durch ist. Das ist die technische Hälfte des
 * "kein Rollout ohne kompatibles Schema".
 *
 * Umgekehrt ist ein Schema, das NEUER ist als das Artefakt (Rollback des
 * Codes ohne Rollback der Migration), ausdrücklich **kein** Readiness-Fehler –
 * genau dafür ist expand-contract da: die alte Fassung liest ihre gewohnten
 * Spalten weiter. Ein 503 dort würde den Rollback-Pfad blockieren, den §15
 * verlangt.
 */
export function registerHealthRoutes(app: FastifyInstance, databaseUrl?: string) {
  /** Unverändert aus Prompt 0 – der Pfad wird von den vier Apps benutzt. */
  app.get("/health", async () => ({ status: "ok", service: "@fahrschul/api" }));

  app.get("/health/live", async (_request, reply) => {
    const id = deploymentIdentity();
    // KEIN I/O. Wenn dieser Handler antwortet, lebt der Prozess – das ist die
    // ganze Aussage, und sie ist deshalb immer 200.
    return reply.code(200).send({
      status: "ok",
      service: "@fahrschul/api",
      deploymentId: id.deploymentId,
      instanceId: id.instanceId,
      releaseChannel: id.releaseChannel,
      version: id.version,
      uptimeSeconds: uptimeSeconds(),
    });
  });

  app.get("/health/ready", async (_request, reply) => {
    const id = deploymentIdentity();
    const url = databaseUrl ?? process.env.DATABASE_URL ?? null;
    let datenbank: "erreichbar" | "nicht erreichbar" = "nicht erreichbar";
    let offeneMigrationen: number | null = null;
    let fehler: string | null = null;

    if (!url) {
      fehler = "DATABASE_URL nicht gesetzt";
    } else {
      const sql = createRawClient(url);
      try {
        // Ein billiger Roundtrip, absichtlich mit kurzem Zeitlimit: eine
        // Readiness-Probe, die hängt, ist so schlecht wie eine, die lügt.
        await Promise.race([
          sql`select 1`,
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error("readiness_db_timeout")), 2000),
          ),
        ]);
        datenbank = "erreichbar";
        offeneMigrationen = (await pendingMigrations(url)).length;
      } catch (err) {
        fehler = (err as Error).message;
      } finally {
        await sql.end().catch(() => undefined);
      }
    }

    const bereit = datenbank === "erreichbar" && offeneMigrationen === 0;
    return reply.code(bereit ? 200 : 503).send({
      status: bereit ? "ready" : "not_ready",
      service: "@fahrschul/api",
      deploymentId: id.deploymentId,
      instanceId: id.instanceId,
      releaseChannel: id.releaseChannel,
      version: id.version,
      datenbank,
      offeneMigrationen,
      grund: bereit
        ? null
        : datenbank !== "erreichbar"
          ? "datenbank_nicht_erreichbar"
          : "migrationen_ausstehend",
      fehler,
      hinweis: bereit
        ? null
        : "Diese Instanz darf keinen Verkehr bekommen. Sie NICHT neu starten – Ursache beheben (siehe docs/recovery-runbook.md).",
    });
  });
}
