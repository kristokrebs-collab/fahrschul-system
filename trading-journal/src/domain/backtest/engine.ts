/**
 * Bar-loop backtest engine (P07, pure, deterministic). One position at a time, decisions on CLOSED bars only:
 *
 * 1. At the close of bar i the strategy may signal an entry (flat) or an exit (in a position) – it sees bars 0…i.
 * 2. The order fills at the OPEN of bar i + 1 (market, taker, slippage against the trader). An open that already
 *    gapped beyond the stop or the target skips the signal (counted in `skipped`).
 * 3. Inside every bar from the fill on: stop first, then target (when both lie inside one bar's range the engine
 *    cannot know the order – it assumes the worse one). A stop that the open gapped through fills at the open.
 *    A target is a resting limit (maker, no slippage; a gap through it fills at the better open).
 * 4. Time stop: after `maxBars` bars in the trade, exit at that bar's close. End of the window: exit at its last close.
 * 5. Size: risk `riskPct` of the equity (or of the start capital without compounding) between fill and stop, capped
 *    at `maxLeverage` × equity notional. Fees on both fills, funding for every 8 h settlement held (see `fees.ts`).
 *
 * The equity is marked to market at every close (realised + open P&L − the entry fee).
 */
import { feeFor, fundingCost } from "./fees";
import { slipped } from "./slippage";
import { indexAtOrAfter } from "./bars";
import type { Bar, BtStrategy, BtTrade, EngineCfg, EntrySignal, EquityPoint, ExitReason, OpenPosition, RunResult } from "./types";

/** Smallest stop distance the engine accepts, as a share of the price (a 0-risk trade would get an absurd size). */
export const MIN_RISK_FRAC = 0.0005;

export interface RunOptions {
  /** first / last bar index of the window (inclusive); default the whole series */
  from?: number;
  to?: number;
  /** per-bar equity curve (default true; the optimiser switches it off) */
  equity?: boolean;
  /** ATR per bar for the ATR slippage model */
  atr?: readonly number[];
  /** bar length in seconds (for times in ms of the exit at a close) */
  secLen: number;
}

interface Pending {
  kind: "entry" | "exit";
  signal?: EntrySignal;
  reason?: string;
}

const ms = (s: number): number => s * 1000;

