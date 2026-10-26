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
 * - **Drawdown (R)** – deepest drop of the running sum of R (capped like the others) in the window; SMALLER is better, so
 *   this is the one metric that ranks ascending. It is shown beside every other metric too: a result without its risk is
 *   half a number.
 * - **Herkunft der Datensätze** – which share of the R trades was written by the exchange interface (`api`), a file import
 *   (`csv`), by hand (`manual`, also every record without a mark) or by a bot / webhook (`auto`). A class holding ≥
 *   `ORIGIN_DOMINANT` of the trades names the trader's data; anything else is `mixed`. The app cannot know whether an
 *   account is real money or a demo account – only where the records came from; a trade entered by hand is the trader's word.
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

export const SOCIAL_METRICS = ["expectancy", "discipline", "consistency", "drawdown"] as const;
export type SocialMetric = (typeof SOCIAL_METRICS)[number];
/** Metrics with a community distribution (`community_stats.metric`). */
export const STAT_METRICS = ["expectancy", "discipline", "consistency", "winrate", "drawdown"] as const;
export type StatMetric = (typeof STAT_METRICS)[number];

/** Which end of a metric is better: `high` (more is better) ranks descending, `low` (the drawdown) ascending. */
export const RANK_ORDER: Readonly<Record<SocialMetric | StatMetric, "high" | "low">> = { expectancy: "high", discipline: "high", consistency: "high", winrate: "high", drawdown: "low" };

/** Where the records of a trade came from (`Trade.origin.kind`; no mark = by hand). */
export const ORIGIN_KINDS = ["api", "csv", "manual", "auto"] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];
/** A trader's data class: one origin holding at least `ORIGIN_DOMINANT` of the R trades, else mixed. */
export type OriginClass = OriginKind | "mixed";
export const ORIGIN_CLASSES: readonly OriginClass[] = [...ORIGIN_KINDS, "mixed"];
export const ORIGIN_DOMINANT = 0.8;
/** The ranking's data filter: everybody, or the traders of one class. */
export type OriginFilter = "all" | OriginKind;
export const ORIGIN_FILTERS: readonly OriginFilter[] = ["all", ...ORIGIN_KINDS];
export const isOriginFilter = (v: unknown): v is OriginFilter => typeof v === "string" && (ORIGIN_FILTERS as readonly string[]).includes(v);
export const isOriginClass = (v: unknown): v is OriginClass => typeof v === "string" && (ORIGIN_CLASSES as readonly string[]).includes(v);

/** The origin of a journal record: `Trade.origin = { kind }` (or just the kind, as a server projection returns it). */
export function originOf(raw: unknown): OriginKind {
  const k = raw && typeof raw === "object" ? (raw as { kind?: unknown }).kind : raw;
  if (k === "api") return "api";
  if (k === "csv") return "csv";
  if (k === "bot" || k === "webhook") return "auto";
  return "manual";
}

/** The class of a set of origin counts: the one holding ≥ `ORIGIN_DOMINANT`, else `mixed`; `null` without records. */
export function originClassOf(counts: Readonly<Record<OriginKind, number>>): OriginClass | null {
  const total = ORIGIN_KINDS.reduce((a, k) => a + counts[k], 0);
  if (total <= 0) return null;
  for (const k of ORIGIN_KINDS) if (counts[k] / total >= ORIGIN_DOMINANT) return k;
  return "mixed";
}

export const isSocialMetric = (v: unknown): v is SocialMetric => typeof v === "string" && (SOCIAL_METRICS as readonly string[]).includes(v);

/** The trade fields the figures read – a journal record or a `journal_docs.data` object (anything else is ignored). */
export interface MetricTrade {
  status?: unknown;
  r?: unknown;
  date?: unknown;
  followedPlan?: unknown;
  mistakes?: unknown;
  /** `{ kind }` of the journal record, or the kind alone. Absent = by hand. */
  origin?: unknown;
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
  /** Deepest drop of the running R sum in the window (≥ 0), `null` under `MIN_R_TRADES` R trades. */
  drawdownR: number | null;
  /** The R trades by where their records came from. */
  origins: Record<OriginKind, number>;
  /** The data class of the R trades, `null` without any. */
  origin: OriginClass | null;
  /** Weeks with at least one R trade. */
  weeks: number;
  eligible: boolean;
}

