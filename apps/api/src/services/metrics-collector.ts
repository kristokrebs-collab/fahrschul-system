import {
  deadLetters,
  eventOutbox,
  integrationHealth,
  integrationOutboundCalls,
  jobs,
} from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  METRIC,
  currentRealtimeConnections,
  setGauge,
} from "../lib/metrics.js";

/**
 * PROMPT -1 §16 – Kennzahlen, die aus der DATENBANK kommen und nicht aus dem
 * Prozessspeicher: Verbindungen, Warteschlangenlängen, Dead-Letter-Tiefe,
 * Synchronisationsverzögerung, Integrationszustand.
 *
 * Warum beim Scrape sammeln und nicht laufend fortschreiben? Weil diese
 * Größen ZUSTÄNDE sind, keine Ereignisse. Ein laufend fortgeschriebener
 * Zähler würde nach einem Neustart lügen; eine Abfrage beim Scrape ist immer
 * wahr. Der Preis (fünf kleine Aggregatabfragen je Scrape) ist bewusst
 * akzeptiert.
 *
 * ## Sync-Verzögerung: die Definition, nicht nur die Zahl
 *
 * `fahrschul_sync_delay_seconds` ist das ALTER des ältesten noch nicht
 * zugestellten Outbox-Ereignisses. Damit misst sie genau das, was ein Nutzer
 * spürt: "wie lange kann meine Anzeige maximal veraltet sein, ohne dass es
 * jemand merkt". Ist die Outbox leer, ist der Wert 0 – nicht "unbekannt".
 */

export interface CollectedMetrics {
  dbConnections: number;
  jobQueueDepth: Record<string, number>;
  outboxDepth: Record<string, number>;
  openDeadLetters: number;
  syncDelaySeconds: number;
  realtimeConnections: number;
  integrationBreakersOpen: number;
  integrationBufferDepth: number;
}

export async function collectDbMetrics(db: Database): Promise<CollectedMetrics> {
  // §16.3 – DB-Verbindungen. `pg_stat_activity` ist die einzige ehrliche
  // Quelle; ein Poolzähler im Prozess kennt nur den eigenen Pool.
  let dbConnections = 0;
  try {
    const rows = await db.execute(
      sql`select count(*)::int as n from pg_stat_activity where datname = current_database()`,
    );
    const first = (rows as unknown as Array<{ n: number }>)[0];
    dbConnections = Number(first?.n ?? 0);
  } catch {
    // Fehlende Rechte auf pg_stat_activity dürfen den Scrape nicht kippen.
    dbConnections = -1;
  }

  // §16.4 – Warteschlangenlängen.
  const jobRows = await db
    .select({ status: jobs.status, n: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.status);
  const jobQueueDepth: Record<string, number> = {};
  for (const row of jobRows) {
    jobQueueDepth[row.status] = Number(row.n);
    setGauge(METRIC.jobQueueDepth, "Jobs je Status", Number(row.n), { status: row.status });
  }
  for (const status of ["pending", "in_progress", "succeeded", "failed", "dead"]) {
    if (!(status in jobQueueDepth)) {
      setGauge(METRIC.jobQueueDepth, "Jobs je Status", 0, { status });
    }
  }

  const outboxRows = await db
    .select({ status: eventOutbox.status, n: sql<number>`count(*)::int` })
    .from(eventOutbox)
    .groupBy(eventOutbox.status);
  const outboxDepth: Record<string, number> = {};
  for (const row of outboxRows) {
    outboxDepth[row.status] = Number(row.n);
    setGauge(METRIC.outboxDepth, "Outbox-Ereignisse je Status", Number(row.n), { status: row.status });
  }
  for (const status of ["pending", "in_flight", "delivered", "dead"]) {
    if (!(status in outboxDepth)) {
      setGauge(METRIC.outboxDepth, "Outbox-Ereignisse je Status", 0, { status });
    }
  }

  // §16.6 – offene Dead Letters.
  const [dl] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deadLetters)
    .where(isNull(deadLetters.resumedAt));
  const openDeadLetters = Number(dl?.n ?? 0);
  setGauge(METRIC.deadLettersOpen, "Offene Dead-Letter-Einträge", openDeadLetters);

  // §16.7 – Synchronisationsverzögerung.
  const [lag] = await db
    .select({
      seconds: sql<number>`coalesce(max(extract(epoch from (now() - ${eventOutbox.createdAt}))), 0)::float8`,
    })
    .from(eventOutbox)
    .where(inArray(eventOutbox.status, ["pending", "in_flight"]));
  const syncDelaySeconds = Math.max(0, Number(lag?.seconds ?? 0));
  setGauge(
    METRIC.syncDelay,
    "Alter des ältesten noch nicht zugestellten Ereignisses in Sekunden",
    syncDelaySeconds,
  );

  // §16.8 – offene SSE-Verbindungen (Prozesswert, siehe lib/metrics.ts).
  const realtimeConnections = currentRealtimeConnections();
  setGauge(METRIC.realtimeConnections, "Offene SSE-Verbindungen dieses Prozesses", realtimeConnections);

  // §11 – Integrationszustand als Kennzahl (Phase-4-SLOs lesen sie hier ab).
  const healthRows = await db.select().from(integrationHealth);
  let integrationBreakersOpen = 0;
  for (const row of healthRows) {
    const open = row.breakerState === "open" ? 1 : 0;
    integrationBreakersOpen += open;
    setGauge(
      METRIC.integrationBreakerOpen,
      "1 = Circuit Breaker offen (Integration wird kurzgeschlossen)",
      open,
      { integration: row.integration, mode: row.mode },
    );
  }

  const bufferRows = await db
    .select({ integration: integrationOutboundCalls.integration, n: sql<number>`count(*)::int` })
    .from(integrationOutboundCalls)
    .where(inArray(integrationOutboundCalls.status, ["buffered", "in_flight"]))
    .groupBy(integrationOutboundCalls.integration);
  let integrationBufferDepth = 0;
  for (const row of bufferRows) {
    integrationBufferDepth += Number(row.n);
    setGauge(
      METRIC.integrationBufferDepth,
      "Gepufferte ausgehende Aufrufe je Integration",
      Number(row.n),
      { integration: row.integration },
    );
  }

  setGauge(METRIC.dbConnections, "Aktive Datenbankverbindungen", dbConnections);

  return {
    dbConnections,
    jobQueueDepth,
    outboxDepth,
    openDeadLetters,
    syncDelaySeconds,
    realtimeConnections,
    integrationBreakersOpen,
    integrationBufferDepth,
  };
}

/**
 * Zählt fehlgeschlagene, nicht aufgelöste ausgehende Aufrufe – die
 * "Fehlerwarteschlange" aus §11. Getrennt von `collectDbMetrics`, weil die
 * Betriebsoberfläche sie einzeln braucht.
 */
export async function integrationErrorQueueDepth(db: Database, integration?: string): Promise<number> {
  const where = integration
    ? and(eq(integrationOutboundCalls.status, "failed"), eq(integrationOutboundCalls.integration, integration))
    : eq(integrationOutboundCalls.status, "failed");
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(integrationOutboundCalls).where(where);
  return Number(row?.n ?? 0);
}
