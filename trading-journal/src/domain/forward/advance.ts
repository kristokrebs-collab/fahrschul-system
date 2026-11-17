/**
 * Catch-up of a virtual account (F23, pure): every candle that closed since the stored cursor is fed to the lab engine, which
 * continues EXACTLY where it stopped – the trades are the ones a single pass over all candles from the start would give
 * (tested as a property). Nothing is decided on a candle that has not closed, nothing before the start, and the rules of an
 * account never change (a change is a new account).
 *
 * The caller loads the candles from `planOf(account).anchorMs` on (the series always starts at the same candle, so the
 * indicators – EMA, RSI – have the same values however often the account is brought up to date) and prepares the strategy
 * facts once (`customStrategy.prepare`, with the account's `startMs`); `advanceAccount` is the cheap loop over the new candles.
 */
import { indexAtOrAfter } from "../backtest/bars";
import { DEFAULT_FUNDING_RATE, feePreset } from "../backtest/fees";
import { runBacktest } from "../backtest/engine";
import { fundingModelOf } from "../backtest/job";
import { customStrategy, type CustomCfgIn, type CustomFacts } from "../backtest/strategies/custom";
import type { Prepared } from "../backtest/strategies/types";
import { HIST_MS, type BtStrategy, type BtTrade, type EngineCarry, type EngineCfg, type FundingPoint, type HistInterval } from "../backtest/types";
import { cursorSig, emptyCursor } from "./config";
import { MAX_PAUSES, MAX_TRADES, type ForwardAccount, type Pause, type StoredTrade } from "./types";

/** Strategy config of the account (the frozen rules + the signal setting of the start). */
export const strategyInOf = (a: Pick<ForwardAccount, "config" | "signal">): CustomCfgIn => ({ config: a.config, signal: a.signal });

/** Intervals to load, the history needed before the start and the fixed first candle of the series. */
export function planOf(a: Pick<ForwardAccount, "config" | "signal" | "startMs">): { intervals: HistInterval[]; warmupMs: number; anchorMs: number } {
  const cfg = strategyInOf(a);
  const warmupMs = customStrategy.warmupMs(cfg);
  return { intervals: customStrategy.intervals(cfg), warmupMs, anchorMs: a.startMs - warmupMs };
}

/** The engine settings of an account (costs as in the lab; funding from the history when there is one, else the flat assumption). */
export function engineCfgOf(a: Pick<ForwardAccount, "capital" | "riskPct" | "maxLeverage" | "exchange" | "slippage" | "funding">, funding: readonly FundingPoint[] | null): EngineCfg {
  const fee = feePreset(a.exchange);
  const model = a.funding === "none" ? ({ kind: "none" } as const) : fundingModelOf(a.funding === "history" ? funding : null, DEFAULT_FUNDING_RATE);
  return { capital: a.capital, riskPct: a.riskPct / 100, maxLeverage: a.maxLeverage, compounding: true, costs: { fees: { exchange: fee.exchange, makerBps: fee.makerBps, takerBps: fee.takerBps }, slippage: a.slippage, funding: model } };
}

/** A strategy that makes no NEW entries for candles closing inside a pause. An open position keeps being managed. */
export function gateStrategy(base: BtStrategy, bars: readonly { t: number }[], secLen: number, pauses: readonly Pause[]): BtStrategy {
  if (!pauses.length) return base;
  const blocked = (i: number): boolean => {
    const closeMs = (bars[i]!.t + secLen) * 1000;
    return pauses.some((p) => closeMs > p.from && (p.to == null || closeMs <= p.to));
  };
  return { start: base.start, signalAt: (i) => (blocked(i) ? null : base.signalAt(i)), exitAt: base.exitAt };
}

const storedOf = (t: BtTrade, bars: readonly { t: number }[]): StoredTrade => {
  const s: StoredTrade = {
    id: `f${bars[t.entryIndex]!.t}`,
    side: t.side,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    entry: t.entry,
    exit: t.exit,
    stop: t.stop,
    target: t.target,
    qty: t.qty,
    notional: t.notional,
    pnl: t.pnl,
    fees: t.fees,
    funding: t.funding,
    slippage: t.slippage,
    r: t.r,
    move: t.move,
    bars: t.bars,
    reason: t.reason,
  };
  if (t.stopExit != null) s.stopExit = t.stopExit;
  if (t.ambiguous) s.ambiguous = true;
  if (t.partials?.length) s.partials = t.partials.map((p) => ({ time: p.time, price: p.price, qty: p.qty, pnl: p.pnl, fee: p.fee }));
  return s;
};

