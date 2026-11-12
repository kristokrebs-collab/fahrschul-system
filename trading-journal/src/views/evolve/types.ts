/**
 * The public contract of the optimiser panel – what a host (the Labor section today, the Strategie-Studio later) hands in and
 * what it gets back. Types only; importing this file costs nothing at run time.
 *
 *   <EvolvePanel
 *     strategies={[{ id, name, config, symbol, signal, engine }, …]}      // the rule sets to improve (≤ 6 at once)
 *     candles={{ [id]: { data, fromMs, toMs, … } }}                       // closed candles per strategy id
 *     onLoadCandles={(ids) => …}                                          // asked when a start needs candles that are not there
 *     onSaveVersion={(strategy, proposal) => …}                           // "Als neue Version speichern" – the host stores it
 *     onStartChallenger={(strategy, proposal) => …}                       // "Als Herausforderer live testen" – the host starts the forward account
 *   />
 *
 * The panel never changes a strategy itself: both callbacks run only after the user clicked that button on that proposal, and
 * the host decides how to store the result (a new version of a draft, a new draft, a forward account …).
 */
import type { BarsBy, EngineCfg } from "@/domain/backtest/index";
import type { StoredProposal } from "@/domain/evolve";
import type { CustomConfig } from "@/domain/lab";
import type { SignalCfg } from "@/domain/signals";

/** One strategy the optimiser may improve. */
export interface StrategyEntry {
  /** stable id of the strategy in the host (a draft id, a studio id …): trials and learning are kept per id */
  id: string;
  /** shown name (the rules' own name is kept inside `config`) */
  name: string;
  /** the rule set ("Eigene Idee") – the current version, version 1 of every proposal */
  config: CustomConfig;
  /** market, e.g. BTCUSDT */
  symbol: string;
  /** the app's MCB / WaveTrend setting (some blocks read it) */
  signal: SignalCfg;
  /** capital, risk per trade and the costs (fees, slippage, funding) every variant is tested with */
  engine: EngineCfg;
  /** optional: a short label of the current version ("Version 3") */
  versionLabel?: string;
}

/** Closed candles of one strategy, as the lab's loader delivers them. */
export interface CandleSet {
  /** ascending, closed candles per interval; the execution interval and the next larger one at least */
  data: BarsBy;
  /** first tradable time (ms) – candles before it are warm-up */
  fromMs: number;
  /** end of the period (ms): the close of the last candle */
  toMs: number;
  /** when the candles were fetched (ms) */
  loadedAt: number;
  /** where they come from, shown on the cards ("Binance USDⓈ-M") */
  source: string;
}

export interface CandleStatus {
  state: "idle" | "loading" | "error";
  message?: string;
  /** 0…1 */
  progress?: number;
}

/** What a host answers after "save" / "challenger". `label` is shown to the user ("Version 3 von …"). */
export type EvolveActionResult = { ok: true; label: string; id?: string } | { ok: false; reason: string };

export interface EvolvePanelProps {
  strategies: readonly StrategyEntry[];
  candles: Readonly<Record<string, CandleSet | undefined>>;
  candleStatus?: Readonly<Record<string, CandleStatus | undefined>>;
  onLoadCandles?: (ids: readonly string[]) => void;
  onSaveVersion: (strategy: StrategyEntry, proposal: StoredProposal) => Promise<EvolveActionResult> | EvolveActionResult;
  onStartChallenger: (strategy: StrategyEntry, proposal: StoredProposal) => Promise<EvolveActionResult> | EvolveActionResult;
  /** ids selected at first (default: the first three) */
  defaultSelected?: readonly string[];
  /** trials per strategy and run (default 400) */
  budget?: number;
  /** fixed seed (tests); default derived from the clock */
  seed?: number;
  className?: string;
}
