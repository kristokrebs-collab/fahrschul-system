/**
 * PROMPT -1 §9/§16 – Alarmierung.
 *
 * ## Was Phase 1 hier gelassen hat, und was Phase 3 daraus gemacht hat
 *
 * Phase 1 hatte einen einzigen, festen Sink, der strukturiert auf stderr
 * schrieb und Alarme im Prozess sammelte, und hat "den echten Sink"
 * ausdrücklich an §16 (Phase 3) abgegeben.
 *
 * Phase 3 macht daraus eine **Sink-Kette** statt eines Austauschs:
 *
 *  1. `stderrAlarmSink` – die bisherige, strukturierte stderr-Zeile. Sie
 *     bleibt, weil sie in jeder Umgebung funktioniert, auch wenn nichts
 *     anderes läuft.
 *  2. `logAlarmSink` – schreibt denselben Alarm als §16-Logzeile (mit
 *     Korrelations-ID, pseudonymisiertem Akteur, Redaktion).
 *  3. `metricsAlarmSink` – zählt Alarme als Kennzahl, damit "wie oft hat es
 *     heute Nacht gepiept" messbar ist statt erzählt.
 *  4. `createWebhookAlarmSink(...)` – der DOKUMENTIERTE KONFIGURATIONS-SEAM
 *     für einen echten Anbieter (PagerDuty/Opsgenie/Slack). Er ist
 *     implementiert, aber standardmäßig NICHT registriert, weil in dieser
 *     Umgebung kein Endpunkt existiert (docs/integration-gaps.md). Er wird
 *     aktiv, sobald `ALARM_WEBHOOK_URL` gesetzt ist – und er behauptet
 *     niemals Erfolg: schlägt der Versand fehl, bleibt der Alarm über die
 *     anderen Sinks sichtbar und der Fehlschlag wird protokolliert.
 *
 * Ein Sink darf NIEMALS werfen. Ein Fehler in der Alarmierung darf den
 * fachlichen Vorgang nicht kippen – das wäre die Alarmierung als
 * Ausfallursache. `emitAlarm` fängt deshalb pro Sink.
 */

import { incCounter, sanitizeLabelValue } from "../lib/metrics.js";
import { log, newCorrelationId } from "../lib/observability.js";

export type AlarmKind =
  | "dead_letter"
  | "job_stuck"
  | "consistency_findings"
  // Phase 3:
  | "integration_breaker_open"
  | "integration_error_queue"
  | "audit_tamper"
  | "brute_force_lockout"
  | "rate_limit_flood"
  | "document_scan_unavailable"
  | "sync_delay";

export type AlarmSeverity = "info" | "warning" | "critical";

export interface AlarmEvent {
  kind: AlarmKind;
  source?: string;
  sourceId?: string;
  subject: string;
  errorClass?: string;
  message?: string;
  details?: Record<string, unknown>;
  at?: Date;
  /** §16: dieselbe Korrelations-ID wie der auslösende Vorgang. */
  correlationId?: string;
  severity?: AlarmSeverity;
}

export type AlarmSink = (event: AlarmEvent) => void | Promise<void>;

// ---------------------------------------------------------------------------
// §16 Alarmkatalog: Schwelle, Zuständigkeit, Runbook, Eskalation
//
// Ein Alarm ohne Zuständigen ist ein Alarm, der niemanden erreicht. Der
// Katalog ist deshalb Code (typgeprüft, testbar) und nicht nur Prosa im
// Betriebshandbuch. `docs/failure-modes.md` verweist auf genau diese Tabelle.
// ---------------------------------------------------------------------------
export interface AlarmDefinition {
  kind: AlarmKind;
  severity: AlarmSeverity;
  /** Menschlich lesbare Schwelle, die den Alarm auslöst. */
  threshold: string;
  /** Kennzahl aus lib/metrics.ts, an der die Schwelle gemessen wird. */
  metric: string;
  owner: string;
  runbook: string;
  /** Was passiert, wenn niemand reagiert. */
  escalation: string;
}

