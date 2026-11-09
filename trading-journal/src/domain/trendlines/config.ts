/**
 * `settings.trendlines` – the versioned passthrough key of the structure view (F05): which timeframes are read and
 * whether the price lines are drawn in the Markt chart. Reading is lenient (anything unknown falls back to the default),
 * writing keeps every unknown key of the root object (a newer version's data survives a round trip) and returns the SAME
 * object when nothing changed. Absent until the user changes something (old settings get no new key).
 */
import { KEY_TIMEFRAMES, isKeyTf, type KeyTf } from "../keylevels/types";

export const TRENDLINES_VERSION = 1 as const;

/** The timeframes read until the user picks others: 1h, 4h, 1D, 1W. */
export const DEFAULT_TREND_TFS: readonly KeyTf[] = ["1h", "4h", "1D", "1W"];

export interface TrendlinesCfg {
  tfs: KeyTf[];
  /** draw the price lines in the Markt chart */
  chart: boolean;
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** Timeframes in their natural order, once each; unknown entries dropped. */
export function normalizeTfs(raw: unknown): KeyTf[] {
  const want = new Set(Array.isArray(raw) ? raw.filter(isKeyTf) : []);
  return KEY_TIMEFRAMES.filter((t) => want.has(t));
}

export function trendlinesCfgOf(raw: unknown): TrendlinesCfg {
  const r = isObj(raw) ? raw : {};
  return { tfs: Array.isArray(r.tfs) ? normalizeTfs(r.tfs) : [...DEFAULT_TREND_TFS], chart: typeof r.chart === "boolean" ? r.chart : true };
}

export const trendlinesOfSettings = (s: { trendlines?: unknown } | null | undefined): TrendlinesCfg => trendlinesCfgOf(s?.trendlines);

const canon = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

export function withTrendlines(raw: unknown, patch: Partial<TrendlinesCfg>): Record<string, unknown> {
  const prev = isObj(raw) ? raw : {};
  const cur = trendlinesCfgOf(raw);
  const next: Record<string, unknown> = { ...prev, v: TRENDLINES_VERSION, tfs: patch.tfs ? normalizeTfs(patch.tfs) : cur.tfs, chart: patch.chart ?? cur.chart };
  return isObj(raw) && canon(prev) === canon(next) ? (raw as Record<string, unknown>) : next;
}
