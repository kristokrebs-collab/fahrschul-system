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
 * 6. Position management (optional, `EntrySignal.manage`, F65), decided at bar CLOSES and in force from the NEXT bar:
 *    break-even (after +X R / +X %: the stop moves to the entry or to the estimated net break-even), trailing stop (ATR
 *    multiple or percent behind the best price since the fill, ratchet) and ONE partial take-profit (a maker limit at
 *    +N R for a share of the quantity, the rest runs on). The stop is never loosened. R is always measured against
 *    the ORIGINAL stop and quantity. Inside one bar the order is: the stop in force at the bar's start → partial →
 *    final target → time stop. When the bar's range holds the stop AND a take-profit, the stop wins (the engine cannot
 *    know the order – the trade is flagged `ambiguous`); a break-even / trailing stop that is only decided at this
 *    bar's close can never fill inside the same bar.
 *
 * The equity is marked to market at every close (realised + booked partials + open P&L − the entry fee).
 */
import { feeFor, fundingCost } from "./fees";
import { slipDistance, slipped } from "./slippage";
import { indexAtOrAfter } from "./bars";
import type { Bar, BtPartial, BtStrategy, BtTrade, EngineCfg, EntrySignal, EquityPoint, ExitReason, OpenPosition, PositionMgmt, RunResult } from "./types";

/** Smallest stop distance the engine accepts, as a share of the price (a 0-risk trade would get an absurd size). */
export const MIN_RISK_FRAC = 0.0005;

export interface RunOptions {
  /** first / last bar index of the window (inclusive); default the whole series */
  from?: number;
  to?: number;
  /** per-bar equity curve (default true; the optimiser switches it off) */
  equity?: boolean;
  /** ATR per bar for the ATR slippage model and the ATR trailing stop */
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

/** The engine's view of an open position: the public `OpenPosition` plus the management state. */
interface LivePos extends OpenPosition {
  stop0: number;
  qty0: number;
  manage: PositionMgmt | null;
  /** best price since the fill (highest high for a long, lowest low for a short) */
  peak: number;
  /** who moved the stop last: nobody (the original), break-even or the trailing stop */
  stopBy: "none" | "be" | "trail";
  beDone: boolean;
  partialDone: boolean;
  /** price of the partial limit (null = no partial, or dropped because it is not nearer than the target) */
  partialPx: number | null;
  /** booked parts: Σ (gross − exit fee − funding) of the partial fills, their fees / funding / quantity / notional */
  booked: number;
  partFees: number;
  partFunding: number;
  partNotional: number;
  parts: BtPartial[];
}

/** Price `r` multiples of the ORIGINAL risk away from the entry in the trade's direction. */
const rPrice = (p: { side: "long" | "short"; entry: number; stop0: number }, r: number): number => p.entry + (p.side === "long" ? 1 : -1) * r * Math.abs(p.entry - p.stop0);

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
  let pos: LivePos | null = null;
  let entryFee = 0;
  let entrySlip = 0;
  let pending: Pending | null = null;
  let skippedGap = 0;
  let skippedRisk = 0;
  let signals = 0;
  const priceAt = (tMs: number): number => {
    const k = Math.max(0, indexAtOrAfter(bars, tMs / 1000 + 1) - 1);
    return bars[Math.min(k, n - 1)]!.c;
  };

  const close = (i: number, raw: number, reason: ExitReason, maker: boolean, atClose: boolean, ambiguous = false) => {
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
    const pnl = p.booked + (gross - entryFee - exitFee - fund);
    const risk = Math.abs(p.entry - p.stop0) * p.qty0;
    const avgExit = p.parts.length ? (p.partNotional + p.qty * px) / p.qty0 : px;
    const t: BtTrade = {
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
      stop: p.stop0,
      target: p.target,
      qty: p.qty0,
      notional: p.qty0 * p.entry,
      pnl,
      fees: entryFee + p.partFees + exitFee,
      funding: p.partFunding + fund,
      slippage: entrySlip + Math.abs(px - raw) * p.qty,
      r: risk > 0 ? pnl / risk : 0,
      move: p.entry > 0 ? (dir * (avgExit - p.entry)) / p.entry : 0,
      bars: i - p.entryIndex + 1,
      reason,
    };
    if (p.stop !== p.stop0) t.stopExit = p.stop;
    if (p.parts.length) t.partials = p.parts;
    if (ambiguous) t.ambiguous = true;
    trades.push(t);
    realised += pnl;
    pos = null;
    entryFee = 0;
    entrySlip = 0;
  };