/** Runs `strategy` over `bars` with `cfg`. */
export function runBacktest(bars: readonly Bar[], strategy: BtStrategy, cfg: EngineCfg, opts: RunOptions): RunResult {
  const n = bars.length;
  const from = Math.max(0, Math.min(n - 1, opts.from ?? 0));
  const to = Math.max(from, Math.min(n - 1, opts.to ?? n - 1));
  const withEquity = opts.equity !== false;
  const { fees: feeModel, slippage, funding } = cfg.costs;
  const atrAt = (i: number): number | null => (opts.atr && i >= 0 && i < opts.atr.length ? (opts.atr[i] ?? null) : null);
  const trades: BtTrade[] = [];
  const equity: EquityPoint[] = [];
  let realised = cfg.capital;
  let pos: OpenPosition | null = null;
  let entryFee = 0;
  let entrySlip = 0;
  let pending: Pending | null = null;
  let skipped = 0;
  const priceAt = (tMs: number): number => {
    const k = Math.max(0, indexAtOrAfter(bars, tMs / 1000 + 1) - 1);
    return bars[Math.min(k, n - 1)]!.c;
  };

  const close = (i: number, raw: number, reason: ExitReason, maker: boolean, atClose: boolean) => {
    const p = pos!;
    const long = p.side === "long";
    const px = maker ? raw : slipped(slippage, raw, !long, atrAt(i - 1));
    const notionalOut = p.qty * px;
    const exitFee = feeFor(notionalOut, maker, feeModel);
    const entryT = ms(bars[p.entryIndex]!.t);
    const exitT = atClose ? ms(bars[i]!.t + opts.secLen) : ms(bars[i]!.t);
    const fund = fundingCost(funding, p.side, p.qty, entryT, exitT, priceAt);
    const dir = long ? 1 : -1;
    const gross = dir * (px - p.entry) * p.qty;
    const pnl = gross - entryFee - exitFee - fund;
    const risk = Math.abs(p.entry - p.stop) * p.qty;
    trades.push({
      id: `bt-${p.entryIndex}`,
      side: p.side,
      tag: p.signal.tag,
      grade: p.signal.grade,
      entryIndex: p.entryIndex,
      exitIndex: i,
      entryTime: entryT,
      exitTime: exitT,
      entry: p.entry,
      exit: px,
      stop: p.stop,
      target: p.target,
      qty: p.qty,
      notional: p.qty * p.entry,
      pnl,
      fees: entryFee + exitFee,
      funding: fund,
      slippage: entrySlip + Math.abs(px - raw) * p.qty,
      r: risk > 0 ? pnl / risk : 0,
      move: p.entry > 0 ? (dir * (px - p.entry)) / p.entry : 0,
      bars: i - p.entryIndex + 1,
      reason,
    });
    realised += pnl;
    pos = null;
    entryFee = 0;
    entrySlip = 0;
  };

  const open = (i: number, s: EntrySignal): boolean => {
    const b = bars[i]!;
    const long = s.side === "long";
    // the open gapped past the stop or the target: the setup is gone
    if (long ? b.o <= s.stop : b.o >= s.stop) return false;
    if (s.target != null && (long ? b.o >= s.target : b.o <= s.target)) return false;
    const px = slipped(slippage, b.o, long, atrAt(i - 1));
    const riskDist = long ? px - s.stop : s.stop - px;
    if (!(riskDist > px * MIN_RISK_FRAC)) return false;
    const base = cfg.compounding ? realised : Math.min(realised, cfg.capital);
    if (!(base > 0)) return false;
    let qty = (base * cfg.riskPct) / riskDist;
    const maxQty = (base * Math.max(1, cfg.maxLeverage)) / px;
    if (qty > maxQty) qty = maxQty;
    if (!(qty > 0)) return false;
    entryFee = feeFor(qty * px, false, feeModel);
    entrySlip = Math.abs(px - b.o) * qty;
    pos = { side: s.side, entryIndex: i, entry: px, stop: s.stop, target: s.target, qty, maxBars: s.maxBars, signal: s };
    return true;
  };

  for (let i = from; i <= to; i++) {
    const b = bars[i]!;
    // 1) orders decided at the previous close fill at this open
    if (pending) {
      const pd: Pending = pending;
      pending = null;
      if (pd.kind === "exit" && pos) close(i, b.o, "signal", false, false);
      else if (pd.kind === "entry" && !pos && pd.signal) {
        if (!open(i, pd.signal)) skipped++;
      }
    }
    // 2) intrabar: stop first, then the target
    if (pos) {
      const p: OpenPosition = pos;
      const long = p.side === "long";
      const fillBar = p.entryIndex === i;
      const stopHit = long ? b.l <= p.stop : b.h >= p.stop;
      const tgtHit = p.target != null && (long ? b.h >= p.target : b.l <= p.target);
      if (stopHit) {
        const raw = fillBar ? p.stop : long ? Math.min(p.stop, b.o) : Math.max(p.stop, b.o);
        close(i, raw, "stop", false, false);
      } else if (tgtHit && p.target != null) {
        const raw = fillBar ? p.target : long ? Math.max(p.target, b.o) : Math.min(p.target, b.o);
        close(i, raw, "target", true, false);
      } else if (p.maxBars != null && i - p.entryIndex + 1 >= p.maxBars) {
        close(i, b.c, "time", false, true);
      }
    }
    // 3) decisions at this close (never on the window's last bar: there is no next open inside the window)
    if (i < to) {
      if (pos) {
        const why = strategy.exitAt?.(i, pos) ?? null;
        if (why) pending = { kind: "exit", reason: why };
      } else if (i >= strategy.start) {
        const s = strategy.signalAt(i);
        if (s && Number.isFinite(s.stop) && (s.target == null || Number.isFinite(s.target))) pending = { kind: "entry", signal: s };
      }
    } else if (pos) {
      close(i, b.c, "end", false, true);
    }
    if (withEquity) {
      let eq = realised;
      if (pos) {
        const p: OpenPosition = pos;
        eq += (p.side === "long" ? 1 : -1) * (b.c - p.entry) * p.qty - entryFee;
      }
      equity.push({ t: ms(b.t + opts.secLen), equity: eq });
    }
  }
  return { trades, equity, from: ms(bars[from]!.t), to: ms(bars[to]!.t + opts.secLen), capital: cfg.capital, skipped };
}
