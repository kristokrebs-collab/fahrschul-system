/**
 * Backtest lab types (P07). Pure data: bars are the signal engine's `Bar` (`t` = open time in UNIX SECONDS), every
 * time in a result is epoch MILLISECONDS (the chart / journal unit). Prices in quote currency, money in the quote
 * currency of the market (USDT), R = result ÷ the planned risk of the trade.
 */
import type { Bar } from "../signals/indicators";

export type { Bar };
export type BtSide = "long" | "short";

/** Exchange intervals the lab loads (Binance USDⓈ-M klines). */
export type HistInterval = "15m" | "1h" | "4h" | "1d";

/** Interval length in ms. */
export const HIST_MS: Readonly<Record<HistInterval, number>> = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };

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
  /** optional grade / score for the trade list */
  grade?: string;
  score?: number;
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
  stop: number;
  target: number | null;
  qty: number;
  maxBars: number | null;
  signal: EntrySignal;
}

export type ExitReason = "stop" | "target" | "time" | "signal" | "end";

export const EXIT_LABEL: Readonly<Record<ExitReason, string>> = {
  stop: "Stop",
  target: "Ziel",
  time: "Zeit-Stop",
  signal: "Signal",
  end: "Fensterende",
};

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
}
