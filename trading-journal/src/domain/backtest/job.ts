/**
 * The lab job (P07, pure, stepped): everything after the bars are loaded – one `createLabJob(input)` is stepped by the
 * worker (`lab.worker.ts`) or, under file:// / without a worker, in idle chunks (`labRunner.ts`); both give the same
 * result. Phases (with their share of the progress bar):
 *
 *   signals      0 – 72 %  the strategy's preparation over every closed bar (real box engine / entry check)
 *   run          your parameters over the whole period (equity curve, trades, buy & hold)
 *   optimise     the grid on the first 70 % (in-sample) → the winner on the last 30 % (out-of-sample)
 *   walkforward  5 rolling train / test windows
 *   overfit      the grid over the whole period → PBO (CSCV), Deflated Sharpe, parameter heat map, verdict
 */
import { boxToBox, type BoxCfgIn } from "./strategies/boxToBox";
import { customStrategy, defaultCustomIn, type CustomCfgIn } from "./strategies/custom";
import { mcbLadder, type McbCfgIn } from "./strategies/mcbLadder";
import { ruleBuilder, type RulesCfgIn } from "./strategies/rules";
import { now, paramGrid, paramKey, type LabStrategy, type ParamSpec, type Params, type Prepared, type Stepper } from "./strategies/types";
import { bestTrial, evaluate, oosSplit, trialOf, type Trial, type Window } from "./optimize";
import { downsampleIdx, runStats, type RunStats } from "./metrics";
import { summarizeWf, wfLayout, wfWindow, type WalkForward, type WfWindow } from "./walkForward";
import { deflatedSharpe, paramHeat, pboOf, robustness, type Dsr, type Heat, type Pbo, type Robustness } from "./overfit";
import { customKey, sanitizeCustom } from "../lab/rules/tree";
import { gapsOf } from "./bars";
import { runBacktest } from "./engine";
import type { BarsBy, BtStrategy, BtTrade, EngineCfg, EquityPoint, FundingPoint, RunResult } from "./types";
import { HIST_MS } from "./types";
import type { FunnelNode, StrategyFunnel, StrategyVariant } from "./strategies/types";

export type LabStrategyId = "custom" | "box" | "mcb" | "rules";

export interface LabJobInput {
  strategy: LabStrategyId;
  symbol: string;
  box: BoxCfgIn;
  mcb: McbCfgIn;
  rules: RulesCfgIn;
  /** "Eigene Idee": the rule tree and the app's MCB setting (absent = the default idea) */
  custom?: CustomCfgIn;
  /** the chosen parameter set (missing keys → the spec's first option) */
  params: Params;
  /** first tradable time (ms) – bars before are warm-up – and the end of the period */
  fromMs: number;
  toMs: number;
  engine: EngineCfg;
  data: BarsBy;
  /** in-sample share of the OOS split, walk-forward windows */
  isShare?: number;
  wfWindows?: number;
}

export type LabPhase = "signals" | "run" | "optimise" | "walkforward" | "overfit" | "diagnose" | "done";

export const PHASE_LABEL: Readonly<Record<LabPhase, string>> = {
  signals: "Signale auf jeder Kerze",
  run: "Dein Lauf",
  optimise: "In-Sample / Out-of-Sample",
  walkforward: "Walk-forward",
  overfit: "Overfitting-Check",
  diagnose: "Diagnose",
  done: "Fertig",
};

export interface TrialLite {
  key: string;
  params: Params;
  n: number;
  meanR: number | null;
  sharpe: number | null;
}

export interface SplitResult {
  params: Params | null;
  is: RunStats | null;
  oos: RunStats | null;
  /** Ø R of the OOS trades and its equity in R (for the side-by-side) */
  isCurveR: number[];
  oosCurveR: number[];
  cutTime: number | null;
}

export interface HeatAxis {
  key: string;
  label: string;
  options: (string | number)[];
  /** formatted options ("T1", "2 × ATR") */
  labels: string[];
}

export interface HeatLite extends Omit<Heat, "rows" | "cols"> {
  rows: HeatAxis;
  cols: HeatAxis;
}

const axisOf = (s: ParamSpec): HeatAxis => ({ key: s.key, label: s.label, options: [...s.options], labels: s.options.map((o) => s.format(o)) });

