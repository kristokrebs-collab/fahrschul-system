/**
 * Streaks (P08) – process only, never P&L or trade count:
 *
 *   journal     trading days in a row on which every closed trade has a review (P04 `reviewed`) or the day has a note /
 *               plan / review / check-in; days without trades are skipped (never break it); today still open does not
 *               break it either.
 *   checkin     calendar days in a row with a check-in or mood; a weekend day without one is skipped, today still open
 *               does not break it.
 *   green       "grüne Tage" = trading days in the GREEN ZONE of the limits: the day loss per account within
 *               `maxLossDayPct`, the trades per account within `maxTrades` (the discipline / P05 limits) and no rule
 *               violation, overtrading, revenge or tilt event (P04) that day. Not "days in profit" – a red day that kept
 *               every limit is a green day.
 *   discipline  the Auswertung's discipline streak (`disciplineStreak`, score ≥ 80 %) – reused as is.
 *
 * `best` is the longest run of the same rule in the journal. Pure.
 */
import type { AccountId, EnrichedTrade } from "../types";
import type { BehaviorKey } from "../coach/events";
import { reviewed } from "../coach/recommendations";
import { disciplineStreak, STREAK_MIN, type DisciplineDay } from "../insights/discipline";
import { accountOf, dayFromKey } from "../insights/shared";
import { hasCheckin, hasDayText } from "../psych/checkin";
import type { Prepared } from "./context";
import { addDays } from "./habits";

export type StreakKey = "journal" | "checkin" | "green" | "discipline";

export interface Streak {
  key: StreakKey;
  label: string;
  unit: string;
  current: number;
  best: number;
  /** today is not counted yet but can still be (e.g. no check-in so far) */
  pending: boolean;
  hint: string;
}

const RED_FLAGS: ReadonlySet<BehaviorKey> = new Set(["ruleViolation", "overtrading", "revenge", "tilt"]);

/** Every closed trade of the day is reviewed, or the day itself carries journal text / a check-in. */
export function journalDayOk(p: Prepared, key: string): boolean {
  const note = p.days[key];
  if (hasDayText(note) || hasCheckin(note)) return true;
  const closed = (p.byDay.get(key) ?? []).filter((t) => t.result !== "open");
  return closed.length > 0 && closed.every(reviewed);
}

/** The day kept the limits: loss and trade count per account, no red behaviour event. */
export function greenDayOk(p: Prepared, key: string): boolean {
  const ts = p.byDay.get(key) ?? [];
  if ((p.eventsByDay.get(key) ?? []).some((e) => RED_FLAGS.has(e.key))) return false;
  const net: Partial<Record<AccountId, number>> = {};
  const count: Partial<Record<AccountId, number>> = {};
  for (const t of ts) {
    const a = accountOf(t);
    count[a] = (count[a] ?? 0) + 1;
    if (t.result !== "open" && typeof t.pnl === "number" && Number.isFinite(t.pnl)) net[a] = (net[a] ?? 0) + t.pnl;
  }
  for (const a of Object.keys(count) as AccountId[]) {
    if ((count[a] ?? 0) > p.limits.maxTrades[a]) return false;
    const cap = p.settings.capital[a] ?? 0;
    if (cap > 0 && (net[a] ?? 0) < -p.limits.maxLossDayPct * cap) return false;
  }
  return true;
}

/** Current run over ordered `keys` (oldest first) with `ok`; today (when last and not ok) is "pending", not a break. */
function runOver(keys: readonly string[], ok: (k: string) => boolean, todayKey: string, todayPending = true): { current: number; best: number; pending: boolean } {
  let best = 0;
  let run = 0;
  for (const k of keys) {
    if (ok(k)) best = Math.max(best, ++run);
    else if (!(todayPending && k === todayKey)) run = 0;
  }
  let current = 0;
  let pending = false;
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i]!;
    if (ok(k)) current++;
    else if (todayPending && k === todayKey) pending = true;
    else break;
  }
  return { current, best: Math.max(best, current), pending };
}

function bestDiscipline(days: readonly DisciplineDay[]): number {
  let best = 0;
  let run = 0;
  for (const d of days) {
    if (d.score == null) continue;
    run = d.score >= STREAK_MIN ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

const isWeekend = (key: string) => {
  const wd = dayFromKey(key).getDay();
  return wd === 0 || wd === 6;
};

/** Check-in streak over calendar days (weekends without a check-in skipped). */
export function checkinStreak(p: Pick<Prepared, "days" | "todayKey">): { current: number; best: number; pending: boolean } {
  const has = (k: string) => hasCheckin(p.days[k]);
  let current = 0;
  let k = p.todayKey;
  const pending = !has(k);
  if (pending) k = addDays(k, -1);
  for (let guard = 0; guard < 3660; guard++) {
    if (has(k)) current++;
    else if (!isWeekend(k)) break;
    k = addDays(k, -1);
  }
  const keys = Object.keys(p.days).filter(has).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of keys) {
    let contiguous = false;
    if (prev) {
      let x = addDays(prev, 1);
      while (x < key && isWeekend(x)) x = addDays(x, 1);
      contiguous = x === key;
    }
    run = contiguous ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return { current, best: Math.max(best, current), pending };
}

export const STREAK_LABEL: Readonly<Record<StreakKey, string>> = { journal: "Journal", checkin: "Check-in", green: "Grüne Tage", discipline: "Disziplin" };
const HINT: Readonly<Record<StreakKey, string>> = {
  journal: "Handelstage mit Review oder Tagesnotiz",
  checkin: "Tage mit Check-in · Wochenenden pausieren",
  green: "Handelstage im Limit, ohne Regelbruch",
  discipline: "Handelstage mit Disziplin ≥ 80 %",
};

/** The four streaks, in display order. */
export function streakBoard(p: Prepared): Streak[] {
  const j = runOver(p.tradeDays, (k) => journalDayOk(p, k), p.todayKey);
  const c = checkinStreak(p);
  // a breach today is final (it already happened) – it breaks the green run at once
  const g = runOver(p.tradeDays, (k) => greenDayOk(p, k), p.todayKey, false);
  const discCurrent = disciplineStreak(p.discDays);
  const mk = (key: StreakKey, r: { current: number; best: number; pending: boolean }, unit: string): Streak => ({ key, label: STREAK_LABEL[key], unit, current: r.current, best: r.best, pending: r.pending, hint: HINT[key] });
  return [
    mk("journal", j, "Handelstage"),
    mk("checkin", c, "Tage"),
    mk("green", g, "Handelstage"),
    mk("discipline", { current: discCurrent, best: Math.max(discCurrent, bestDiscipline(p.discDays)), pending: false }, "Handelstage"),
  ];
}

/** Trades in a row (entry order, newest last) that satisfy `ok` – current and best run. */
export function tradeRun(list: readonly EnrichedTrade[], ok: (t: EnrichedTrade) => boolean): { current: number; best: number } {
  let best = 0;
  let run = 0;
  for (const t of list) {
    run = ok(t) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current: run, best };
}
