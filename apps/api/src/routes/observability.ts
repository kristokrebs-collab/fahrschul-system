import type { Database } from "@fahrschul/database";
import type { FastifyInstance } from "fastify";
import { PROMETHEUS_CONTENT_TYPE, renderPrometheus } from "../lib/metrics.js";
import { recentTraceSpans } from "../lib/observability.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { collectDbMetrics } from "../services/metrics-collector.js";
import { integrationStatus } from "../services/integrations.js";
import { ALARM_CATALOG } from "../workers/alarm.js";

/**
 * PROMPT -1 §16 – die Abrufpunkte der Beobachtbarkeit.
 *
 * ## Warum `/metrics` ohne Sitzung erreichbar ist – und was das kostet
 *
 * Ein Prometheus-Scraper hat keine Sitzung und kein Cookie. Es gibt genau drei
 * Möglichkeiten: (a) offen, (b) mit einem Bearer-Token, (c) nur auf einem
 * separaten Port/Interface. In dieser Umgebung existiert kein Secret-Store und
 * kein zweites Interface, deshalb ist der Weg hier:
 *
 *   - `/metrics` ist offen, ABER liefert ausschließlich aggregierte Zahlen mit
 *     einer geschlossenen Label-Menge (siehe lib/metrics.ts – IDs werden zu
 *     `:id`, unbekannte Labelwerte zu `other`). Es gibt keinen Weg, daraus
 *     einen Personenbezug zu gewinnen: keine Schüler-ID, keine E-Mail, keine
 *     Fahrlehrer-Notiz, kein Kontoauszug.
 *   - **Ist `METRICS_TOKEN` gesetzt, wird es verlangt** (Bearer oder
 *     `?token=`). Das ist die Produktionsvorgabe und steht so in
 *     docs/security-architecture.md; ohne gesetztes Token bleibt der Endpunkt
 *     offen, damit ein Betrieb ohne Secret-Store nicht ohne Kennzahlen
 *     dasteht.
 *
 * Die ehrliche Bewertung: aggregierte Kennzahlen verraten Betriebsvolumen
 * (wie viele Buchungen es gab). Das ist ein Geschäftsgeheimnis, kein
 * personenbezogenes Datum. Im Deployment gehört der Endpunkt hinter das
 * interne Netz – dokumentiert, nicht behauptet.
 */

export interface ObservabilityRouteOptions {
  /** Wenn gesetzt, ist `/metrics` nur mit diesem Token abrufbar. */
  metricsToken?: string | null;
}

export function registerObservabilityRoutes(
  app: FastifyInstance,
  db: Database,
  options: ObservabilityRouteOptions = {},
) {
  app.get("/metrics", async (request, reply) => {
    const token = options.metricsToken ?? process.env.METRICS_TOKEN ?? null;
    if (token) {
      const header = request.headers.authorization;
      const query = (request.query as { token?: string }).token;
      const provided = header?.startsWith("Bearer ") ? header.slice(7) : query;
      if (provided !== token) {
        return reply.code(401).send({ error: "unauthenticated", hinweis: "METRICS_TOKEN erforderlich." });
      }
    }
    // Zustandsgrößen werden beim Scrape frisch aus der Datenbank geholt
    // (Begründung in services/metrics-collector.ts).
    try {
      await collectDbMetrics(db);
    } catch (err) {
      // Ein Scrape darf nicht fehlschlagen, nur weil die DB gerade nicht mag –
      // die Prozesskennzahlen sind dann immer noch wahr und wertvoll.
      request.log?.error?.(err);
    }
    reply.header("content-type", PROMETHEUS_CONTENT_TYPE);
    return reply.send(renderPrometheus());
  });

  /**
   * §16/§18 – Tiefe Gesundheitsprüfung: der EINE Endpunkt, den die vier
   * Frontends abfragen, um "eingeschränkter Betrieb" korrekt anzuzeigen.
   *
   * Gibt bewusst KEINE 5xx zurück, wenn eine Integration ausgefallen ist: der
   * Kern ist dann weiterhin nutzbar, und ein Loadbalancer, der die Instanz
   * deswegen aus dem Verkehr nimmt, würde die Degradation zum Totalausfall
   * machen. 503 gibt es nur, wenn die DATENBANK nicht erreichbar ist – dann ist
   * die Instanz wirklich nutzlos (§1: die Datenbank ist die Wahrheit).
   */
  app.get("/health/deep", async (_request, reply) => {
    let dbOk = true;
    let metrics: Awaited<ReturnType<typeof collectDbMetrics>> | null = null;
    let integrationen: Awaited<ReturnType<typeof integrationStatus>> = [];
    try {
      metrics = await collectDbMetrics(db);
      integrationen = await integrationStatus(db);
    } catch {
      dbOk = false;
    }

    const ausgefallen = integrationen.filter((i) => i.status === "ausgefallen").map((i) => i.integration);
    const eingeschraenkt = integrationen
      .filter((i) => i.status === "eingeschraenkt")
      .map((i) => i.integration);

    const gesamt = !dbOk ? "ausgefallen" : ausgefallen.length > 0 || eingeschraenkt.length > 0 ? "eingeschraenkt" : "gesund";

    return reply.code(dbOk ? 200 : 503).send({
      status: gesamt,
      service: "@fahrschul/api",
      datenbank: dbOk ? "erreichbar" : "nicht erreichbar",
      kern: dbOk
        ? "nutzbar – Termine, Dokumente und Ausbildung funktionieren unabhängig von externen Systemen"
        : "nicht nutzbar",
      integrationen: integrationen.map((i) => ({
        integration: i.integration,
        modus: i.mode,
        status: i.status,
        breaker: i.breakerState,
        letzteErfolgreicheSynchronisation: i.lastSuccessAt,
        gepuffert: i.gepuffert,
        fehlerwarteschlange: i.fehlerwarteschlange,
      })),
      ausgefallen,
      eingeschraenkt,
      kennzahlen: metrics
        ? {
            syncVerzoegerungSekunden: metrics.syncDelaySeconds,
            offeneDeadLetters: metrics.openDeadLetters,
            offeneRealtimeVerbindungen: metrics.realtimeConnections,
            jobWarteschlange: metrics.jobQueueDepth,
            outbox: metrics.outboxDepth,
          }
        : null,
      serverTime: new Date().toISOString(),
    });
  });

  /**
   * §16 – der Alarmkatalog als Daten. Nicht kosmetisch: Phase 4 (§21 SLOs)
   * braucht Schwelle, Zuständigen, Runbook und Eskalation maschinenlesbar,
   * und ein Katalog, der nur in einem Dokument steht, veraltet.
   */
  app.get(
    "/ops/alerts/catalog",
    { preHandler: [requireAuth, requirePermission("ops:reliability:read")] },
    async (_request, reply) => reply.send({ alarme: ALARM_CATALOG }),
  );

  /** §16 – Tracing: die letzten Spannen dieses Prozesses (Trace-ID = Korrelations-ID). */
  app.get(
    "/ops/traces",
    { preHandler: [requireAuth, requirePermission("ops:reliability:read")] },
    async (request, reply) => {
      const query = request.query as { correlationId?: string; limit?: string };
      const limit = Math.min(200, Math.max(1, Number(query.limit ?? "50") || 50));
      let spans = [...recentTraceSpans()];
      if (query.correlationId) spans = spans.filter((s) => s.traceId === query.correlationId);
      return reply.send({ spans: spans.slice(-limit) });
    },
  );
}
