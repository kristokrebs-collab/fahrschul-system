/**
 * `compareStrategies` – several strategies on the SAME candles, the SAME window, the SAME costs and the SAME train / test
 * cut; one table row each (trades, win rate, Ø R, profit factor, max drawdown, the test window's own figures, rank). Pure:
 * candles in, rows out – no UI, no loading, no model. The studio's "Alle testen", the background optimiser and the pattern
 * finder all call it, so every list of results is built the same way.
 *
 * Honesty built into the result, not left to the UI:
 * - the number of strategies compared is part of the result (`multiple.count`) and drives a multiple-testing note and a
 *   Bonferroni-adjusted p-value per row – the more strategies are compared, the likelier one wins by chance;
 * - the rank uses the TEST window's Ø R when every ranked strategy has enough trades there, else the whole period (and says so);
 * - the strategies' rules are NOT fitted here: train and test are two consecutive periods, and the note says when that
 *   stops being a clean test (rules edited after looking at the data);
 * - a row with a thin sample is flagged, a row that cannot run says why (`status`, `reason`).
 */
import { DEFAULT_SIGNAL_CFG, type SignalCfg } from "../signals/config";
import { customStrategy } from "../backtest/strategies/custom";
import { evaluate, type Window } from "../backtest/optimize";
import { runStats, type RunStats } from "../backtest/metrics";
import { windowOf } from "../backtest/job";
import { now, type Stepper } from "../backtest/strategies/types";
import { HIST_MS, type BarsBy, type EngineCfg, type FundingPoint } from "../backtest/types";
import { higherTfsOf, needsLadder, sanitizeCustom, validateCustom } from "../lab/rules/tree";
import type { CustomConfig, TfId } from "../lab/rules/types";

export interface CompareInput {
  id: string;
  name: string;
  config: CustomConfig;
}

export interface CompareOptions {
  /** candles by interval – must cover every interval the strategies need (see `compareIntervals`) from `fromMs − warm-up` to `toMs` */
  data: BarsBy;
  /** the window every strategy is measured on (ms): first tradable time and the end */
  fromMs: number;
  toMs: number;
  engine: EngineCfg;
  signal?: SignalCfg;
  funding?: readonly FundingPoint[] | null;
  /** share of the window that is "train" (default 0.7); the cut is the same instant for every strategy */
  trainShare?: number;
  /** strategies tried before that are not in this list (a search): they count for the multiple-testing note */
  extraTrials?: number;
}

export type SampleLevel = "none" | "tiny" | "small" | "ok" | "good";

export const sampleLevel = (n: number): SampleLevel => (n === 0 ? "none" : n < 10 ? "tiny" : n < 30 ? "small" : n < 100 ? "ok" : "good");

/** Fewest trades in the test window before the rank is taken from it. */
export const MIN_TEST_TRADES = 5;
/** Fewest bars a train or test window needs to be measured at all. */
const MIN_WINDOW_BARS = 20;

export interface PeriodFigures {
  n: number;
  winRate: number | null;
  avgR: number | null;
  /** `null` = no losing trade (infinite) or no trade */
  pf: number | null;
  /** fraction of the running peak */
  maxDD: number;
  netPct: number;
  sumR: number;
}

export type RowStatus = "ok" | "invalid" | "nodata" | "error";

export interface CompareRow {
  id: string;
  name: string;
  status: RowStatus;
  /** why the strategy was not run (`status` ≠ "ok") */
  reason: string | null;
  interval: TfId;
  all: PeriodFigures | null;
  train: PeriodFigures | null;
  test: PeriodFigures | null;
  /** one-sided p of "Ø R > 0" over the whole window, and the same times the number of strategies compared (Bonferroni, ≤ 1) */
  pEdge: number | null;
  pAdj: number | null;
  sample: SampleLevel;
  /** 1 = best by `rankBasis`; `null` = not ranked (no trades or not run) */
  rank: number | null;
  /** equity in % of the start capital, ≤ 48 points (a sparkline) */
  curve: number[];
}

export interface MultipleTesting {
  /** strategies in this comparison that were run */
  count: number;
  /** … plus `extraTrials` */
  trials: number;
  /** chance that at least one of `trials` strategies WITHOUT any edge looks "significant" (p < 0,05) by luck: 1 − 0,95^trials */
  luckyChance: number;
  text: string;
}

export interface CompareResult {
  rows: CompareRow[];
  /** "test" = ranked by the test window's Ø R, "all" = by the whole window's, null = nothing to rank */
  rankBasis: "test" | "all" | null;
  window: { fromMs: number; toMs: number; cutMs: number; trainShare: number };
  multiple: MultipleTesting;
  /** sentences the table must show (sample, multiple testing, what the test window is) */
  warnings: string[];
}

const de = (v: number, d = 1): string => v.toFixed(d).replace(".", ",");

