/**
 * The numbers over the hits (F19): shares up / down with a Wilson interval, the spread of the move after the horizon, the
 * typical excursions, the first touch of ±1 unit, and the counter-examples – every hit that went against the majority.
 * Pure; the same hits always give the same numbers.
 */
import { quantileSorted } from "../analytics/stats";
import { wilson } from "../insights/shared";
import type { Baseline, Outcome, Share, SimilarHit, SimilarSummary, Spread } from "./types";

export function shareOf(k: number, n: number): Share {
  const w = wilson(k, n);
  return { k, n, share: n > 0 ? k / n : 0, lo: w.lo, hi: w.hi };
}

const sorted = (xs: readonly number[]): number[] => [...xs].sort((a, b) => a - b);

export function median(xs: readonly number[]): number | null {
  return quantileSorted(sorted(xs), 0.5);
}

export function spreadOf(xs: readonly number[]): Spread {
  const s = sorted(xs);
  const n = s.length;
  const mean = n ? s.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  return { median: quantileSorted(s, 0.5) ?? 0, q25: quantileSorted(s, 0.25) ?? 0, q75: quantileSorted(s, 0.75) ?? 0, mean, sd };
}

/** The yardstick: how the same horizon went after EVERY comparable candle of the period (overlapping courses, so strongly dependent). */
export function baselineOf(all: readonly Outcome[]): Baseline | null {
  if (!all.length) return null;
  return { n: all.length, up: shareOf(all.filter((o) => o.dir === "up").length, all.length), medianChange: median(all.map((o) => o.change)) ?? 0 };
}

export function summarize(hits: readonly SimilarHit[]): SimilarSummary {
  const n = hits.length;
  const outs = hits.map((h) => h.outcome);
  const up = outs.filter((o) => o.dir === "up").length;
  const down = outs.filter((o) => o.dir === "down").length;
  const expectation = up > down ? "up" : down > up ? "down" : null;
  const against = expectation === "up" ? "down" : expectation === "down" ? "up" : null;
  const counters = against ? hits.filter((h) => h.outcome.dir === against).sort((a, b) => Math.abs(b.outcome.change) - Math.abs(a.outcome.change) || b.time - a.time) : [];
  const barsOf = (dir: "up" | "down"): number | null => median(outs.filter((o) => o.first === dir && o.firstBars != null).map((o) => o.firstBars as number));
  const touch = (k: "up" | "down" | "both" | "none"): number => (n ? outs.filter((o) => o.first === k).length / n : 0);
  return {
    n,
    up: shareOf(up, n),
    down: shareOf(down, n),
    flat: shareOf(n - up - down, n),
    change: spreadOf(outs.map((o) => o.change)),
    medianUp: median(outs.map((o) => o.up)) ?? 0,
    medianDown: median(outs.map((o) => o.down)) ?? 0,
    expectation,
    counters,
    medianSetback: expectation ? (median(outs.map((o) => (expectation === "up" ? o.down : o.up))) ?? 0) : null,
    touch: { up: touch("up"), down: touch("down"), both: touch("both"), none: touch("none"), medianBarsUp: barsOf("up"), medianBarsDown: barsOf("down") },
  };
}
