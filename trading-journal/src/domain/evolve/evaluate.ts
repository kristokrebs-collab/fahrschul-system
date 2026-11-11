/**
 * Evaluating a variant (pure, stepped). One preparation of the rules over the whole history (the expensive part, run in
 * slices and cached), then cheap engine loops over the walk-forward windows with the lab's own engine – the costs, slippage
 * and funding of the strategy, decisions on closed bars only. Nothing here looks at a bar that did not exist at the decision.
 *
 * Cache: the prepared facts only depend on the SIGNAL part of a rule set (interval, side choice, the rule trees). A variant
 * that only changes the stop, the target or the exits reuses the facts of its parent – the prepared object is re-bound to the
 * variant's configuration (the strategy reads stop / target / exits from `facts.config`).
 */
import { runBacktest } from "../backtest/engine";
import { customStrategy, type CustomFacts } from "../backtest/strategies/custom";
import type { Prepared, Stepper } from "../backtest/strategies/types";
import { HIST_MS, type BarsBy, type BtTrade, type EngineCfg, type FundingPoint } from "../backtest/types";
import { customKey, sanitizeCustom } from "../lab/rules/tree";
import type { CustomConfig } from "../lab/rules/types";
import type { SignalCfg } from "../signals/config";
import { freedomOf } from "./mutations";
import { metricsOf, robustScore, scoredR } from "./score";
import type { Evaluation, EvolveOpts, WinMetrics } from "./types";
import { evolveWindows, type EvolveWindows, type Win, type WindowResult } from "./windows";

export interface EvalEnv {
  data: BarsBy;
  signal: SignalCfg;
  funding: readonly FundingPoint[] | null;
  fromMs: number;
  engine: EngineCfg;
  opts: EvolveOpts;
}

export type Facts = Prepared<CustomFacts>;

export interface Evaluated {
  ev: Evaluation;
  /** result per time block (Σ R of the trades that closed in the block), `folds × sub` long */
  blocks: Float32Array;
}

const MAX_CACHE = 10;

/** The part of a configuration the prepared facts depend on. */
export function signalKey(cfg: CustomConfig): string {
  return JSON.stringify([cfg.interval, cfg.sides, cfg.long, cfg.short]);
}

const rebind = (p: Facts, cfg: CustomConfig): Facts => ({ ...p, facts: { ...p.facts, config: cfg } });

export class Evaluator {
  windows: EvolveWindows | null = null;
  private readonly cache = new Map<string, Facts>();

  constructor(readonly env: EvalEnv) {}

  /** Stepper that yields the facts of `cfgIn` (from the cache when only the exits differ from an earlier variant). */
  prepare(cfgIn: CustomConfig): Stepper<Facts> {
    const cfg = sanitizeCustom(cfgIn);
    const key = signalKey(cfg);
    const hit = this.cache.get(key);
    if (hit) {
      const out = rebind(hit, cfg);
      return { step: () => true, progress: () => 1, result: () => out };
    }
    const inner = customStrategy.prepare(this.env.data, { config: cfg, signal: this.env.signal, funding: this.env.funding }, this.env.fromMs);
    let stored = false;
    const remember = (): Facts => {
      const p = inner.result();
      if (!stored) {
        stored = true;
        this.cache.set(key, p);
        while (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value as string);
      }
      return p;
    };
    return {
      step: (deadline) => {
        if (!inner.step(deadline)) return false;
        remember();
        return true;
      },
      progress: () => inner.progress(),
      result: () => rebind(remember(), cfg),
    };
  }

  /** The windows of the data (known after the first preparation: they depend on the first tradable bar). */
  setWindows(prep: Facts): WindowResult {
    const r = evolveWindows(prep.start, prep.bars.length - 1, this.env.opts);
    if (r.ok) this.windows = r.windows;
    return r;
  }

  private run(prep: Facts, cfg: CustomConfig, win: Win): BtTrade[] {
    const secLen = HIST_MS[prep.interval] / 1000;
    const strat = customStrategy.build({ ...prep, facts: { ...prep.facts, config: cfg } }, {});
    return runBacktest(prep.bars, strat, this.env.engine, { from: win.from, to: win.to, equity: false, atr: prep.atr, secLen }).trades;
  }

  /** The variant on every test window (+ the training part for reference). */
  evaluate(prep: Facts, cfgIn: CustomConfig, baseFreedom: number): Evaluated {
    const w = this.windows!;
    const cfg = sanitizeCustom(cfgIn);
    const { folds, sub } = this.env.opts;
    const secLen = HIST_MS[prep.interval] / 1000;
    const strat = customStrategy.build({ ...prep, facts: { ...prep.facts, config: cfg } }, {});
    const runWin = (win: Win): BtTrade[] => runBacktest(prep.bars, strat, this.env.engine, { from: win.from, to: win.to, equity: false, atr: prep.atr, secLen }).trades;
    const blocks = new Float32Array(folds * sub);
    const all: BtTrade[] = [];
    const perWindow = w.tests.map((win, k) => {
      const ts = runWin(win);
      const len = win.to - win.from + 1;
      let sum = 0;
      for (const t of ts) {
        const r = scoredR(t);
        sum += r;
        const b = k * sub + Math.max(0, Math.min(sub - 1, Math.floor(((t.exitIndex - win.from) * sub) / len)));
        blocks[b]! += r;
      }
      all.push(...ts);
      return { n: ts.length, sumR: sum };
    });
    const test = metricsOf(all, this.env.engine.capital);
    const tr = runWin(w.train);
    const freedom = freedomOf(cfg).total;
    const ev: Evaluation = {
      key: customKey(cfg),
      score: robustScore(test, freedom - baseFreedom),
      test,
      perWindow,
      train: { n: tr.length, avgR: tr.length ? tr.reduce((a, t) => a + scoredR(t), 0) / tr.length : null },
      freedom,
    };
    return { ev, blocks };
  }

  /** The variant on the confirmation window (looked at once per finalist). */
  holdout(prep: Facts, cfg: CustomConfig): WinMetrics {
    return metricsOf(this.run(prep, sanitizeCustom(cfg), this.windows!.holdout), this.env.engine.capital);
  }

  /** Window edges in ms for the cards. */
  msOf(prep: Facts, win: Win): { from: number; to: number } {
    const secLen = HIST_MS[prep.interval] / 1000;
    return { from: prep.bars[win.from]!.t * 1000, to: (prep.bars[win.to]!.t + secLen) * 1000 };
  }
}
