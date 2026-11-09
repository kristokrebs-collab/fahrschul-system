/**
 * Challenges (P08) – time-boxed process challenges. They never need a trade to be won: a CLEAN challenge is won when
 * its days pass without a violation (no trade at all is fine – not trading is never punished), a COUNT challenge
 * when the trader did the routine on enough days (check-ins, plans). Violations come from the journal and the
 * coach's behaviour events (P04) – nothing is ticked by hand. Pure; `challengeProgress` is what the cards and the
 * status write-back read.
 */
import type { BehaviorKey } from "../coach/events";
import { reviewed } from "../coach/recommendations";
import { accountOf, dayFromKey } from "../insights/shared";
import { hasCheckin } from "../psych/checkin";
import { localDateKey, tradeTime } from "@/lib/dates";
import type { TrackerKey } from "../psych/trackers";
import type { Prepared } from "./context";
import { addDays } from "./habits";
import type { Challenge } from "./model";

export type ChallengeMode = "clean" | "count";

export interface ChallengeTemplate {
  key: string;
  title: string;
  /** one sentence: the rule */
  text: string;
  days: number;
  mode: ChallengeMode;
  /** count mode: days needed */
  need?: number;
  /** dot-matrix glyph on the card (upper case / digits) */
  glyph: string;
  /** trackers this challenge works on (the deck's suggestion) */
  for: readonly TrackerKey[];
}

export const CHALLENGES: readonly ChallengeTemplate[] = [
  { key: "calm14", title: "Ruhige Hand", text: "14 Tage ohne Revenge- und Tilt-Muster.", days: 14, mode: "clean", glyph: "14", for: ["revenge"] },
  { key: "fomo14", title: "Kein Hinterherlaufen", text: "14 Tage ohne FOMO-Einstieg.", days: 14, mode: "clean", glyph: "FOMO", for: ["fomo"] },
  { key: "stop14", title: "Stop immer", text: "14 Tage: jeder Trade hat einen Stop.", days: 14, mode: "clean", glyph: "SL", for: ["lossAversion"] },
  { key: "rules14", title: "Regeltreu", text: "14 Tage ohne Regelverstoß.", days: 14, mode: "clean", glyph: "OK", for: ["overconfidence"] },
  { key: "limit10", title: "Im Limit", text: "10 Tage im Trade-Limit, ohne Overtrading.", days: 10, mode: "clean", glyph: "MAX", for: ["impulsive"] },
  { key: "review7", title: "Review-Woche", text: "7 Tage: jeder geschlossene Trade bekommt ein Review.", days: 7, mode: "clean", glyph: "REV", for: ["profitTaking"] },
  { key: "checkin7", title: "Check-in-Woche", text: "An 5 von 7 Tagen ein Check-in.", days: 7, mode: "count", need: 5, glyph: "5:7", for: [] },
  { key: "plan7", title: "Plan-Woche", text: "An 5 von 7 Tagen ein Plan vor dem Markt.", days: 7, mode: "count", need: 5, glyph: "PLAN", for: [] },
];

export const templateOf = (key: string): ChallengeTemplate | null => CHALLENGES.find((c) => c.key === key) ?? null;

export type ChallengeDayState = "ok" | "fail" | "pending" | "future" | "idle";

export interface ChallengeDay {
  key: string;
  state: ChallengeDayState;
}

export interface Violation {
  key: string;
  text: string;
  tradeId?: string;
}

export interface ChallengeProgress {
  challenge: Challenge;
  template: ChallengeTemplate;
  /** day of the challenge today (1 … days; > days once over) */
  day: number;
  days: number;
  endKey: string;
  /** count mode: qualifying days; clean mode: clean days so far */
  have: number;
  need: number;
  state: "active" | "done" | "failed";
  violations: Violation[];
  cells: ChallengeDay[];
  /** 0–1 */
  ratio: number;
}

const EVENT_RULES: Readonly<Record<string, readonly BehaviorKey[]>> = {
  calm14: ["revenge", "tilt"],
  fomo14: ["fomo"],
  rules14: ["ruleViolation"],
  limit10: ["overtrading"],
};

const dayDiff = (a: string, b: string): number => Math.round((+dayFromKey(b) - +dayFromKey(a)) / 86_400_000);

/**
 * Violations of a clean challenge on day `key`. Only what happened after the challenge was accepted counts (`since`,
 * epoch ms): a trade entered earlier on the start day cannot break a challenge taken on later that day.
 */