/** The stored trade as the engine's trade (bar indices are not part of a stored trade; stats and tables do not need them). */
export const btTradeOf = (t: StoredTrade): BtTrade => ({
  id: t.id,
  side: t.side,
  tag: "",
  entryIndex: 0,
  exitIndex: 0,
  entryTime: t.entryTime,
  exitTime: t.exitTime,
  entry: t.entry,
  exit: t.exit,
  stop: t.stop,
  target: t.target,
  qty: t.qty,
  notional: t.notional,
  pnl: t.pnl,
  fees: t.fees,
  funding: t.funding,
  slippage: t.slippage,
  r: t.r,
  move: t.move,
  bars: t.bars,
  reason: t.reason,
  ...(t.stopExit != null ? { stopExit: t.stopExit } : {}),
  ...(t.ambiguous ? { ambiguous: true } : {}),
  ...(t.partials ? { partials: t.partials.map((p, i) => ({ index: i, ...p })) } : {}),
});

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Shape check of a stored engine carry (it comes from storage: never trusted). */
export function validCarry(c: unknown): c is EngineCarry {
  if (!c || typeof c !== "object") return false;
  const k = c as Record<string, unknown>;
  if (![k.realised, k.entryFee, k.entrySlip, k.signals, k.skippedGap, k.skippedRisk].every(fin)) return false;
  if (k.pending != null) {
    const p = k.pending as Record<string, unknown>;
    if (typeof p !== "object" || (p.kind !== "entry" && p.kind !== "exit")) return false;
    if (p.kind === "entry") {
      const s = p.signal as Record<string, unknown> | undefined;
      if (!s || typeof s !== "object" || (s.side !== "long" && s.side !== "short") || !fin(s.stop) || !(s.target === null || fin(s.target))) return false;
    }
  }
  if (k.pos != null) {
    const p = k.pos as Record<string, unknown>;
    if (typeof p !== "object" || (p.side !== "long" && p.side !== "short")) return false;
    if (![p.entryT, p.entry, p.stop, p.stop0, p.qty, p.qty0, p.peak, p.booked, p.partFees, p.partFunding, p.partNotional].every(fin)) return false;
    if (!Array.isArray(p.parts) || !p.signal || typeof p.signal !== "object") return false;
  }
  return true;
}

/** Is the stored cursor a consistent state belonging to the stored trades? Anything else is rebuilt from the candles. */
export function isCoherent(a: ForwardAccount): boolean {
  const c = a.cursor;
  if (c.sig !== cursorSig(c)) return false;
  if (c.nTrades !== a.trades.length) return false;
  const sum = a.trades.reduce((s, t) => s + t.pnl, 0);
  if (Math.abs(sum - c.pnlSum) > 1e-6 * Math.max(1, Math.abs(sum))) return false;
  if ((c.carry == null) !== (c.t == null)) return false;
  if (c.carry && !validCarry(c.carry)) return false;
  if (c.carry && Math.abs(c.carry.realised - (a.capital + sum)) > 1e-6 * Math.max(1, Math.abs(c.carry.realised))) return false;
  return true;
}

export interface Advance {
  account: ForwardAccount;
  /** candles processed by this call */
  processed: number;
  /** the stored state did not belong to the stored trades: everything was recomputed from the candles */
  rebuilt: boolean;
}

/** Index of the last candle (of `bars`) that had closed at `atMs`, or -1. */
export function lastClosedIndex(bars: readonly { t: number }[], secLen: number, atMs: number): number {
  return indexAtOrAfter(bars as never, atMs / 1000 - secLen + 1e-6) - 1;
}

/** An ended account with nothing open and nothing pending needs no more work. */
function finish(a: ForwardAccount): ForwardAccount {
  const base = { t: a.cursor.t, c: a.cursor.c, carry: a.cursor.carry, nTrades: a.cursor.nTrades, pnlSum: a.cursor.pnlSum, done: true };
  return { ...a, cursor: { ...base, sig: cursorSig(base) } };
}

