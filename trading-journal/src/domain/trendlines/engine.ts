/**
 * The trendline engine (pure): pivots, candidate lines, break and retest on ONE value series. It is the algorithm of the
 * RSI trendlines of the box engine (`../boxes/rsiLines.ts`: pivots with `L` left / `R` right bars, pairs of the newest
 * pivots, a line must not be crossed between its points, touches, score) generalised so the same code runs on the price
 * (highs / lows, tolerances in ATR) and on the RSI (tolerances in points), plus the retest the old code did not have.
 *
 * No lookahead:
 * - a pivot at bar `i` needs `pivotR` bars to its right, so it is known at bar `i + pivotR`; a line is known at
 *   `confirmedAt = b.i + pivotR` and not before (the checks that void a pair read bars up to `confirmedAt` only);
 * - a break is a CLOSE beyond the line (wicks do not break), searched from the bar after `confirmedAt`;
 * - appending bars never changes a line found earlier (its points, slope, `confirmedAt`) – only `brokeAt` can appear.
 * The caller passes CLOSED candles only (`analyze.ts` filters).
 */
import type { RetestState, TrendKind, TrendLine, TrendPivot, TrendRetest } from "./types";

/** The series one engine run works on. Highs / lows / closes of the same length (RSI: all three are the RSI). */
export interface SeriesInput {
  hi: readonly number[];
  lo: readonly number[];
  close: readonly number[];
  /** first bar a pivot may sit on (warm-up of ATR / RSI) */
  first: number;
  /** tolerances at bar `i`, in value units */
  inner(i: number): number;
  brk(i: number): number;
  touch(i: number): number;
  retest(i: number): number;
  /** minimum |slope| (value units per bar) at bar `i` */
  minSlope(i: number): number;
  /** unit the height of a line is scored in (RSI 10 points, price 2 ATR) */
  scale(i: number): number;
  /** a line whose value at the newest bar fails this is dropped (RSI 3 … 97, price > 0) */
  plausible(v: number): boolean;
}

export interface EngineCfg {
  pivotL: number;
  pivotR: number;
  lookback: number;
  minGap: number;
  maxPivots: number;
  retestBars: number;
}

/** Value of a line at bar `i`. */
export const lineAt = (l: Pick<TrendLine, "a" | "slope">, i: number): number => l.a.v + l.slope * (i - l.a.i);

/** +1: the line is a resistance (price should stay below, a break goes up); −1: support. */
export const sideOf = (kind: TrendKind): 1 | -1 => (kind === "down" ? 1 : -1);

/**
 * Swing points of `x`: strictly beyond the `L` bars before, at least as far as the `R` bars after (`high`) or the
 * mirror. Only bars that have `R` bars to their right – a pivot exists once it is confirmed. Non-finite values are
 * skipped, in the middle and as neighbours.
 */
export function pivotsOf(x: readonly number[], L: number, R: number, high: boolean, from: number): TrendPivot[] {
  const out: TrendPivot[] = [];
  for (let i = Math.max(from, L); i < x.length - R; i++) {
    const v = x[i]!;
    if (!Number.isFinite(v)) continue;
    let ok = true;
    for (let k = i - L; k <= i + R && ok; k++) {
      if (k === i) continue;
      const w = x[k]!;
      if (!Number.isFinite(w)) continue;
      ok = high ? (k < i ? w < v : w <= v) : k < i ? w > v : w >= v;
    }
    if (ok) out.push({ i, v });
  }
  return out;
}

const score = (l: TrendLine, inp: SeriesInput): number => l.touches * 3 + (l.b.i - l.a.i) / 15 + Math.abs(l.a.v - l.b.v) / inp.scale(l.b.i);

/**
 * Every candidate line of `kind` (pairs of the newest pivots) with its break. `down` runs through pivot HIGHS, `up`
 * through pivot LOWS; the in-between check, the break and the retest read the closes.
 */