function violationsOn(t: ChallengeTemplate, p: Prepared, key: string, since: number): Violation[] {
  const out: Violation[] = [];
  const evKeys = EVENT_RULES[t.key];
  if (evKeys) for (const e of p.eventsByDay.get(key) ?? []) if (evKeys.includes(e.key) && e.at >= since) out.push({ key, text: e.note ?? e.key, tradeId: e.tradeIds[e.tradeIds.length - 1] });
  const trades = (p.byDay.get(key) ?? []).filter((tr) => +tradeTime(tr) >= since);
  if (t.key === "stop14") for (const tr of trades) if (!(typeof tr.stop === "number" && tr.stop > 0)) out.push({ key, text: `${tr.pair} ohne Stop`, tradeId: tr.id });
  if (t.key === "limit10") {
    const count: Record<string, number> = {};
    for (const tr of trades) count[accountOf(tr)] = (count[accountOf(tr)] ?? 0) + 1;
    for (const [a, n] of Object.entries(count)) if (n > p.limits.maxTrades[a as "makro" | "scalp"]) out.push({ key, text: `${n} Trades (${a === "makro" ? "Makro" : "Scalp"}) über dem Limit` });
  }
  if (t.key === "review7" && key < addDays(p.todayKey, -1))
    // a day's trades have until the end of the next day for their review
    for (const tr of trades) if (tr.result !== "open" && !reviewed(tr)) out.push({ key, text: `${tr.pair} ohne Review`, tradeId: tr.id });
  return out;
}

function counts(t: ChallengeTemplate, p: Prepared, key: string): boolean {
  const note = p.days[key];
  if (t.key === "checkin7") return hasCheckin(note);
  if (t.key === "plan7") return typeof note?.plan === "string" && note.plan.trim() !== "";
  return false;
}

export function challengeProgress(c: Challenge, p: Prepared): ChallengeProgress | null {
  const t = templateOf(c.template);
  if (!t) return null;
  // accepted at `createdAt` on the start day (an older / foreign record: the start of that day)
  const created = Date.parse(c.createdAt);
  const startMs = +dayFromKey(c.start);
  const since = Number.isFinite(created) && localDateKey(new Date(created)) === c.start ? created : startMs;
  const endKey = addDays(c.start, t.days - 1);
  const day = dayDiff(c.start, p.todayKey) + 1;
  const cells: ChallengeDay[] = [];
  const violations: Violation[] = [];
  let have = 0;
  for (let i = 0; i < t.days; i++) {
    const key = addDays(c.start, i);
    if (key > p.todayKey) {
      cells.push({ key, state: "future" });
      continue;
    }
    if (t.mode === "clean") {
      const v = violationsOn(t, p, key, since);
      violations.push(...v);
      const pendingReview = t.key === "review7" && key >= addDays(p.todayKey, -1);
      if (v.length) cells.push({ key, state: "fail" });
      else if (key === p.todayKey || pendingReview) cells.push({ key, state: "pending" });
      else {
        have++;
        cells.push({ key, state: "ok" });
      }
    } else {
      const ok = counts(t, p, key);
      if (ok) have++;
      cells.push({ key, state: ok ? "ok" : key === p.todayKey ? "pending" : "idle" });
    }
  }
  const need = t.mode === "count" ? (t.need ?? t.days) : t.days;
  let state: ChallengeProgress["state"];
  if (t.mode === "clean") {
    // won once every day of the window has passed clean (a review day stays pending until the next day is over)
    const open = cells.some((x) => x.state === "pending" || x.state === "future");
    state = violations.length ? "failed" : p.todayKey > endKey && !open ? "done" : "active";
  } else {
    const todayOpen = p.todayKey <= endKey && !counts(t, p, p.todayKey) ? 1 : 0;
    const left = p.todayKey >= endKey ? todayOpen : Math.max(0, dayDiff(p.todayKey, endKey)) + todayOpen;
    state = have >= need ? "done" : have + left < need ? "failed" : "active";
  }
  if (c.status === "done") state = "done";
  else if (c.status === "failed") state = "failed";
  return { challenge: c, template: t, day: Math.max(1, day), days: t.days, endKey, have, need, state, violations, cells, ratio: Math.max(0, Math.min(1, have / Math.max(1, need))) };
}

/**
 * The card the deck deals first: the challenge for the trader's most frequent pattern (P08 trackers), else a routine
 * one; never one that is running. `skip` cycles to the next candidates ("Andere Karte").
 */
export function suggestChallenges(trackers: readonly { key: TrackerKey; count: number }[], running: readonly string[], checkinStreak: number): ChallengeTemplate[] {
  const free = CHALLENGES.filter((c) => !running.includes(c.key));
  const score = (c: ChallengeTemplate): number => {
    let s = 0;
    for (const t of trackers) if (c.for.includes(t.key)) s += 10 + t.count * 3;
    if (c.key === "checkin7" && checkinStreak < 3) s += 8;
    if (c.key === "rules14") s += 4;
    return s;
  };
  return [...free].sort((a, b) => score(b) - score(a) || CHALLENGES.indexOf(a) - CHALLENGES.indexOf(b));
}
