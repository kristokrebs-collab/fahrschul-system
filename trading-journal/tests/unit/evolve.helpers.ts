/** Shared fixtures of the optimiser tests: real BTCUSDT candles (fixtures), synthetic paths and small rule sets. Test data only. */
import { readFileSync } from "node:fs";
import { rng } from "@/domain/analytics/stats";
import { DEFAULT_FEES, type Bar, type BarsBy, type EngineCfg } from "@/domain/backtest/index";
import { EvolveMulti, type MultiInput, type StoredProposal, type StrategyInput } from "@/domain/evolve";
import { defaultCustom, newGroup, newLeaf, sanitizeCustom, type CustomConfig } from "@/domain/lab";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";

const read = (n: string): Bar[] => (JSON.parse(readFileSync(`tests/unit/fixtures/${n}`, "utf8")) as { bars: number[][] }).bars.map(([t, o, h, l, c, v]) => ({ t: t!, o: o!, h: h!, l: l!, c: c!, ...(v != null ? { v } : {}) }));
export const H4 = read("binance-btcusdt-4h.json");
export const D1 = read("binance-btcusdt-1d.json");

export const ENGINE: EngineCfg = { capital: 10_000, riskPct: 0.01, maxLeverage: 5, compounding: true, costs: { fees: DEFAULT_FEES, slippage: { kind: "fixed", bps: 2 }, funding: { kind: "flat", ratePer8h: 0.0001 } } };

/** "RSI below 45 AND close above the 5-day average (1D)" on 4h, long. */
export function baseRules(): CustomConfig {
  return sanitizeCustom({
    ...defaultCustom(),
    name: "Test-Idee",
    long: newGroup("g1", "and", [
      { ...newLeaf("n1", "rsi"), params: { len: 14, mode: "below", level: 45, within: 1 } },
      { ...newLeaf("n2", "maPrice", "1d"), params: { type: "sma", len: 5, mode: "above", within: 1 } },
    ]),
  });
}

export const DATA: BarsBy = { "4h": H4, "1d": D1 };
export const FROM_MS = H4[300]!.t * 1000;

export function strategy(id = "s1", over: Partial<StrategyInput> = {}): StrategyInput {
  return { id, name: `Strategie ${id}`, datasetKey: "btc", base: baseRules(), signal: DEFAULT_SIGNAL_CFG, symbol: "BTCUSDT", fromMs: FROM_MS, engine: ENGINE, maxTrials: 40, priorTrials: 0, ...over };
}

export function multiInput(over: Partial<MultiInput> = {}, strategies: StrategyInput[] = [strategy()]): MultiInput {
  return { datasets: { btc: DATA }, strategies, seed: 12345, opts: { boot: 120 }, ...over };
}

// ── synthetic markets ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Hourly candles from a seeded path with 12 sub-steps per candle (so highs and lows are real: a candle made of one step has no
 * wicks and flatters break-even / trailing rules). `kappa` 0 = random walk, > 0 = mean-reverting around 100 (a real edge for
 * "buy after a fall" rules).
 */
export function path(n: number, seed: number, kappa: number, sigma = 0.012): Bar[] {
  const r = rng(seed);
  const g = (): number => {
    let s = 0;
    for (let i = 0; i < 12; i++) s += r();
    return s - 6;
  };
  const SUB = 12;
  const t0 = Date.UTC(2026, 0, 1) / 1000;
  let x = 0;
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const o = 100 * Math.exp(x);
    let hi = o;
    let lo = o;
    for (let k = 0; k < SUB; k++) {
      x = x - (kappa / SUB) * x + (sigma / Math.sqrt(SUB)) * g();
      const v = 100 * Math.exp(x);
      hi = Math.max(hi, v);
      lo = Math.min(lo, v);
    }
    out.push({ t: t0 + i * 3600, o, h: hi, l: lo, c: 100 * Math.exp(x), v: 100 + 50 * r() });
  }
  return out;
}

/** A deliberately weak long idea on hourly candles: RSI below 60, 1.5 ATR stop, 1 R target. */
export function weakRules(): CustomConfig {
  return sanitizeCustom({
    ...defaultCustom(),
    name: "Schwach",
    interval: "1h",
    long: newGroup("g1", "and", [{ ...newLeaf("n1", "rsi"), params: { len: 14, mode: "below", level: 60, within: 1 } }]),
    stop: { kind: "atr", atr: 1.5, pct: 1.5, swing: 10, buffer: 0.1 },
    target: { kind: "r", r: 1 },
  });
}

export function pathInput(bars: Bar[], seed: number, budget: number, over: Partial<StrategyInput> = {}): MultiInput {
  return {
    datasets: { a: { "1h": bars } },
    seed,
    opts: { boot: 300 },
    strategies: [{ id: "s", name: "Weak", datasetKey: "a", base: weakRules(), signal: DEFAULT_SIGNAL_CFG, symbol: "TESTUSDT", fromMs: bars[400]!.t * 1000, engine: ENGINE, maxTrials: budget, priorTrials: 0, ...over }],
  };
}

/** Steps a run to its end in slices of `ms` (the work does not depend on the slice). */
export function drive(m: { step(deadline: number): boolean }, ms = 50): void {
  const stop = performance.now() + 120_000;
  while (!m.step(performance.now() + ms)) if (performance.now() > stop) throw new Error("run did not finish");
}

/** Real proposals from a real (small) run on a mean-reverting synthetic market – the strategy id is "s". */
export function realProposals(count = 3): StoredProposal[] {
  const m = new EvolveMulti(pathInput(path(5000, 31, 0.12), 7, 150));
  drive(m);
  return m.result()!.strategies[0]!.proposals.slice(0, count).map((d, i) => ({ ...d, id: `ev_real${i}`, createdAt: 1_000 + i, decision: "open" as const }));
}
