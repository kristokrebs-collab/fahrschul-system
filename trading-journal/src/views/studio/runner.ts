/**
 * The two runs of the Strategie-Studio, on REAL candles through the lab's own loader and engine – the studio computes
 * nothing itself:
 * - `runStudioBacktest`: one strategy, the lab's job (`runLab`: worker or idle chunks), the lab's costs (fees, slippage,
 *   funding) from the Labor page's current set-up, risk per trade from the text when it names one;
 * - `runStudioCompare`: several strategies on the SAME candles, window, costs and train / test cut (`createComparison`),
 *   stepped in short slices so the page stays responsive.
 * The Labor page's own state is never touched.
 */
import {
  DEFAULT_FUNDING_RATE,
  feePreset,
  fundingModelOf,
  isLabAbort,
  runLab,
  type Bar,
  type EngineCfg,
  type HistInterval,
  type LabJobInput,
  type LabPhase,
  type LabResult,
} from "@/domain/backtest/index";
import { now as perfNow } from "@/domain/backtest/strategies/types";
import { activeLeaves, validateCustom, type CustomConfig } from "@/domain/lab";
import type { SignalCfg } from "@/domain/signals";
import { compareIntervals, compareWarmupMs, createComparison, type CompareInput, type CompareResult, type StudioPeriod } from "@/domain/strategytext";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { loadErrorKind, loadLabData } from "@/views/labor/historySource";
import { planOf, PERIOD_DAYS, sanitizeCfg, useLabor, type LabConfig } from "@/views/labor/laborStore";
import { STUDIO } from "./strings";

const E = STUDIO.backtest.errors;

export type RunErrorKind = "invalid" | "blocked" | "rate" | "symbol" | "failed" | "noData" | "cancelled";

/** A run that did not finish; `message` is German and shown as is. */
export class StudioRunError extends Error {
  kind: RunErrorKind;
  constructor(kind: RunErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "StudioRunError";
  }
}

export interface RunProgress {
  stage: "load" | "run";
  /** 0..1 over the whole run */
  fraction: number;
  done: number;
  total: number;
  phase: LabPhase | "load";
}

export interface StudioRun {
  result: LabResult;
  /** the execution candles (the index space of the result's trades) */
  bars: readonly Bar[];
  /** the lab set-up this run used (costs, capital, risk) */
  cfg: LabConfig;
  fundingUsed: "history" | "flat" | "none";
  config: CustomConfig;
  symbol: string;
  period: StudioPeriod;
  /** ms */
  at: number;
}

const MS_DAY = 86_400_000;

const loadMessage = (e: unknown): StudioRunError => {
  const kind = loadErrorKind(e);
  return new StudioRunError(kind, kind === "blocked" ? (IS_FILE_BUILD || isFileProtocol() ? STUDIO.backtest.errors.blocked : E.blocked) : kind === "rate" ? E.rate : kind === "symbol" ? E.symbol : E.failed);
};

const isAbort = (e: unknown): boolean => isLabAbort(e) || (e instanceof Error && e.name === "AbortError");

/** The lab's set-up for a studio run: the Labor page's costs, the strategy's rules, market and period. */
export function labCfgFor(config: CustomConfig, symbol: string, period: StudioPeriod, riskPct: number | null): LabConfig {
  const base = useLabor.getState().cfg;
  return sanitizeCfg({ ...base, strategy: "custom", symbol, period, custom: config, ...(riskPct != null ? { riskPct } : {}) });
}

const FUNDING_MISSING = "Die Funding-Historie konnte nicht geladen werden. Der Baustein „Funding-Extrem“ braucht sie – ohne sie würde die Strategie nie handeln. Versuche es noch einmal oder entferne den Baustein.";

export function engineOf(cfg: LabConfig, fundingUsed: "history" | "flat" | "none", history: Parameters<typeof fundingModelOf>[0]): EngineCfg {
  const fee = feePreset(cfg.exchange);
  return {
    capital: cfg.capital,
    riskPct: cfg.riskPct / 100,
    maxLeverage: cfg.maxLeverage,
    compounding: true,
    costs: { fees: { exchange: fee.exchange, makerBps: fee.makerBps, takerBps: fee.takerBps }, slippage: cfg.slippage, funding: fundingUsed === "none" ? { kind: "none" } : fundingModelOf(fundingUsed === "history" ? history : null, DEFAULT_FUNDING_RATE) },
  };
}

export interface BacktestArgs {
  config: CustomConfig;
  symbol: string;
  period: StudioPeriod;
  /** percent per trade named in the text, `null` = the lab's setting */
  riskPct: number | null;
  signal: SignalCfg;
  abort: AbortSignal;
  now?: number;
  onProgress?: (p: RunProgress) => void;
}