export interface WfWindowLite extends Omit<WfWindow, "testTrades"> {
  testN: number;
}

/** Data of one interval the run used: what was loaded and where the holes are. */
export interface CoverageRow {
  interval: string;
  /** the execution interval (the engine walks it) or a higher / ladder interval */
  role: "exec" | "other";
  bars: number;
  /** ms, null when empty */
  first: number | null;
  last: number | null;
  gaps: number;
  missing: number;
}

/** The rule funnel of a run: from the examined bars to the closed trades. */
export interface RunFunnel {
  /** bars of the period the strategy was asked about */
  examined: number;
  /** strategy-specific rows (the custom strategy's leaves and groups); empty for the templates */
  nodes: FunnelNode[];
  /** new signals (rising edges) / both sides at once / valid entries ignoring an open position / of these blocked by an open position; null = the strategy does not tell */
  edges: number | null;
  conflicts: number | null;
  candidates: number | null;
  blockedByPosition: number | null;
  /** engine: entries handed over while flat, skipped at the next open (gap beyond stop / target), skipped (stop too close / no size), executed */
  signals: number;
  skippedGap: number;
  skippedRisk: number;
  executed: number;
}

/** A re-run of the same run with one thing removed (costs, a filter, the position management). */
export interface VariantLite {
  id: string;
  label: string;
  kind: "noCosts" | "noLeaf" | "noExits";
  n: number;
  avgR: number | null;
  sumR: number;
  net: number;
  netPct: number;
  winRate: number | null;
  pf: number | null;
  maxDD: number;
}

export interface LabResult {
  strategy: LabStrategyId;
  /** name of the custom idea / stable key of its rules (compare cards); null for the templates */
  name: string | null;
  configKey: string | null;
  /** data of the execution interval and every other interval the run used */
  coverage: CoverageRow[];
  /** execution bars the period should hold (from its length) and the warm-up bars wanted before it / found */
  expectedBars: number;
  warmup: { wanted: number; got: number };
  funnel: RunFunnel;
  variants: VariantLite[];
  symbol: string;
  interval: string;
  params: Params;
  specs: { key: string; label: string; value: string }[];
  /** bars of the execution interval inside the period, data gaps */
  bars: number;
  gaps: { gaps: number; missing: number };
  from: number;
  to: number;
  stats: RunStats;
  trades: BtTrade[];
  /** marked-to-market equity (downsampled) and buy & hold of the same capital (same times) */
  equity: EquityPoint[];
  buyHold: EquityPoint[];
  skipped: number;
  split: SplitResult;
  wf: { windows: WfWindowLite[]; oosMeanR: number | null; efficiency: number | null; positiveShare: number | null; oosN: number; oosSumR: number } | null;
  dsr: Dsr | null;
  pbo: Pbo | null;
  /** the heat map, structured-clone safe (worker → page): axis labels instead of format functions */
  heat: HeatLite | null;
  trials: TrialLite[];
  robust: Robustness;
  /** ms spent per phase (diagnostics) */
  timings: Partial<Record<LabPhase, number>>;
}