/** Deepest peak-to-trough drop of the running sum of `rs` (in the given order, start at 0). */
export function maxDrawdown(rs: readonly number[]): number {
  let cum = 0;
  let peak = 0;
  let dd = 0;
  for (const r of rs) {
    cum += r;
    if (cum > peak) peak = cum;
    if (peak - cum > dd) dd = peak - cum;
  }
  return dd;
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
  const timed: { at: number; r: number }[] = [];
  const origins: Record<OriginKind, number> = { api: 0, csv: 0, manual: 0, auto: 0 };
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
      timed.push({ at, r });
      origins[originOf(t.origin)]++;
      const w = weekIndex(at);
      weeks.set(w, (weeks.get(w) ?? 0) + r);
    }
    if (typeof t.followedPlan === "boolean") {
      planned++;
      const mistakes = Array.isArray(t.mistakes) ? t.mistakes.filter((m) => typeof m === "string" && m.trim()) : [];
      if (t.followedPlan && mistakes.length === 0) clean++;
    }
  }
  // the running sum needs the time order; equal stamps keep the journal's order (a stable sort)
  const rs = timed.sort((a, b) => a.at - b.at).map((x) => x.r);
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
    drawdownR: n >= MIN_R_TRADES ? round(maxDrawdown(rs), 2) : null,
    origins,
    origin: originClassOf(origins),
    weeks: weeks.size,
    eligible: n >= MIN_TRADES,
  };
}

/** All-time R figures of the closed trades of one setup (the optional numbers of a setup share). */
export function setupFigures(trades: readonly (MetricTrade & { setups?: unknown })[], setupId: string): { trades: number; winRate: number | null; expectancyR: number | null } {
  const rs: number[] = [];
  let n = 0;
  for (const t of trades) {
    if (t.status !== "closed" || !Array.isArray(t.setups) || !t.setups.includes(setupId)) continue;
    n++;
    if (fin(t.r)) rs.push(Math.max(-R_CAP, Math.min(R_CAP, t.r)));
  }
  const k = rs.length;
  return {
    trades: n,
    winRate: k >= MIN_R_TRADES ? round((rs.filter((r) => r > 0).length / k) * 100, 1) : null,
    expectancyR: k >= MIN_R_TRADES ? round(rs.reduce((a, b) => a + b, 0) / k, 2) : null,
  };
}

/** The value a metric ranks by (`null` = not enough data for it). */
export function metricValue(s: Pick<SocialStats, "expectancyR" | "discipline" | "consistency" | "winRate"> & { drawdownR?: number | null }, metric: SocialMetric | StatMetric): number | null {
  switch (metric) {
    case "drawdown":
      return s.drawdownR ?? null;
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

/**
 * Ranks by value; ties share the rank and are listed by more trades first, then id. `high` (the default): the higher
 * value is better; `low` (the drawdown): the smaller one.
 */
export function rankRows(rows: readonly RankInput[], order: "high" | "low" = "high"): RankedRow[] {
  const dir = order === "low" ? -1 : 1;
  const sorted = [...rows].filter((r) => fin(r.value)).sort((a, b) => dir * (b.value - a.value) || b.trades - a.trades || (a.userId < b.userId ? -1 : 1));
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
export const AGG_DECIMALS: Readonly<Record<StatMetric, number>> = { expectancy: 2, discipline: 0, consistency: 0, winrate: 0, drawdown: 1 };

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

/**
 * "Better than x %" (1–99) of `value` for `metric`: for a metric where more is better the share of the community below
 * the value, for the drawdown the share ABOVE it (a smaller drop is better).
 */
export function betterThanPct(metric: SocialMetric | StatMetric, value: number, q: Pick<Quantiles, "p10" | "p25" | "p50" | "p75" | "p90">): number {
  const p = percentileOf(value, q);
  return RANK_ORDER[metric] === "low" ? Math.max(1, Math.min(99, 100 - p)) : p;
}
