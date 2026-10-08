/**
 * Top-Trader-Kombi (ours, decision 5, 2026-10-08) — replaces the run rule "Top-Trader kaufen · Retail rot" as the graded
 * top-trader condition of the Einstiegs-Check. Four parts, each lit or unlit with its value; the more hold, the stronger:
 *
 * | part | long | short |
 * |---|---|---|
 * | `pos` Top-Trader Positionen | long share > `topPct` (64 %) | long share ≤ 100 − `topPct` (= > 64 % short) |
 * | `acc` Top-Trader Konten | long share > `topPct` | long share ≤ 100 − `topPct` |
 * | `retail` Retail (alle Konten) | long share FALLING vs one `retailPeriod` earlier ("Retail rot") | RISING ("Retail grün") |
 * | `zone` Premium/Discount | price in Discount (the check's zone) | price in Premium |
 *
 * Inputs: Binance futures data at the 5-minute period (`topLongShortPositionRatio`, `topLongShortAccountRatio`,
 * `globalLongShortAccountRatio`), so the live reading refreshes every 5 minutes. A series whose newest point is older than
 * two steps + 5 min is stale (no value). The ratios are snapshots at period boundaries, so "one hour earlier" is simply
 * the 5-minute point an hour before the newest one.
 *
 * Grading (`tradersPart` in `parts.ts`): grade = met / 4, score + weight × grade, a valid entry +1 strength from
 * `bonusParts` (3) met parts (with weight > 0). No top-trader data (other source, older than Binance's ~30-day window)
 * → the part has no data and is excluded (never a fail). Pure.
 */
import { tfSeconds, whaleCfgOf, type SignalCfg } from "./config";
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

/** The live (or back-dated) reading the combo is graded with. */
export interface TraderReading {
  /** ms of the newest point used */
  at: number;
  /** top-trader long share (positions / accounts), %; `null` = no fresh data */
  position: number | null;
  account: number | null;
  /** all-accounts long share now and one `period` earlier, %; change in pp */
  retail: number | null;
  retailPrev: number | null;
  retailChg: number | null;
  /** the comparison period (`retailPeriod`) */
  period: string;
  /** point spacing of the series used (ms) */
  step: number;
}

export const TRADER_STEP_MS = 5 * 60_000;
/** Newest point older than this many steps (+ 5 min publication slack) → stale. */
export const TRADER_FRESH_STEPS = 2;
const SLACK_MS = 5 * 60_000;

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
  return {
    at: Math.max(pos?.time ?? 0, acc?.time ?? 0, ret?.time ?? 0),
    position: pos?.longPct ?? null,
    account: acc?.longPct ?? null,
    retail: ret?.longPct ?? null,
    retailPrev: prev?.longPct ?? null,
    retailChg: ret && prev ? ret.longPct - prev.longPct : null,
    period: per === retailMs ? w.retailPeriod : periodName(per),
    step,
  };
}

const periodName = (ms: number): string => (ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : `${Math.round(ms / 60_000)}m`);

/** Group title of the condition (settings, explainer). */
export const TRADERS_TITLE = "Top-Trader-Kombi";
/** Row title per side. */
export const TRADERS_SIDE_TITLE = { long: "Top-Trader long · Retail rot", short: "Top-Trader short · Retail grün" } as const;