export const ALARM_CATALOG: readonly AlarmDefinition[] = [
  {
    kind: "dead_letter",
    severity: "critical",
    threshold: "fahrschul_dead_letters_open > 0 für > 15 Minuten",
    metric: "fahrschul_dead_letters_open",
    owner: "Rolle systemdienst (Bereitschaft)",
    runbook: "docs/failure-modes.md#runbook-dead-letter-queue",
    escalation: "nach 30 Min. an Geschäftsführung; Zustellung bleibt gestoppt, Fachdaten sind konsistent",
  },
  {
    kind: "job_stuck",
    severity: "warning",
    threshold: "Job mit abgelaufenem Lease > 3 Wiederaufnahmen",
    metric: "fahrschul_job_queue_depth{status=\"in_progress\"}",
    owner: "Rolle systemdienst",
    runbook: "docs/failure-modes.md#runbook-haengende-jobs",
    escalation: "nach 60 Min. an Geschäftsführung; betroffene Automatik läuft nicht, manuelle Arbeit möglich",
  },
  {
    kind: "consistency_findings",
    severity: "warning",
    threshold: "§19-Lauf mit Befund der Schwere 'kritisch'",
    metric: "n/a (Befundtabelle consistency_findings)",
    owner: "Rolle systemdienst + Büro (fachliche Bewertung)",
    runbook: "docs/failure-modes.md#runbook-konsistenzbefunde",
    escalation: "täglicher Bericht an Geschäftsführung; Reparaturvorschläge werden NIE automatisch angewendet",
  },
  {
    kind: "integration_breaker_open",
    severity: "warning",
    threshold: "fahrschul_integration_breaker_open == 1 für > 5 Minuten",
    metric: "fahrschul_integration_breaker_open",
    owner: "Rolle systemdienst",
    runbook: "docs/failure-modes.md#runbook-externe-schnittstelle-offen",
    escalation: "nach 4 Stunden an Geschäftsführung; Kernsystem bleibt nutzbar, Änderungen sind gepuffert",
  },
  {
    kind: "integration_error_queue",
    severity: "warning",
    threshold: "fahrschul_integration_buffer_depth > 100 oder Fehlerwarteschlange > 0 für > 24 h",
    metric: "fahrschul_integration_buffer_depth",
    owner: "Rolle systemdienst",
    runbook: "docs/failure-modes.md#runbook-fehlerwarteschlange",
    escalation: "nach 24 Stunden an Büro (fachliche Nacharbeit) und Geschäftsführung",
  },
  {
    kind: "audit_tamper",
    severity: "critical",
    threshold: "Hash-Kettenprüfung meldet einen Inhalts- oder Verkettungsfehler (Anzahl > 0)",
    metric: "n/a (POST /ops/audit/verify)",
    owner: "Geschäftsführung + Rolle systemdienst, GEMEINSAM",
    runbook: "docs/security-architecture.md#runbook-audit-manipulation",
    escalation: "sofort; Vorfall ist meldepflichtig zu behandeln, keine stille Reparatur",
  },
  {
    kind: "brute_force_lockout",
    severity: "warning",
    threshold: "> 5 Sperren derselben IP innerhalb einer Stunde",
    metric: "fahrschul_login_failures_total",
    owner: "Rolle systemdienst",
    runbook: "docs/security-architecture.md#runbook-brute-force",
    escalation: "nach 3 Wiederholungen an Geschäftsführung; Entsperrung ausschließlich über den Entsperrpfad",
  },
  {
    kind: "rate_limit_flood",
    severity: "info",
    threshold: "fahrschul_rate_limited_total steigt > 100/Min. auf einer Route",
    metric: "fahrschul_rate_limited_total",
    owner: "Rolle systemdienst",
    runbook: "docs/security-architecture.md#runbook-rate-limiting",
    escalation: "keine automatische Eskalation; nur Bewertung, ob ein Limit falsch gesetzt ist",
  },
  {
    kind: "document_scan_unavailable",
    severity: "warning",
    threshold: "Malware-Scanner ausgefallen und > 0 Dokumente in Quarantäne wartend",
    metric: "fahrschul_document_scan_failures_total{reason=\"scanner_unavailable\"}",
    owner: "Rolle systemdienst; fachliche Info an Büro",
    runbook: "docs/failure-modes.md#runbook-dokumentscanner-aus",
    escalation: "nach 4 Stunden an Büro: Schüler informieren, dass die Prüfung länger dauert",
  },
  {
    kind: "sync_delay",
    severity: "warning",
    threshold: "fahrschul_sync_delay_seconds > 120 für > 5 Minuten",
    metric: "fahrschul_sync_delay_seconds",
    owner: "Rolle systemdienst",
    runbook: "docs/failure-modes.md#runbook-sync-verzoegerung",
    escalation: "nach 30 Min. an Geschäftsführung; Clients fallen auf Polling zurück, keine Datenverluste",
  },
];

export function alarmDefinition(kind: AlarmKind): AlarmDefinition | undefined {
  return ALARM_CATALOG.find((d) => d.kind === kind);
}

// ---------------------------------------------------------------------------
// Sinks
// ---------------------------------------------------------------------------

export const stderrAlarmSink: AlarmSink = (event) => {
  process.stderr.write(
    `[ALARM] ${JSON.stringify({ ...event, at: (event.at ?? new Date()).toISOString() })}\n`,
  );
};

