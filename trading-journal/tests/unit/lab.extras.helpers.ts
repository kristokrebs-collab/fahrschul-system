/** Shared fixtures of the F20 / F18 / F17 tests: hand-built trades and a REAL lab run on the BTCUSDT fixtures. */
import { readFileSync } from "node:fs";
import { DEFAULT_FEES, type Bar, type BtTrade, type EngineCfg, type LabJobInput } from "@/domain/backtest/index";
import { defaultCustom, newGroup, newLeaf, sanitizeCustom } from "@/domain/lab";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";

export const H = 3600;
export const T0 = Date.UTC(2026, 0, 5, 0, 0, 0); // a Monday, 00:00 UTC

let seq = 0;
/** A closed long trade on a 1h grid: entry at bar `entryIndex`, `bars` bars long; money follows from `r` (risk 100). */
export function trade(r: number, o: Partial<BtTrade> = {}): BtTrade {
  const entryIndex = o.entryIndex ?? 40 + (seq++ % 200);
  const bars = o.bars ?? 4;
  const entry = 100;
  const stop = 95;
  return {
    id: `t${seq}`,
    side: "long",
    tag: "T",
    entryIndex,
    exitIndex: entryIndex + bars - 1,
    entryTime: T0 + entryIndex * H * 1000,
    exitTime: T0 + (entryIndex + bars) * H * 1000,
    entry,
    exit: entry + r * (entry - stop),
    stop,
    target: null,
    qty: 20,
    notional: 2000,
    pnl: r * 100,
    fees: 0,
    funding: 0,
    slippage: 0,
    move: 0,
    bars,
    reason: "stop",
    r,
    ...o,
  } as BtTrade;
}

/** Trades one after the other, `gap` bars apart, from bar 20. */
export function chain(rs: readonly number[], bars = 4, gap = 6): BtTrade[] {
  return rs.map((r, i) => trade(r, { entryIndex: 20 + i * (bars + gap), bars }));
}

const read = (n: string): Bar[] => (JSON.parse(readFileSync(`tests/unit/fixtures/${n}`, "utf8")) as { bars: number[][] }).bars.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));
export const H4 = read("binance-btcusdt-4h.json");
export const D1 = read("binance-btcusdt-1d.json");

export const ENGINE: EngineCfg = { capital: 10_000, riskPct: 0.01, maxLeverage: 5, compounding: true, costs: { fees: DEFAULT_FEES, slippage: { kind: "fixed", bps: 2 }, funding: { kind: "flat", ratePer8h: 0.0001 } } };

/** "RSI below 45 AND close above the 5-day average (1D)" on 4h, long, plain stop / target – a real run with trades. */
export function realInput(over: Partial<LabJobInput> = {}): LabJobInput {
  const config = sanitizeCustom({
    ...defaultCustom(),
    long: newGroup("g1", "and", [
      { ...newLeaf("n1", "rsi"), params: { len: 14, mode: "below", level: 45, within: 1 } },
      { ...newLeaf("n2", "maPrice", "1d"), params: { type: "sma", len: 5, mode: "above", within: 1 } },
    ]),
  });
  return {
    strategy: "custom",
    symbol: "BTCUSDT",
    box: { tf: "4h" },
    mcb: { signal: DEFAULT_SIGNAL_CFG, step: "4h" },
    rules: { interval: "4h", side: "long", conds: [] },
    custom: { config, signal: DEFAULT_SIGNAL_CFG },
    params: {},
    fromMs: H4[400]!.t * 1000,
    toMs: (H4[H4.length - 1]!.t + 14_400) * 1000,
    engine: ENGINE,
    data: { "4h": H4, "1d": D1 },
    ...over,
  };
}
