/**
 * Personal bests and milestones (P08) – process records only (streaks, rule-keeping runs, reviewed trades, the best
 * discipline month). P&L, win rate and trade count never become a record here: growth is rewarded for HOW the trader
 * trades, not for how much. Pure.
 */
import { reviewed } from "../coach/recommendations";
import { triggerOf } from "../coach/behaviors";
import { hasCheckin } from "../psych/checkin";
import type { Prepared } from "./context";
import type { GrowthPrefs } from "./model";
import { streakBoard, tradeRun, type Streak } from "./streaks";

export type BestKey = "discipline" | "journal" | "checkin" | "green" | "ruleRun" | "reviewRun" | "disciplineMonth";

export interface PersonalBest {
  key: BestKey;
  label: string;
  value: number;
  valueText: string;
  /** the running streak / run IS the record right now */
  live: boolean;
  current: number;
}

const unitText = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const MONTH = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"] as const;
export const MIN_MONTH_DAYS = 5;

/** Best monthly Ø discipline score (months with ≥ `MIN_MONTH_DAYS` scored trading days). */
export function bestDisciplineMonth(p: Prepared): { value: number; month: string; current: boolean } | null {
  const by = new Map<string, number[]>();
  for (const d of p.discDays) {
    if (d.score == null) continue;
    const m = d.key.slice(0, 7);
    const arr = by.get(m) ?? [];
    arr.push(d.score);
    by.set(m, arr);
  }
  let best: { value: number; month: string; current: boolean } | null = null;
  for (const [m, xs] of by) {
    if (xs.length < MIN_MONTH_DAYS) continue;
    const v = xs.reduce((a, b) => a + b, 0) / xs.length;
    if (!best || v > best.value + 1e-9) best = { value: v, month: `${MONTH[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`, current: m === p.todayKey.slice(0, 7) };
  }
  return best;
}

export function personalBests(p: Prepared, streaks: readonly Streak[] = streakBoard(p)): PersonalBest[] {
  const out: PersonalBest[] = [];
  for (const s of streaks) {
    if (s.best <= 0) continue;
    out.push({ key: s.key, label: `Längste ${s.label}-Serie`, value: s.best, valueText: unitText(s.best, s.unit === "Tage" ? "Tag" : "Handelstag", s.unit), live: s.current > 0 && s.current >= s.best, current: s.current });
  }
  const breaks = new Set(p.events.filter((e) => e.key === "ruleViolation").map(triggerOf));
  const rules = tradeRun(p.closed, (t) => !breaks.has(t.id));
  if (rules.best > 0) out.push({ key: "ruleRun", label: "Trades ohne Regelverstoß", value: rules.best, valueText: unitText(rules.best, "Trade", "Trades"), live: rules.current > 0 && rules.current >= rules.best, current: rules.current });
  const rev = tradeRun(p.closed, reviewed);
  if (rev.best > 0) out.push({ key: "reviewRun", label: "Trades in Folge mit Review", value: rev.best, valueText: unitText(rev.best, "Trade", "Trades"), live: rev.current > 0 && rev.current >= rev.best, current: rev.current });
  const dm = bestDisciplineMonth(p);
  if (dm) out.push({ key: "disciplineMonth", label: `Bester Disziplin-Monat · ${dm.month}`, value: Math.round(dm.value), valueText: `${Math.round(dm.value)} %`, live: dm.current, current: dm.current ? Math.round(dm.value) : 0 });
  return out;
}

export interface Milestone {
  key: string;
  label: string;
  value: number;
  threshold: number;
  reached: boolean;
  /** 0–1 */
  progress: number;
}

const LADDERS: readonly { key: string; steps: readonly number[]; label: (n: number) => string }[] = [
  { key: "checkins", steps: [1, 10, 30, 100], label: (n) => (n === 1 ? "Erster Check-in" : `${n} Check-ins`) },
  { key: "reviews", steps: [10, 50, 200], label: (n) => `${n} Trades mit Review` },
  { key: "discipline", steps: [5, 10, 20], label: (n) => `${n} Handelstage Disziplin-Serie` },
  { key: "green", steps: [5, 10, 20], label: (n) => `${n} grüne Tage in Folge` },
  { key: "challenges", steps: [1, 3, 10], label: (n) => (n === 1 ? "Erste Challenge gemeistert" : `${n} Challenges gemeistert`) },
  { key: "goals", steps: [1, 5], label: (n) => (n === 1 ? "Erstes Ziel erreicht" : `${n} Ziele erreicht`) },
];

/** Every milestone of the ladders (value vs threshold). */
export function milestones(p: Prepared, prefs: GrowthPrefs, streaks: readonly Streak[] = streakBoard(p)): Milestone[] {
  const best = (k: string) => streaks.find((s) => s.key === k)?.best ?? 0;
  const values: Record<string, number> = {
    checkins: Object.keys(p.days).filter((k) => hasCheckin(p.days[k])).length,
    reviews: p.closed.filter(reviewed).length,
    discipline: best("discipline"),
    green: best("green"),
    challenges: prefs.challenges.filter((c) => c.status === "done").length,
    goals: prefs.goals.filter((g) => g.status === "done").length,
  };
  const out: Milestone[] = [];
  for (const l of LADDERS) {
    const v = values[l.key] ?? 0;
    for (const n of l.steps) out.push({ key: `${l.key}:${n}`, label: l.label(n), value: v, threshold: n, reached: v >= n, progress: Math.max(0, Math.min(1, v / n)) });
  }
  return out;
}

/** "Trade the best": the reached count and the next few milestones closest to being reached. */
export function nextMilestones(list: readonly Milestone[], max = 3): { reached: number; total: number; next: Milestone[] } {
  const open = list.filter((m) => !m.reached);
  // per ladder only its next step
  const firstPer = new Map<string, Milestone>();
  for (const m of open) {
    const ladder = m.key.split(":")[0]!;
    if (!firstPer.has(ladder)) firstPer.set(ladder, m);
  }
  const next = [...firstPer.values()].sort((a, b) => b.progress - a.progress || a.threshold - b.threshold).slice(0, max);
  return { reached: list.filter((m) => m.reached).length, total: list.length, next };
}
