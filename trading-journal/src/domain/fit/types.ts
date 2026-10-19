/**
 * „Passt die Strategie zu mir?“ (F49): the data model. Pure types and the thresholds – no React, no I/O.
 *
 * Two descriptions are held against each other: what a tested idea DEMANDS (`StrategyFacts`, from a finished Labor run) and
 * what the trader's own journal SHOWS (`JournalProfile`). The result is a list of agreements and frictions with numbers –
 * no total score, no advice to act, and every statement carries its sample.
 */
import type { SessionKey } from "../insights/time";

/** Fewest closed journal trades before anything is compared; below it the card is an honest empty state. */
export const MIN_JOURNAL = 20;
/** Fewest trades of the tested idea before its numbers are compared. */
export const MIN_STRATEGY = 10;
/** Per-statement minimums of the journal side. */
export const MIN_HOLD = 10;
export const MIN_DRAWDOWN = 20;
export const MIN_WINDOW = 20;
export const MIN_RISK = 10;
export const MIN_PLAN = 10;
/** Journal span (days) before a weekly trade frequency means anything. */
export const MIN_SPAN_DAYS = 14;

/** Thresholds of the statements (one place, documented in README.md). */
export const FIT_RULES = {
  /** hold times further apart than this factor are a friction */
  holdFactor: 2,
  /** the idea's longest losing run exceeds the journal's by at least this many trades */
  streakExtra: 2,
  /** the idea's deepest drawdown (R) exceeds the journal's by this factor AND by at least `ddMinExtra` R */
  ddFactor: 1.5,
  ddMinExtra: 2,
  /** trade frequency further apart than this factor (either way) */
  freqFactor: 2,
  /** a time window counts as „selten gehandelt“ below this share of the journal … */
  rareShare: 0.05,
  /** … and as a friction when the idea enters at least this share of its trades there */
  heavyShare: 0.15,
  /** the idea risks more than this factor of the usual risk */
  riskFactor: 1.5,
  /** discipline: share of trades with a stop below which it is a friction; share of stop-widened trades; plan-following */
  stopShare: 0.9,
  widenedShare: 0.05,
  planShare: 0.7,
} as const;

export interface Share {
  k: number;
  n: number;
  share: number;
  /** 80 % Wilson interval */
  lo: number;
  hi: number;
}

/** What a tested idea demands. Times are UTC. */
export interface StrategyFacts {
  name: string;
  n: number;
  /** period of the run, ms, and its length in days */
  from: number;
  to: number;
  days: number;
  win: Share;
  /** trades per week over the period; null under 7 days */
  perWeek: number | null;
  /** median time in a trade, ms; null without trades */
  holdMedianMs: number | null;
  /** longest run of losing trades */
  longestLosing: number;
  /** deepest drop of the cumulative R (≥ 0) */
  drawdownR: number;
  /** deepest drop of the equity in percent of the account, null if the run did not say */
  drawdownPct: number | null;
  /** percent of the account risked per trade (the run's setting), null if unknown */
  riskPct: number | null;
  /** share of entries per UTC weekday (index 0 = Sunday) and per session */
  weekday: number[];
  session: Record<SessionKey, number>;
  sumR: number;
}

export interface JournalProfile {
  /** closed trades considered (all accounts and markets of the journal) */
  n: number;
  from: number | null;
  to: number | null;
  spanDays: number;
  /** trades per week over the span; null under `MIN_SPAN_DAYS` */
  perWeek: number | null;
  win: Share;
  hold: { n: number; medianMs: number | null };
  longestLosing: number;
  drawdown: { n: number; depthR: number };
  /** risk per trade in percent of the start capital of the account */
  risk: { n: number; medianPct: number | null };
  weekday: { n: number; share: number[]; count: number[] };
  session: { n: number; share: Record<SessionKey, number>; count: Record<SessionKey, number> };
  discipline: {
    /** trades with a stop price */
    stopSet: Share;
    /** trades in which the stop was moved further away (coach event `stopMoved`) */
    widened: number;
    /** trades the trader marked „Plan befolgt“ — of those that carry the answer */
    followed: Share;
  };
}

export type FitKind = "match" | "friction" | "unknown";
export type FitId = "winRate" | "hold" | "streak" | "drawdown" | "frequency" | "window" | "risk" | "discipline";

export interface FitEvidence {
  label: string;
  value: string;
}

export interface FitItem {
  id: FitId;
  kind: FitKind;
  /** short name of the topic */
  title: string;
  /** one or two sentences with the numbers, phrased as an observation */
  text: string;
  /** the figures behind the sentence, side by side */
  evidence: FitEvidence[];
  /** a sample or reading caveat that belongs to THIS statement (may be empty) */
  caveat: string;
}

export type FitStatus = "ok" | "journalNone" | "journalFew" | "strategyFew";

export interface FitReport {
  status: FitStatus;
  /** why there is no comparison (null when `status` is `ok`) */
  reason: string | null;
  strategy: StrategyFacts | null;
  profile: JournalProfile | null;
  /** in a fixed order: win rate, hold, streak, drawdown, frequency, window, risk, discipline */
  items: FitItem[];
}
