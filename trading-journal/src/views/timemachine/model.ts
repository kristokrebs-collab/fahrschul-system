/**
 * Pure model of the Zeitmaschine card: the card's props → the domain input (or the reason it cannot run), the key that tells
 * a changed plan from a re-render, and the trade of the journal → a plan. No React, no network.
 */
import type { Bar } from "@/domain/backtest/types";
import { checkInput, DEFAULT_TM_COSTS, defaultOptions, isTmInterval, TM_SEED, type TmInput } from "@/domain/timemachine";
import type { TimeMachineCandle, TimeMachineProps } from "./types";

/** Closed candles in the engine's bars (open time in SECONDS); unusable ones are dropped here, `buildPool` cleans the rest. */
export function barsOf(candles: readonly TimeMachineCandle[]): Bar[] {
  const out: Bar[] = [];
  for (const c of candles) {
    if (c.closed === false) continue;
    if (![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)) continue;
    out.push({ t: c.time / 1000, o: c.open, h: c.high, l: c.low, c: c.close, ...(c.volume != null && Number.isFinite(c.volume) ? { v: c.volume } : {}) });
  }
  return out;
}

export type InputOf = { ok: true; input: TmInput } | { ok: false; why: string };

export function inputOf(p: TimeMachineProps): InputOf {
  if (!isTmInterval(p.interval)) return { ok: false, why: `Der Zeiteinheit „${String(p.interval)}“ wird nicht unterstützt.` };
  const input: TmInput = {
    symbol: p.symbol,
    plan: { side: p.side, entry: p.entry, stop: p.stop, target: p.target },
    bars: barsOf(p.candles),
    interval: p.interval,
    costs: p.costs ?? DEFAULT_TM_COSTS,
    startMs: p.startMs ?? null,
    ...defaultOptions(p.interval),
    ...p.options,
    seed: p.seed ?? p.options?.seed ?? TM_SEED,
  };
  const bad = checkInput(input);
  return bad ? { ok: false, why: bad.why } : { ok: true, input };
}

/** Changes whenever the plan, the options, the costs or the candles change (the effect restarts the run on it). */
export function runKey(p: TimeMachineProps): string {
  const c = p.candles;
  const first = c[0];
  const last = c[c.length - 1];
  return JSON.stringify([p.symbol, p.side, p.entry, p.stop, p.target, p.interval, p.seed ?? null, p.options ?? null, p.costs ?? null, p.startMs ?? null, c.length, first?.time ?? 0, last?.time ?? 0, last?.close ?? 0]);
}
