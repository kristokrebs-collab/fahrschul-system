/**
 * The extra job of the Labor (F20 / F17): additional runs of the SAME set-up as a finished lab run – the stress scenarios
 * or the filter comparison. Stepped like `createLabJob` (the worker or idle chunks drive it, identical results): the
 * strategy's preparation over the closed bars is repeated from the same input (deterministic, so the base scenario is the
 * run above again), then every scenario / variant is one cheap engine loop.
 *
 * Reports the phase `diagnose` (it is the same kind of work: re-runs of the run with one thing changed).
 */
import { completeParams, strategyCfg, strategyOf, windowOf, type LabJobInput, type LabPhase } from "../../backtest/job";
import { now, type Prepared, type Stepper } from "../../backtest/strategies/types";
import { activeFilters, type FilterSelection } from "../filters/types";
import { filterUnits, type FilterCompare } from "../filters/compare";
import { stressUnits } from "../stress/run";
import type { StressRows } from "../stress/types";

export interface ExtraJobInput {
  /** the input of the finished run (data, engine, parameters, period) */
  base: LabJobInput;
  what: "stress" | "filters";
  /** the chosen filters (`what: "filters"`) */
  filters?: FilterSelection;
}

export type ExtraResult = { what: "stress"; rows: StressRows } | { what: "filters"; compare: FilterCompare };

export interface ExtraJob extends Stepper<ExtraResult> {
  phase(): LabPhase;
}

/** Share of the progress the preparation takes. */
const PREP_SHARE = 0.9;

export function createExtraJob(input: ExtraJobInput): ExtraJob {
  const b = input.base;
  const strategy = strategyOf(b.strategy);
  const cfg = strategyCfg(b);
  const params = completeParams(strategy.specs(cfg), b.params);
  const prepStepper = strategy.prepare(b.data, cfg, b.fromMs) as Stepper<Prepared<unknown>>;
  let prep: Prepared<unknown> | null = null;
  let units: { count: number; run(i: number): void; result(): ExtraResult } | null = null;
  let u = 0;
  let result: ExtraResult | null = null;

  const plan = (pr: Prepared<unknown>): void => {
    const win = windowOf(pr, b.toMs);
    const ok = pr.bars.length > 0 && win.to > pr.start;
    if (input.what === "stress") {
      const s = stressUnits(strategy, pr, params, b.engine, win, ok);
      units = { count: s.count, run: s.run, result: () => ({ what: "stress", rows: s.rows() }) };
    } else {
      const sel = input.filters;
      const active = sel ? activeFilters(sel, b.strategy, pr.interval) : [];
      const f = filterUnits(strategy, pr, params, b.engine, win, ok, sel ?? { v: 1, on: [], rsiLimit: 70, trendLen: 20 }, active);
      units = { count: f.count, run: f.run, result: () => ({ what: "filters", compare: f.result() }) };
    }
  };

  return {
    phase: () => "diagnose",
    progress: () => (result ? 1 : Math.min(0.999, !prep ? prepStepper.progress() * PREP_SHARE : PREP_SHARE + (1 - PREP_SHARE) * (units && units.count ? u / units.count : 0))),
    step(deadline: number): boolean {
      if (result) return true;
      if (!prep) {
        if (!prepStepper.step(deadline)) return false;
        prep = prepStepper.result();
        plan(prep);
      }
      const us = units!;
      while (u < us.count) {
        us.run(u++);
        if (now() >= deadline) return false;
      }
      result = us.result();
      return true;
    },
    result(): ExtraResult {
      while (!this.step(Number.POSITIVE_INFINITY)) {
        /* run to the end */
      }
      return result!;
    },
  };
}
