/** Shared fixtures of the optimiser tests: real BTCUSDT candles (fixtures) and small rule sets. Test data only. */
import { readFileSync } from "node:fs";
import { DEFAULT_FEES, type Bar, type BarsBy, type EngineCfg } from "@/domain/backtest/index";
import { newGroup, newLeaf, sanitizeCustom, defaultCustom } from "@/domain/lab";
import type { CustomConfig } from "@/domain/lab";
import type { MultiInput, StrategyInput } from "@/domain/evolve";
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
