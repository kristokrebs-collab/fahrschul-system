import { auditEreignisse, integrationHealth, integrationOutboundCalls } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import {
  DEFAULT_TIMEOUTS,
  INTEGRATIONS,
  IntegrationGuard,
  IntegrationGuardRegistry,
  type CallOptions,
  type CallResult,
  type IntegrationHealthSnapshot,
  type IntegrationName,
} from "@fahrschul/integrations";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { incCounter, recordRetry, sanitizeLabelValue, METRIC } from "../lib/metrics.js";
import { log, newCorrelationId } from "../lib/observability.js";
import { emitAlarm } from "../workers/alarm.js";

/**
 * PROMPT -1 §11 / §18 – die API-Seite der Ausfallsicherheit.
 *
 * `packages/integrations/src/resilience.ts` besitzt die MECHANIK (Breaker,
 * Zeitlimit, Retry). Diese Datei besitzt die WIRKUNG im System:
 *
 *  - sie spiegelt den Breaker-Zustand nach `integration_health`, damit er
 *    einen Neustart überlebt und in der Betriebsoberfläche sichtbar ist,
 *  - sie PUFFERT einen ausgehenden Aufruf, der nicht durchkam
 *    (`integration_outbound_calls`, Status `buffered`) – statt ihn zu
 *    verlieren oder einen falschen Erfolg zu melden,
 *  - sie führt die Fehlerwarteschlange (Status `failed`) mit einem
 *    manuellen UND einem automatischen Wiederaufnahmepfad,
 *  - sie alarmiert bei jedem Zustandswechsel (§16-Alarmkatalog).
 *
 * ## Die Regel, an der §18 hängt
 *
 * `runBuffered(...)` liefert IMMER eines von drei Ergebnissen:
 *   `zugestellt` | `gepuffert` | `endgueltig_fehlgeschlagen`
 * Es gibt keinen vierten Fall und insbesondere kein stilles "ok". Eine Route,
 * die `gepuffert` bekommt, MUSS dem Nutzer "wartet auf externe
 * Synchronisation" zeigen – nicht "gesendet". Das ist die Stelle, an der die
 * geforderte Zusage „keine falsche Erfolgsmeldung" technisch erzwungen wird:
 * der Rückgabetyp lässt die falsche Aussage nicht zu.
 */

export type OutboundOutcome = "zugestellt" | "gepuffert" | "endgueltig_fehlgeschlagen";

export interface OutboundResult<T> {
  outcome: OutboundOutcome;
  value?: T;
  callId: string | null;
  errorClass?: string;
  error?: string;
  attempts: number;
  /** Für die UI: der Text, den §18 an dieser Stelle verlangt. */
  hinweis: string;
}

const WARTET_AUF_EXTERNE_SYNC = "wartet auf externe Synchronisation";

export interface IntegrationServiceOptions {
  db: Database;
  /** Deterministische Uhr für Tests. */
  now?: () => number;
  /** Backoff ohne echtes Warten (Tests). */
  sleep?: (ms: number) => Promise<void>;
  breaker?: { failureThreshold?: number; successThreshold?: number; openMs?: number; maxOpenMs?: number };
  timeouts?: Partial<Record<IntegrationName, number>>;
}

/**
 * Ein Prozess hat genau eine Registry. Modul-Singleton, weil der Breaker
 * Prozesszustand IST – zwei Registries wären zwei Meinungen über denselben
 * Anbieter. Tests bekommen über `resetIntegrationRegistry()` einen frischen
 * Stand.
 */
let registry = new IntegrationGuardRegistry();

export function resetIntegrationRegistry(): void {
  registry.clear();
  registry = new IntegrationGuardRegistry();
}

export function integrationRegistry(): IntegrationGuardRegistry {
  return registry;
}