export const logAlarmSink: AlarmSink = (event) => {
  const definition = alarmDefinition(event.kind);
  log({
    severity: (event.severity ?? definition?.severity) === "critical" ? "error" : "warn",
    requestId: event.sourceId ?? "alarm",
    correlationId: event.correlationId ?? newCorrelationId(),
    operation: `alarm.${event.kind}`,
    errorCode: event.errorClass ?? event.kind,
    message: event.message ?? event.subject,
    details: {
      alarmKind: event.kind,
      alarmSource: event.source,
      alarmSubject: event.subject,
      owner: definition?.owner,
      runbook: definition?.runbook,
      escalation: definition?.escalation,
      ...event.details,
    },
  });
};

export const metricsAlarmSink: AlarmSink = (event) => {
  const definition = alarmDefinition(event.kind);
  incCounter("fahrschul_alarms_total", "Ausgelöste Alarme nach Art und Schwere", {
    kind: sanitizeLabelValue(event.kind),
    severity: sanitizeLabelValue(event.severity ?? definition?.severity ?? "warning"),
  });
};

/**
 * Der Seam für einen echten Anbieter. Absichtlich `fetch`-basiert und
 * anbieterneutral: PagerDuty Events API, Opsgenie und ein Slack-Webhook
 * nehmen alle ein JSON-POST. Nicht getestet gegen einen echten Endpunkt –
 * das wäre eine Behauptung ohne Zugang (docs/integration-gaps.md).
 */
export function createWebhookAlarmSink(options: {
  url: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}): AlarmSink {
  return async (event) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
    const definition = alarmDefinition(event.kind);
    try {
      await fetch(options.url, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", ...(options.headers ?? {}) },
        body: JSON.stringify({
          kind: event.kind,
          severity: event.severity ?? definition?.severity ?? "warning",
          subject: event.subject,
          message: event.message,
          owner: definition?.owner,
          runbook: definition?.runbook,
          escalation: definition?.escalation,
          correlationId: event.correlationId,
          at: (event.at ?? new Date()).toISOString(),
        }),
      });
    } catch (err) {
      // KEIN erneutes Werfen: eine ausgefallene Alarmierung darf den
      // Fachvorgang nicht kippen. Der Fehlschlag wird selbst protokolliert,
      // damit "wir haben nichts gehört" von "es gab nichts" unterscheidbar ist.
      log({
        severity: "error",
        requestId: "alarm-webhook",
        correlationId: event.correlationId ?? newCorrelationId(),
        operation: "alarm.webhook.failed",
        errorCode: "ALARM_SINK_FAILED",
        message: (err as Error).message,
        details: { kind: event.kind },
      });
    } finally {
      clearTimeout(timer);
    }
  };
}

const recent: AlarmEvent[] = [];
const MAX_RECENT = 100;

let sinks: AlarmSink[] = [stderrAlarmSink, logAlarmSink, metricsAlarmSink];

/**
 * Ersetzt die Sink-Kette vollständig (Phase-1-Signatur, rückwärtskompatibel:
 * ein einzelner Sink ist erlaubt).
 */
export function setAlarmSink(next: AlarmSink | AlarmSink[]): void {
  sinks = Array.isArray(next) ? [...next] : [next];
}

/** Hängt einen Sink an, ohne die bestehenden zu verlieren. */
export function addAlarmSink(next: AlarmSink): void {
  sinks.push(next);
}

export function resetAlarmSinks(): void {
  sinks = [stderrAlarmSink, logAlarmSink, metricsAlarmSink];
}

export function activeAlarmSinkCount(): number {
  return sinks.length;
}

/**
 * Registriert den Webhook-Sink, WENN er konfiguriert ist. Wird in `buildApp`
 * aufgerufen. Ohne `ALARM_WEBHOOK_URL` passiert nichts – kein Fallback auf
 * einen erfundenen Endpunkt.
 */
export function configureAlarmSinksFromEnv(env: NodeJS.ProcessEnv = process.env): {
  webhook: boolean;
} {
  const url = env.ALARM_WEBHOOK_URL;
  if (url && /^https?:\/\//.test(url)) {
    addAlarmSink(
      createWebhookAlarmSink({
        url,
        timeoutMs: Number(env.ALARM_WEBHOOK_TIMEOUT_MS ?? 5000),
      }),
    );
    return { webhook: true };
  }
  return { webhook: false };
}

export async function emitAlarm(event: AlarmEvent): Promise<void> {
  const definition = alarmDefinition(event.kind);
  const enriched: AlarmEvent = {
    ...event,
    at: event.at ?? new Date(),
    severity: event.severity ?? definition?.severity ?? "warning",
  };
  recent.push(enriched);
  if (recent.length > MAX_RECENT) recent.shift();
  for (const sink of sinks) {
    try {
      await sink(enriched);
    } catch {
      // Siehe Modulkommentar: ein Sink darf den Vorgang nicht kippen.
    }
  }
}

/** Für Tests und die Ops-Route: die letzten Alarme dieses Prozesses. */
export function recentAlarms(): readonly AlarmEvent[] {
  return recent;
}

export function clearRecentAlarms(): void {
  recent.length = 0;
}
