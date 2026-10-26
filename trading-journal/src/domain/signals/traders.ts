/**
 * Top-Trader-Kombi (ours, decision 5, 2026-10-08) — replaces the run rule "Top-Trader kaufen · Retail rot" as the graded
 * top-trader condition of the Einstiegs-Check. Four parts, each lit or unlit with its value; the more hold, the stronger:
 *
 * | part | long | short |
 * |---|---|---|
 * | `pos` Top-Trader Positionen | long share > `topPct` (64 %) | long share ≤ 100 − `topPct` (= > 64 % short) |
 * | `acc` Top-Trader Konten | long share > `topPct` | long share ≤ 100 − `topPct` |
 * | `retail` Whale–Retail-Delta ("Retail rot") | delta < `deltaRed` (0 pp) OR fell ≥ `deltaFall` (1 pp) over `deltaWindow` (1h) | delta > −`deltaRed` OR rose ≥ `deltaFall` ("Retail grün") |
 * | `zone` Premium/Discount | price in Discount (the check's zone) | price in Premium |
 *
 * Whale–Retail-Delta (user decision 2026-10-08 15:45, "Delta wie bei Hyblock") = Binance top-trader ACCOUNTS long %
 * (`topLongShortAccountRatio`, the top 20 % by margin balance) − ALL-accounts long % (`globalLongShortAccountRatio`), on
 * the 5-min series. Honest note: these are Binance's cohorts, not Hyblock's own "whale" / "retail" cohorts, so the value
 * can differ slightly from Hyblock's "Whale vs Retail Delta" (same sign and direction in practice).
 *
 * Inputs: Binance futures data at the 5-minute period (`topLongShortPositionRatio`, `topLongShortAccountRatio`,
 * `globalLongShortAccountRatio`), so the live reading refreshes every 5 minutes. A series whose newest point is older than
 * two steps + 5 min is stale (no value). The ratios are snapshots at period boundaries, so "one hour earlier" is simply
 * the 5-minute point an hour before the newest one. The former retail comparison (`retail` / `retailPrev` / `retailChg`
 * over `retailPeriod`) is still computed for compatibility (stored snapshots, the other journal) but no longer grades.
 *
 * Grading (`tradersPart` in `parts.ts`): grade = met / 4, score + weight × grade, a valid entry +1 strength from
 * `bonusParts` (3) met parts (with weight > 0). No top-trader data (other source, older than Binance's ~30-day window)
 * → the part has no data and is excluded (never a fail). Pure.
 */
import { tfSeconds, whaleCfgOf, type Side, type SignalCfg, type WhaleCfg } from "./config";
import type { RatioSample } from "./whale";

/** The three 5-minute long-share series (time ms at the period boundary, long %). */
export interface TraderSeries {
  /** top traders by position */
  position: readonly RatioSample[];
  /** top traders by account */
  account: readonly RatioSample[];
  /** all accounts ("retail") */
  retail: readonly RatioSample[];
  /** spacing of the points in ms (default 5 min; a coarser fallback series sets its period) */
  step?: number;
}

/** One point of the Whale–Retail-Delta history (ms at the period boundary, pp). */
export interface DeltaPoint {
  time: number;
  delta: number;
}

/** The live (or back-dated) reading the combo is graded with. */
export interface TraderReading {
  /** ms of the newest point used */
  at: number;
  /** top-trader long share (positions / accounts), %; `null` = no fresh data */
  position: number | null;
  account: number | null;
  /** all-accounts long share now and one `period` earlier, %; change in pp (legacy comparison, kept for compatibility) */
  retail: number | null;
  retailPrev: number | null;
  retailChg: number | null;
  /** the legacy comparison period (`retailPeriod`) */
  period: string;
  /** point spacing of the series used (ms) */
  step: number;
  /** Whale–Retail-Delta now: top-trader accounts long % − all-accounts long %, pp (`null` = one of the two has no fresh point) */
  delta?: number | null;
  /** the delta one `deltaWindow` earlier and the change since (pp); `null` without that older point */
  deltaPrev?: number | null;
  deltaChg?: number | null;
  /** the window of the change (`deltaWindow`, e.g. `1h`) */
  deltaWindow?: string;
  /** the last `DELTA_SPARK_POINTS` delta points up to `at` (oldest first) — the scorecard sparkline */
  deltaSeries?: DeltaPoint[];
}

