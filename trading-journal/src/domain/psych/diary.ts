/**
 * Emotion diary (P08): one entry per local day that has anything to say – the check-in (mood, stress, energy, sleep,
 * words), the day texts (plan, note, review), the trades of the day with their psyche (pre / post notes, flags,
 * stress) and the coach's behaviour events. Newest LAST (a timeline is scrubbed left → right). Pure.
 */
import type { DayNotes, EnrichedTrade } from "../types";
import type { BehaviorEvent } from "../coach/events";
import { BEHAVIOR_LABEL } from "../coach/events";
import { dayFromKey, dayKeyOf } from "../insights/shared";
import { localDateKey } from "@/lib/dates";
import { checkinOf, emotionTone, level5, type CheckIn, type Level5 } from "./checkin";

export interface DiaryTrade {
  id: string;
  pair: string;
  side: "long" | "short";
  result: EnrichedTrade["result"];
  r: number | null;
  pnl: number | null;
  stress: number | null;
  flags: string[];
  preNote: string;
  postNote: string;
}

export interface DiaryDay {
  key: string;
  /** "Mo 12.10." */
  label: string;
  mood: Level5 | null;
  checkin: CheckIn | null;
  plan: string;
  note: string;
  review: string;
  trades: DiaryTrade[];
  /** behaviour events triggered that day (labels, de-duplicated by key) */
  patterns: string[];
  /** −1 (a tense / bad day) … 1 (a calm / good day), from mood, stress and the words; `null` without a feeling */
  feel: number | null;
}

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;
const p2 = (n: number) => String(n).padStart(2, "0");
export const dayLabel = (key: string): string => {
  const d = dayFromKey(key);
  return `${WD[d.getDay()]} ${p2(d.getDate())}.${p2(d.getMonth() + 1)}.`;
};

/** Feeling score of a day: mood (centred), inverted stress and the words' tones, averaged. */
export function feelOf(mood: Level5 | null, c: CheckIn | null): number | null {
  const parts: number[] = [];
  if (mood != null) parts.push((mood - 3) / 2);
  if (c?.stress != null) parts.push((3 - c.stress) / 2);
  if (c?.energy != null) parts.push(((c.energy - 3) / 2) * 0.5);
  if (c?.emotions.length) {
    const t = c.emotions.map((w) => (emotionTone(w) === "pos" ? 1 : emotionTone(w) === "neg" ? -1 : 0) as number);
    parts.push(t.reduce((a, b) => a + b, 0) / t.length);
  }
  if (!parts.length) return null;
  return Math.max(-1, Math.min(1, parts.reduce((a, b) => a + b, 0) / parts.length));
}

/** Diary days in [fromKey, toKey] (inclusive, `YYYY-MM-DD`), oldest first; days with nothing are left out. */
export function diaryDays({ days, list, events, fromKey, toKey }: { days: DayNotes; list: readonly EnrichedTrade[]; events: readonly BehaviorEvent[]; fromKey: string; toKey: string }): DiaryDay[] {
  const inRange = (k: string) => k >= fromKey && k <= toKey;
  const trades = new Map<string, EnrichedTrade[]>();
  for (const t of list) {
    const k = dayKeyOf(t);
    if (!inRange(k)) continue;
    const arr = trades.get(k);
    if (arr) arr.push(t);
    else trades.set(k, [t]);
  }
  const pats = new Map<string, string[]>();
  for (const e of events) {
    const k = localDateKey(new Date(e.at));
    if (!inRange(k)) continue;
    const arr = pats.get(k) ?? [];
    const label = BEHAVIOR_LABEL[e.key];
    if (!arr.includes(label)) arr.push(label);
    pats.set(k, arr);
  }
  const keys = new Set<string>([...trades.keys(), ...pats.keys(), ...Object.keys(days).filter(inRange)]);
  const out: DiaryDay[] = [];
  for (const key of [...keys].sort()) {
    const note = days[key];
    const checkin = checkinOf(note);
    const mood = level5(note?.mood);
    const ts = (trades.get(key) ?? []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const d: DiaryDay = {
      key,
      label: dayLabel(key),
      mood,
      checkin,
      plan: (note?.plan ?? "").trim(),
      note: (note?.note ?? "").trim(),
      review: (note?.review ?? "").trim(),
      trades: ts.map((t) => ({
        id: t.id,
        pair: t.pair,
        side: t.side,
        result: t.result,
        r: t.r,
        pnl: t.pnl,
        stress: level5(t.psych?.stress),
        flags: [...(t.psych?.flags ?? [])],
        preNote: (t.psych?.preNote ?? "").trim(),
        postNote: (t.psych?.postNote ?? "").trim(),
      })),
      patterns: pats.get(key) ?? [],
      feel: feelOf(mood, checkin),
    };
    const empty = !d.checkin && d.mood == null && !d.plan && !d.note && !d.review && !d.trades.length && !d.patterns.length;
    if (!empty) out.push(d);
  }
  return out;
}

/** One-line summary of a diary day ("Gut · Stress 2 · 7,5 h · Fokussiert, Ruhig"). */
export function diarySummary(d: Pick<DiaryDay, "mood" | "checkin">, moodLabels: readonly string[]): string {
  const parts: string[] = [];
  if (d.mood != null) parts.push(moodLabels[d.mood - 1] ?? "");
  if (d.checkin?.stress != null) parts.push(`Stress ${d.checkin.stress}`);
  if (d.checkin?.sleep != null) parts.push(`${String(d.checkin.sleep).replace(".", ",")} h`);
  if (d.checkin?.emotions.length) parts.push(d.checkin.emotions.slice(0, 3).join(", "));
  return parts.filter(Boolean).join(" · ");
}
