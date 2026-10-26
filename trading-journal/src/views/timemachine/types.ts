/**
 * Props of the Zeitmaschine card (`TimeMachineCard`). The trade plan (`src/views/plan`, slot `TimeMachineSlot`), the journal's
 * trade sheet and the Labor section all hand the card the same few things: the plan as prices, the market's closed candles and
 * their timeframe. The card computes (worker, progress, abort) and shows; it never sends an order and never changes the plan.
 */
import type { CostModel } from "@/domain/backtest/types";
import type { TmInterval, TmOptions } from "@/domain/timemachine";

/** A candle as the market layer has it (`@/market/types` `Candle` fits: open time in ms UTC). Only closed candles are used. */
export interface TimeMachineCandle {
  /** open time, ms UTC */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  /** false = still forming: the candle is left out */
  closed?: boolean;
}

export type TimeMachineInterval = TmInterval;

export interface TimeMachineProps {
  /** the market ("BTCUSDT", "AAPL") – shown and quoted, not looked up */
  symbol: string;
  side: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  /** closed candles of the market, ascending (the history the sessions are rebuilt from and searched in) */
  candles: readonly TimeMachineCandle[];
  /** the candles' length: "15m" | "1h" | "4h" | "1d" … */
  interval: TimeMachineInterval;
  /** fees / slippage / funding as the backtest engine knows them; default: the lab's (Binance base tier, 2 bp, flat funding) */
  costs?: CostModel;
  /** seed of the simulation (default 19); the card always shows the seed in use */
  seed?: number;
  /** a close button in the card's header (sheets); absent = none */
  onClose?: () => void;
  /** more of the run's options (runs, time stop, method, trigger …); the defaults are `defaultOptions(interval)` */
  options?: Partial<TmOptions>;
  /** open time (ms) of the first simulated candle; default: the candle after the last one given */
  startMs?: number | null;
  /** where the candles come from ("Binance USDⓈ-M") and when they were fetched (ms) – shown as "Quelle … · Abruf …" */
  source?: string | null;
  fetchedAt?: number | null;
  /** compute as soon as the card shows (default) – false: wait for the button */
  autoStart?: boolean;
  /** the wording above the plan line when the host explains where the plan comes from */
  note?: string;
  /** false = no card frame (the host is a sheet that has its own); default true */
  framed?: boolean;
  className?: string;
}