export function findLines(inp: SeriesInput, kind: TrendKind, cfg: EngineCfg): TrendLine[] {
  const n = inp.close.length;
  const sgn = sideOf(kind);
  const from = Math.max(inp.first, n - cfg.lookback);
  const piv = pivotsOf(kind === "down" ? inp.hi : inp.lo, cfg.pivotL, cfg.pivotR, kind === "down", from);
  const P = piv.slice(-cfg.maxPivots);
  const out: TrendLine[] = [];
  for (let p = 0; p < P.length; p++) {
    for (let q = p + 1; q < P.length; q++) {
      const a = P[p]!;
      const b = P[q]!;
      if (b.i - a.i < cfg.minGap) continue;
      const slope = (b.v - a.v) / (b.i - a.i);
      const min = inp.minSlope(b.i);
      // a resistance must fall, a support must rise – a (nearly) flat pair is a level, not a trendline
      if (kind === "down" ? slope > -min : slope < min) continue;
      const confirmedAt = b.i + cfg.pivotR;
      const line = { a, slope };
      let valid = true;
      for (let k = a.i + 1; k <= confirmedAt && valid; k++) {
        const c = inp.close[k]!;
        if (Number.isFinite(c) && sgn * (c - lineAt(line, k)) > inp.inner(k)) valid = false;
      }
      if (!valid) continue;
      let brokeAt: number | null = null;
      for (let k = confirmedAt + 1; k < n; k++) {
        const c = inp.close[k]!;
        if (Number.isFinite(c) && sgn * (c - lineAt(line, k)) > inp.brk(k)) {
          brokeAt = k;
          break;
        }
      }
      const end = brokeAt ?? n;
      let touches = 0;
      for (const pv of piv) if (pv.i >= a.i && pv.i < end && Math.abs(pv.v - lineAt(line, pv.i)) <= inp.touch(pv.i)) touches++;
      if (!inp.plausible(lineAt(line, n - 1))) continue;
      out.push({ kind, a, b, slope, touches, confirmedAt, brokeAt });
    }
  }
  return out;
}

/**
 * The newest unbroken line: the one with the newest second point, then the better score, then the longer one. Parallel
 * lines (same slope, different offset) are told apart by exactly this order – never by chance.
 */
export function pickActive(lines: readonly TrendLine[], inp: SeriesInput): TrendLine | null {
  const open = lines.filter((l) => l.brokeAt == null);
  open.sort((x, y) => y.b.i - x.b.i || score(y, inp) - score(x, inp) || x.a.i - y.a.i || x.slope - y.slope);
  return open[0] ?? null;
}

/** Broken lines, best first: the better score, then the newer break, then the longer line. */
export function sortBroken(lines: readonly TrendLine[], inp: SeriesInput): TrendLine[] {
  const done = lines.filter((l) => l.brokeAt != null);
  done.sort((x, y) => score(y, inp) - score(x, inp) || (y.brokeAt as number) - (x.brokeAt as number) || x.a.i - y.a.i || x.slope - y.slope);
  return done;
}

/**
 * What the price did at a broken line after the break, on the closed bars `brokeAt + 1 … n − 1`:
 * - touch  – after a close clear of the line (further than the retest tolerance), the wick (RSI: the value) comes back
 *            within the retest tolerance of the line, inside `retestBars` of the break;
 * - held   – a candle closes beyond the line again (the touch candle itself counts);
 * - failed – a candle closes back on the old side by more than the break tolerance (also after a held retest);
 * - expired – no touch within the window.
 */
export function retestOf(inp: SeriesInput, line: TrendLine, cfg: Pick<EngineCfg, "retestBars">): TrendRetest {
  const n = inp.close.length;
  const sgn = sideOf(line.kind);
  const broke = line.brokeAt;
  const none: TrendRetest = { state: "none", touchedAt: null, heldAt: null, failedAt: null };
  if (broke == null) return none;
  let touchedAt: number | null = null;
  let heldAt: number | null = null;
  let failedAt: number | null = null;
  // a retest is a RETURN: the price must first have closed clear of the line (further than the retest tolerance) – the
  // candle after a hesitant break that merely stays next to the line is no retest
  let away = sgn * (inp.close[broke]! - lineAt(line, broke)) > inp.retest(broke);
  for (let k = broke + 1; k < n; k++) {
    const c = inp.close[k]!;
    if (!Number.isFinite(c)) continue;
    const l = lineAt(line, k);
    if (sgn * (c - l) < -inp.brk(k)) {
      failedAt = k;
      break;
    }
    if (touchedAt == null && away && k - broke <= cfg.retestBars) {
      // the extreme on the old side of the price: the low of a break upward, the high of a break downward
      const reach = sgn > 0 ? inp.lo[k]! : inp.hi[k]!;
      if (Number.isFinite(reach) && sgn * (reach - l) <= inp.retest(k)) touchedAt = k;
    }
    if (touchedAt != null && heldAt == null && sgn * (c - l) > 0) heldAt = k;
    if (sgn * (c - l) > inp.retest(k)) away = true;
  }
  let state: RetestState;
  if (failedAt != null) state = "failed";
  else if (heldAt != null) state = "held";
  else if (touchedAt != null) state = "pending";
  else state = n - 1 - broke > cfg.retestBars ? "expired" : "none";
  return { state, touchedAt, heldAt, failedAt };
}
