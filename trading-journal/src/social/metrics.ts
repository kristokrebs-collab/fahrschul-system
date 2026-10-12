/**
 * Community figures (P12) – PURE and alias-free: the Netlify functions import this file by relative path
 * (`social-aggregate`), the client uses the very same code for its own preview and the percentile comparison, so a
 * trader sees exactly the number the ranking uses.
 *
 * Everything is R-based (never money, never account size) and computed over the last `WINDOW_DAYS` days:
 * - **Erwartung (R)** – mean R per closed trade, every R capped at ±`R_CAP` (one freak trade must not buy a rank);
 *   needs ≥ `MIN_R_TRADES` trades with an R.
 * - **Disziplin (%)** – share of closed trades marked "nach Plan" AND without a mistake tag, among the trades that
 *   carry the plan flag at all; needs ≥ `MIN_PLAN_TRADES` such trades.
 * - **Konsistenz (%)** – share of green weeks (ΣR > 0) among the weeks with at least one R trade; needs ≥ `MIN_WEEKS`.
 * A trader is **eligible** for the ranking with ≥ `MIN_TRADES` R trades in the window.
 *
 * Aggregates are k-anonymous: `quantiles()` returns nothing below `K_ANON` traders (the database enforces the same
 * with a check constraint on `community_stats.n`).
 */

export const WINDOW_DAYS = 90;
/** R trades in the window to appear in a ranking. */
export const MIN_TRADES = 20;
export const MIN_R_TRADES = 5;
export const MIN_PLAN_TRADES = 5;
export const MIN_WEEKS = 4;
/** k-anonymity: no aggregate over fewer traders. */
export const K_ANON = 10;
/** R values are capped at ± this before averaging. */
export const R_CAP = 10;

export const SOCIAL_METRICS = ["expectancy", "discipline", "consistency"] as const;
export type SocialMetric = (typeof SOCIAL_METRICS)[number];
/** Metrics with a community distribution (`community_stats.metric`). */
export const STAT_METRICS = ["expectancy", "discipline", "consistency", "winrate"] as const;
export type StatMetric = (typeof STAT_METRICS)[number];

export const isSocialMetric = (v: unknown): v is SocialMetric => typeof v === "string" && (SOCIAL_METRICS as readonly string[]).includes(v);

/** The trade fields the figures read – a journal record or a `journal_docs.data` object (anything else is ignored). */
export interface MetricTrade {
  status?: unknown;
  r?: unknown;
  date?: unknown;
  followedPlan?: unknown;
  mistakes?: unknown;
}

export interface SocialStats {
  windowDays: number;
  /** Closed trades in the window. */
  trades: number;
  /** Closed trades with a finite R. */
  rTrades: number;
  expectancyR: number | null;
  /** 0–100. */
  winRate: number | null;
  /** 0–100. */
  discipline: number | null;
  /** 0–100. */
  consistency: number | null;
  /** Weeks with at least one R trade. */
  weeks: number;
  eligible: boolean;
}

const DAY_MS = 86_400_000;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number, d: number) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

/** Epoch ms of a journal date ("YYYY-MM-DDTHH:mm", local wall clock read as UTC – a day off never matters here). */
export function tradeEpoch(date: unknown): number | null {
  if (typeof date !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(date);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0));
  return Number.isFinite(t) ? t : null;
}

/** Monday-based week index since the epoch (1970-01-01 was a Thursday). */
export const weekIndex = (epochMs: number): number => Math.floor((Math.floor(epochMs / DAY_MS) + 3) / 7);

/** The R-based figures of one trader over the window ending at `now`. */
export function socialStats(trades: readonly MetricTrade[], now: number, windowDays: number = WINDOW_DAYS): SocialStats {
  const from = now - windowDays * DAY_MS;
  let closed = 0;
  const rs: number[] = [];
  const weeks = new Map<number, number>();
  let planned = 0;
  let clean = 0;
  for (const t of trades) {
    if (!t || t.status !== "closed") continue;
    const at = tradeEpoch(t.date);
    if (at == null || at < from || at > now + DAY_MS) continue;
    closed++;
    if (fin(t.r)) {
      const r = Math.max(-R_CAP, Math.min(R_CAP, t.r));
      rs.push(r);
      const w = weekIndex(at);
      weeks.set(w, (weeks.get(w) ?? 0) + r);
    }
    if (typeof t.followedPlan === "boolean") {
      planned++;
      const mistakes = Array.isArray(t.mistakes) ? t.mistakes.filter((m) => typeof m === "string" && m.trim()) : [];
      if (t.followedPlan && mistakes.length === 0) clean++;
    }
  }
  const n = rs.length;
  const sum = rs.reduce((a, b) => a + b, 0);
  const green = [...weeks.values()].filter((v) => v > 0).length;
  return {
    windowDays,
    trades: closed,
    rTrades: n,
    expectancyR: n >= MIN_R_TRADES ? round(sum / n, 2) : null,
    winRate: n >= MIN_R_TRADES ? round((rs.filter((r) => r > 0).length / n) * 100, 1) : null,
    discipline: planned >= MIN_PLAN_TRADES ? round((clean / planned) * 100, 1) : null,
    consistency: weeks.size >= MIN_WEEKS ? round((green / weeks.size) * 100, 1) : null,
    weeks: weeks.size,
    eligible: n >= MIN_TRADES,
  };
}

