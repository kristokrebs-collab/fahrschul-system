/**
 * Psych trackers (P08): FOMO, Revenge, Selbstüberschätzung, Impulsivität, Verlustangst and Gewinnmitnahme – built
 * ONLY from what the journal already knows, never re-derived:
 *   - the coach's behaviour events (P04 `detectBehaviors`; they already include the trader's own psych flags from the
 *     trade editor, P06 `psych.flags`, and the emotion / mistake tags),
 *   - the day check-ins' emotion words (self-reported, counted separately – a feeling is not a mistake).
 * Pure, deterministic, `now` injected. No clinical language: patterns, not diagnoses.
 */
import type { DayNotes, EnrichedTrade } from "../types";
import type { BehaviorEvent, BehaviorKey } from "../coach/events";
import { behaviorReport, triggerOf } from "../coach/behaviors";
import { localDateKey } from "@/lib/dates";
import { checkinOf } from "./checkin";

export type TrackerKey = "fomo" | "revenge" | "overconfidence" | "impulsive" | "lossAversion" | "profitTaking";

export interface TrackerDef {
  key: TrackerKey;
  label: string;
  /** coach behaviour keys that count for this tracker */
  behaviors: readonly BehaviorKey[];
  /** check-in words that count as "selbst bemerkt" */
  words: readonly string[];
  /** one short German line: what it means */
  hint: string;
}

export const TRACKERS: readonly TrackerDef[] = [
  { key: "fomo", label: "FOMO", behaviors: ["fomo"], words: ["FOMO"], hint: "Einstieg hinterhergelaufen statt geplant." },
  { key: "revenge", label: "Revenge", behaviors: ["revenge", "tilt"], words: ["Gereizt"], hint: "Nach Verlusten schnell wieder rein." },
  { key: "overconfidence", label: "Selbstüberschätzung", behaviors: ["overconfidence"], words: ["Euphorisch"], hint: "Nach Gewinnen größer als sonst." },
  { key: "impulsive", label: "Impulsivität", behaviors: ["impulsive", "boredom", "overtrading"], words: ["Ungeduldig", "Gelangweilt"], hint: "Trades ohne Grundlage oder aus Langeweile." },
  { key: "lossAversion", label: "Verlustangst", behaviors: ["lossAversion", "stopMoved"], words: ["Nervös"], hint: "Verlierer zu lange gehalten, Stop verschoben." },
  { key: "profitTaking", label: "Gewinnmitnahme", behaviors: ["earlyProfit"], words: [], hint: "Gewinner zu früh geschlossen." },
];

export const TRACKER_WINDOW_DAYS = 30;
export const TRACKER_WEEKS = 8;
const DAY = 86_400_000;

export type TrackerLevel = "ruhig" | "selten" | "häufig";

export interface Tracker {
  key: TrackerKey;
  label: string;
  hint: string;
  /** events in the last `TRACKER_WINDOW_DAYS` days */
  count: number;
  /** events in the 30 days before that */
  previous: number;
  /** "weniger" | "mehr" | "gleich" against the previous window */
  trend: "down" | "up" | "flat";
  /** events per week, oldest first (`TRACKER_WEEKS` weeks ending with the current one) */
  weekly: number[];
  /** days in the window on which the trader named a matching feeling in the check-in */
  selfReported: number;
  /** Σ R of the triggering closed trades against clean trades (< 0 = it cost), whole journal; `null` without R */
  costR: number | null;
  /** epoch ms of the newest event, `null` without one */
  last: number | null;
  /** triggering trade ids in the window, newest first (evidence) */
  tradeIds: string[];
  level: TrackerLevel;
}

export interface TrackerInput {
  events: readonly BehaviorEvent[];
  closed: readonly EnrichedTrade[];
  days?: DayNotes;
  now: number;
}

const levelOf = (count: number): TrackerLevel => (count === 0 ? "ruhig" : count <= 2 ? "selten" : "häufig");

/** Every tracker, the most frequent first (ties: the most expensive first). */
export function psychTrackers({ events, closed, days = {}, now }: TrackerInput): Tracker[] {
  const from = now - TRACKER_WINDOW_DAYS * DAY;
  const prevFrom = from - TRACKER_WINDOW_DAYS * DAY;
  const report = behaviorReport(events, closed);
  const weekStartMs = (() => {
    const d = new Date(now);
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
    return +s;
  })();
  const weekFrom = (i: number) => {
    const d = new Date(weekStartMs);
    d.setDate(d.getDate() - 7 * (TRACKER_WEEKS - 1 - i));
    return +d;
  };
  const dayKeys: string[] = [];
  for (let t = from; t <= now; t += DAY) dayKeys.push(localDateKey(new Date(t)));

  const out = TRACKERS.map((def): Tracker => {
    const keys = new Set<BehaviorKey>(def.behaviors);
    const mine = events.filter((e) => keys.has(e.key) && e.at <= now);
    const inWin = mine.filter((e) => e.at >= from);
    const prev = mine.filter((e) => e.at >= prevFrom && e.at < from).length;
    const weekly = Array.from({ length: TRACKER_WEEKS }, (_, i) => {
      const a = weekFrom(i);
      const b = i === TRACKER_WEEKS - 1 ? now + 1 : weekFrom(i + 1);
      return mine.filter((e) => e.at >= a && e.at < b).length;
    });
    let selfReported = 0;
    if (def.words.length)
      for (const k of new Set(dayKeys)) {
        const c = checkinOf(days[k]);
        if (c && c.emotions.some((w) => def.words.includes(w))) selfReported++;
      }
    const stats = report.stats.filter((s) => keys.has(s.key));
    const rs = stats.map((s) => s.excessR).filter((x): x is number => x != null);
    const costR = rs.length ? rs.reduce((a, b) => a + b, 0) : null;
    const ids: string[] = [];
    for (let i = inWin.length - 1; i >= 0; i--) {
      const id = triggerOf(inWin[i]!);
      if (id && !ids.includes(id)) ids.push(id);
    }
    const count = inWin.length;
    return {
      key: def.key,
      label: def.label,
      hint: def.hint,
      count,
      previous: prev,
      trend: count < prev ? "down" : count > prev ? "up" : "flat",
      weekly,
      selfReported,
      costR,
      last: mine.length ? mine[mine.length - 1]!.at : null,
      tradeIds: ids,
      level: levelOf(count),
    };
  });
  return out.sort((a, b) => b.count - a.count || (a.costR ?? 0) - (b.costR ?? 0));
}

/** The tracker that needs attention most (`null` when every tracker is quiet). */
export function topTracker(trackers: readonly Tracker[]): Tracker | null {
  const t = trackers[0];
  return t && t.count > 0 ? t : null;
}

/** "3× in 30 Tagen · weniger als davor" */
export function trackerLine(t: Pick<Tracker, "count" | "previous" | "trend">): string {
  if (t.count === 0) return t.previous > 0 ? `Ruhig in 30 Tagen · davor ${t.previous}×` : "Ruhig in 30 Tagen";
  const trend = t.trend === "down" ? "weniger als davor" : t.trend === "up" ? "mehr als davor" : "wie davor";
  return `${t.count}× in 30 Tagen · ${trend}`;
}
