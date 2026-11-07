/**
 * Data of the psychology report (P08) for a period [from, to): check-in coverage and averages, the most named
 * feelings, the trackers with events in the period, the clearest mood / stress factor and one summary sentence.
 * Consumed by the Wachstum page; the P04 reports can read it for their "Psychologie" section. Pure.
 */
import type { DayNotes, EnrichedTrade } from "../types";
import type { BehaviorEvent } from "../coach/events";
import { journalRate } from "../coach/recommendations";
import { dayKeyOf } from "../insights/shared";
import { localDateKey } from "@/lib/dates";
import { checkinOf, hasCheckin, level5 } from "./checkin";
import { psychFactors, strongestFactors, type PsychFactor } from "./mood";
import { TRACKERS, type TrackerKey } from "./trackers";

export interface PsychReport {
  fromKey: string;
  toKey: string;
  /** days with a check-in / mood */
  checkins: number;
  /** days with trades */
  tradingDays: number;
  /** trading days that also had a check-in */
  coveredTradingDays: number;
  avg: { mood: number | null; stress: number | null; energy: number | null; sleep: number | null };
  emotions: { word: string; n: number }[];
  trackers: { key: TrackerKey; label: string; count: number }[];
  journalRate: number | null;
  factor: PsychFactor | null;
  sentence: string;
}

const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const DAY = 86_400_000;

export function psychReport({ days, list, events, from, to, currency = "" }: { days: DayNotes; list: readonly EnrichedTrade[]; events: readonly BehaviorEvent[]; from: number; to: number; currency?: string }): PsychReport {
  const fromKey = localDateKey(new Date(from));
  const toKey = localDateKey(new Date(Math.max(from, to - 1)));
  const inKey = (k: string) => k >= fromKey && k <= toKey;
  const inP = list.filter((t) => inKey(dayKeyOf(t)));
  const closed = inP.filter((t) => t.result !== "open");
  const keys = Object.keys(days).filter(inKey);
  const checked = keys.filter((k) => hasCheckin(days[k]));
  const tradeDays = new Set(inP.map(dayKeyOf));
  const covered = [...tradeDays].filter((k) => hasCheckin(days[k])).length;
  const cs = checked.map((k) => checkinOf(days[k]));
  const avg = {
    mood: mean(checked.map((k) => level5(days[k]?.mood)).filter((x): x is NonNullable<typeof x> => x != null)),
    stress: mean(cs.map((c) => c?.stress).filter((x): x is NonNullable<typeof x> => x != null)),
    energy: mean(cs.map((c) => c?.energy).filter((x): x is NonNullable<typeof x> => x != null)),
    sleep: mean(cs.map((c) => c?.sleep).filter((x): x is number => x != null)),
  };
  const words = new Map<string, number>();
  for (const c of cs) for (const w of c?.emotions ?? []) words.set(w, (words.get(w) ?? 0) + 1);
  const emotions = [...words].map(([word, n]) => ({ word, n })).sort((a, b) => b.n - a.n || a.word.localeCompare(b.word)).slice(0, 5);
  const evIn = events.filter((e) => e.at >= from && e.at < to);
  const trackers = TRACKERS.map((d) => ({ key: d.key, label: d.label, count: evIn.filter((e) => d.behaviors.includes(e.key)).length }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);
  const factor = strongestFactors(psychFactors({ days, closed, currency }))[0] ?? null;
  const jr = inP.length ? journalRate(inP) : null;

  const parts: string[] = [];
  const nDays = Math.max(1, Math.round((to - from) / DAY));
  parts.push(checked.length ? `${checked.length} Check-in${checked.length === 1 ? "" : "s"} in ${nDays} Tagen` : "Kein Check-in in diesem Zeitraum");
  if (tradeDays.size) parts.push(`${covered} von ${tradeDays.size} Handelstagen mit Check-in`);
  if (trackers[0]) parts.push(`häufigstes Muster: ${trackers[0].label} (${trackers[0].count}×)`);
  else if (inP.length) parts.push("keine auffälligen Muster");
  return {
    fromKey,
    toKey,
    checkins: checked.length,
    tradingDays: tradeDays.size,
    coveredTradingDays: covered,
    avg,
    emotions,
    trackers,
    journalRate: jr,
    factor,
    sentence: parts.join(" · ") + ".",
  };
}
