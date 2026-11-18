/**
 * The Zustellprotokoll (F22) as data: one `DeliveryRecord` per message the alerts sent or held back, newest first,
 * capped. Kept free of the evaluation code so the always-loaded alert paths (signal check, box alerts) can log into it
 * without pulling the key-level evaluator into the first load.
 */
import { ALERT_STAGES, type AlertStage, type DeliveryChannel, type EventBasis } from "./types";

export type DeliveryOutcome = "sent" | "duplicate" | "hours" | "channels";

export const OUTCOME_LABEL: Readonly<Record<DeliveryOutcome, string>> = {
  sent: "gesendet",
  duplicate: "unterdrückt – Dublette",
  hours: "unterdrückt – außerhalb der Aktivzeit",
  channels: "unterdrückt – kein passender Kanal",
};

export interface DeliveryRecord {
  id: string;
  /** ms, device clock */
  at: number;
  /** `key` = a key level, `signal` / `box` = the existing alerts (logged only) */
  source: "key" | "signal" | "box";
  levelId: string | null;
  title: string;
  detail: string;
  stage: AlertStage | null;
  basis: EventBasis | null;
  channels: DeliveryChannel[];
  outcome: DeliveryOutcome;
  dedupeKey: string;
}

export const DELIVERY_LOG_CAP = 200;

/** Appends `rec` (newest first) and keeps the newest `cap` entries. */
export function appendDelivery(log: readonly DeliveryRecord[], rec: DeliveryRecord, cap: number = DELIVERY_LOG_CAP): DeliveryRecord[] {
  return [rec, ...log].slice(0, Math.max(1, cap));
}

/** Tolerant read of a stored log. */
export function parseDeliveryLog(raw: unknown, cap: number = DELIVERY_LOG_CAP): DeliveryRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: DeliveryRecord[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.at !== "number" || typeof o.title !== "string" || typeof o.dedupeKey !== "string") continue;
    if (o.outcome !== "sent" && o.outcome !== "duplicate" && o.outcome !== "hours" && o.outcome !== "channels") continue;
    out.push({
      id: o.id,
      at: o.at,
      source: o.source === "signal" || o.source === "box" ? o.source : "key",
      levelId: typeof o.levelId === "string" ? o.levelId : null,
      title: o.title,
      detail: typeof o.detail === "string" ? o.detail : "",
      stage: ALERT_STAGES.includes(o.stage as AlertStage) ? (o.stage as AlertStage) : null,
      basis: o.basis === "intrabar" || o.basis === "close" ? o.basis : null,
      channels: Array.isArray(o.channels) ? o.channels.filter((c): c is DeliveryChannel => c === "toast" || c === "system") : [],
      outcome: o.outcome,
      dedupeKey: o.dedupeKey,
    });
    if (out.length >= cap) break;
  }
  return out;
}
