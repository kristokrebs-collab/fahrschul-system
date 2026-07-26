/**
 * PROMPT -1 §9 – Alarm-Hook für die Dead-Letter-Queue.
 *
 * BEWUSSTE LÜCKE / SEAM: In dieser Umgebung existiert kein echter Alerting-
 * Kanal (kein PagerDuty/Opsgenie/Slack-Webhook, siehe
 * docs/integration-gaps.md). Statt eine funktionierende Alarmierung zu
 * behaupten, ist der Hook hier ein registrierbarer Sink mit einem
 * Default-Sink, der strukturiert auf stderr schreibt und die Alarme im
 * Prozess sammelt (damit Tests beweisen können, DASS alarmiert wurde).
 *
 * PHASE 3 (§16 Observability) besitzt die echte Anbindung: sie ersetzt
 * `setAlarmSink(...)` durch einen Metrik-/Alerting-Adapter. Die Signatur ist
 * deshalb absichtlich schmal und transportneutral.
 */

export interface AlarmEvent {
  kind: "dead_letter" | "job_stuck" | "consistency_findings";
  source?: string;
  sourceId?: string;
  subject: string;
  errorClass?: string;
  message?: string;
  details?: Record<string, unknown>;
  at?: Date;
}

export type AlarmSink = (event: AlarmEvent) => void | Promise<void>;

const recent: AlarmEvent[] = [];
const MAX_RECENT = 100;

let sink: AlarmSink = (event) => {
  // Strukturierte Zeile – Phase 3 ersetzt das durch den echten Kanal.
  process.stderr.write(
    `[ALARM] ${JSON.stringify({ ...event, at: (event.at ?? new Date()).toISOString() })}\n`,
  );
};

export function setAlarmSink(next: AlarmSink): void {
  sink = next;
}

export async function emitAlarm(event: AlarmEvent): Promise<void> {
  const enriched = { ...event, at: event.at ?? new Date() };
  recent.push(enriched);
  if (recent.length > MAX_RECENT) recent.shift();
  await sink(enriched);
}

/** Für Tests und die Ops-Route: die letzten Alarme dieses Prozesses. */
export function recentAlarms(): readonly AlarmEvent[] {
  return recent;
}

export function clearRecentAlarms(): void {
  recent.length = 0;
}
