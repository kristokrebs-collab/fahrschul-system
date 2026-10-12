/**
 * Custom statistics (P03): metric × filter × group-by, saved in `settings.analytics.custom` (a passthrough settings
 * key – `normalizeSettings` keeps unknown keys, backups carry them). Parsed defensively: an unknown metric / dimension
 * or a broken entry is dropped, never thrown. Every number goes through `aggregate()` / the analytics helpers.
 */
import type { EnrichedTrade, Settings } from "../types";
import { aggregate } from "../agg";
import { accountOf } from "../insights/shared";
import { tradeTime } from "@/lib/dates";
import { DIMENSIONS, bucketLabel, groupByDimension, isDimensionKey, type DimensionCtx, type DimensionKey } from "./dimensions";
import { tradeReturns, sharpeOf } from "./ratios";
import { finite, meanCI, sd, wilsonCI, type Interval } from "./stats";

export type CustomMetricKey = "trades" | "winRate" | "net" | "exp" | "avgR" | "pf" | "payoff" | "sqn" | "sharpeTrade";
export type CustomFormat = "int" | "pct" | "money" | "r" | "ratio";

export interface CustomMetric {
  key: CustomMetricKey;
  label: string;
  format: CustomFormat;
  compute(list: readonly EnrichedTrade[], start: number): number | null;
  /** 80 % interval where one exists */
  ci?(list: readonly EnrichedTrade[]): Interval | null;
}

const rsOf = (list: readonly EnrichedTrade[]) => finite(list.map((t) => t.r));

export const CUSTOM_METRICS: Readonly<Record<CustomMetricKey, CustomMetric>> = {
  trades: { key: "trades", label: "Trades", format: "int", compute: (l) => l.length },
  winRate: {
    key: "winRate",
    label: "Win-Rate",
    format: "pct",
    compute: (l) => aggregate(l).winRate,
    ci: (l) => {
      const g = aggregate(l);
      return g.n >= 5 ? wilsonCI(g.wins, g.n) : null;
    },
  },
  net: { key: "net", label: "Netto", format: "money", compute: (l) => (l.length ? aggregate(l).net : null) },
  exp: { key: "exp", label: "Ø P&L pro Trade", format: "money", compute: (l) => aggregate(l).exp, ci: (l) => (l.length >= 5 ? meanCI(l.map((t) => t.pnl ?? 0)) : null) },
  avgR: { key: "avgR", label: "Ø R", format: "r", compute: (l) => aggregate(l).avgR, ci: (l) => (rsOf(l).length >= 5 ? meanCI(rsOf(l)) : null) },
  pf: { key: "pf", label: "Profit-Faktor", format: "ratio", compute: (l) => aggregate(l).pf },
  payoff: { key: "payoff", label: "Ø Gewinn ÷ Ø Verlust", format: "ratio", compute: (l) => aggregate(l).payoff },
  sqn: {
    key: "sqn",
    label: "SQN",
    format: "ratio",
    compute: (l) => {
      const rs = rsOf(l);
      const s = sd(rs);
      return rs.length >= 5 && s && s > 0 ? (Math.sqrt(Math.min(rs.length, 100)) * (rs.reduce((a, b) => a + b, 0) / rs.length)) / s : null;
    },
  },
  sharpeTrade: { key: "sharpeTrade", label: "Sharpe pro Trade", format: "ratio", compute: (l, start) => (l.length >= 5 ? sharpeOf(tradeReturns(l, start)) : null) },
};
export const CUSTOM_METRIC_ORDER: readonly CustomMetricKey[] = ["winRate", "exp", "avgR", "net", "pf", "payoff", "sqn", "sharpeTrade", "trades"];

export type CustomSince = "all" | "30d" | "90d" | "365d";
export const SINCE_LABELS: Record<CustomSince, string> = { all: "Gesamt", "30d": "30 Tage", "90d": "90 Tage", "365d": "12 Monate" };
const SINCE_DAYS: Record<Exclude<CustomSince, "all">, number> = { "30d": 30, "90d": 90, "365d": 365 };

export interface CustomFilter {
  side?: "long" | "short";
  account?: "makro" | "scalp";
  since?: CustomSince;
  /** only trades in this bucket of a dimension */
  dim?: DimensionKey;
  key?: string;
}

export interface CustomStat {
  id: string;
  metric: CustomMetricKey;
  filter: CustomFilter;
  groupBy: DimensionKey | null;
  createdAt: string;
}

/** Saved custom stats at most. */
export const CUSTOM_MAX = 12;

const isMetric = (v: unknown): v is CustomMetricKey => typeof v === "string" && v in CUSTOM_METRICS;