export interface LabJob extends Stepper<LabResult> {
  phase(): LabPhase;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStrategy = LabStrategy<any, any>;

export function strategyOf(id: LabStrategyId): AnyStrategy {
  return id === "custom" ? customStrategy : id === "box" ? boxToBox : id === "mcb" ? mcbLadder : ruleBuilder;
}

export function strategyCfg(input: Pick<LabJobInput, "strategy" | "box" | "mcb" | "rules" | "custom">): unknown {
  return input.strategy === "custom" ? (input.custom ?? defaultCustomIn()) : input.strategy === "box" ? input.box : input.strategy === "mcb" ? input.mcb : input.rules;
}

/** The chosen parameters completed with each spec's first option (unknown values → the first option). */
export function completeParams(specs: readonly ParamSpec[], p: Params): Params {
  const out: Record<string, string | number> = {};
  for (const s of specs) {
    const v = p[s.key];
    out[s.key] = s.options.some((o) => o === v) ? v! : s.options[0]!;
  }
  return out;
}

/** The bar window of a run: from the first tradable bar to the last bar that had closed by `toMs`. */
export function windowOf(pr: Pick<Prepared<unknown>, "bars" | "interval" | "start">, toMs: number): Window {
  const secLen = HIST_MS[pr.interval] / 1000;
  let to = pr.bars.length - 1;
  while (to > pr.start && (pr.bars[to]!.t + secLen) * 1000 > toMs) to--;
  return { from: pr.start, to };
}

/** Most "ohne …" comparisons one run computes. */
const MAX_VARIANTS = 14;

function variantLite(v: Pick<VariantLite, "id" | "label" | "kind">, run: RunResult): VariantLite {
  const s = runStats(run);
  return { ...v, n: s.n, avgR: s.avgR, sumR: s.sumR, net: s.net, netPct: s.netPct, winRate: s.winRate, pf: s.pf === Infinity ? null : s.pf, maxDD: s.maxDD };
}

const curveR = (trades: readonly BtTrade[]): number[] => {
  let s = 0;
  return [0, ...trades.map((t) => (s += t.r))];
};

const WEIGHTS: Readonly<Record<Exclude<LabPhase, "done">, number>> = { signals: 0.7, run: 0.04, optimise: 0.08, walkforward: 0.08, overfit: 0.08, diagnose: 0.02 };

export function createLabJob(input: LabJobInput): LabJob {
  const strategy = strategyOf(input.strategy);
  const cfg = strategyCfg(input);
  const specs: ParamSpec[] = strategy.specs(cfg);
  const params = completeParams(specs, input.params);
  const grid = paramGrid(specs, params);
  const timings: Partial<Record<LabPhase, number>> = {};
  let phase: LabPhase = "signals";
  let phaseStart = now();
  const prepStepper = strategy.prepare(input.data, cfg, input.fromMs) as Stepper<Prepared<unknown>>;
  let prep: Prepared<unknown> | null = null;
  // work queue after the preparation (each unit is a cheap loop over the bars)
  type Unit = { phase: LabPhase; run: () => void };
  let units: Unit[] = [];
  let u = 0;
  let result: LabResult | null = null;

  // shared state filled by the units
  let main: RunResult | null = null;
  let window: Window = { from: 0, to: 0 };
  const isTrials: Trial[] = [];
  let split: SplitResult = { params: null, is: null, oos: null, isCurveR: [], oosCurveR: [], cutTime: null };
  const wfWins: WfWindow[] = [];
  const fullTrials: Trial[] = [];
  const variantsOut: VariantLite[] = [];
  let funnelInfo: StrategyFunnel | null = null;

  const setPhase = (p: LabPhase) => {
    if (p === phase) return;
    timings[phase] = (timings[phase] ?? 0) + (now() - phaseStart);
    phase = p;
    phaseStart = now();
  };

  const plan = (pr: Prepared<unknown>) => {
    const bars = pr.bars;
    const secLen = HIST_MS[pr.interval] / 1000;
    window = windowOf(pr, input.toMs);
    const to = window.to;
    const ok = bars.length > 0 && to > pr.start;
    const q: Unit[] = [];
    q.push({
      phase: "run",
      run: () => {
        if (ok) main = evaluate(strategy, pr, params, input.engine, window, true);
      },
    });
    const sp = ok ? oosSplit(window.from, window.to, input.isShare ?? 0.7) : null;
    if (sp) {
      for (const p of grid) q.push({ phase: "optimise", run: () => void isTrials.push(trialOf(p, evaluate(strategy, pr, p, input.engine, sp.is).trades)) });
      q.push({
        phase: "optimise",
        run: () => {
          const best = bestTrial(isTrials);
          if (!best) {
            split = { params: null, is: null, oos: null, isCurveR: [], oosCurveR: [], cutTime: bars[sp.oos.from]!.t * 1000 };
            return;
          }
          const isRun = evaluate(strategy, pr, best.params, input.engine, sp.is, true);
          const oosRun = evaluate(strategy, pr, best.params, input.engine, sp.oos, true);
          split = { params: best.params, is: runStats(isRun), oos: runStats(oosRun), isCurveR: curveR(isRun.trades), oosCurveR: curveR(oosRun.trades), cutTime: bars[sp.oos.from]!.t * 1000 };
        },
      });
    }
    const layout = ok ? wfLayout(window.from, window.to, input.wfWindows ?? 5) : null;
    if (layout) layout.forEach((w, k) => q.push({ phase: "walkforward", run: () => void wfWins.push(wfWindow(strategy, pr, grid, input.engine, k, w.train, w.test, secLen)) }));
    if (ok) for (const p of grid) q.push({ phase: "overfit", run: () => void fullTrials.push(trialOf(p, evaluate(strategy, pr, p, input.engine, window).trades)) });
    if (ok) {
      // diagnosis: the same run without costs, without single filters / the management, and the strategy's rule funnel
      const rerun = (s: BtStrategy, eng: EngineCfg): RunResult => runBacktest(pr.bars, s, eng, { from: window.from, to: window.to, equity: false, atr: pr.atr, secLen });
      const free: EngineCfg = { ...input.engine, costs: { fees: { exchange: "none", makerBps: 0, takerBps: 0 }, slippage: { kind: "none" }, funding: { kind: "none" } } };
      q.push({ phase: "diagnose", run: () => void variantsOut.push(variantLite({ id: "noCosts", label: "Ohne Kosten (Gebühren, Slippage, Funding)", kind: "noCosts" }, rerun(strategy.build(pr, params), free))) });
      const vs: StrategyVariant[] = (strategy.variants?.(cfg) ?? []).slice(0, MAX_VARIANTS);
      for (const v of vs) {
        q.push({
          phase: "diagnose",
          run: () => {
            const built = strategy.buildVariant?.(pr, params, v.id) ?? null;
            if (built) variantsOut.push(variantLite(v, rerun(built, input.engine)));
          },
        });
      }
      q.push({ phase: "diagnose", run: () => void (funnelInfo = strategy.funnel?.(pr, params, window) ?? null) });
    }
    units = q;
  };

  const finish = (pr: Prepared<unknown>): LabResult => {
    setPhase("done");
    const bars = pr.bars;
    const secLen = HIST_MS[pr.interval] / 1000;
    const empty: RunResult = { trades: [], equity: [], from: input.fromMs, to: input.toMs, capital: input.engine.capital, skipped: 0, skippedGap: 0, skippedRisk: 0, signals: 0 };
    const run: RunResult = main ?? empty;
    const stats = runStats(run);
    // buy & hold: the whole capital in the market from the first close to the last (no leverage, no costs)
    const p0 = bars[window.from]?.c ?? 0;
    const buyHold: EquityPoint[] = p0 > 0 ? run.equity.map((e, k) => ({ t: e.t, equity: input.engine.capital * (bars[window.from + k]!.c / p0) })) : [];
    const wf: WalkForward | null = wfWins.length ? summarizeWf(wfWins) : null;
    const selected = split.params ? isTrials.find((t) => t.key === paramKey(split.params!)) : null;
    const dsr = selected ? deflatedSharpe(selected.trades.map((t) => t.r), isTrials.map((t) => t.sharpe ?? NaN)) : null;
    const span = Math.max(1, window.to - window.from + 1);
    const pbo = pboOf(fullTrials, (t) => Math.min(7, Math.floor(((t.exitIndex - window.from) / span) * 8)));
    const heatRaw = paramHeat(specs, fullTrials, params);
    const heat: HeatLite | null = heatRaw ? { ...heatRaw, rows: axisOf(heatRaw.rows), cols: axisOf(heatRaw.cols) } : null;
    const robust = robustness({
      trades: stats.n,
      dsr: dsr?.dsr ?? null,
      pbo: pbo?.pbo ?? null,
      isMeanR: split.is?.avgR ?? null,
      oosMeanR: split.oos?.avgR ?? null,
      wfe: wf?.efficiency ?? null,
      wfMeanR: wf?.oosMeanR ?? null,
    });
    const inPeriod = bars.slice(window.from, window.to + 1);
    const idx = downsampleIdx(run.equity, 360);
    const ivMs = HIST_MS[pr.interval];
    const sf: StrategyFunnel | null = funnelInfo;
    let blocked: number | null = null;
    if (sf) {
      // candidates inside a holding period [entry, exit) were never offered to the engine
      blocked = 0;
      let k = 0;
      for (const c of sf.candidates) {
        while (k < run.trades.length && run.trades[k]!.exitIndex <= c) k++;
        if (k < run.trades.length && run.trades[k]!.entryIndex <= c) blocked++;
      }
    }
    const custom = input.strategy === "custom" ? sanitizeCustom((cfg as { config: unknown }).config) : null;
    const coverage: CoverageRow[] = strategy.intervals(cfg).map((iv) => {
      const b = input.data[iv] ?? [];
      const g = gapsOf(b, HIST_MS[iv] / 1000);
      return { interval: iv, role: iv === pr.interval ? "exec" : "other", bars: b.length, first: b.length ? b[0]!.t * 1000 : null, last: b.length ? (b[b.length - 1]!.t + HIST_MS[iv] / 1000) * 1000 : null, gaps: g.gaps, missing: g.missing };
    });
    return {
      strategy: input.strategy,
      name: custom?.name ?? null,
      configKey: custom ? customKey(custom) : null,
      coverage,
      expectedBars: Math.max(0, Math.floor((input.toMs - input.fromMs) / ivMs)),
      warmup: { wanted: Math.ceil(strategy.warmupMs(cfg) / ivMs), got: pr.start },
      funnel: {
        examined: window.to > window.from ? window.to - window.from + 1 : 0,
        nodes: sf?.nodes ?? [],
        edges: sf ? sf.edges : null,
        conflicts: sf ? sf.conflicts : null,
        candidates: sf ? sf.candidates.length : null,
        blockedByPosition: blocked,
        signals: run.signals,
        skippedGap: run.skippedGap,
        skippedRisk: run.skippedRisk,
        executed: run.trades.length,
      },
      variants: variantsOut,
      symbol: input.symbol,
      interval: pr.interval,
      params,
      specs: specs.map((s) => ({ key: s.key, label: s.label, value: s.format(params[s.key]!) })),
      bars: inPeriod.length,
      gaps: gapsOf(inPeriod, secLen),
      from: run.from,
      to: run.to,
      stats,
      trades: run.trades,
      equity: idx.map((i) => run.equity[i]!),
      buyHold: buyHold.length === run.equity.length ? idx.map((i) => buyHold[i]!) : [],
      skipped: run.skipped,
      split,
      wf: wf
        ? {
            windows: wf.windows.map(({ testTrades, ...w }) => ({ ...w, testN: testTrades.length })),
            oosMeanR: wf.oosMeanR,
            efficiency: wf.efficiency,
            positiveShare: wf.positiveShare,
            oosN: wf.oos.length,
            oosSumR: wf.oos.reduce((s, t) => s + t.r, 0),
          }
        : null,
      dsr,
      pbo,
      heat,
      trials: fullTrials.map((t) => ({ key: t.key, params: t.params, n: t.n, meanR: t.meanR, sharpe: t.sharpe })),
      robust,
      timings,
    };
  };

  const total = () => {
    const unitShare = units.length ? u / units.length : 0;
    if (!prep) return prepStepper.progress() * WEIGHTS.signals;
    return WEIGHTS.signals + (1 - WEIGHTS.signals) * unitShare;
  };

  return {
    phase: () => phase,
    progress: () => (result ? 1 : Math.min(0.999, total())),
    step(deadline: number): boolean {
      if (result) return true;
      if (!prep) {
        if (!prepStepper.step(deadline)) return false;
        prep = prepStepper.result();
        plan(prep);
        setPhase(units[0]?.phase ?? "done");
      }
      while (u < units.length) {
        const unit = units[u]!;
        setPhase(unit.phase);
        unit.run();
        u++;
        if (now() >= deadline) return false;
      }
      result = finish(prep);
      return true;
    },
    result(): LabResult {
      while (!this.step(Number.POSITIVE_INFINITY)) {
        /* run to the end */
      }
      return result!;
    },
  };
}

/** Funding points in, the engine's model out (history when present, else the flat assumption). */
export function fundingModelOf(points: readonly FundingPoint[] | null, fallbackRate: number): EngineCfg["costs"]["funding"] {
  return points && points.length ? { kind: "history", points: [...points].sort((a, b) => a.t - b.t), fallbackRate } : { kind: "flat", ratePer8h: fallbackRate };
}
