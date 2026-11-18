/**
 * Data of the progress charts (P08): per ISO week (Monday first, local) the process numbers – Ø discipline score,
 * journaling rate, check-in days, rule breaks, habit rate. Weeks without trades keep `null` for the trade-based
 * values (a gap, never a fake zero). Pure.
 */
import { journalRate } from "../coach/recommendations";
import { disciplineAvg } from "../insights/discipline";
import { periodOf, shiftPeriod } from "../reports/periods";
import { hasCheckin } from "../psych/checkin";
import { localDateKey } from "@/lib/dates";
import type { Prepared } from "./context";
import { addDays, habitDone } from "./habits";
import type { Habit } from "./model";

export interface WeekPoint {
  key: string;
  /** "KW 41" */
  label: string;
  fromKey: string;
  toKey: string;
  discipline: number | null;
  journal: number | null;
  checkins: number;
  ruleBreaks: number;
  habitRate: number | null;
  trades: number;
}

export function progressSeries(p: Prepared, habits: readonly Habit[] = [], weeks = 12): WeekPoint[] {
  const out: WeekPoint[] = [];
  let per = shiftPeriod(periodOf("week", p.now), -(weeks - 1));
  const breaks = p.events.filter((e) => e.key === "ruleViolation");
  for (let i = 0; i < weeks; i++) {
    const fromKey = localDateKey(new Date(per.from));
    const lastKey = localDateKey(new Date(per.to - 1));
    const toKey = lastKey < p.todayKey ? lastKey : p.todayKey;
    const list = p.tradeDays.filter((k) => k >= fromKey && k <= toKey).flatMap((k) => p.byDay.get(k) ?? []);
    let checkins = 0;
    let hDone = 0;
    let hAll = 0;
    for (let k = fromKey; k <= toKey; k = addDays(k, 1)) {
      if (hasCheckin(p.days[k])) checkins++;
      for (const h of habits) {
        hAll++;
        if (habitDone(h, k, p.days)) hDone++;
      }
    }
    out.push({
      key: per.key,
      label: per.short,
      fromKey,
      toKey,
      discipline: disciplineAvg(p.discDays, fromKey, toKey),
      // reviews follow the close: open trades are left out of the journaling rate
      journal: list.some((t) => t.result !== "open") ? journalRate(list.filter((t) => t.result !== "open")) : null,
      checkins,
      ruleBreaks: breaks.filter((e) => {
        const k = localDateKey(new Date(e.at));
        return k >= fromKey && k <= toKey;
      }).length,
      habitRate: hAll ? hDone / hAll : null,
      trades: list.length,
    });
    per = shiftPeriod(per, 1);
  }
  return out;
}

/** Change of a series between the last 4 and the 4 weeks before (`null` without data on either side). */
export function seriesTrend(points: readonly WeekPoint[], pick: (p: WeekPoint) => number | null): number | null {
  const vals = (xs: readonly WeekPoint[]) => xs.map(pick).filter((x): x is number => x != null);
  const a = vals(points.slice(-4));
  const b = vals(points.slice(-8, -4));
  if (!a.length || !b.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length - b.reduce((s, x) => s + x, 0) / b.length;
}