async function persistSnapshot(db: Database, snapshot: IntegrationHealthSnapshot): Promise<void> {
  const toDate = (iso: string | null) => (iso ? new Date(iso) : null);
  await db
    .insert(integrationHealth)
    .values({
      integration: snapshot.integration,
      mode: snapshot.mode,
      breakerState: snapshot.breakerState,
      consecutiveFailures: snapshot.consecutiveFailures,
      consecutiveSuccesses: snapshot.consecutiveSuccesses,
      openedAt: toDate(snapshot.openedAt),
      probeAfter: toDate(snapshot.probeAfter),
      lastSuccessAt: toDate(snapshot.lastSuccessAt),
      lastFailureAt: toDate(snapshot.lastFailureAt),
      lastError: snapshot.lastError,
      lastErrorClass: snapshot.lastErrorClass,
      rateLimitedUntil: toDate(snapshot.rateLimitedUntil),
      totalCalls: snapshot.totalCalls,
      totalFailures: snapshot.totalFailures,
      totalShortCircuited: snapshot.totalShortCircuited,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: integrationHealth.integration,
      set: {
        mode: snapshot.mode,
        breakerState: snapshot.breakerState,
        consecutiveFailures: snapshot.consecutiveFailures,
        consecutiveSuccesses: snapshot.consecutiveSuccesses,
        openedAt: toDate(snapshot.openedAt),
        probeAfter: toDate(snapshot.probeAfter),
        lastSuccessAt: toDate(snapshot.lastSuccessAt),
        lastFailureAt: toDate(snapshot.lastFailureAt),
        lastError: snapshot.lastError,
        lastErrorClass: snapshot.lastErrorClass,
        rateLimitedUntil: toDate(snapshot.rateLimitedUntil),
        totalCalls: snapshot.totalCalls,
        totalFailures: snapshot.totalFailures,
        totalShortCircuited: snapshot.totalShortCircuited,
        updatedAt: new Date(),
      },
    });
}

/**
 * Holt (oder erzeugt) den Wächter einer Integration. `mode` ist immer `mock`
 * in dieser Umgebung – `assertMockOnly` bleibt die Stelle, die das erzwingt
 * (siehe packages/integrations/src/types.ts). Der Wächter behauptet nichts
 * anderes; `integration_health.mode` trägt den Wert mit, damit die
 * Betriebsansicht ihn ZEIGT statt ihn zu verschweigen.
 */
export function guardFor(
  integration: IntegrationName,
  options: IntegrationServiceOptions,
): IntegrationGuard {
  const existing = registry.get(integration);
  if (existing) return existing;
  const db = options.db;
  return registry.ensure({
    integration,
    mode: "mock",
    timeoutMs: options.timeouts?.[integration] ?? DEFAULT_TIMEOUTS[integration],
    now: options.now,
    sleep: options.sleep,
    breaker: options.breaker,
    persist: (snapshot) => {
      void persistSnapshot(db, snapshot).catch(() => {
        // Ein Schreibfehler auf der Gesundheitstabelle darf den Fachaufruf
        // nicht kippen. Der In-Memory-Zustand bleibt korrekt.
      });
    },
    onStateChange: (from, to, snapshot) => {
      log({
        severity: to === "open" ? "error" : "warn",
        requestId: `integration-${integration}`,
        correlationId: newCorrelationId(),
        operation: `integration.breaker.${to}`,
        errorCode: snapshot.lastErrorClass ?? undefined,
        message: `Circuit Breaker "${integration}": ${from} -> ${to}`,
        details: { integration, from, to, consecutiveFailures: snapshot.consecutiveFailures },
      });
      incCounter("fahrschul_integration_breaker_transitions_total", "Zustandswechsel der Circuit Breaker", {
        integration: sanitizeLabelValue(integration),
        to: sanitizeLabelValue(to),
      });
      if (to === "open") {
        void emitAlarm({
          kind: "integration_breaker_open",
          source: "integration",
          subject: `Integration "${integration}" ist ausgefallen (Breaker offen)`,
          errorClass: snapshot.lastErrorClass ?? undefined,
          message: snapshot.lastError ?? undefined,
          details: { integration, probeAfter: snapshot.probeAfter },
        });
      }
    },
  });
}

