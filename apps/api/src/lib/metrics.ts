/**
 * PROMPT -1 §16 – Kennzahlen, abrufbar im Prometheus-Textformat.
 *
 * Warum eigenhändig und nicht `prom-client`? Weil in dieser Umgebung kein
 * Prometheus/Grafana-Stack existiert (docs/integration-gaps.md) und eine
 * zusätzliche Laufzeitabhängigkeit hier nichts beweisen würde. Das
 * EXPOSITIONSFORMAT ist dagegen das echte (`text/plain; version=0.0.4`),
 * damit ein Prometheus-Scrape ohne Codeänderung funktioniert – der Betreiber
 * muss nur `GET /metrics` in seine `scrape_configs` aufnehmen.
 *
 * ## Die elf geforderten Kennzahlen und wo sie herkommen
 *
 * | § | Kennzahl | Quelle |
 * | --- | --- | --- |
 * | 1 | API-Fehlerquote | `http_requests_total{status_class}` (Zähler je Klasse) |
 * | 2 | API-Latenz | `http_request_duration_seconds` (Histogramm) |
 * | 3 | DB-Verbindungen | `db_connections` (Gauge, aus `pg_stat_activity`) |
 * | 4 | Warteschlangenlänge | `job_queue_depth{status}` + `outbox_depth{status}` |
 * | 5 | Retry-Zahl | `retries_total{source}` |
 * | 6 | Dead Letters | `dead_letters_open` (Gauge) + `dead_letters_total` |
 * | 7 | Sync-Verzögerung | `sync_delay_seconds` (ältestes unzugestelltes Ereignis) |
 * | 8 | SSE-Verbindungen | `realtime_connections` (Gauge) |
 * | 9 | Fehlgeschlagene Logins | `login_failures_total{reason}` |
 * | 10 | Buchungskonflikte | `booking_conflicts_total{kind}` |
 * | 11 | Zahlungszuordnungsfehler | `payment_match_failures_total{reason}` |
 * | + | Dokument-Scanfehler | `document_scan_failures_total{reason}` |
 *
 * ## Redaktionsvertrag gilt auch hier
 *
 * Labels sind eine FRISCHE Leckstelle: ein Label mit Schüler-ID oder
 * Fahrlehrer-Notiz wäre in Prometheus für immer sichtbar. Deshalb ist die
 * Label-Menge geschlossen (`sanitizeLabelValue` + feste Label-Namen je
 * Kennzahl) und es gibt keinen Weg, freien Text als Label zu übergeben:
 * unbekannte Werte werden auf `other` abgebildet.
 */

export type MetricType = "counter" | "gauge" | "histogram";

interface CounterState {
  type: "counter";
  help: string;
  values: Map<string, number>;
}

interface GaugeState {
  type: "gauge";
  help: string;
  values: Map<string, number>;
}

interface HistogramState {
  type: "histogram";
  help: string;
  buckets: readonly number[];
  /** labelKey -> { counts je Bucket, sum, count } */
  values: Map<string, { counts: number[]; sum: number; count: number }>;
}

type MetricState = CounterState | GaugeState | HistogramState;

const registry = new Map<string, MetricState>();

/** Erlaubte Zeichen in einem Labelwert. Alles andere wird ersetzt. */
export function sanitizeLabelValue(value: string, allowed?: readonly string[]): string {
  // `/` ist erlaubt, weil Routen-Labels sonst unlesbar würden
  // (`_office_schueler_:id`). Anführungszeichen und Backslashes NICHT – sie
  // würden das Prometheus-Textformat zerbrechen.
  const cleaned = value.replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 64);
  if (allowed && !allowed.includes(cleaned)) return "other";
  return cleaned.length > 0 ? cleaned : "unknown";
}