function figures(s: RunStats): PeriodFigures {
  return { n: s.n, winRate: s.winRate, avgR: s.avgR, pf: s.pf === Infinity ? null : s.pf, maxDD: s.maxDD, netPct: s.netPct, sumR: s.sumR };
}

/** The intervals the strategies need together – load these (from `fromMs − warmupMs`) before calling `compareStrategies`. */
export function compareIntervals(strategies: readonly CompareInput[], signal: SignalCfg = DEFAULT_SIGNAL_CFG): TfId[] {
  const out = new Set<TfId>();
  for (const s of strategies) for (const iv of customStrategy.intervals({ config: s.config, signal })) out.add(iv as TfId);
  return [...out];
}

/** Warm-up (ms) the strategies need before `fromMs`: the longest of them. */
export function compareWarmupMs(strategies: readonly CompareInput[], signal: SignalCfg = DEFAULT_SIGNAL_CFG): number {
  return strategies.reduce((m, s) => Math.max(m, customStrategy.warmupMs({ config: s.config, signal })), 0);
}

/** The multiple-testing note for `trials` strategies (exported: the studio shows it before a run, too). */
export function multipleTestingNote(count: number, extraTrials = 0): MultipleTesting {
  const trials = Math.max(0, count) + Math.max(0, Math.round(extraTrials));
  const luckyChance = trials > 0 ? 1 - Math.pow(0.95, trials) : 0;
  const text =
    trials <= 1
      ? "Eine einzelne Strategie: Das Ergebnis gilt für diese eine Prüfung."
      : `${trials} Strategien auf denselben Daten verglichen. Je mehr man vergleicht, desto eher liegt eine nur durch Zufall vorn: Selbst wenn keine einen echten Vorteil hätte, sähe mit ${de(luckyChance * 100, 0)} % Wahrscheinlichkeit mindestens eine für sich genommen „signifikant“ aus (p < 0,05). Die angepasste Zahl rechnet das mit (Bonferroni: p × ${trials}).`;
  return { count, trials, luckyChance, text };
}

interface Job {
  input: CompareInput;
  config: CustomConfig;
}

