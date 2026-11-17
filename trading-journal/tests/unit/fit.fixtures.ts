/**
 * Fixtures of the F49 tests (not a test file): one idea (ten trades) and one journal (24 trades), both hand-computed in
 * `fit.test.ts`. Weekday / session buckets are UTC; the journal's local wall-clock strings are built FROM UTC instants so
 * nothing depends on the time zone.
 */
import type { FitRunInput } from "@/domain/fit";
import { ct } from "./coach.fixtures";

export const H = 3_600_000;
export const D = 24 * H;
export const MON = Date.UTC(2026, 0, 5); // Monday 2026-01-05 00:00 UTC

export const local = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Ten trades of an idea: W L L L W L W L L L with +2 / −1 R; six on Mondays 08:00 UTC (London), four on Saturdays 10:00 UTC. */
export function idea(): FitRunInput {
  const signs = [1, -1, -1, -1, 1, -1, 1, -1, -1, -1];
  const entries = [MON + 8 * H, MON + 5 * D + 10 * H, MON + 7 * D + 8 * H, MON + 12 * D + 10 * H, MON + 14 * D + 8 * H, MON + 19 * D + 10 * H, MON + 21 * D + 8 * H, MON + 26 * D + 10 * H, MON + 28 * D + 8 * H, MON + 35 * D + 8 * H];
  return {
    name: "Test-Idee",
    from: MON,
    to: MON + 28 * D,
    riskPct: 2,
    maxDD: 0.06,
    trades: entries.map((t, i) => ({ entryTime: t, exitTime: t + (i + 1) * H, r: signs[i]! > 0 ? 2 : -1, pnl: signs[i]! > 0 ? 200 : -100 })),
  };
}

/**
 * 24 closed trades, four weeks, Tuesday / Wednesday / Thursday at 14:00 and 16:00 UTC (New York), W L W L … (+2 R / −1 R),
 * each held 1 h, risk 100 on a 10 000 account (1 %), every trade with a stop; the first 20 marked „Plan befolgt“, 4 not.
 */
export function journalRaw(opts: { exits?: boolean; followed?: boolean } = {}) {
  const { exits = true, followed = true } = opts;
  const ts = [];
  let i = 0;
  for (let w = 0; w < 4; w++) {
    for (const day of [1, 2, 3]) {
      for (const hour of [14, 16]) {
        const at = MON + (w * 7 + day) * D + hour * H;
        ts.push(
          ct(local(at), {
            id: `f${i}`,
            p: i % 2 === 0 ? 200 : -100,
            ...(exits ? { exitDate: local(at + H) } : {}),
            followedPlan: followed ? i < 20 : null,
          }),
        );
        i++;
      }
    }
  }
  return ts;
}

