/**
 * One trade through the REAL backtest engine (`@/domain/backtest`): the Zeitmaschine does not have its own idea of fills.
 * A "segment" is a short series of candles whose first candle is the SIGNAL candle; the engine fills at the open of the second,
 * checks stop before target inside every candle (both in one candle → the stop counts), pays taker fees and slippage on the
 * entry and the stop, a maker fee on the target, funding for every 8 h settlement held, and closes at the time stop.
 * Simulated sessions and real candles go through exactly this function, so the two parts are comparable by construction.
 */
import { runBacktest } from "../backtest/engine";
import type { BtStrategy, BtTrade, EngineCfg, EntrySignal, PositionMgmt } from "../backtest/types";
import type { Bar, CostModel, TmManage, TmPlan } from "./types";

/** Capital and risk only scale the position: R, the shares and the costs in R do not depend on them. No leverage cap. */
export function engineCfg(costs: CostModel): EngineCfg {
  return { capital: 10_000, riskPct: 0.01, maxLeverage: 1_000_000, compounding: false, costs };
}

/** The user-level management → the engine's `PositionMgmt` (undefined = the plain stop and target). */
export function mgmtOf(m: TmManage): PositionMgmt | undefined {
  const out: PositionMgmt = {};
  if (m.breakEvenR != null && m.breakEvenR > 0) out.breakEven = { after: { kind: "r", value: m.breakEvenR }, to: "entry" };
  if (m.trailAtr != null && m.trailAtr > 0) out.trail = { kind: "atr", value: m.trailAtr, activateR: Math.max(0, m.trailFromR) };
  return out.breakEven || out.trail ? out : undefined;
}

export function signalOf(plan: TmPlan, stop: number, target: number, horizon: number, manage: TmManage): EntrySignal {
  const mg = mgmtOf(manage);
  return { side: plan.side, stop, target, maxBars: horizon, tag: "Zeitmaschine", ...(mg ? { manage: mg } : {}) };
}

/** A strategy that signals once, at the close of the first candle of the segment. */
export function onceAtStart(signal: EntrySignal): BtStrategy & { signal: EntrySignal } {
  const s = {
    signal,
    start: 0,
    signalAt(i: number): EntrySignal | null {
      return i === 0 ? s.signal : null;
    },
  };
  return s;
}

export interface Played {
  trade: BtTrade | null;
  /** the engine skipped the signal because the open lay beyond stop or target / the stop was too close */
  skipped: boolean;
}

/** Runs one segment. `atr` is aligned to the segment (ATR for the slippage model and the trailing stop). */
export function playSegment(seg: readonly Bar[], atr: readonly number[], strategy: BtStrategy, cfg: EngineCfg, secLen: number): Played {
  const res = runBacktest(seg, strategy, cfg, { equity: false, atr, secLen });
  const trade = res.trades[0] ?? null;
  return { trade, skipped: trade == null && res.skipped > 0 };
}

/** Largest move against / for the position, in R of the ORIGINAL risk, from the entry candle to the exit candle (inclusive). */
export function excursionR(seg: readonly Bar[], t: BtTrade): { mae: number; mfe: number } {
  const risk = Math.abs(t.entry - t.stop);
  if (!(risk > 0)) return { mae: 0, mfe: 0 };
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = t.entryIndex; i <= t.exitIndex && i < seg.length; i++) {
    const b = seg[i]!;
    if (b.l < lo) lo = b.l;
    if (b.h > hi) hi = b.h;
  }
  const long = t.side === "long";
  const adverse = long ? t.entry - lo : hi - t.entry;
  const favourable = long ? hi - t.entry : t.entry - lo;
  return { mae: Math.max(0, adverse / risk), mfe: Math.max(0, favourable / risk) };
}

/** Fees + funding + slippage of a trade in R of its planned risk (positive = cost). */
export function costInR(t: BtTrade): number {
  const risk = Math.abs(t.entry - t.stop) * t.qty;
  return risk > 0 ? (t.fees + t.funding + t.slippage) / risk : 0;
}
