/**
 * Weekday × time-of-day heatmap (P03): 7 weekdays (Mo … So, local) × 12 two-hour blocks (local), each cell an
 * `aggregate()` of its trades plus Ø R. `best` / `worst` only among cells with at least `HEAT_MIN_N` trades.
 */
import type { EnrichedTrade } from "../types";
import { aggregate, type Agg } from "../agg";
import { tradeTime } from "@/lib/dates";
import { breakdownUnit, unitValue } from "./breakdowns";
import { finite, mean } from "./stats";

export const HEAT_MIN_N = 3;
export const HEAT_DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
export const HEAT_HOURS = Array.from({ length: 12 }, (_, i) => String(i * 2).padStart(2, "0"));

export interface HeatCell {
  /** row-major index (day × 12 + block) */
  i: number;
  day: number;
  block: number;
  trades: EnrichedTrade[];
  g: Agg;
  /** Ø in the grid's unit (R or money), null without trades */
  value: number | null;
}

export interface HeatGrid {
  unit: "R" | "money";
  cells: HeatCell[];
  /** largest |value| among cells with trades (colour scale) */
  maxAbs: number;
  best: HeatCell | null;
  worst: HeatCell | null;
}

export function heatGrid(closed: readonly EnrichedTrade[]): HeatGrid {
  const unit = breakdownUnit(closed);
  const buckets: EnrichedTrade[][] = Array.from({ length: 7 * 12 }, () => []);
  for (const t of closed) {
    const d = tradeTime(t);
    const day = (d.getDay() + 6) % 7;
    const block = Math.floor(d.getHours() / 2);
    buckets[day * 12 + block]!.push(t);
  }
  let maxAbs = 0;
  let best: HeatCell | null = null;
  let worst: HeatCell | null = null;
  const cells = buckets.map((trades, i) => {
    const value = trades.length ? mean(finite(trades.map((t) => unitValue(t, unit)))) : null;
    const cell: HeatCell = { i, day: Math.floor(i / 12), block: i % 12, trades, g: aggregate(trades), value };
    if (value != null) maxAbs = Math.max(maxAbs, Math.abs(value));
    if (value != null && trades.length >= HEAT_MIN_N) {
      if (value > 0 && (!best || value > best.value!)) best = cell;
      if (value < 0 && (!worst || value < worst.value!)) worst = cell;
    }
    return cell;
  });
  return { unit, cells, maxAbs, best, worst };
}
