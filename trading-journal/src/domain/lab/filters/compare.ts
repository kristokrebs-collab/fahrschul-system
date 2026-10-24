/**
 * The filter comparison (F17): the same run – same data, window, parameters and costs – with and without the chosen
 * filters, and with each chosen filter alone and left out. The contribution of one filter is read two ways:
 *   alone     "nur dieser Filter" against the run without any filter
 *   marginal  "alle gewählten" against "alle gewählten ohne diesen" (what it adds on top of the others)
 * Both overlap with the other filters (several filters reject the same signals), so the contributions do NOT add up;
 * `overlap` counts the signals more than one filter rejected.
 */
import { runBacktest } from "../../backtest/engine";
import { patternMask } from "../../discovery/filter";
import type { Window } from "../../backtest/optimize";
import type { LabStrategy, Params, Prepared } from "../../backtest/strategies/types";
import { HIST_MS, type EngineCfg } from "../../backtest/types";
import { statsOf } from "../stress/run";
import type { ScenarioStats } from "../stress/types";
import { applyFilters, type FilterCounts, type Masks } from "./apply";
import { rsiMask, trendMask } from "./masks";
import { FILTER_VERSION, type FilterId, type FilterSelection } from "./types";

export interface FilterVariant {
  id: string;
  label: string;
  filters: FilterId[];
}

export interface FilterDelta {
  dN: number;
  dSumR: number;
  dAvgR: number | null;
  dWinRate: number | null;
}

export interface FilterRow extends FilterVariant {
  stats: ScenarioStats | null;
  /** signals the strategy offered / the filters rejected / could not judge (all variants with filters) */
  asked: number;
  blocked: number;
  unknown: number;
  /** change against the run without filters (null for that run) */
  delta: FilterDelta | null;
}

export interface FilterContribution {
  id: FilterId;
  label: string;
  /** "nur dieser Filter" against no filter */
  alone: FilterDelta | null;
  /** "alle gewählten" against "alle gewählten ohne diesen"; null with a single chosen filter */
  marginal: FilterDelta | null;
}

export interface FilterCompare {
  v: typeof FILTER_VERSION;
  active: FilterId[];
  rows: FilterRow[];
  contributions: FilterContribution[];
  /** in the run with all chosen filters: rejected signals / of them rejected by two or more filters; null without that run */
  overlap: { blocked: number; multi: number } | null;
}

const NAME: Readonly<Record<FilterId, string>> = { rsi: "RSI-Zone", trend: "Höherer Trend", retest: "Retest", topTrader: "Top-Trader-Quote", pattern: "Muster-Filter" };

/** The runs to make for the chosen filters: none · each alone · all · all without one (when that is a new combination). */
export function variantPlan(active: readonly FilterId[]): FilterVariant[] {
  const out: FilterVariant[] = [{ id: "base", label: "Ohne Filter", filters: [] }];
  for (const f of active) out.push({ id: `only:${f}`, label: `Nur ${NAME[f]}`, filters: [f] });
  if (active.length >= 2) out.push({ id: "all", label: "Alle gewählten", filters: [...active] });
  if (active.length >= 3) for (const f of active) out.push({ id: `without:${f}`, label: `Alle ohne ${NAME[f]}`, filters: active.filter((x) => x !== f) });
  return out;
}

const deltaOf = (a: ScenarioStats | null, b: ScenarioStats | null): FilterDelta | null =>
  a && b ? { dN: a.n - b.n, dSumR: a.sumR - b.sumR, dAvgR: a.avgR != null && b.avgR != null ? a.avgR - b.avgR : null, dWinRate: a.winRate != null && b.winRate != null ? a.winRate - b.winRate : null } : null;

/** The masks of the chosen series-based filters over the execution bars. */
export function buildMasks<F>(prep: Prepared<F>, sel: FilterSelection, active: readonly FilterId[]): Masks {
  const execSec = HIST_MS[prep.interval] / 1000;
  const m: Masks = {};
  if (active.includes("rsi")) m.rsi = rsiMask(prep.bars, sel.rsiLimit);
  if (active.includes("trend")) m.trend = trendMask(prep.bars, prep.interval, execSec, sel.trendLen);
  if (active.includes("pattern") && sel.pattern) m.pattern = patternMask(prep.bars, execSec, sel.pattern);
  return m;
}

/** One unit of work per variant; `result()` assembles the comparison from the finished units. */
export function filterUnits<F>(
  strategy: LabStrategy<F, unknown>,
  prep: Prepared<F>,
  params: Params,
  engine: EngineCfg,
  win: Window,
  windowOk: boolean,
  sel: FilterSelection,
  active: readonly FilterId[],
): { count: number; run(i: number): void; result(): FilterCompare } {
  const plan = variantPlan(active);
  const masks = windowOk ? buildMasks(prep, sel, active) : {};
  const secLen = HIST_MS[prep.interval] / 1000;
  const stats = new Map<string, ScenarioStats>();
  const counts = new Map<string, FilterCounts>();

  const run = (i: number): void => {
    const v = plan[i]!;
    if (!windowOk) return;
    const { strategy: s, counts: c } = applyFilters(strategy.build(prep, params), v.filters, masks);
    stats.set(v.id, statsOf(runBacktest(prep.bars, s, engine, { from: win.from, to: win.to, equity: true, atr: prep.atr, secLen })));
    counts.set(v.id, c());
  };

  const result = (): FilterCompare => {
    const base = stats.get("base") ?? null;
    const rows: FilterRow[] = plan.map((v) => {
      const st = stats.get(v.id) ?? null;
      const c = counts.get(v.id);
      const unknown = c ? Object.values(c.by).reduce((s, x) => s + (x?.unknown ?? 0), 0) : 0;
      return { ...v, stats: st, asked: c?.asked ?? 0, blocked: c?.blocked ?? 0, unknown, delta: v.id === "base" ? null : deltaOf(st, base) };
    });
    const get = (id: string): ScenarioStats | null => stats.get(id) ?? null;
    const contributions: FilterContribution[] = active.map((f) => {
      let marginal: FilterDelta | null = null;
      if (active.length >= 3) marginal = deltaOf(get("all"), get(`without:${f}`));
      else if (active.length === 2) marginal = deltaOf(get("all"), get(`only:${active.find((x) => x !== f)}`));
      return { id: f, label: NAME[f], alone: deltaOf(get(`only:${f}`), base), marginal };
    });
    const all = counts.get("all");
    return { v: FILTER_VERSION, active: [...active], rows, contributions, overlap: all ? { blocked: all.blocked, multi: all.blockedMulti } : null };
  };
  return { count: plan.length, run, result };
}