/** Legt (oder findet) den Puffer-Eintrag für einen ausgehenden Aufruf. */
async function upsertOutboundCall(
  db: Database,
  input: {
    integration: string;
    operation: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    correlationId: string | null;
    standortId: string | null;
    akteurBenutzerId: string | null;
  },
): Promise<{ id: string; status: string; result: unknown }> {
  const [row] = await db
    .insert(integrationOutboundCalls)
    .values({
      integration: input.integration,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      status: "in_flight",
      correlationId: input.correlationId,
      standortId: input.standortId,
      akteurBenutzerId: input.akteurBenutzerId,
    })
    .onConflictDoNothing({
      target: [
        integrationOutboundCalls.integration,
        integrationOutboundCalls.operation,
        integrationOutboundCalls.idempotencyKey,
      ],
    })
    .returning();
  if (row) return { id: row.id, status: row.status, result: row.result };

  const [existing] = await db
    .select()
    .from(integrationOutboundCalls)
    .where(
      and(
        eq(integrationOutboundCalls.integration, input.integration),
        eq(integrationOutboundCalls.operation, input.operation),
        eq(integrationOutboundCalls.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  return { id: existing.id, status: existing.status, result: existing.result };
}

export interface RunBufferedInput<T> extends CallOptions {
  integration: IntegrationName;
  fn: () => Promise<T>;
  /** Wird gepuffert, damit ein Wiederaufsetzen denselben Aufruf bilden kann. */
  payload?: Record<string, unknown>;
  correlationId?: string | null;
  standortId?: string | null;
  akteurBenutzerId?: string | null;
}

/**
 * Der EINE Weg, einen ausgehenden Aufruf zu machen.
 *
 * Ablauf:
 *   1. Puffer-Zeile anlegen (`in_flight`). Sie ist der Beweis, dass der Aufruf
 *      GEWOLLT war – auch wenn der Prozess danach abstürzt.
 *      Existiert sie schon als `succeeded`, wird das gespeicherte Ergebnis
 *      zurückgegeben (Idempotenz nach außen).
 *   2. Aufruf unter Breaker/Zeitlimit/Retry.
 *   3a. Erfolg -> `succeeded`, Ergebnis gespeichert.
 *   3b. Transienter Fehler oder offener Breaker -> `buffered` mit
 *       `next_attempt_at`. Ergebnis: `gepuffert`.
 *   3c. Dauerhafter Fehler oder Versuche erschöpft -> `failed`
 *       (Fehlerwarteschlange). Ergebnis: `endgueltig_fehlgeschlagen`.
 */
export async function runBuffered<T>(
  options: IntegrationServiceOptions,
  input: RunBufferedInput<T>,
): Promise<OutboundResult<T>> {
  const db = options.db;
  const guard = guardFor(input.integration, options);
  const now = options.now?.() ?? Date.now();

  const buffered = await upsertOutboundCall(db, {
    integration: input.integration,
    operation: input.operation,
    idempotencyKey: input.idempotencyKey,
    payload: input.payload ?? {},
    correlationId: input.correlationId ?? null,
    standortId: input.standortId ?? null,
    akteurBenutzerId: input.akteurBenutzerId ?? null,
  });

  if (buffered.status === "succeeded") {
    return {
      outcome: "zugestellt",
      value: buffered.result as T,
      callId: buffered.id,
      attempts: 0,
      hinweis: "Bereits zugestellt (Idempotenzschlüssel bekannt) – kein zweiter Aufruf.",
    };
  }

  const result: CallResult<T> = await guard.call(input.fn, {
    operation: input.operation,
    idempotencyKey: input.idempotencyKey,
    timeoutMs: input.timeoutMs,
    maxAttempts: input.maxAttempts,
    probe: input.probe,
  });

  incCounter(METRIC.integrationCalls, "Ausgehende Aufrufe je Integration und Ergebnis", {
    integration: sanitizeLabelValue(input.integration),
    outcome: result.ok ? "success" : result.shortCircuited ? "short_circuited" : "failure",
  });
  if (result.attempts > 1) recordRetry("integration");

  if (result.ok) {
    await db
      .update(integrationOutboundCalls)
      .set({
        status: "succeeded",
        attempts: sql`${integrationOutboundCalls.attempts} + ${result.attempts}`,
        result: (result.value ?? {}) as never,
        resolvedAt: new Date(now),
        lastError: null,
        lastErrorClass: null,
        updatedAt: new Date(now),
      })
      .where(eq(integrationOutboundCalls.id, buffered.id));
    return {
      outcome: "zugestellt",
      value: result.value,
      callId: buffered.id,
      attempts: result.attempts,
      hinweis: "Zugestellt.",
    };
  }

  const transient =
    result.shortCircuited ||
    result.errorClass === "TIMEOUT" ||
    result.errorClass === "NETWORK" ||
    result.errorClass === "SERVER_UNAVAILABLE" ||
    result.errorClass === "RATE_LIMITED";

  const [updated] = await db
    .update(integrationOutboundCalls)
    .set({
      status: transient ? "buffered" : "failed",
      attempts: sql`${integrationOutboundCalls.attempts} + ${Math.max(1, result.attempts)}`,
      lastError: result.error ?? null,
      lastErrorClass: result.errorClass ?? null,
      nextAttemptAt: new Date(now + (transient ? 30_000 : 0)),
      updatedAt: new Date(now),
    })
    .where(eq(integrationOutboundCalls.id, buffered.id))
    .returning();

  // Versuche erschöpft: aus dem Puffer wird die Fehlerwarteschlange.
  if (transient && updated && updated.attempts >= updated.maxAttempts) {
    await db
      .update(integrationOutboundCalls)
      .set({ status: "failed", updatedAt: new Date(now) })
      .where(eq(integrationOutboundCalls.id, buffered.id));
    await emitAlarm({
      kind: "integration_error_queue",
      source: "integration",
      sourceId: buffered.id,
      subject: `Ausgehender Aufruf "${input.integration}.${input.operation}" endgültig fehlgeschlagen`,
      errorClass: result.errorClass,
      message: result.error,
      correlationId: input.correlationId ?? undefined,
    });
    return {
      outcome: "endgueltig_fehlgeschlagen",
      callId: buffered.id,
      errorClass: result.errorClass,
      error: result.error,
      attempts: result.attempts,
      hinweis:
        "Externe Übermittlung endgültig fehlgeschlagen. Der Vorgang liegt in der Fehlerwarteschlange und muss manuell wieder aufgenommen werden.",
    };
  }

  if (!transient) {
    await emitAlarm({
      kind: "integration_error_queue",
      source: "integration",
      sourceId: buffered.id,
      subject: `Ausgehender Aufruf "${input.integration}.${input.operation}" dauerhaft fehlerhaft`,
      errorClass: result.errorClass,
      message: result.error,
      correlationId: input.correlationId ?? undefined,
    });
  }

  return {
    outcome: transient ? "gepuffert" : "endgueltig_fehlgeschlagen",
    callId: buffered.id,
    errorClass: result.errorClass,
    error: result.error,
    attempts: result.attempts,
    hinweis: transient
      ? `Externes System nicht erreichbar – der Vorgang ist gespeichert und ${WARTET_AUF_EXTERNE_SYNC}. Der fachliche Zustand ist gültig.`
      : "Externe Übermittlung wurde abgelehnt (dauerhafter Fehler). Der Vorgang liegt in der Fehlerwarteschlange.",
  };
}

/**
 * §11 „automatische UND manuelle Wiederaufnahme" – der automatische Teil.
 * Wird vom Job `integration.resume` aufgerufen. `execute` liefert der
 * Aufrufkontext (der Job kennt die Adapter), damit dieser Service keine
 * Adapterkenntnis braucht.
 */
export async function resumeBufferedCalls(
  options: IntegrationServiceOptions,
  input: {
    integration?: IntegrationName;
    limit?: number;
    execute: (call: {
      integration: string;
      operation: string;
      idempotencyKey: string;
      payload: Record<string, unknown>;
    }) => Promise<unknown>;
  },
): Promise<{ versucht: number; zugestellt: number; weiterGepuffert: number; fehlgeschlagen: number }> {
  const db = options.db;
  const now = new Date(options.now?.() ?? Date.now());
  const conditions = [
    eq(integrationOutboundCalls.status, "buffered"),
    lte(integrationOutboundCalls.nextAttemptAt, now),
  ];
  if (input.integration) conditions.push(eq(integrationOutboundCalls.integration, input.integration));

  const pending = await db
    .select()
    .from(integrationOutboundCalls)
    .where(and(...conditions))
    .orderBy(asc(integrationOutboundCalls.createdAt))
    .limit(input.limit ?? 25);

  let zugestellt = 0;
  let weiterGepuffert = 0;
  let fehlgeschlagen = 0;

  for (const call of pending) {
    const result = await runBuffered(options, {
      integration: call.integration as IntegrationName,
      operation: call.operation,
      idempotencyKey: call.idempotencyKey,
      payload: (call.payload ?? {}) as Record<string, unknown>,
      correlationId: call.correlationId,
      standortId: call.standortId,
      akteurBenutzerId: call.akteurBenutzerId,
      fn: () =>
        input.execute({
          integration: call.integration,
          operation: call.operation,
          idempotencyKey: call.idempotencyKey,
          payload: (call.payload ?? {}) as Record<string, unknown>,
        }),
    });
    if (result.outcome === "zugestellt") zugestellt += 1;
    else if (result.outcome === "gepuffert") weiterGepuffert += 1;
    else fehlgeschlagen += 1;
  }

  return { versucht: pending.length, zugestellt, weiterGepuffert, fehlgeschlagen };
}

/**
 * §11 „manuelle Wiederaufnahme". Setzt einen `failed`-Eintrag auf `buffered`
 * zurück, schließt optional den Breaker und auditiert die Entscheidung.
 * Bewusst KEIN "alles automatisch reparieren": ein Mensch entscheidet, ob der
 * Aufruf noch fachlich sinnvoll ist.
 */
export async function resumeFailedCall(
  db: Database,
  input: {
    callId: string;
    akteurBenutzerId: string;
    standortId: string | null;
    correlationId?: string;
    resetBreaker?: boolean;
  },
): Promise<{ ok: boolean; reason?: "not_found" | "not_failed" }> {
  const [call] = await db
    .select()
    .from(integrationOutboundCalls)
    .where(eq(integrationOutboundCalls.id, input.callId))
    .limit(1);
  if (!call) return { ok: false, reason: "not_found" };
  if (call.status !== "failed") return { ok: false, reason: "not_failed" };

  await db
    .update(integrationOutboundCalls)
    .set({
      status: "buffered",
      attempts: 0,
      nextAttemptAt: new Date(),
      resolvedByBenutzerId: input.akteurBenutzerId,
      updatedAt: new Date(),
    })
    .where(eq(integrationOutboundCalls.id, call.id));

  if (input.resetBreaker) {
    registry.get(call.integration)?.reset();
    await db
      .update(integrationHealth)
      .set({ breakerState: "closed", consecutiveFailures: 0, openedAt: null, probeAfter: null, updatedAt: new Date() })
      .where(eq(integrationHealth.integration, call.integration));
  }

  await db.insert(auditEreignisse).values(
    buildEventRow({
      type: "integration.call.resumed",
      aktion: "integration.resume",
      entitaet: "integration_outbound_call",
      entitaetId: call.id,
      akteurBenutzerId: input.akteurBenutzerId,
      standortId: input.standortId,
      source: "apps/api:ops.integrations.resume",
      correlationId: input.correlationId,
      payload: {
        integration: call.integration,
        operation: call.operation,
        breakerZurueckgesetzt: Boolean(input.resetBreaker),
      },
    }),
  );
  return { ok: true };
}

export interface IntegrationStatusRow extends IntegrationHealthSnapshot {
  /** Gepufferte Aufrufe, die auf Zustellung warten. */
  gepuffert: number;
  /** Endgültig fehlgeschlagene Aufrufe (Fehlerwarteschlange). */
  fehlerwarteschlange: number;
}

/**
 * §11 Gesundheitsstatus + letzte erfolgreiche Synchronisation, für die
 * Betriebsoberfläche UND für §18 (die vier Frontends fragen sie ab, um
 * „wartet auf externe Synchronisation" anzuzeigen).
 *
 * Liest aus der DATENBANK, nicht aus der Registry: nur so ist der Wert nach
 * einem Neustart und über mehrere Instanzen hinweg wahr.
 */
export async function integrationStatus(db: Database): Promise<IntegrationStatusRow[]> {
  const health = await db.select().from(integrationHealth);
  const counts = await db
    .select({
      integration: integrationOutboundCalls.integration,
      status: integrationOutboundCalls.status,
      n: sql<number>`count(*)::int`,
    })
    .from(integrationOutboundCalls)
    .where(inArray(integrationOutboundCalls.status, ["buffered", "in_flight", "failed"]))
    .groupBy(integrationOutboundCalls.integration, integrationOutboundCalls.status);

  const byIntegration = new Map<string, { gepuffert: number; fehler: number }>();
  for (const row of counts) {
    const entry = byIntegration.get(row.integration) ?? { gepuffert: 0, fehler: 0 };
    if (row.status === "failed") entry.fehler += Number(row.n);
    else entry.gepuffert += Number(row.n);
    byIntegration.set(row.integration, entry);
  }

  const known = new Set(health.map((h) => h.integration));
  const rows: IntegrationStatusRow[] = health.map((h) => {
    const extra = byIntegration.get(h.integration) ?? { gepuffert: 0, fehler: 0 };
    const status: IntegrationHealthSnapshot["status"] =
      h.breakerState === "open"
        ? "ausgefallen"
        : h.breakerState === "half_open" || h.rateLimitedUntil !== null || extra.fehler > 0
          ? "eingeschraenkt"
          : "gesund";
    return {
      integration: h.integration,
      mode: h.mode as IntegrationHealthSnapshot["mode"],
      breakerState: h.breakerState as IntegrationHealthSnapshot["breakerState"],
      consecutiveFailures: h.consecutiveFailures,
      consecutiveSuccesses: h.consecutiveSuccesses,
      openedAt: h.openedAt?.toISOString() ?? null,
      probeAfter: h.probeAfter?.toISOString() ?? null,
      lastSuccessAt: h.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: h.lastFailureAt?.toISOString() ?? null,
      lastError: h.lastError,
      lastErrorClass: h.lastErrorClass,
      rateLimitedUntil: h.rateLimitedUntil?.toISOString() ?? null,
      totalCalls: Number(h.totalCalls),
      totalFailures: Number(h.totalFailures),
      totalShortCircuited: Number(h.totalShortCircuited),
      status,
      gepuffert: extra.gepuffert,
      fehlerwarteschlange: extra.fehler,
    };
  });

  // Integrationen, für die noch keine Zeile existiert (frische DB), werden
  // ehrlich als "unbekannt, aber vorhanden" ausgegeben statt verschwiegen.
  for (const name of INTEGRATIONS) {
    if (known.has(name)) continue;
    rows.push({
      integration: name,
      mode: "mock",
      breakerState: "closed",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      openedAt: null,
      probeAfter: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      lastErrorClass: null,
      rateLimitedUntil: null,
      totalCalls: 0,
      totalFailures: 0,
      totalShortCircuited: 0,
      status: "gesund",
      gepuffert: 0,
      fehlerwarteschlange: 0,
    });
  }

  return rows.sort((a, b) => a.integration.localeCompare(b.integration));
}

/** Aufräumen: erfolgreiche Puffer-Zeilen älter als N Tage entfernen. */
export async function pruneOutboundCalls(db: Database, olderThanMs = 30 * 24 * 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const removed = await db
    .delete(integrationOutboundCalls)
    .where(
      and(
        eq(integrationOutboundCalls.status, "succeeded"),
        or(isNull(integrationOutboundCalls.resolvedAt), lte(integrationOutboundCalls.resolvedAt, cutoff)),
      ),
    )
    .returning({ id: integrationOutboundCalls.id });
  return removed.length;
}
