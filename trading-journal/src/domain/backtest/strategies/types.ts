/**
 * Contract of a lab strategy (P07): an expensive, parameter-free preparation over CLOSED bars (the real Box-zu-Box
 * engine, the real MCB ladder, indicator series) that runs once per data set, and a cheap `build(params)` that turns
 * the prepared per-bar facts into an engine strategy. The optimiser (in-sample grid, walk-forward, PBO) only calls
 * `build`, so a grid of 27 parameter sets costs 27 cheap loops, not 27 box scans.
 */
import type { Bar, BarsBy, BtStrategy, HistInterval } from "../types";

export type ParamValue = number | string;
export type Params = Readonly<Record<string, ParamValue>>;

export interface ParamSpec {
  key: string;
  label: string;
  options: readonly ParamValue[];
  /** shown value ("T1", "≥ 3", "2 × ATR") */
  format: (v: ParamValue) => string;
  /** part of the optimisation grid (else only the chosen value is used) */
  grid: boolean;
}

/** A prepared data set: the execution bars, the first tradable index and the strategy's own per-bar facts. */
export interface Prepared<F = unknown> {
  /** execution interval and its bars (the engine walks these) */
  interval: HistInterval;
  bars: readonly Bar[];
  /** ATR(14) per execution bar (stops, slippage) */
  atr: readonly number[];
  /** first bar index inside the chosen period (bars before it are warm-up only) */
  start: number;
  facts: F;
}

/** Incremental work unit: `step(deadline)` works until `performance.now() ≥ deadline`, returns true when done. */
export interface Stepper<T> {
  step(deadline: number): boolean;
  /** 0…1 */
  progress(): number;
  result(): T;
}

export interface LabStrategy<F = unknown, C = unknown> {
  id: string;
  /** exchange intervals the preparation needs (first = execution interval) */
  intervals(cfg: C): HistInterval[];
  /** history the preparation needs before the first tradable bar (ms; every interval is loaded from start − warm-up) */
  warmupMs(cfg: C): number;
  prepare(data: BarsBy, cfg: C, startMs: number): Stepper<Prepared<F>>;
  specs(cfg: C): ParamSpec[];
  build(prep: Prepared<F>, params: Params): BtStrategy;
}

/** Every combination of the grid specs (others fixed to `base`). */
export function paramGrid(specs: readonly ParamSpec[], base: Params): Params[] {
  let out: Record<string, ParamValue>[] = [{ ...base }];
  for (const s of specs) {
    if (!s.grid) continue;
    const next: Record<string, ParamValue>[] = [];
    for (const p of out) for (const v of s.options) next.push({ ...p, [s.key]: v });
    out = next;
  }
  return out;
}

/** Stable key of a parameter set (grid lookups, heat cells). */
export const paramKey = (p: Params): string =>
  Object.keys(p)
    .sort()
    .map((k) => `${k}=${String(p[k])}`)
    .join("&");

/** A stepper over `n` units (`unit(i)` does one), with `performance.now()` deadlines. */
export function loopStepper<T>(n: number, unit: (i: number) => void, done: () => T): Stepper<T> {
  let i = 0;
  let res: T | undefined;
  return {
    step(deadline) {
      while (i < n) {
        unit(i++);
        if ((i & 7) === 0 && now() >= deadline) break;
      }
      if (i >= n && res === undefined) res = done();
      return i >= n;
    },
    progress: () => (n ? i / n : 1),
    result() {
      if (res === undefined) {
        while (i < n) unit(i++);
        res = done();
      }
      return res;
    },
  };
}

export const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