  /** Sells the partial share at its limit (maker, no slippage); the rest of the position stays open. */
  const takePartial = (i: number, raw: number) => {
    const p = pos!;
    const qty = p.qty0 * p.manage!.partial!.frac;
    const dir = p.side === "long" ? 1 : -1;
    const fee = feeFor(qty * raw, true, feeModel);
    const exitT = ms(bars[i]!.t);
    const fund = fundingCost(funding, p.side, qty, ms(bars[p.entryIndex]!.t), exitT, priceAt);
    const pnl = dir * (raw - p.entry) * qty - fee - fund;
    p.booked += pnl;
    p.partFees += fee;
    p.partFunding += fund;
    p.partNotional += qty * raw;
    p.qty -= qty;
    p.partialDone = true;
    p.parts.push({ index: i, time: exitT, price: raw, qty, pnl, fee });
  };

  const open = (i: number, s: EntrySignal): "ok" | "gap" | "risk" => {
    const b = bars[i]!;
    const long = s.side === "long";
    // the open gapped past the stop or the target: the setup is gone
    if (long ? b.o <= s.stop : b.o >= s.stop) return "gap";
    if (s.target != null && (long ? b.o >= s.target : b.o <= s.target)) return "gap";
    const px = slipped(slippage, b.o, long, atrAt(i - 1));
    const riskDist = long ? px - s.stop : s.stop - px;
    if (!(riskDist > px * MIN_RISK_FRAC)) return "risk";
    const base = cfg.compounding ? realised : Math.min(realised, cfg.capital);
    if (!(base > 0)) return "risk";
    let qty = (base * cfg.riskPct) / riskDist;
    const maxQty = (base * Math.max(1, cfg.maxLeverage)) / px;
    if (qty > maxQty) qty = maxQty;
    if (!(qty > 0)) return "risk";
    entryFee = feeFor(qty * px, false, feeModel);
    entrySlip = Math.abs(px - b.o) * qty;
    const live: LivePos = {
      side: s.side,
      entryIndex: i,
      entry: px,
      stop: s.stop,
      stop0: s.stop,
      target: s.target,
      qty,
      qty0: qty,
      maxBars: s.maxBars,
      signal: s,
      manage: s.manage ?? null,
      peak: px,
      stopBy: "none",
      beDone: false,
      partialDone: false,
      partialPx: null,
      booked: 0,
      partFees: 0,
      partFunding: 0,
      partNotional: 0,
      parts: [],
    };
    const pr = s.manage?.partial;
    if (pr && Number.isFinite(pr.atR) && pr.atR > 0 && pr.frac > 0 && pr.frac < 1) {
      const lvl = rPrice(live, pr.atR);
      // a partial limit must lie nearer than the final target, else it could never fill first
      if (s.target == null || (long ? lvl < s.target : lvl > s.target)) live.partialPx = lvl;
    }
    pos = live;
    return "ok";
  };

  /** Estimated price at which the trade's TOTAL result is zero after a taker exit of the open quantity. */
  const netBreakEven = (p: LivePos, atr: number | null): number => {
    const tk = Math.max(0, feeModel.takerBps) / 10_000;
    // dir·(px − entry)·qty + booked − entryFee − tk·px·qty − slip·qty = 0   (funding is not estimated)
    const need = (entryFee - p.booked) / p.qty;
    if (p.side === "long") {
      const slip = slipDistance(slippage, (p.entry + need) / (1 - tk), atr);
      return (p.entry + need + slip) / (1 - tk);
    }
    const slip = slipDistance(slippage, (p.entry - need) / (1 + tk), atr);
    return (p.entry - need - slip) / (1 + tk);
  };

