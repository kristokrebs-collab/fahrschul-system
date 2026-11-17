/**
 * What an account shows (F23, pure): the equity curve, the key numbers (with their sample size and uncertainty, from the lab's
 * `runStats`) and the open position – all derived from the stored trades and the cursor, nothing invented.
 *
 * The equity curve has one point per closed trade (at its exit) plus the current mark-to-market value of an open position at
 * the last processed candle's close. Between trades the engine's per-candle curve is not stored, so the drawdown here is
 * measured on these points: it can understate the dip inside a trade (the text says so).
 */
import { carryEquity } from "../backtest/engine";
import { runStats, type RunStats } from "../backtest/metrics";
import { HIST_MS, type EquityPoint, type RunResult } from "../backtest/types";
import { btTradeOf } from "./advance";
import type { ForwardAccount } from "./types";

export interface OpenView {
  side: "long" | "short";
  entry: number;
  stop: number;
  target: number | null;
  qty: number;
  /** ms, entry bar open */
  since: number;
  /** unrealised result at the last processed close (money, after the entry fee) */
  unrealised: number;
}

export interface AccountView {
  /** equity in money, start first */
  equity: EquityPoint[];
  /** equity in % of the start capital for the drawing */
  curve: number[];
  stats: RunStats;
  /** current equity (realised + open position marked to the last close) */
  now: number;
  nowPct: number;
  open: OpenView | null;
  /** an entry order is waiting for the next candle's open */
  pendingEntry: "long" | "short" | null;
  /** close time (ms) of the last processed candle, null = none yet */
  upTo: number | null;
  /** candles the account has processed (0 = nothing yet) */
  hasData: boolean;
}

export function accountView(a: ForwardAccount): AccountView {
  const secLen = HIST_MS[a.interval] / 1000;
  const trades = a.trades.map(btTradeOf);
  const upTo = a.cursor.t != null ? (a.cursor.t + secLen) * 1000 : null;
  const equity: EquityPoint[] = [{ t: a.startMs, equity: a.capital }];
  let e = a.capital;
  for (const t of trades) equity.push({ t: t.exitTime, equity: (e += t.pnl) });
  const carry = a.cursor.carry;
  let now = e;
  let open: OpenView | null = null;
  if (carry && a.cursor.c != null) {
    now = carryEquity(carry, a.cursor.c);
    const p = carry.pos;
    if (p) {
      open = { side: p.side, entry: p.entry, stop: p.stop, target: p.target, qty: p.qty, since: p.entryT * 1000, unrealised: now - carry.realised };
    }
  }
  if (upTo != null && upTo > equity[equity.length - 1]!.t) equity.push({ t: upTo, equity: now });
  const run: RunResult = { trades, equity, from: a.startMs, to: upTo ?? a.startMs, capital: a.capital, skipped: (carry?.skippedGap ?? 0) + (carry?.skippedRisk ?? 0), skippedGap: carry?.skippedGap ?? 0, skippedRisk: carry?.skippedRisk ?? 0, signals: carry?.signals ?? 0 };
  const stats = runStats(run);
  const pend = carry?.pending;
  return {
    equity,
    curve: equity.map((p) => (a.capital > 0 ? (p.equity / a.capital - 1) * 100 : 0)),
    stats,
    now,
    nowPct: a.capital > 0 ? now / a.capital - 1 : 0,
    open,
    pendingEntry: pend?.kind === "entry" && pend.signal ? pend.signal.side : null,
    upTo,
    hasData: a.cursor.t != null,
  };
}
