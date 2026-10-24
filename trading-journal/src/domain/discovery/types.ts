/**
 * Muster-Entdecker (Auftrag B): the data contracts. Pure types and constants – no React, no I/O.
 *
 * ONE input type serves both sources: the trades of a backtest (Labor, Strategie-Studio) and the real journal trades. A trade
 * carries what was KNOWN when it was entered (time, side) and what it became (R); the candles that describe the market at the
 * entry come separately (`markets`), because a journal trade has none of its own. Features are computed from the candles that were
 * CLOSED at the entry time – nothing later (see `features.ts`, checked by `tests/unit/discovery.lookahead.test.ts`).
 */
import type { Bar } from "../signals/indicators";

export type DiscoverySide = "long" | "short";

/** One trade, reduced to what the pattern search needs. Times in epoch MILLISECONDS. */
export interface DiscoveryTrade {
  id: string;
  /** when the position was opened (backtest: the open of the entry bar; journal: the entered time) */
  entryTime: number;
  /** when it was closed; `null` = unknown / still open (the trade then does not count for "losses in a row") */
  exitTime: number | null;
  side: DiscoverySide;
  /** result in R (result ÷ planned risk); `null` = unknown – the trade is left out and counted */
  r: number | null;
  /** key into `DiscoveryInput.markets` (journal trades on several pairs); absent = the single market `""` */
  market?: string;
  /** setup / signal label (backtest: the strategy's tag, journal: the setup name) – a category */
  setup?: string | null;
  /** journal field "Emotion" – a category */
  emotion?: string | null;
}

/** A level of the user with its creation time: it only counts for trades entered after it existed (else it would be hindsight). */
export interface DiscoveryLevel {
  price: number;
  /** ms; `null` = creation time unknown → never used */
  sinceMs: number | null;
}

/** The candles one or more trades were taken on. `bars[i].t` = open time in UNIX SECONDS, ascending. */
export interface DiscoveryMarket {
  intervalSec: number;
  bars: readonly Bar[];
  levels?: readonly DiscoveryLevel[];
}

export interface DiscoveryInput {
  trades: readonly DiscoveryTrade[];
  /** candles per market key; a trade without candles still gets the calendar, history and journal features */
  markets?: Readonly<Record<string, DiscoveryMarket>>;
  source: "backtest" | "journal";
  /** what was analysed ("BTCUSDT 4h · Eigene Idee"), shown in the header */
  label?: string;
  /** seed of every random draw (permutations, bootstrap); the same input and seed always give the same result */
  seed?: number;
  /** also use descriptions that are only known AFTER the entry (hold time). Off by default: they would be look-ahead. */
  includePostEntry?: boolean;
}

// ── features ──────────────────────────────────────────────────────────────────────────────────────────────────

export type FeatureId =
  | "side"
  | "session"
  | "weekday"
  | "dayPart"
  | "emaDist20"
  | "emaDist50"
  | "emaDist200"
  | "rsi"
  | "rsiSlope"
  | "volRegime"
  | "candleSize"
  | "bodyRatio"
  | "wickAgainst"
  | "relVolume"
  | "roomAhead"
  | "roomBehind"
  | "trendSlope"
  | "efficiency"
  | "bbPos"
  | "bbWidth"
  | "keyLevelDist"
  | "htfTrend"
  | "dayStartDist"
  | "gap"
  | "lossStreak"
  | "setup"
  | "emotion"
  | "hold";

export type FeatureValue = number | string | null;

/** One feature's definition: what it is, how it reads, and whether an entry filter can evaluate it from candles alone. */
export interface FeatureDef {
  id: FeatureId;
  kind: "num" | "cat";
  label: string;
  /** unit written behind a number ("ATR", "%", "×") */
  unit: string;
  /** decimals when a threshold of this feature is written out */
  digits: number;
  group: "time" | "price" | "volatility" | "candle" | "volume" | "history" | "journal" | "after";
  /** the number reads from the trade's side (Long as is, Short mirrored) – then the label says so */
  dir: boolean;
  /** a feature most traders never look at (a pattern on it is more likely to be new to the user) */
  obscure: boolean;
  /** `entry`: known when the trade was entered. `after`: only known afterwards (look-ahead if used to decide). */
  phase: "entry" | "after";
  /** candles are needed (without them the feature is empty) */
  needsBars: boolean;
  /** an entry filter in the backtest can evaluate it from candles + the clock alone (not the trade history or the journal) */
  filterable: boolean;
}

// ── conditions / findings ─────────────────────────────────────────────────────────────────────────────────────

/** One condition of a pattern: a range of a number (`lo ≤ x < hi`, open end = `null`) or one value of a category. */
export type Cond = { f: FeatureId; k: "num"; lo: number | null; hi: number | null } | { f: FeatureId; k: "cat"; v: string };

export type Tier = "confirmed" | "hint" | "rejected";

/** Why a finding is not confirmed (codes the UI turns into sentences; `rejected` ones always carry one). */
export type Reason =
  | "chance" // after correcting for the number of tests the difference is still compatible with chance
  | "flipped" // the confirmation part points the other way
  | "confirmSmall" // too few trades of the pattern in the confirmation part to say anything
  | "confirmWeak" // same direction in the confirmation part, but not clear enough
  | "unstable" // the sign is not the same in 3 of 4 time blocks
  | "gate" // the feature as a whole shows no association (permutation test per feature)
  | "untested"; // more candidates than the confirmation test covers

