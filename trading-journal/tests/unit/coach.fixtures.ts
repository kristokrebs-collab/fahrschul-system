/**
 * Fixtures of the coach / report tests (P04, not a test file): a settings object with two setups and known limits,
 * a quick closed-trade builder on local wall-clock times (timezone-independent: every test speaks local time) and a
 * deterministic "realistic" journal with a clear edge, a clear leak and a few behaviours.
 */
import type { EnrichedTrade, Settings, Trade } from "@/domain/types";
import { enrichTrades } from "@/domain/enrich";
import { rng } from "@/domain/analytics/stats";
import { mkTrade } from "./domain.fixtures";
import { settingsWith } from "./insights.fixtures";

export const COACH_SETTINGS: Settings = {
  ...settingsWith({
    capital: { makro: 10_000, scalp: 10_000 },
    // no global rules: a trade's checklist is "complete" only by its setup's items (none here)
    rules: [],
    setups: [
      { id: "s_good", name: "Breakout", account: "both", color: "#fff", desc: "", checklist: [] },
      { id: "s_bad", name: "Fade", account: "both", color: "#fff", desc: "", checklist: [] },
    ],
  }),
  // discipline limits: 2 % per trade, 4 % per day, 5 scalp / 2 makro trades per day
  ...({ discipline: { maxLossTradePct: 0.02, maxLossDayPct: 0.04, maxTrades: { makro: 2, scalp: 5 } } } as object),
} as Settings;

let seq = 0;

/** Local wall clock "YYYY-MM-DDTHH:mm" of a day offset and minutes from 2026-03-02 (a Monday). */
export function at(day: number, min = 600): string {
  const d = new Date(2026, 2, 2 + day, 0, 0);
  d.setMinutes(min);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface CT extends Partial<Trade> {
  /** realised P&L */
  p?: number;
  /** risk in money (entry 100, stop 99, size 100 · risk) → r = p / risk */
  risk?: number;
}

/** A closed trade with a stop (risk 100 by default) and setup "Breakout". */
export function ct(date: string, { p = 0, risk = 100, ...rest }: CT = {}): Trade {
  seq++;
  return mkTrade({ id: rest.id ?? `c${seq}`, date, pnlManual: p, entry: 100, stop: 99, size: 100 * risk, setups: ["s_good"], reason: "Plan", ...rest });
}

export const enrichC = (ts: Trade[], s: Settings = COACH_SETTINGS): EnrichedTrade[] => enrichTrades(ts, s);

/**
 * 90 days of a deterministic journal: "Breakout" (s_good) wins ~65 % at +2 R, "Fade" (s_bad) wins ~25 %; the London
 * session is the best; revenge entries 20 minutes after a loss mostly lose.
 */
export function coachJournal(days = 90, seed = 11): Trade[] {
  const rand = rng(seed);
  const out: Trade[] = [];
  for (let d = 0; d < days; d++) {
    const n = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const good = rand() < 0.6;
      const minute = 480 + k * 180 + Math.floor(rand() * 60);
      const win = rand() < (good ? 0.65 : 0.25);
      const p = win ? (good ? 200 : 120) : -100;
      out.push(ct(at(d, minute), { id: `j${d}_${k}`, p, setups: [good ? "s_good" : "s_bad"], side: rand() < 0.3 ? "short" : "long", conviction: (1 + Math.floor(rand() * 5)) as 1 | 2 | 3 | 4 | 5, emotion: rand() < 0.5 ? "Ruhig" : "Unsicher", followedPlan: true, leverage: 3 }));
      if (!win && rand() < 0.5) {
        // a revenge entry 20 min later that mostly loses, sized up
        const rwin = rand() < 0.2;
        out.push(ct(at(d, minute + 20), { id: `r${d}_${k}`, p: rwin ? 150 : -180, risk: 180, setups: [good ? "s_good" : "s_bad"], emotion: "Revenge", followedPlan: false, leverage: 3 }));
      }
    }
  }
  return out;
}