function parseFilter(raw: unknown): CustomFilter {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const f: CustomFilter = {};
  if (o.side === "long" || o.side === "short") f.side = o.side;
  if (o.account === "makro" || o.account === "scalp") f.account = o.account;
  if (o.since === "30d" || o.since === "90d" || o.since === "365d" || o.since === "all") f.since = o.since;
  if (isDimensionKey(o.dim) && typeof o.key === "string" && o.key) {
    f.dim = o.dim;
    f.key = o.key;
  }
  return f;
}

/** The saved custom stats of the settings (defensive; unknown entries dropped). */
export function customStatsOf(settings: Settings): CustomStat[] {
  const analytics = (settings as Settings & { analytics?: unknown }).analytics;
  const raw = analytics && typeof analytics === "object" ? (analytics as { custom?: unknown }).custom : undefined;
  if (!Array.isArray(raw)) return [];
  const out: CustomStat[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id || !isMetric(o.metric)) continue;
    out.push({
      id: o.id,
      metric: o.metric,
      filter: parseFilter(o.filter),
      groupBy: isDimensionKey(o.groupBy) ? o.groupBy : null,
      createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
    });
    if (out.length >= CUSTOM_MAX) break;
  }
  return out;
}

/** Settings with `analytics.custom` replaced (every other key – also other `analytics` keys – kept). */
export function withCustomStats(settings: Settings, list: readonly CustomStat[]): Settings {
  const prev = (settings as Settings & { analytics?: unknown }).analytics;
  const analytics = prev && typeof prev === "object" ? { ...(prev as Record<string, unknown>) } : {};
  return { ...settings, analytics: { ...analytics, custom: list.slice(0, CUSTOM_MAX).map((s) => ({ ...s, filter: { ...s.filter } })) } } as Settings;
}

/** Trades passing a filter. */
export function applyCustomFilter(closed: readonly EnrichedTrade[], f: CustomFilter, ctx: DimensionCtx, now: number): EnrichedTrade[] {
  const since = f.since && f.since !== "all" ? now - SINCE_DAYS[f.since] * 86_400_000 : null;
  const dim = f.dim ? DIMENSIONS[f.dim] : null;
  return closed.filter((t) => {
    if (f.side && (t.side === "short" ? "short" : "long") !== f.side) return false;
    if (f.account && accountOf(t) !== f.account) return false;
    if (since != null && +tradeTime(t) < since) return false;
    if (dim && f.key && !dim.keys(t, ctx).includes(f.key)) return false;
    return true;
  });
}

export interface CustomGroupValue {
  key: string;
  label: string;
  value: number | null;
  n: number;
  ci: Interval | null;
}

export interface CustomResult {
  value: number | null;
  n: number;
  ci: Interval | null;
  groups: CustomGroupValue[] | null;
}

/** Evaluates a custom stat over the closed trades (time order). */
export function evalCustomStat(closed: readonly EnrichedTrade[], stat: CustomStat, ctx: DimensionCtx, start: number, now: number): CustomResult {
  const m = CUSTOM_METRICS[stat.metric];
  const list = applyCustomFilter(closed, stat.filter, ctx, now);
  const groups = stat.groupBy
    ? (() => {
        const dim = DIMENSIONS[stat.groupBy];
        const map = groupByDimension(list, dim, ctx);
        const rows = [...map.entries()].map(([key, l]) => ({ key, label: bucketLabel(dim, key, ctx), value: m.compute(l, start), n: l.length, ci: m.ci?.(l) ?? null }));
        if (dim.order) {
          const idx = new Map(dim.order.map((k, i) => [k, i]));
          rows.sort((a, b) => (idx.get(a.key) ?? 999) - (idx.get(b.key) ?? 999));
        } else rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
        return rows;
      })()
    : null;
  return { value: m.compute(list, start), n: list.length, ci: m.ci?.(list) ?? null, groups };
}

/** Title of a custom stat: "Win-Rate · Long · 90 Tage · nach Session". */
export function customStatTitle(stat: CustomStat, ctx: DimensionCtx): string {
  const parts: string[] = [CUSTOM_METRICS[stat.metric].label];
  if (stat.filter.side) parts.push(stat.filter.side === "long" ? "Long" : "Short");
  if (stat.filter.account) parts.push(stat.filter.account === "makro" ? "Makro" : "Scalp");
  if (stat.filter.since && stat.filter.since !== "all") parts.push(SINCE_LABELS[stat.filter.since]);
  if (stat.filter.dim && stat.filter.key) parts.push(bucketLabel(DIMENSIONS[stat.filter.dim], stat.filter.key, ctx));
  if (stat.groupBy) parts.push(`nach ${DIMENSIONS[stat.groupBy].label}`);
  return parts.join(" · ");
}