/** One strategy on real candles. Throws `StudioRunError`. */
export async function runStudioBacktest(a: BacktestArgs): Promise<StudioRun> {
  const now = a.now ?? Date.now();
  if (validateCustom(a.config, { funding: true }).some((i) => i.level === "error")) throw new StudioRunError("invalid", "Die Regeln lassen sich so nicht rechnen.");
  const cfg = labCfgFor(a.config, a.symbol, a.period, a.riskPct);
  const plan = planOf(cfg, a.signal);
  const fromMs = now - PERIOD_DAYS[a.period] * MS_DAY;
  let stage: "load" | "run" = "load";
  let last = 0;
  try {
    const loaded = await loadLabData({
      symbol: cfg.symbol,
      intervals: plan.intervals,
      from: fromMs - plan.warmupMs,
      to: now,
      funding: cfg.funding === "history",
      signal: a.abort,
      onProgress: (done, total) => a.onProgress?.({ stage: "load", fraction: total ? Math.min(1, done / total) * 0.15 : 0, done, total, phase: "load" }),
    });
    const exec = loaded.data[plan.intervals[0]!] ?? [];
    if (exec.length < 120) throw new StudioRunError("noData", E.noData);
    const fundingUsed: StudioRun["fundingUsed"] = cfg.funding === "none" ? "none" : cfg.funding === "history" && loaded.funding ? "history" : "flat";
    if (fundingUsed !== "history" && activeLeaves(a.config).some((l) => l.block === "funding")) throw new StudioRunError("failed", FUNDING_MISSING);
    const input: LabJobInput = { ...plan.input, fromMs, toMs: now, data: loaded.data, engine: engineOf(cfg, fundingUsed, loaded.funding) };
    stage = "run";
    const result = await runLab(input, {
      signal: a.abort,
      onProgress: (p, phase) => {
        const t = Date.now();
        if (t - last < 120) return;
        last = t;
        a.onProgress?.({ stage: "run", fraction: 0.15 + 0.85 * p, done: 0, total: 0, phase });
      },
    });
    return { result, bars: exec, cfg, fundingUsed, config: a.config, symbol: a.symbol, period: a.period, at: Date.now() };
  } catch (e) {
    if (e instanceof StudioRunError) throw e;
    if (isAbort(e)) throw new StudioRunError("cancelled", E.cancelled);
    if (stage === "run") {
      console.error("Studio: Lauf fehlgeschlagen", e);
      throw new StudioRunError("failed", E.failed);
    }
    throw loadMessage(e);
  }
}

export interface CompareArgs {
  items: CompareInput[];
  symbol: string;
  period: StudioPeriod;
  signal: SignalCfg;
  abort: AbortSignal;
  /** strategies tried before that are not in `items` (they count for the multiple-testing note) */
  extraTrials: number;
  now?: number;
  onProgress?: (fraction: number) => void;
}

export interface StudioComparison {
  result: CompareResult;
  symbol: string;
  period: StudioPeriod;
  cfg: LabConfig;
  at: number;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Several strategies on the same candles and window. Throws `StudioRunError`. */
export async function runStudioCompare(a: CompareArgs): Promise<StudioComparison> {
  const now = a.now ?? Date.now();
  const cfg = labCfgFor(a.items[0]!.config, a.symbol, a.period, null);
  const intervals = compareIntervals(a.items, a.signal);
  const warm = compareWarmupMs(a.items, a.signal);
  const fromMs = now - PERIOD_DAYS[a.period] * MS_DAY;
  let stage: "load" | "run" = "load";
  try {
    const loaded = await loadLabData({
      symbol: cfg.symbol,
      intervals: intervals as HistInterval[],
      from: fromMs - warm,
      to: now,
      funding: cfg.funding === "history",
      signal: a.abort,
      onProgress: (done, total) => a.onProgress?.(total ? Math.min(1, done / total) * 0.2 : 0),
    });
    const exec = intervals.map((iv) => loaded.data[iv]?.length ?? 0);
    if (exec.every((n) => n < 120)) throw new StudioRunError("noData", E.noData);
    const fundingUsed: StudioRun["fundingUsed"] = cfg.funding === "none" ? "none" : cfg.funding === "history" && loaded.funding ? "history" : "flat";
    stage = "run";
    const step = createComparison(a.items, { data: loaded.data, fromMs, toMs: now, engine: engineOf(cfg, fundingUsed, loaded.funding), signal: a.signal, funding: fundingUsed === "history" ? loaded.funding : null, extraTrials: a.extraTrials });
    while (!step.step(perfNow() + 14)) {
      if (a.abort.aborted) throw new StudioRunError("cancelled", E.cancelled);
      a.onProgress?.(0.2 + 0.8 * step.progress());
      await tick();
    }
    return { result: step.result(), symbol: a.symbol, period: a.period, cfg, at: Date.now() };
  } catch (e) {
    if (e instanceof StudioRunError) throw e;
    if (isAbort(e)) throw new StudioRunError("cancelled", E.cancelled);
    if (stage === "run") {
      console.error("Studio: Vergleich fehlgeschlagen", e);
      throw new StudioRunError("failed", E.failed);
    }
    throw loadMessage(e);
  }
}
