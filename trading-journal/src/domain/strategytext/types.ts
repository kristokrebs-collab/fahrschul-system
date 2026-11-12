/**
 * Strategy text → lab rules (Strategie-Studio): the result type of the local parser and everything the studio shows
 * about it. Pure data, serialisable. The rules are the lab's own `CustomConfig`; around them stand the plain-language
 * lists the trader reads: what was understood (with the original words), what was not (with the reason), the questions
 * that remain and the assumptions the parser had to make – every one of them visible and changeable.
 */
import type { CustomConfig, Issue } from "../lab/rules/types";

export const PARSE_VERSION = 1 as const;
/** Longest text the parser reads (the rest is ignored, and the parse says so). */
export const TEXT_MAX = 4000;

/** Periods the lab offers (`LaborPeriod` of the Labor page). */
export type StudioPeriod = "3m" | "6m" | "1y" | "2y" | "3y";
export const STUDIO_PERIODS: readonly StudioPeriod[] = ["3m", "6m", "1y", "2y", "3y"];
export const PERIOD_LABEL: Readonly<Record<StudioPeriod, string>> = { "3m": "3 Monate", "6m": "6 Monate", "1y": "1 Jahr", "2y": "2 Jahre", "3y": "3 Jahre" };

/** The trader's answers to questions and assumption chips: id → option id. */
export type Answers = Readonly<Record<string, string>>;

/** Offsets in the ORIGINAL text, `end` exclusive. */
export interface TextSpan {
  start: number;
  end: number;
}

export type UnderstoodKind = "side" | "condition" | "filter" | "stop" | "target" | "breakEven" | "trailing" | "partial" | "timeStop" | "opposite" | "risk" | "market" | "interval" | "period";

export interface Understood {
  id: string;
  kind: UnderstoodKind;
  /** the trader's own words, as typed */
  phrase: string;
  span: TextSpan;
  /** what the lab makes of it, in plain German (the same text the rule tree shows) */
  meaning: string;
}

export interface Unclear {
  id: string;
  /** the words that were not understood ("" when the problem is the whole text) */
  phrase: string;
  span: TextSpan | null;
  /** one sentence: why it is not a rule */
  why: string;
}

export interface AskOption {
  id: string;
  label: string;
}

/** A question the parser cannot answer for the trader; the chips complete the rules (`answers[id]`). */
export interface Ask {
  id: string;
  text: string;
  options: AskOption[];
  /** without an answer the rules cannot run (the studio keeps "Backtest" off until it is answered) */
  blocking: boolean;
  /** the chip the trader picked, `null` while open (the rules then use the provisional reading named in the text) */
  chosen: string | null;
  span: TextSpan | null;
}

/** A default the parser chose where the text said nothing – always listed, changeable by a chip or by writing it in the text. */
export interface AssumptionItem {
  id: string;
  text: string;
  /** empty = no chip; change it by writing the value into the text */
  options: AskOption[];
  /** the option in force (the default unless the trader picked another) */
  value: string | null;
}

export interface StrategySetup {
  /** Binance symbol named in the text (`ETHUSDT`), `null` = the studio keeps its market */
  symbol: string | null;
  period: StudioPeriod | null;
  /** percent per trade (1 = 1 %) named in the text, `null` = the lab's setting */
  riskPct: number | null;
}

export interface StrategyParse {
  v: typeof PARSE_VERSION;
  /** who read the text: the local rules or (after the trader asked for it) the server's language model, validated against the same schema */
  source: "local" | "ai";
  text: string;
  rules: CustomConfig;
  setup: StrategySetup;
  understood: Understood[];
  unclear: Unclear[];
  /** the questions as sentences (parallel to `asks`) */
  questions: string[];
  asks: Ask[];
  /** the assumptions as sentences (parallel to `assumptionItems`) */
  assumptions: string[];
  assumptionItems: AssumptionItem[];
  /** the lab's own check of the rules (errors block a run) */
  issues: Issue[];
  /** the rules can run: no lab error and no blocking question */
  ready: boolean;
}

export interface ParseOptions {
  answers?: Answers;
}
