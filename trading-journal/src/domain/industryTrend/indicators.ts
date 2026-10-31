/**
 * The indicators of the Branchen-Trend rule, written to do EXACTLY what the lab script does (`megatest.py`, "schnelle
 * Indikatoren – gleiche Semantik wie industry_trend.indicators"): same warm-up (NaN until a window is full), same order of
 * the sliding sums (so the float results are the same, not just close), population standard deviation.
 *
 * Pure: arrays in, arrays out. `NaN` is "not defined yet".
 */

/** Exponential average with `alpha = 2 / (span + 1)`, seeded with the first value (no SMA seed, no NaN at the start). */
export function ema(xs: ArrayLike<number>, span: number): Float64Array {
  const a = 2 / (span + 1);
  const out = new Float64Array(xs.length);
  let e = 0;
  for (let t = 0; t < xs.length; t++) {
    const x = xs[t]!;
    e = t === 0 ? x : a * x + (1 - a) * e;
    out[t] = e;
  }
  return out;
}

/** Highest (`isMax`) or lowest value of the last `w` values INCLUDING the current one; defined from index `w - 1`. */
export function rollExtreme(xs: ArrayLike<number>, w: number, isMax: boolean): Float64Array {
  const n = xs.length;
  const out = new Float64Array(n);
  const dq = new Int32Array(n + 1);
  let head = 0;
  let tail = 0;
  for (let t = 0; t < n; t++) {
    const x = xs[t]!;
    while (tail > head && (isMax ? xs[dq[tail - 1]!]! <= x : xs[dq[tail - 1]!]! >= x)) tail--;
    dq[tail++] = t;
    if (dq[head]! <= t - w) head++;
    out[t] = t >= w - 1 ? xs[dq[head]!]! : NaN;
  }
  return out;
}

/**
 * Mean of the last `w` values of `chg`, where `chg[0]` is NaN (there is no change on the first day), so the first defined
 * value stands at index `w`.
 */
export function rollMeanChange(chg: ArrayLike<number>, w: number): Float64Array {
  const out = new Float64Array(chg.length);
  let s = 0;
  for (let t = 0; t < chg.length; t++) {
    if (t >= 1) s += chg[t]!;
    if (t > w) s -= chg[t - w]!;
    out[t] = t >= w ? s / w : NaN;
  }
  return out;
}

/** Population standard deviation (divisor `w`) of the last `w` values; defined from index `w - 1`. */
export function rollStd0(xs: ArrayLike<number>, w: number): Float64Array {
  const out = new Float64Array(xs.length);
  let s = 0;
  let s2 = 0;
  for (let t = 0; t < xs.length; t++) {
    const x = xs[t]!;
    s += x;
    s2 += x * x;
    if (t >= w) {
      const y = xs[t - w]!;
      s -= y;
      s2 -= y * y;
    }
    if (t >= w - 1) {
      const m = s / w;
      const v = s2 / w - m * m;
      out[t] = v > 0 ? Math.sqrt(v) : 0;
    } else out[t] = NaN;
  }
  return out;
}
