/**
 * Forward test (F23): the data model of a virtual account. An account runs ONE frozen rule tree ("Eigene Idee" draft or
 * template) on new, CLOSED candles from a fixed start on – never backwards. Everything shown is derived from the candles by the
 * lab engine; what is stored (`settings.forward`) is only the configuration, the cursor (the engine state after the last
 * processed candle) and the closed trades – a cache that can be rebuilt from the candles at any time.
 */
import type { EngineCarry, SlippageModel } from "../backtest/types";
import type { CustomConfig, TfId } from "../lab/rules/types";
import type { SignalCfg } from "../signals/config";

export const FORWARD_VERSION = 1 as const;
/** Accounts in total (running, paused and ended) – the stored key stays small. */
export const MAX_ACCOUNTS = 8;
/** Accounts that run at the same time (each one loads and evaluates candles). */
export const MAX_RUNNING = 5;
/** Closed trades kept per account; a full account ends itself (`endReason: "limit"`). */
export const MAX_TRADES = 250;
export const MAX_NAME = 60;
export const MAX_PAUSES = 40;

export type ForwardStatus = "running" | "paused" | "ended";
export type ForwardFunding = "history" | "flat" | "none";
export type SourceKind = "editor" | "draft" | "template" | "playbook";

/** Where the rules came from; `foreign` = a playbook of someone else (stays marked). */
export interface ForwardSource {
  kind: SourceKind;
  /** the title as it was when the account started */
  label: string;
  /** version number of the draft (F15) when it came from one */
  versionNo?: number;
  foreign?: boolean;
}

/** A closed trade as stored: the engine's trade without the series-dependent bar indices. */
export interface StoredTrade {
  /** `f<entry open time in s>` – stable whatever the series looks like */
  id: string;
  side: "long" | "short";
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  stop: number;
  target: number | null;
  qty: number;
  notional: number;
  pnl: number;
  fees: number;
  funding: number;
  slippage: number;
  r: number;
  move: number;
  bars: number;
  reason: "stop" | "target" | "time" | "signal" | "end" | "breakeven" | "trail";
  stopExit?: number;
  ambiguous?: boolean;
  partials?: { time: number; price: number; qty: number; pnl: number; fee: number }[];
}

/** The engine state after the last processed candle (+ the check values that tell a mixed-up copy from a good one). */
export interface ForwardCursor {
  /** open time (s) of the last processed candle, `null` = nothing processed yet */
  t: number | null;
  /** close of that candle (for the mark-to-market value of an open position) */
  c: number | null;
  carry: EngineCarry | null;
  nTrades: number;
  pnlSum: number;
  /** ended and flattened: no more work */
  done: boolean;
  /** check value of the fields above (see `cursorSig`) */
  sig: string;
}

/** A pause: no NEW entries for candles that close in (`from`, `to`] (ms); the open position keeps running. `to: null` = still paused. */
export interface Pause {
  from: number;
  to: number | null;
}

export interface ForwardAccount {
  id: string;
  name: string;
  /** ms, when the account was created */
  createdAt: number;
  status: ForwardStatus;
  /** ms, set when the account ends */
  endedAt?: number;
  endReason?: "user" | "limit";
  pauses: Pause[];
  symbol: string;
  /** execution interval of the rule tree */
  interval: TfId;
  /** ms, open time of the first candle that counts: the one that contains the creation time (its close lies after the start) */
  startMs: number;
  capital: number;
  /** percent (1 = 1 %) */
  riskPct: number;
  maxLeverage: number;
  exchange: string;
  slippage: SlippageModel;
  funding: ForwardFunding;
  /** the frozen rules */
  config: CustomConfig;
  /** `customKey(config)`: the identity of the rules */
  key: string;
  /** the app's MCB / WaveTrend setting as it was at the start (some blocks read it) */
  signal: SignalCfg;
  source: ForwardSource;
  cursor: ForwardCursor;
  trades: StoredTrade[];
}

export interface ForwardCfg {
  v: typeof FORWARD_VERSION;
  accounts: ForwardAccount[];
  /** stored entries this version cannot read – written back untouched */
  rejected: unknown[];
}
