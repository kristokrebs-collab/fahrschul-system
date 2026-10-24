/**
 * Types of the Strategie-Studio that other panels build on. The two slot panels (`Slots.tsx`: `DiscoveryPanel`, `EvolvePanel`)
 * get the strategy the trader is working on – its text, the rules as understood, market and period – plus the candles and the
 * result of the last backtest of it (memory only, `null` before a run). A panel may PROPOSE new rules through `onPropose`; the
 * studio shows the proposal and applies it only after the trader confirms exactly that change.
 */
import type { LabResult } from "@/domain/backtest/index";
import type { Bar } from "@/domain/backtest/types";
import type { CustomConfig, TfId } from "@/domain/lab";
import type { Answers, StrategySetup, StudioPeriod } from "@/domain/strategytext";

/** The strategy as the editor holds it right now (saved or not). */
export interface StudioStrategy {
  /** the id in `settings.studio`, `null` while the draft is unsaved */
  id: string | null;
  name: string;
  /** the trader's own text */
  text: string;
  /** his answers to the questions and assumption chips */
  answers: Answers;
  /** the rules the text became (the lab's `CustomConfig`) */
  rules: CustomConfig;
  /** what the text itself said about market, period and risk (`null` = nothing) */
  setup: StrategySetup;
  /** the market and period it is tested on */
  symbol: string;
  period: StudioPeriod;
  interval: TfId;
  /** the number of the newest saved version, `null` = never saved */
  versionNo: number | null;
  /** who read the text: the local rules or the optional server help */
  source: "local" | "ai";
  /** the rules can run (no lab error, no open blocking question) */
  ready: boolean;
}

export interface StudioProposal {
  config: CustomConfig;
  /** one sentence: what changes and why the panel suggests it */
  note: string;
}

export interface StudioPanelProps {
  strategy: StudioStrategy;
  /** the execution candles of the last backtest of this strategy (index space of `result.trades`), `null` before a run */
  candles: readonly Bar[] | null;
  /** the shown backtest result, `null` before a run */
  result: LabResult | null;
  /** how many strategies the trader has compared or tried so far – a panel that searches adds its own trials to the multiple-testing note */
  trials?: number;
  /** proposes rules; nothing changes until the trader confirms */
  onPropose?: (proposal: StudioProposal) => void;
}