export const TRADER_STEP_MS = 5 * 60_000;
/** Newest point older than this many steps (+ 5 min publication slack) → stale. */
export const TRADER_FRESH_STEPS = 2;
const SLACK_MS = 5 * 60_000;
/** Points of the delta sparkline (the last hour at the 5-min step). */
export const DELTA_SPARK_POINTS = 12;
/** pp differences rounded to 1e-6 (no float noise at a threshold: 65,6 − 64,6 is exactly 1). */
const pp6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/** Newest finite point at or before `atMs`. */
function latest(s: readonly RatioSample[], atMs: number): RatioSample | null {
  let best: RatioSample | null = null;
  for (const p of s) if (p.time <= atMs && Number.isFinite(p.longPct) && (!best || p.time > best.time)) best = p;
  return best;
}

/** Point at `t` (exact), else the newest point within (t − tolerance, t]. */
function pointAt(s: readonly RatioSample[], t: number, tolerance: number): RatioSample | null {
  let best: RatioSample | null = null;
  for (const p of s) if (p.time <= t && p.time > t - tolerance && Number.isFinite(p.longPct) && (!best || p.time > best.time)) best = p;
  return best;
}

/** Window of the delta change in ms (`deltaWindow`, at least one step). */
export function deltaWindowMs(w: Pick<WhaleCfg, "deltaWindow">, step: number = TRADER_STEP_MS): number {
  return Math.max(step, tfSeconds(w.deltaWindow) * 1000 || 0);
}

/**
 * History the reading needs behind `atMs` (ms): the legacy retail comparison, the delta window and the sparkline — the
 * market side fetches at least this much for a back-dated reading.
 */
export function traderLookbackMs(cfg: Pick<SignalCfg, "whale">, step: number = TRADER_STEP_MS): number {
  const w = whaleCfgOf(cfg);
  return Math.max(tfSeconds(w.retailPeriod) * 1000 || 0, deltaWindowMs(w, step), DELTA_SPARK_POINTS * step);
}

/**
 * Whale–Retail-Delta points: for every account point at or before `atMs` with an all-accounts point on the same boundary
 * (tolerance one step), `account − retail` in pp. Oldest first.
 */
export function deltaSeriesOf(series: Pick<TraderSeries, "account" | "retail">, atMs: number, step: number = TRADER_STEP_MS): DeltaPoint[] {
  const retail = new Map<number, number>();
  for (const p of series.retail) if (p.time <= atMs && Number.isFinite(p.longPct)) retail.set(p.time, p.longPct);
  const out: DeltaPoint[] = [];
  for (const a of series.account) {
    if (a.time > atMs || !Number.isFinite(a.longPct)) continue;
    let r = retail.get(a.time);
    if (r === undefined) r = pointAt(series.retail, a.time, step)?.longPct;
    if (r === undefined) continue;
    out.push({ time: a.time, delta: pp6(a.longPct - r) });
  }
  out.sort((x, y) => x.time - y.time);
  // one point per boundary (a duplicate boundary keeps the later entry)
  return out.filter((p, i) => i === out.length - 1 || out[i + 1]!.time !== p.time);
}

/**
 * Reading at `atMs` (only points at or before it). `null` when the condition is off or none of the three series has a
 * fresh point.
 */