export interface CellStats {
  /** trades inside the pattern / trades of the part */
  n: number;
  total: number;
  wins: number;
  /** wins ÷ n, `null` for n = 0 */
  winRate: number | null;
  /** 80 % Wilson interval of `winRate` */
  winCi: { lo: number; hi: number } | null;
  avgR: number | null;
  /** 80 % bootstrap interval of `avgR` (seeded) */
  rCi: { lo: number; hi: number } | null;
  /** hit rate / Ø R of ALL trades of the part (the strategy as a whole) */
  baseWinRate: number | null;
  baseAvgR: number | null;
  /** pattern minus strategy as a whole */
  diffWinRate: number | null;
  diffR: number | null;
}

export interface Finding {
  /** stable id (the conditions, canonical) */
  id: string;
  conds: Cond[];
  /** `win`: the pattern does BETTER than the strategy as a whole · `loss`: worse */
  side: "win" | "loss";
  tier: Tier;
  reasons: Reason[];
  /** all trades / discovery part / confirmation part (null where the part had too few trades of the pattern) */
  all: CellStats;
  disc: CellStats;
  conf: CellStats | null;
  /** discovery: standardised difference (permutation z), the raw p of the pooled permutation null, the BH-adjusted q */
  z: number;
  p: number;
  q: number;
  /** permutation test of the feature (pair, triple) as a whole: the best of its classes against the same shuffles */
  parentP: number;
  /** confirmation part: one-sided permutation p in the direction of the discovery, `null` when it was not tested */
  confP: number | null;
  /** … and the same corrected over all candidates of the confirmation test (Holm); `null` when it was not tested */
  confQ: number | null;
  /** time blocks (4, chronological, over all trades): +1 same sign as the pattern, −1 opposite, 0 too few trades */
  blocks: (1 | -1 | 0)[];
  /** share of the winners / of the losers (R > 0 / R ≤ 0) that show the pattern, over all trades */
  shareWinners: number | null;
  shareLosers: number | null;
  /** the combination does more than its best single part (combos only) */
  nonObvious: boolean;
  /** a combination that its single parts explain – kept out of the lists, still counted as tested */
  redundant: boolean;
  /** at least one feature in it is one most traders do not look at */
  obscure: boolean;
  /** uses a description that is only known after the trade (hold time) – never turned into a filter */
  postEntry: boolean;
}

export interface DiscoveryCounts {
  /** every hypothesis that went into the Benjamini-Hochberg correction */
  tested: number;
  /** of them: singles / pairs / triples */
  singles: number;
  pairs: number;
  triples: number;
  confirmed: number;
  hint: number;
  rejected: number;
  /** combinations explained by a simpler pattern (not shown separately) */
  redundant: number;
  /** classes that had too few trades to be tested at all */
  skippedSmall: number;
}

export type DiscoveryStatus = "ok" | "tooFew" | "noFeatures" | "error";

export interface DiscoveryResult {
  status: DiscoveryStatus;
  /** why there is no result (`tooFew` / `noFeatures`) */
  note: string | null;
  seed: number;
  label: string | null;
  source: "backtest" | "journal";
  /** trades analysed (with a known R) / split 60 : 40 / trades left out */
  n: number;
  nDisc: number;
  nConf: number;
  droppedNoR: number;
  /** trades cut off by the upper limit (oldest first) */
  droppedCap: number;
  /** features that had data / that were empty and why */
  featuresUsed: FeatureId[];
  featuresEmpty: { id: FeatureId; reason: string }[];
  /** permutations of the discovery test, confirmation permutations per candidate */
  permutations: number;
  confPermutations: number;
  /** the whole strategy, in the same words as every finding */
  base: { n: number; winRate: number | null; avgR: number | null };
  counts: DiscoveryCounts;
  /** confirmed (all), hints (best first, capped), the few closest rejected ones (so nothing is hidden) */
  findings: Finding[];
  /** wall time of the computation (diagnostics only; never shown as a result) */
  ms: number;
}

// ── limits (one place; the README explains each) ──────────────────────────────────────────────────────────────

export const LIMITS = {
  /** fewer trades than this: no analysis, the card says how many are missing */
  minTrades: 80,
  /** upper limit of trades (the most recent ones are kept) */
  maxTrades: 2000,
  /** share of the trades (the oldest) used to search; the rest only confirms */
  discoveryShare: 0.6,
  /** a pattern needs this many trades inside and outside in the discovery part */
  minCell: 15,
  /** … and this many inside in the confirmation part */
  minConfCell: 8,
  /** false discovery rate of the whole search (Benjamini-Hochberg) */
  fdr: 0.1,
  /** the feature as a whole must also pass its own permutation test at this level */
  parentGate: 0.1,
  /** confirmation: one-sided permutation p in the direction of the discovery, Holm-corrected over all candidates, must be ≤ this */
  confirmAlpha: 0.05,
  /** time blocks and how many must agree in sign */
  blocks: 4,
  blocksAgree: 3,
  /** a block counts only with this many trades inside and outside */
  blockMin: 3,
  /** quintile classes only from this many trades on */
  quintilesFrom: 300,
  /** triples only from this many trades on, and only among the core features */
  triplesFrom: 400,
  /** upper limit of hypotheses (triples and quintiles are dropped first) */
  maxHypotheses: 9000,
  /** permutation count follows the work budget (element operations) – deterministic, never from the clock */
  workBudget: 70_000_000,
  minPerms: 80,
  maxPerms: 400,
  confPerms: 3000,
  /** the confirmation test covers at most this many candidates (strongest first) */
  maxCandidates: 60,
  /** findings kept in the result: hints / closest rejected ones */
  maxHints: 12,
  maxRejectedShown: 5,
  defaultSeed: 20_260_424,
} as const;