/** The value a metric ranks by (`null` = not enough data for it). */
export function metricValue(s: Pick<SocialStats, "expectancyR" | "discipline" | "consistency" | "winRate">, metric: SocialMetric | StatMetric): number | null {
  switch (metric) {
    case "expectancy":
      return s.expectancyR;
    case "discipline":
      return s.discipline;
    case "consistency":
      return s.consistency;
    case "winrate":
      return s.winRate;
  }
}

export interface RankInput {
  userId: string;
  value: number;
  trades: number;
}

export interface RankedRow extends RankInput {
  /** Competition ranking (1, 2, 2, 4): equal values share a rank. */
  rank: number;
}

/** Ranks by value (higher is better); ties share the rank and are listed by more trades first, then id. */
export function rankRows(rows: readonly RankInput[]): RankedRow[] {
  const sorted = [...rows].filter((r) => fin(r.value)).sort((a, b) => b.value - a.value || b.trades - a.trades || (a.userId < b.userId ? -1 : 1));
  const out: RankedRow[] = [];
  sorted.forEach((r, i) => {
    const prev = out[i - 1];
    out.push({ ...r, rank: prev && prev.value === r.value ? prev.rank : i + 1 });
  });
  return out;
}

export interface Quantiles {
  n: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  mean: number;
}

/** Decimals a metric's aggregates are rounded to (coarser than the individual figure – less to re-identify). */
export const AGG_DECIMALS: Readonly<Record<StatMetric, number>> = { expectancy: 2, discipline: 0, consistency: 0, winrate: 0 };

/** Linear-interpolated quantile of sorted values. */
export function quantileOf(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Distribution of a metric – `null` below `K_ANON` traders (k-anonymity). Rounded per metric. */
export function quantiles(values: readonly number[], decimals = 2, k: number = K_ANON): Quantiles | null {
  const v = values.filter(fin).sort((a, b) => a - b);
  if (v.length < k) return null;
  const r = (x: number) => round(x, decimals);
  return {
    n: v.length,
    p10: r(quantileOf(v, 0.1)),
    p25: r(quantileOf(v, 0.25)),
    p50: r(quantileOf(v, 0.5)),
    p75: r(quantileOf(v, 0.75)),
    p90: r(quantileOf(v, 0.9)),
    mean: r(v.reduce((a, b) => a + b, 0) / v.length),
  };
}

/**
 * Where `value` sits in a distribution, 1–99 ("besser als x %"): piecewise linear through the stored quantiles,
 * extrapolated to 1 / 99 beyond p10 / p90 by the p10–p25 / p75–p90 slope.
 */
export function percentileOf(value: number, q: Pick<Quantiles, "p10" | "p25" | "p50" | "p75" | "p90">): number {
  const pts: [number, number][] = [
    [q.p10, 10],
    [q.p25, 25],
    [q.p50, 50],
    [q.p75, 75],
    [q.p90, 90],
  ];
  const clamp = (p: number) => Math.max(1, Math.min(99, Math.round(p)));
  if (value <= pts[0]![0]) {
    const span = pts[1]![0] - pts[0]![0];
    return clamp(span > 0 ? 10 - ((pts[0]![0] - value) / span) * 15 : value < pts[0]![0] ? 1 : 10);
  }
  if (value >= pts[4]![0]) {
    const span = pts[4]![0] - pts[3]![0];
    return clamp(span > 0 ? 90 + ((value - pts[4]![0]) / span) * 15 : value > pts[4]![0] ? 99 : 90);
  }
  for (let i = 1; i < pts.length; i++) {
    const [x1, p1] = pts[i]!;
    const [x0, p0] = pts[i - 1]!;
    if (value <= x1) return clamp(x1 > x0 ? p0 + ((value - x0) / (x1 - x0)) * (p1 - p0) : p1);
  }
  return 50;
}
