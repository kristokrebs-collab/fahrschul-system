/**
 * Helpers of the Zeitmaschine tests: lattice markets with a known solution (gambler's ruin), real BTCUSDT bars, a plain input.
 */
import { readFileSync } from "node:fs";
import type { Bar, CostModel } from "@/domain/backtest/types";
import { defaultOptions, type TmInput, type TmInterval, type TmPlan } from "@/domain/timemachine";
import { rng } from "@/domain/timemachine/stats";

export const ZERO_COSTS: CostModel = { fees: { exchange: "test", makerBps: 0, takerBps: 0 }, slippage: { kind: "none" }, funding: { kind: "none" } };
export const FEE_COSTS: CostModel = { fees: { exchange: "test", makerBps: 2, takerBps: 5 }, slippage: { kind: "none" }, funding: { kind: "none" } };

/** The step of the lattice: every candle moves the price by ×1,01 or ÷1,01. */
export const STEP = 1.01;

/**
 * A market on a lattice: `n` candles, each starts at the previous close and ends one step up (×1,01) or down (÷1,01); high and
 * low are the open and the close. Exactly `round(pUp · n)` steps go up, in a seeded random order – so the pool of a run on it
 * has the drift and the step distribution this function says, and the odds of a plan with barriers on the lattice are known.
 */
export function latticeBars(n: number, pUp: number, secLen = 86_400, t0 = 1_700_000_000 - (1_700_000_000 % 86_400), seed = 7): Bar[] {
  const ups = Math.round(pUp * n);
  const dirs: number[] = Array.from({ length: n }, (_, i) => (i < ups ? 1 : -1));
  const r = rng(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [dirs[i], dirs[j]] = [dirs[j]!, dirs[i]!];
  }
  const out: Bar[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const c = dirs[i]! > 0 ? p * STEP : p / STEP;
    out.push({ t: t0 + i * secLen, o: p, h: Math.max(p, c), l: Math.min(p, c), c });
    p = c;
  }
  return out;
}

/**
 * A plan whose stop sits `a` steps against and whose target `b` steps for the trade (a hair inside the lattice point, so the
 * barrier is reached exactly when the price lands on the lattice point and not one step earlier).
 */
export function latticePlan(a: number, b: number, side: "long" | "short" = "long", entry = 100): TmPlan {
  if (side === "long") return { side, entry, stop: (entry / STEP ** a) * (1 + 1e-6), target: entry * STEP ** b * (1 - 1e-6) };
  return { side, entry, stop: entry * STEP ** a * (1 - 1e-6), target: (entry / STEP ** b) * (1 + 1e-6) };
}

export function input(over: Partial<TmInput> & { interval?: TmInterval } = {}): TmInput {
  const interval = over.interval ?? "1d";
  const bars = over.bars ?? latticeBars(600, 0.5);
  return {
    symbol: "TEST",
    plan: latticePlan(5, 10),
    bars,
    interval,
    costs: ZERO_COSTS,
    startMs: null,
    ...defaultOptions(interval),
    runs: 4000,
    horizon: 300,
    method: "single",
    // the lattice markets have a known solution only without a rescaling of the steps
    vol: "history",
    ...over,
  };
}

/** Real TradingView BINANCE:BTCUSDT.P 4h bars (`tests/unit/fixtures`). */
export function btc4h(): Bar[] {
  return (JSON.parse(readFileSync("tests/unit/fixtures/binance-btcusdt-4h.json", "utf8")) as { bars: number[][] }).bars.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));
}