/**
 * Brings the account up to `nowMs` (an ended account: up to its end, then flattened). `prep` holds the prepared facts of the
 * candles from the plan's anchor on (all of them closed, prepared with `startMs` of the account). Returns the same account
 * object when nothing changed.
 */
export function advanceAccount(account: ForwardAccount, prep: Prepared<CustomFacts>, engine: EngineCfg, nowMs: number): Advance {
  if (account.cursor.done) return { account, processed: 0, rebuilt: false };
  const secLen = HIST_MS[account.interval] / 1000;
  const bars = prep.bars;
  const ended = account.status === "ended";
  const until = ended && account.endedAt != null ? Math.min(nowMs, account.endedAt) : nowMs;
  const last = lastClosedIndex(bars, secLen, until);
  let acct = account;
  let rebuilt = false;
  if (!isCoherent(acct)) {
    rebuilt = acct.cursor.t != null || acct.trades.length > 0;
    acct = { ...acct, trades: [], cursor: emptyCursor() };
  }
  if (!ended && acct.trades.length >= MAX_TRADES && acct.cursor.t != null) {
    // (a list that is already full, e.g. from another device)
    return { account: advanceAccount({ ...acct, status: "ended", endedAt: (acct.cursor.t + secLen) * 1000, endReason: "limit" }, prep, engine, nowMs).account, processed: 0, rebuilt };
  }
  const fromIdx = acct.cursor.t == null ? prep.start : indexAtOrAfter(bars, acct.cursor.t + 1e-6);
  const fresh = last >= fromIdx;
  if (!fresh && (!ended || acct.cursor.carry == null)) {
    // nothing new: an ended account without anything open is simply finished
    return { account: ended ? finish(acct) : acct, processed: 0, rebuilt };
  }
  const view = last + 1 === bars.length ? bars : bars.slice(0, last + 1);
  const strat = gateStrategy(customStrategy.build(prep, {}), view, secLen, acct.pauses);
  const res = runBacktest(view, strat, engine, { from: fromIdx, to: last, equity: false, atr: prep.atr, secLen, keepOpen: true, resume: acct.cursor.carry, flatten: ended });
  // a full account ends itself at the candle of its last allowed trade: the rules stay, the list stops growing. The run is
  // repeated from the state before this call as an ended account (it stops there and flattens), so a long catch-up and a
  // candle-by-candle one end at the same candle.
  if (!ended && acct.trades.length + res.trades.length >= MAX_TRADES) {
    const e = res.trades[MAX_TRADES - acct.trades.length - 1]!.exitIndex;
    const limited: ForwardAccount = { ...acct, status: "ended", endedAt: (view[e]!.t + secLen) * 1000, endReason: "limit" };
    const done = advanceAccount(limited, prep, engine, nowMs);
    return { account: done.account, processed: done.processed, rebuilt };
  }
  const trades = [...acct.trades, ...res.trades.map((t) => storedOf(t, view))];
  const processed = fresh ? last - fromIdx + 1 : 0;
  const cursorBase = {
    t: fresh ? view[last]!.t : acct.cursor.t,
    c: fresh ? view[last]!.c : acct.cursor.c,
    carry: res.carry ?? null,
    nTrades: trades.length,
    pnlSum: trades.reduce((s, t) => s + t.pnl, 0),
    done: ended,
  };
  return { account: { ...acct, trades, cursor: { ...cursorBase, sig: cursorSig(cursorBase) } }, processed, rebuilt };
}

// ── state changes (the candles decide what they mean: see `gateStrategy` and `advanceAccount`) ─────────────────────

export function pauseAccount(a: ForwardAccount, now: number): ForwardAccount {
  if (a.status !== "running") return a;
  return { ...a, status: "paused", pauses: [...a.pauses, { from: now, to: null }].slice(-MAX_PAUSES) };
}

const closePause = (pauses: readonly Pause[], now: number): Pause[] => pauses.map((p, i) => (i === pauses.length - 1 && p.to == null ? { ...p, to: now } : p));

export function resumeAccount(a: ForwardAccount, now: number): ForwardAccount {
  if (a.status !== "paused") return a;
  return { ...a, status: "running", pauses: closePause(a.pauses, now) };
}

export function endAccount(a: ForwardAccount, now: number): ForwardAccount {
  if (a.status === "ended") return a;
  return { ...a, status: "ended", endedAt: now, endReason: "user", pauses: closePause(a.pauses, now) };
}