  /** Close-of-bar management: tighten the stop for the NEXT bar (never loosen, never retroactive). */
  const manageAtClose = (i: number) => {
    const p = pos!;
    const m = p.manage;
    const b = bars[i]!;
    const long = p.side === "long";
    p.peak = long ? Math.max(p.peak, b.h) : Math.min(p.peak, b.l);
    if (!m) return;
    const apply = (level: number, by: "be" | "trail") => {
      if (Number.isFinite(level) && (long ? level > p.stop : level < p.stop)) {
        p.stop = level;
        p.stopBy = by;
      }
    };
    const atr = atrAt(i);
    const be = m.breakEven;
    // the break-even stop must lie behind the close, else it is not a protective stop yet: try again at the next close
    const tryBreakEven = () => {
      const lvl = be?.to === "net" ? netBreakEven(p, atr) : p.entry;
      if (Number.isFinite(lvl) && (long ? lvl < b.c : lvl > b.c)) {
        apply(lvl, "be");
        p.beDone = true;
      }
    };
    if (be && !p.beDone) {
      const trig = be.after.kind === "r" ? rPrice(p, be.after.value) : p.entry * (1 + (long ? 1 : -1) * (be.after.value / 100));
      if (Number.isFinite(trig) && (long ? p.peak >= trig : p.peak <= trig)) tryBreakEven();
    }
    if (m.partial?.thenBreakEven && p.partialDone && !p.beDone) tryBreakEven();
    const tr = m.trail;
    if (tr && Number.isFinite(tr.value) && tr.value > 0) {
      const armed = tr.activateR <= 0 || (long ? p.peak >= rPrice(p, tr.activateR) : p.peak <= rPrice(p, tr.activateR));
      if (armed) {
        const dist = tr.kind === "atr" ? (atr != null && atr > 0 ? tr.value * atr : NaN) : p.peak * (tr.value / 100);
        if (Number.isFinite(dist) && dist > 0) apply(long ? p.peak - dist : p.peak + dist, "trail");
      }
    }
  };

  for (let i = from; i <= to; i++) {
    const b = bars[i]!;
    // 1) orders decided at the previous close fill at this open
    if (pending) {
      const pd: Pending = pending;
      pending = null;
      if (pd.kind === "exit" && pos) close(i, b.o, "signal", false, false);
      else if (pd.kind === "entry" && !pos && pd.signal) {
        const res = open(i, pd.signal);
        if (res === "gap") skippedGap++;
        else if (res === "risk") skippedRisk++;
      }
    }
    // 2) intrabar: the stop in force first, then the partial limit, then the target (stops win when they share a bar)
    if (pos) {
      const p: LivePos = pos;
      const long = p.side === "long";
      const fillBar = p.entryIndex === i;
      const stopHit = long ? b.l <= p.stop : b.h >= p.stop;
      const partialHit = !p.partialDone && p.partialPx != null && (long ? b.h >= p.partialPx : b.l <= p.partialPx);
      const tgtHit = p.target != null && (long ? b.h >= p.target : b.l <= p.target);
      if (stopHit) {
        const raw = fillBar ? p.stop : long ? Math.min(p.stop, b.o) : Math.max(p.stop, b.o);
        // the bar did not open beyond the stop but also reached a take-profit: the order of the two is unknowable
        const gapped = !fillBar && (long ? b.o <= p.stop : b.o >= p.stop);
        const reason: ExitReason = p.stopBy === "be" ? "breakeven" : p.stopBy === "trail" ? "trail" : "stop";
        close(i, raw, reason, false, false, !gapped && (partialHit || tgtHit));
      } else {
        if (partialHit && p.partialPx != null) takePartial(i, fillBar ? p.partialPx : long ? Math.max(p.partialPx, b.o) : Math.min(p.partialPx, b.o));
        if (tgtHit && p.target != null) {
          const raw = fillBar ? p.target : long ? Math.max(p.target, b.o) : Math.min(p.target, b.o);
          close(i, raw, "target", true, false);
        } else if (p.maxBars != null && i - p.entryIndex + 1 >= p.maxBars) {
          close(i, b.c, "time", false, true);
        }
      }
    }
    // 2b) management at this close: in force from the next bar on
    if (pos) manageAtClose(i);
    // 3) decisions at this close (never on the window's last bar: there is no next open inside the window)
    if (i < to) {
      if (pos) {
        const why = strategy.exitAt?.(i, pos) ?? null;
        if (why) pending = { kind: "exit", reason: why };
      } else if (i >= strategy.start) {
        const s = strategy.signalAt(i);
        if (s && Number.isFinite(s.stop) && (s.target == null || Number.isFinite(s.target))) {
          pending = { kind: "entry", signal: s };
          signals++;
        }
      }
    } else if (pos) {
      close(i, b.c, "end", false, true);
    }
    if (withEquity) {
      let eq = realised;
      if (pos) {
        const p: LivePos = pos;
        eq += p.booked + (p.side === "long" ? 1 : -1) * (b.c - p.entry) * p.qty - entryFee;
      }
      equity.push({ t: ms(b.t + opts.secLen), equity: eq });
    }
  }
  return { trades, equity, from: ms(bars[from]!.t), to: ms(bars[to]!.t + opts.secLen), capital: cfg.capital, skipped: skippedGap + skippedRisk, skippedGap, skippedRisk, signals };
}