/** The stepped comparison (idle chunks / a worker) – `compareStrategies` runs it to the end. */
export function createComparison(strategies: readonly CompareInput[], options: CompareOptions): Stepper<CompareResult> {
  const signal = options.signal ?? DEFAULT_SIGNAL_CFG;
  const share = Math.min(0.9, Math.max(0.5, options.trainShare ?? 0.7));
  const cutMs = options.fromMs + (options.toMs - options.fromMs) * share;
  const jobs: Job[] = strategies.map((input) => ({ input, config: sanitizeCustom(input.config) }));
  const rows: CompareRow[] = [];
  let k = 0;
  let current: { job: Job; prep: Stepper<ReturnType<typeof customStrategy.prepare> extends Stepper<infer P> ? P : never> } | null = null;

  const emptyRow = (job: Job, status: RowStatus, reason: string): CompareRow => ({ id: job.input.id, name: job.input.name, status, reason, interval: job.config.interval, all: null, train: null, test: null, pEdge: null, pAdj: null, sample: "none", rank: null, curve: [] });

  const start = (job: Job): CompareRow | null => {
    const errs = validateCustom(job.config, { funding: options.funding != null && options.funding.length > 0 }).filter((i) => i.level === "error");
    if (errs.length) return emptyRow(job, "invalid", errs[0]!.text);
    const need = [job.config.interval, ...higherTfsOf(job.config)];
    const missing = need.filter((iv) => !(options.data[iv]?.length));
    if (missing.length || (needsLadder(job.config) && !(options.data[job.config.interval]?.length))) return emptyRow(job, "nodata", `Keine Kerzen für ${missing.join(", ") || job.config.interval} geladen.`);
    current = { job, prep: customStrategy.prepare(options.data, { config: job.config, signal, funding: options.funding ?? null }, options.fromMs) as never };
    return null;
  };

  const measure = (job: Job, prep: NonNullable<typeof current>["prep"]): CompareRow => {
    const pr = prep.result();
    const win: Window = windowOf(pr, options.toMs);
    if (!(pr.bars.length > 0 && win.to > pr.start)) return emptyRow(job, "nodata", "Der Zeitraum enthält zu wenige Kerzen.");
    const run = evaluate(customStrategy, pr, {}, options.engine, win, true);
    const all = runStats(run);
    // the cut is one instant for every strategy: the first bar that opens at or after it
    let cut = win.from;
    while (cut <= win.to && pr.bars[cut]!.t * 1000 < cutMs) cut++;
    const trainWin: Window = { from: win.from, to: cut - 1 };
    const testWin: Window = { from: cut, to: win.to };
    const ok = (w: Window): boolean => w.to - w.from + 1 >= MIN_WINDOW_BARS;
    const train = ok(trainWin) ? figures(runStats(evaluate(customStrategy, pr, {}, options.engine, trainWin, true))) : null;
    const test = ok(testWin) ? figures(runStats(evaluate(customStrategy, pr, {}, options.engine, testWin, true))) : null;
    const cap = run.equity[0]?.equity ?? 0;
    const step = Math.max(1, Math.ceil(run.equity.length / 48));
    const curve = cap > 0 ? run.equity.filter((_, i) => i % step === 0 || i === run.equity.length - 1).map((p) => (p.equity / cap - 1) * 100) : [];
    return { id: job.input.id, name: job.input.name, status: "ok", reason: null, interval: job.config.interval, all: figures(all), train, test, pEdge: all.pEdge, pAdj: null, sample: sampleLevel(all.n), rank: null, curve };
  };

  let done: CompareResult | null = null;
  const finish = (): CompareResult => {
    const ran = rows.filter((r) => r.status === "ok");
    const extra = Math.max(0, Math.round(options.extraTrials ?? 0));
    const multiple = multipleTestingNote(ran.length, extra);
    for (const r of ran) r.pAdj = r.pEdge == null ? null : Math.min(1, r.pEdge * Math.max(1, multiple.trials));
    const rankable = ran.filter((r) => r.all!.n > 0 && r.all!.avgR != null);
    const useTest = rankable.length > 0 && rankable.every((r) => r.test != null && r.test.n >= MIN_TEST_TRADES && r.test.avgR != null);
    const basis: CompareResult["rankBasis"] = rankable.length === 0 ? null : useTest ? "test" : "all";
    const score = (r: CompareRow): number => (basis === "test" ? r.test!.avgR! : r.all!.avgR!);
    [...rankable]
      .sort((a, b) => score(b) - score(a) || b.all!.n - a.all!.n || a.id.localeCompare(b.id))
      .forEach((r, i) => {
        r.rank = i + 1;
      });
    const warnings: string[] = [];
    warnings.push(multiple.text);
    if (rankable.length > 1 && basis === "all") warnings.push(`Der Rang beruht auf dem ganzen Zeitraum, weil mindestens eine Strategie im Testfenster weniger als ${MIN_TEST_TRADES} Trades hat – das ist kein ungesehener Test.`);
    if (basis === "test") warnings.push(`Der Rang beruht auf Ø R im Testfenster (die letzten ${de((1 - share) * 100, 0)} % des Zeitraums). Er ist ein Hinweis, keine Empfehlung.`);
    const thin = ran.filter((r) => r.sample === "none" || r.sample === "tiny" || r.sample === "small");
    if (thin.length) warnings.push(`Kleine Stichprobe: ${thin.map((r) => `${r.name} (${r.all!.n} Trades)`).join(", ")}. Unter 30 Trades schwanken Trefferquote und Ø R stark – ein Rang daraus ist kaum belastbar.`);
    warnings.push("Die Regeln werden hier nicht an den Daten angepasst: Training und Test sind zwei aufeinanderfolgende Zeiträume derselben Daten. Hast du Regeln geändert, nachdem du Ergebnisse dieser Daten gesehen hast, ist auch das Testfenster nicht mehr ungesehen.");
    const invalid = rows.filter((r) => r.status !== "ok");
    if (invalid.length) warnings.push(`Nicht gerechnet: ${invalid.map((r) => `${r.name} (${r.reason})`).join("; ")}.`);
    done = { rows, rankBasis: basis, window: { fromMs: options.fromMs, toMs: options.toMs, cutMs, trainShare: share }, multiple, warnings };
    return done;
  };

  return {
    step(deadline: number): boolean {
      if (done) return true;
      for (;;) {
        if (current) {
          if (!current.prep.step(deadline)) return false;
          const { job, prep } = current;
          current = null;
          try {
            rows.push(measure(job, prep));
          } catch (e) {
            void e;
            rows.push(emptyRow(job, "error", "Beim Rechnen ist ein Fehler aufgetreten."));
          }
          k++;
          if (now() >= deadline && k < jobs.length) return false;
        }
        if (k >= jobs.length) {
          finish();
          return true;
        }
        const early = start(jobs[k]!);
        if (early) {
          rows.push(early);
          k++;
        }
      }
    },
    progress: () => (done ? 1 : jobs.length ? Math.min(0.999, (k + (current ? current.prep.progress() : 0)) / jobs.length) : 1),
    result() {
      while (!this.step(Number.POSITIVE_INFINITY)) {
        /* run to the end */
      }
      return done!;
    },
  };
}

/** All strategies on the same candles and window. See the module comment. */
export function compareStrategies(strategies: readonly CompareInput[], candles: BarsBy, options: Omit<CompareOptions, "data">): CompareResult {
  return createComparison(strategies, { ...options, data: candles }).result();
}

/** Length of one candle of `iv` in ms (for callers that size a window). */
export const candleMs = (iv: TfId): number => HIST_MS[iv];
