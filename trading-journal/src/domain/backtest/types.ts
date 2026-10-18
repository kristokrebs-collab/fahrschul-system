/**
 * Backtest lab types (P07). Pure data: bars are the signal engine's `Bar` (`t` = open time in UNIX SECONDS), every
 * time in a result is epoch MILLISECONDS (the chart / journal unit). Prices in quote currency, money in the quote
 * currency of the market (USDT), R = result ÷ the planned risk of the trade.
 */
import type { Bar } from "../signals/indicators";

export type { Bar };
export type BtSide = "long" | "short";

/**
 * Intervals of the lab. 15m / 1h / 4h / 1d are Binance USDⓈ-M klines; `30m` (2 × 15m) and `2h` (2 × 1h) are built from
 * complete exchange buckets by the loader (`deriveBars`) – the market layer's REST clients only know the live feeds'
 * intervals, and exact aggregation of closed bars is the same data.
 */
export type HistInterval = "15m" | "30m" | "1h" | "2h" | "4h" | "1d";

/** Interval length in ms. */
export const HIST_MS: Readonly<Record<HistInterval, number>> = { "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "1d": 86_400_000 };

/** Exchange interval a lab interval is loaded from (itself, or its finer source for the derived `30m` / `2h`). */
export const HIST_SOURCE: Readonly<Record<HistInterval, Exclude<HistInterval, "30m" | "2h">>> = { "15m": "15m", "30m": "15m", "1h": "1h", "2h": "1h", "4h": "4h", "1d": "1d" };

/** Bars per interval, as the strategy asks for them. */
export type BarsBy = Partial<Record<HistInterval, readonly Bar[]>>;

// ── cost models ───────────────────────────────────────────────────────────────────────────────────────────────

/** Maker / taker fee in basis points of the notional (1 bp = 0,01 %). */
export interface FeeModel {
  exchange: string;
  makerBps: number;
  takerBps: number;
}

/** Slippage against the trader on market and stop fills (targets are limit orders: no slippage). */
export type SlippageModel = { kind: "fixed"; bps: number } | { kind: "atr"; frac: number } | { kind: "spread"; bps: number } | { kind: "none" };

/** One funding settlement: `t` in ms, `rate` per settlement (0.0001 = 0,01 %). */
export interface FundingPoint {
  t: number;
  rate: number;
}

/** Funding: the real history (Binance `fundingRate`), a flat assumption per 8 h, or none (spot). */
export type FundingModel = { kind: "history"; points: readonly FundingPoint[]; fallbackRate: number } | { kind: "flat"; ratePer8h: number } | { kind: "none" };

export interface CostModel {
  fees: FeeModel;
  slippage: SlippageModel;
  funding: FundingModel;
}

// ── engine ────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a strategy hands the engine at the CLOSE of a bar (only while flat). Filled at the next bar's open. */
export interface EntrySignal {
  side: BtSide;
  /** protective stop (price) – required, it defines the risk and R */
  stop: number;
  /** take-profit limit (price), null = none (time stop / strategy exit only) */
  target: number | null;
  /** time stop in bars after the fill, null = none */
  maxBars: number | null;
  /** short label of the setup ("Ausbruch Long · A+") */
  tag: string;
  /** optional position management (break-even, trailing stop, partial take-profit); absent = the plain stop / target */
  manage?: PositionMgmt;
  /** optional grade / score for the trade list */
  grade?: string;
  score?: number;
}

// ── position management (F65) ────────────────────────────────────────────────────────────────────────────────

/**
 * Optional management of ONE position, evaluated at bar CLOSES: what is decided at the close of bar i takes effect
 * from bar i + 1 on (never retroactively inside the bar that triggered it). The stop is only ever tightened (ratchet).
 * Order inside a bar (documented in README.md): stop in force at the bar's start → partial take-profit → final target →
 * time stop; stops win when stop and a take-profit are both inside one bar's range.
 */
export interface BreakEvenRule {
  /** the trigger: the best price since the fill reached +value R (of the ORIGINAL risk) or +value % from the entry */
  after: { kind: "r"; value: number } | { kind: "pct"; value: number };
  /** `entry` = the stop moves to the fill price; `net` = to the estimated net break-even (entry fee + exit fee + slippage covered) */
  to: "entry" | "net";
}

export interface TrailRule {
  /** `atr` = value × ATR(14) behind the best price since the fill, `pct` = value % behind it */
  kind: "atr" | "pct";
  value: number;
  /** trailing starts once the best price reached +activateR (of the original risk); 0 = from the first close */
  activateR: number;
}

export interface PartialRule {
  /** the limit sits at +atR of the original risk (maker fill, no slippage); it must be nearer than the final target */
  atR: number;
  /** share of the ORIGINAL quantity sold there (0,05 … 0,95); the rest runs on */
  frac: number;
  /** after the partial fill the stop moves to the break-even level (`breakEven.to`, else the entry) at that close */
  thenBreakEven?: boolean;
}

export interface PositionMgmt {
  breakEven?: BreakEvenRule;
  trail?: TrailRule;
  partial?: PartialRule;
}

/** A strategy decides on CLOSED bars only: `signalAt(i)` sees bars 0…i (never i + 1). */
export interface BtStrategy {
  /** first bar index the strategy may trade on */
  readonly start: number;
  signalAt(i: number): EntrySignal | null;
  /** optional exit decision at the close of bar `i` while in a position (filled at the next open) */
  exitAt?(i: number, pos: OpenPosition): string | null;
}

export interface EngineCfg {
  /** start equity in quote currency */
  capital: number;
  /** risk per trade as a fraction of equity (0.01 = 1 %) */
  riskPct: number;
  /** notional cap = equity × maxLeverage */
  maxLeverage: number;
  /** risk on the current equity (true) or always on the start capital */
  compounding: boolean;
  costs: CostModel;
}

export interface OpenPosition {
  side: BtSide;
  entryIndex: number;
  entry: number;
  /** the stop in force (moves with break-even / trailing; never loosens) */
  stop: number;
  /** the ORIGINAL stop – the risk and R are measured against it */
  stop0?: number;
  target: number | null;
  /** quantity still open (smaller than `qty0` after a partial take-profit) */
  qty: number;
  qty0?: number;
  maxBars: number | null;
  signal: EntrySignal;
}

export type ExitReason = "stop" | "target" | "time" | "signal" | "end" | "breakeven" | "trail";

export const EXIT_LABEL: Readonly<Record<ExitReason, string>> = {
  stop: "Stop",
  target: "Ziel",
  time: "Zeit-Stop",
  signal: "Signal",
  end: "Fensterende",
  breakeven: "Break-even",
  trail: "Trailing-Stop",
};

/** A partial take-profit fill of a trade (money without the entry fee, which the trade carries once). */
export interface BtPartial {
  index: number;
  /** ms */
  time: number;
  price: number;
  qty: number;
  /** gross P&L of this part minus its exit fee and funding */
  pnl: number;
  fee: number;
}

export interface BtTrade {
  id: string;
  side: BtSide;
  tag: string;
  grade?: string;
  /** index of the entry / exit bar in the run's bars */
  entryIndex: number;
  exitIndex: number;
  /** ms */
  entryTime: number;
  exitTime: number;
  /** fill prices (slippage included) */
  entry: number;
  exit: number;
  stop: number;
  target: number | null;
  qty: number;
  notional: number;
  /** money: net P&L after fees and funding; costs as positive numbers */
  pnl: number;
  fees: number;
  funding: number;
  slippage: number;
  /** pnl ÷ planned risk */
  r: number;
  /** gross price move entry → exit in the trade's direction, without leverage (the journal's `move`) */
  move: number;
  bars: number;
  reason: ExitReason;
  /** stop in force at the exit when management moved it (the plain `stop` stays the original) */
  stopExit?: number;
  /** partial take-profit fills (`qty`, `fees`, `funding`, `pnl`, `r` are totals over all parts; `exit` is the last fill) */
  partials?: BtPartial[];
  /** the stop and a take-profit both lay inside the stop bar's range – the engine assumed the stop (conservative) */
  ambiguous?: boolean;
}

export interface EquityPoint {
  /** ms (bar close) */
  t: number;
  /** marked-to-market equity at the close */
  equity: number;
}

export interface RunResult {
  trades: BtTrade[];
  /** per-bar equity from `from` to `to` (inclusive), marked to market */
  equity: EquityPoint[];
  from: number;
  to: number;
  capital: number;
  /** signals skipped because the next open gapped past the stop / target or the risk was zero */
  skipped: number;
  /** of `skipped`: the open lay beyond the stop or target / the stop distance was under the minimum or no size was possible */
  skippedGap: number;
  skippedRisk: number;
  /** entry signals the strategy handed over while flat (executed + skipped, minus orders cancelled by the window end) */
  signals: number;
}
