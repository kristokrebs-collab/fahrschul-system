/**
 * Runs the scenarios of the stress test over a PREPARED strategy (the preparation is the expensive part and is done by
 * the caller, `extras/job.ts`): one cheap engine loop per scenario, deterministic, same window and parameters as the run
 * above – the base scenario is that run again and must give the same numbers.
 */
import { runBacktest } from "../../backtest/engine";
import { runStats } from "../../backtest/metrics";
import type { Window } from "../../backtest/optimize";
import type { LabStrategy, Params, Prepared } from "../../backtest/strategies/types";
import { HIST_MS, type EngineCfg } from "../../backtest/types";
import { scenarioDefs, type ScenarioDef } from "./scenarios";
import { STRESS_VERSION, type ScenarioRow, type ScenarioStats, type StressRows } from "./types";
import { delayed, stopScaled } from "./wrap";

export function statsOf(run: Parameters<typeof runStats>[0]): ScenarioStats {
  const s = runStats(run);
  return { n: s.n, sumR: s.sumR, avgR: s.avgR, winRate: s.winRate, pf: s.pf == null || !Number.isFinite(s.pf) ? null : s.pf, maxDD: s.maxDD, net: s.net, netPct: s.netPct };
}

/** One unit of work per scenario; `rows()` assembles the table once all are done (or with what is done so far). */
export function stressUnits<F>(strategy: LabStrategy<F, unknown>, prep: Prepared<F>, params: Params, base: EngineCfg, win: Window, windowOk: boolean): { count: number; run(i: number): void; rows(): StressRows } {
  const defs: ScenarioDef[] = scenarioDefs(base);
  const done = new Map<number, ScenarioStats>();
  const secLen = HIST_MS[prep.interval] / 1000;

  const run = (i: number): void => {
    const def = defs[i]!;
    if (!windowOk || def.status === "unavailable" || !def.engine) return;
    let s = strategy.build(prep, params);
    if (def.stopFactor !== 1) s = stopScaled(s, prep.bars, def.stopFactor);
    if (def.delay) s = delayed(s);
    done.set(i, statsOf(runBacktest(prep.bars, s, def.engine, { from: win.from, to: win.to, equity: true, atr: prep.atr, secLen })));
  };

  const rows = (): StressRows => {
    const baseStats = done.get(0) ?? null;
    const out: ScenarioRow[] = defs.map((d, i) => {
      const stats = done.get(i) ?? null;
      const unavailable = d.status === "unavailable" || !windowOk;
      const isBase = i === 0;
      const cmp = stats && baseStats && !isBase;
      return {
        id: d.id,
        label: d.label,
        group: d.group,
        status: unavailable ? "unavailable" : d.status,
        note: !windowOk && d.status !== "unavailable" ? "Zu wenige Kerzen im Zeitraum für einen Lauf." : d.note,
        stats,
        dSumR: cmp ? stats.sumR - baseStats.sumR : null,
        dMaxDD: cmp ? stats.maxDD - baseStats.maxDD : null,
        dPf: cmp && stats.pf != null && baseStats.pf != null ? stats.pf - baseStats.pf : null,
        dN: cmp ? stats.n - baseStats.n : null,
      };
    });
    return { v: STRESS_VERSION, rows: out };
  };
  return { count: defs.length, run, rows };
}
