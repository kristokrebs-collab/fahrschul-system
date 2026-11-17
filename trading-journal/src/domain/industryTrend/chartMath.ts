/**
 * The numbers behind the three result charts (scatter, histogram, fan) – pure, so they can be tested without a canvas.
 */

/** Equal-width histogram of `values` between `lo` and `hi` (values outside are clamped into the end bins). */
export function histogram(values: readonly number[], bins: number, lo: number, hi: number): number[] {
  const out = new Array<number>(bins).fill(0);
  if (!(hi > lo) || bins < 1) return out;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const k = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)));
    out[k]! += 1;
  }
  return out;
}

/** Common range of several lists, widened a little; a list without finite values gives `[0, 1]`. */
export function rangeOf(lists: readonly (readonly number[])[], pad = 0.05): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const l of lists) for (const v of l) if (Number.isFinite(v)) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi === lo) return [lo - 0.5, hi + 0.5];
  const w = (hi - lo) * pad;
  return [lo - w, hi + w];
}

/** Share (0…1) of the sampled variants whose end-test Sharpe is below their selection Sharpe – the points under the diagonal. */
export function shareBelowDiagonal(points: readonly (readonly [number, number])[]): number {
  if (!points.length) return 0;
  return points.filter(([sel, end]) => end < sel).length / points.length;
}

/** Gridlines of a log axis: the usual 0.5×, 1×, 2×, 4× … inside `[lo, hi]`. */
export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let k = -4; k <= 12; k++) {
    const v = 2 ** k;
    if (v >= lo && v <= hi) out.push(v);
  }
  return out;
}

/** `1 − (1 − t)⁴`: fast start, soft landing (the drawing of the fan). */
export const easeOutQuart = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 4;

/** Index of the fan's point nearest to a horizontal position (0…1 of the plot width). */
export function nearestIndex(frac: number, n: number): number {
  if (n < 2) return 0;
  return Math.min(n - 1, Math.max(0, Math.round(frac * (n - 1))));
}