export function traderReading(series: TraderSeries | null | undefined, cfg: Pick<SignalCfg, "whale">, atMs: number): TraderReading | null {
  const w = whaleCfgOf(cfg);
  if (!w.on || !series || !Number.isFinite(atMs)) return null;
  const step = series.step && series.step > 0 ? series.step : TRADER_STEP_MS;
  const fresh = (p: RatioSample | null): RatioSample | null => (p && atMs - p.time <= TRADER_FRESH_STEPS * step + SLACK_MS ? p : null);
  const pos = fresh(latest(series.position, atMs));
  const acc = fresh(latest(series.account, atMs));
  const ret = fresh(latest(series.retail, atMs));
  if (!pos && !acc && !ret) return null;
  const retailMs = tfSeconds(w.retailPeriod) * 1000 || TRADER_STEP_MS;
  const per = Math.max(step, retailMs);
  const prev = ret ? pointAt(series.retail, ret.time - per, step) : null;

  // Whale–Retail-Delta: accounts − all accounts on the newest fresh boundary both series share
  const all = deltaSeriesOf(series, atMs, step);
  const newest = all.length ? all[all.length - 1]! : null;
  const now = newest && acc && ret && atMs - newest.time <= TRADER_FRESH_STEPS * step + SLACK_MS ? newest : null;
  const win = deltaWindowMs(w, step);
  let deltaPrev: number | null = null;
  if (now) {
    const t = now.time - win;
    let best: DeltaPoint | null = null;
    for (const p of all) if (p.time <= t && p.time > t - step && (!best || p.time > best.time)) best = p;
    deltaPrev = best?.delta ?? null;
  }
  const spark = now ? all.filter((p) => p.time <= now.time).slice(-DELTA_SPARK_POINTS) : [];
  return {
    at: Math.max(pos?.time ?? 0, acc?.time ?? 0, ret?.time ?? 0),
    position: pos?.longPct ?? null,
    account: acc?.longPct ?? null,
    retail: ret?.longPct ?? null,
    retailPrev: prev?.longPct ?? null,
    retailChg: ret && prev ? ret.longPct - prev.longPct : null,
    period: per === retailMs ? w.retailPeriod : periodName(per),
    step,
    delta: now?.delta ?? null,
    deltaPrev,
    deltaChg: now && deltaPrev != null ? pp6(now.delta - deltaPrev) : null,
    deltaWindow: win === tfSeconds(w.deltaWindow) * 1000 ? w.deltaWindow : periodName(win),
    deltaSeries: spark,
  };
}

const periodName = (ms: number): string => (ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : `${Math.round(ms / 60_000)}m`);

/** The delta of a reading: the stored field, else `account − retail` (the definition) for hand-built readings. */
export function readingDelta(r: Pick<TraderReading, "delta" | "account" | "retail"> | null | undefined): number | null {
  if (!r) return null;
  if (r.delta !== undefined) return r.delta;
  return r.account != null && r.retail != null ? pp6(r.account - r.retail) : null;
}

/**
 * "Retail rot" (long) / "Retail grün" (short) by the delta rule: long = delta < `deltaRed` OR the delta fell by at least
 * `deltaFall` pp over the window; short mirrored (delta > −`deltaRed` OR rose by at least `deltaFall`). `null` = keine
 * Daten (no delta and no change).
 */
export function deltaMet(side: Side, delta: number | null, deltaChg: number | null, w: Pick<WhaleCfg, "deltaRed" | "deltaFall">): boolean | null {
  if (delta == null && deltaChg == null) return null;
  const long = side === "long";
  const level = delta == null ? false : long ? delta < w.deltaRed : delta > -w.deltaRed;
  const move = deltaChg == null ? false : long ? deltaChg < 0 && deltaChg <= -w.deltaFall : deltaChg > 0 && deltaChg >= w.deltaFall;
  return level || move;
}

/** Group title of the condition (settings, explainer). */
export const TRADERS_TITLE = "Top-Trader-Kombi";
/** Row title per side. */
export const TRADERS_SIDE_TITLE = { long: "Top-Trader long · Retail rot", short: "Top-Trader short · Retail grün" } as const;