function labelKey(labels: Record<string, string>): string {
  const entries = Object.entries(labels)
    .map(([k, v]) => [k, sanitizeLabelValue(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${k}="${v}"`).join(",");
}

function ensureCounter(name: string, help: string): CounterState {
  const existing = registry.get(name);
  if (existing && existing.type === "counter") return existing;
  const state: CounterState = { type: "counter", help, values: new Map() };
  registry.set(name, state);
  return state;
}

function ensureGauge(name: string, help: string): GaugeState {
  const existing = registry.get(name);
  if (existing && existing.type === "gauge") return existing;
  const state: GaugeState = { type: "gauge", help, values: new Map() };
  registry.set(name, state);
  return state;
}

function ensureHistogram(name: string, help: string, buckets: readonly number[]): HistogramState {
  const existing = registry.get(name);
  if (existing && existing.type === "histogram") return existing;
  const state: HistogramState = { type: "histogram", help, buckets, values: new Map() };
  registry.set(name, state);
  return state;
}

export function incCounter(
  name: string,
  help: string,
  labels: Record<string, string> = {},
  by = 1,
): void {
  const state = ensureCounter(name, help);
  const key = labelKey(labels);
  state.values.set(key, (state.values.get(key) ?? 0) + by);
}

export function setGauge(
  name: string,
  help: string,
  value: number,
  labels: Record<string, string> = {},
): void {
  const state = ensureGauge(name, help);
  state.values.set(labelKey(labels), value);
}

export function observeHistogram(
  name: string,
  help: string,
  value: number,
  buckets: readonly number[],
  labels: Record<string, string> = {},
): void {
  const state = ensureHistogram(name, help, buckets);
  const key = labelKey(labels);
  let entry = state.values.get(key);
  if (!entry) {
    entry = { counts: new Array(state.buckets.length).fill(0), sum: 0, count: 0 };
    state.values.set(key, entry);
  }
  for (let i = 0; i < state.buckets.length; i += 1) {
    if (value <= state.buckets[i]) entry.counts[i] += 1;
  }
  entry.sum += value;
  entry.count += 1;
}

export function getMetricValue(name: string, labels: Record<string, string> = {}): number | null {
  const state = registry.get(name);
  if (!state) return null;
  const key = labelKey(labels);
  if (state.type === "histogram") return state.values.get(key)?.count ?? null;
  return state.values.get(key) ?? null;
}

/** Summe über ALLE Labelkombinationen einer Kennzahl. */
export function sumMetric(name: string): number {
  const state = registry.get(name);
  if (!state) return 0;
  if (state.type === "histogram") {
    let total = 0;
    for (const entry of state.values.values()) total += entry.count;
    return total;
  }
  let total = 0;
  for (const v of state.values.values()) total += v;
  return total;
}

export function resetMetrics(): void {
  registry.clear();
}

// ---------------------------------------------------------------------------
// Namen + Hilfen der elf Kennzahlen. Zentral, damit kein Aufrufer einen
// Tippfehler in einen Kennzahlnamen einbaut (Prometheus würde ihn stumm als
// neue Zeitreihe akzeptieren).
// ---------------------------------------------------------------------------
export const METRIC = {
  httpRequests: "fahrschul_http_requests_total",
  httpDuration: "fahrschul_http_request_duration_seconds",
  dbConnections: "fahrschul_db_connections",
  jobQueueDepth: "fahrschul_job_queue_depth",
  outboxDepth: "fahrschul_outbox_depth",
  retries: "fahrschul_retries_total",
  deadLettersOpen: "fahrschul_dead_letters_open",
  deadLetters: "fahrschul_dead_letters_total",
  syncDelay: "fahrschul_sync_delay_seconds",
  realtimeConnections: "fahrschul_realtime_connections",
  loginFailures: "fahrschul_login_failures_total",
  bookingConflicts: "fahrschul_booking_conflicts_total",
  paymentMatchFailures: "fahrschul_payment_match_failures_total",
  documentScanFailures: "fahrschul_document_scan_failures_total",
  rateLimited: "fahrschul_rate_limited_total",
  integrationCalls: "fahrschul_integration_calls_total",
  integrationBreakerOpen: "fahrschul_integration_breaker_open",
  integrationBufferDepth: "fahrschul_integration_buffer_depth",
  stepUpChallenges: "fahrschul_step_up_challenges_total",
} as const;

export const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

/** §16.1/§16.2 – Fehlerquote und Latenz. */
export function recordHttpRequest(input: {
  method: string;
  route: string;
  status: number;
  durationMs: number;
}): void {
  const statusClass = `${Math.floor(input.status / 100)}xx`;
  const labels = {
    method: input.method.toUpperCase(),
    route: input.route,
    status_class: statusClass,
  };
  incCounter(METRIC.httpRequests, "HTTP-Anfragen nach Methode, Route und Statusklasse", labels);
  observeHistogram(
    METRIC.httpDuration,
    "Antwortzeit der API in Sekunden",
    input.durationMs / 1000,
    LATENCY_BUCKETS,
    { method: input.method.toUpperCase(), route: input.route },
  );
}

const LOGIN_FAILURE_REASONS = [
  "unknown_account",
  "wrong_password",
  "mfa_missing_or_invalid",
  "mfa_setup_required",
  "locked",
  "rate_limited",
  "inactive",
] as const;
export type LoginFailureReason = (typeof LOGIN_FAILURE_REASONS)[number];

/** §16.9 – fehlgeschlagene Anmeldungen. */
export function recordLoginFailure(reason: LoginFailureReason): void {
  incCounter(METRIC.loginFailures, "Fehlgeschlagene Anmeldeversuche nach Grund", {
    reason: sanitizeLabelValue(reason, LOGIN_FAILURE_REASONS),
  });
}

const BOOKING_CONFLICT_KINDS = [
  "fahrlehrer_overlap",
  "fahrzeug_overlap",
  "offer_taken",
  "offer_expired",
  "version_conflict",
  "vehicle_blocked",
  "other",
] as const;
export type BookingConflictKind = (typeof BOOKING_CONFLICT_KINDS)[number];

/** §16.10 – Buchungskonflikte. */
export function recordBookingConflict(kind: BookingConflictKind): void {
  incCounter(METRIC.bookingConflicts, "Erkannte Terminkonflikte nach Art", {
    kind: sanitizeLabelValue(kind, BOOKING_CONFLICT_KINDS),
  });
}

const PAYMENT_FAILURE_REASONS = [
  "ambiguous",
  "review_required",
  "overbooked",
  "invoice_not_found",
  "constraint",
  "other",
] as const;
export type PaymentMatchFailureReason = (typeof PAYMENT_FAILURE_REASONS)[number];

/** §16.11 – Fehler bei der Zahlungszuordnung. */
export function recordPaymentMatchFailure(reason: PaymentMatchFailureReason): void {
  incCounter(METRIC.paymentMatchFailures, "Fehlgeschlagene Zahlungszuordnungen nach Grund", {
    reason: sanitizeLabelValue(reason, PAYMENT_FAILURE_REASONS),
  });
}

const SCAN_FAILURE_REASONS = [
  "malware_flagged",
  "scanner_unavailable",
  "mime_mismatch",
  "unsupported_type",
  "too_large",
  "checksum_mismatch",
  "empty",
  "other",
] as const;
export type DocumentScanFailureReason = (typeof SCAN_FAILURE_REASONS)[number];

/** §16.12 – Dokument-Scanfehler. */
export function recordDocumentScanFailure(reason: DocumentScanFailureReason): void {
  incCounter(METRIC.documentScanFailures, "Fehlgeschlagene Dokumentprüfungen/-scans nach Grund", {
    reason: sanitizeLabelValue(reason, SCAN_FAILURE_REASONS),
  });
}

/** §16.5 – Wiederholungen (Outbox, Jobs, Integrationen). */
export function recordRetry(source: "outbox" | "job" | "integration"): void {
  incCounter(METRIC.retries, "Wiederholungsversuche nach Quelle", { source });
}

/** §16.6 – Dead Letters (Zähler; die offene Tiefe ist ein Gauge, siehe collectDbMetrics). */
export function recordDeadLetter(source: string): void {
  incCounter(METRIC.deadLetters, "In die Dead-Letter-Queue verschobene Vorgänge", {
    source: sanitizeLabelValue(source, ["outbox", "job", "integration", "other"]),
  });
}

export function recordRateLimited(scope: "ip" | "account" | "global", route: string): void {
  incCounter(METRIC.rateLimited, "Mit HTTP 429 abgewiesene Anfragen", {
    scope,
    route: sanitizeLabelValue(route),
  });
}

export function recordStepUpChallenge(outcome: "required" | "granted" | "rejected"): void {
  incCounter(METRIC.stepUpChallenges, "Step-up-Authentisierungen nach Ergebnis", { outcome });
}

// ---------------------------------------------------------------------------
// §16.8 – offene Realtime-Verbindungen (Prozessspeicher, weil die Verbindung
// selbst am Prozess hängt).
// ---------------------------------------------------------------------------
let realtimeConnections = 0;

export function realtimeConnectionOpened(): void {
  realtimeConnections += 1;
  setGauge(METRIC.realtimeConnections, "Offene SSE-Verbindungen dieses Prozesses", realtimeConnections);
}

export function realtimeConnectionClosed(): void {
  realtimeConnections = Math.max(0, realtimeConnections - 1);
  setGauge(METRIC.realtimeConnections, "Offene SSE-Verbindungen dieses Prozesses", realtimeConnections);
}

export function currentRealtimeConnections(): number {
  return realtimeConnections;
}

// ---------------------------------------------------------------------------
// Prometheus-Textformat
// ---------------------------------------------------------------------------

export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

function renderLabels(key: string, extra?: string): string {
  const parts = [key, extra].filter((p) => p && p.length > 0);
  return parts.length > 0 ? `{${parts.join(",")}}` : "";
}

export function renderPrometheus(): string {
  const lines: string[] = [];
  for (const [name, state] of [...registry.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    lines.push(`# HELP ${name} ${state.help}`);
    lines.push(`# TYPE ${name} ${state.type}`);
    if (state.type === "histogram") {
      for (const [key, entry] of state.values) {
        for (let i = 0; i < state.buckets.length; i += 1) {
          lines.push(`${name}_bucket${renderLabels(key, `le="${state.buckets[i]}"`)} ${entry.counts[i]}`);
        }
        lines.push(`${name}_bucket${renderLabels(key, 'le="+Inf"')} ${entry.count}`);
        lines.push(`${name}_sum${renderLabels(key)} ${entry.sum}`);
        lines.push(`${name}_count${renderLabels(key)} ${entry.count}`);
      }
    } else {
      for (const [key, value] of state.values) {
        lines.push(`${name}${renderLabels(key)} ${value}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
