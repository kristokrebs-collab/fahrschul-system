/**
 * Divergences (ours, decision 10, 2026-10-08): regular and hidden, bullish and bearish, of RSI 14 and WaveTrend wt1
 * against price, per ladder timeframe — MCB / WeloTrades style (oscillator fractals, price compared at the fractal bars).
 *
 * - Pivot (fractal) on the oscillator: lower (higher) than the `left` bars before and not above (below) the `right` bars
 *   after it; it is known `right` bars later (the confirmation bar). MCB uses 2 / 2.
 * - The newer pivot is compared with the previous pivot of the same kind that passed the same filter, `rangeMin` …
 *   `rangeMax` bars earlier (`midline`: bullish pivots below the midline — wt1 < 0, RSI < 50 — bearish above):
 *   - regular bullish: price lower low (bar low), oscillator higher low → reversal up;
 *   - hidden bullish: price higher low, oscillator lower low → continuation up;
 *   - regular bearish: price higher high, oscillator lower high; hidden bearish: price lower high, oscillator higher high.
 * - State: `provisional` while the confirmation bar is the forming candle, `confirmed` after its close, `strong` after
 *   `strongCloses` closes (counting the confirmation bar's own close) with the pivot held (bullish: no later close below
 *   the pivot bar's low; bearish: none above its high). A broken pivot ends the divergence.
 * - Active (counts in the check): held and confirmed at most `maxAge` bars ago.
 * Pure; the chart draws `from` → `to` on price (`price`) and in the oscillator pane (`osc`).
 */
import type { DivCfg } from "./config";
import type { Bar } from "./indicators";
import type { SignalState } from "./state";

export type DivOsc = "rsi" | "wt";
export type DivKind = "regular" | "hidden";

export interface DivPivot {
  /** bar index in the evaluated series */
  index: number;
  /** open time of the bar, unix SECONDS */
  t: number;
  /** bar low (bullish) / high (bearish) */
  price: number;
  /** oscillator value at the pivot */
  osc: number;
}

export interface Divergence {
  osc: DivOsc;
  kind: DivKind;
  /** 1 bullish, −1 bearish */
  dir: 1 | -1;
  /** the earlier and the newer pivot (chart line) */
  from: DivPivot;
  to: DivPivot;
  /** index of the confirmation bar (`to.index + right`) */
  at: number;
  /** bars since the confirmation bar (0 = the newest bar) */
  barsAgo: number;
  state: SignalState;
  /** the pivot held since (bullish: no close below its low) */
  held: boolean;
  /** counts in the check: held and `barsAgo ≤ maxAge` */
  active: boolean;
}

export interface TfDivergences {
  /** every divergence of the evaluated window, oldest first (chart lines) */
  all: Divergence[];
  /** active bullish / bearish ones, newest first */
  long: Divergence[];
  short: Divergence[];
}

/** Oscillator midline per kind (the `midline` filter). */
export const DIV_MIDLINE: Readonly<Record<DivOsc, number>> = { rsi: 50, wt: 0 };

function isPivot(x: readonly number[], i: number, left: number, right: number, low: boolean): boolean {
  const v = x[i]!;
  if (!Number.isFinite(v)) return false;
  for (let k = i - left; k < i; k++) {
    const y = x[k]!;
    if (!Number.isFinite(y) || (low ? !(v < y) : !(v > y))) return false;
  }
  for (let k = i + 1; k <= i + right; k++) {
    const y = x[k]!;
    if (!Number.isFinite(y) || (low ? !(v <= y) : !(v >= y))) return false;
  }
  return true;
}

/**
 * Divergences of one oscillator against price. `forming` = the last bar is the running candle; `strongCloses` as in
 * `state.ts`. Oldest first.
 */
export function findDivergences(bars: readonly Bar[], x: readonly number[], osc: DivOsc, cfg: DivCfg, forming: boolean, strongCloses: number): Divergence[] {
  const n = bars.length;
  const out: Divergence[] = [];
  const { left, right, rangeMin, rangeMax } = cfg;
  if (n < left + right + 2) return out;
  const mid = DIV_MIDLINE[osc];
  const lastClosed = forming ? n - 2 : n - 1;
  // suffix extremes of the closed closes (pivot held)
  const minAfter = new Array<number>(n + 1).fill(Infinity);
  const maxAfter = new Array<number>(n + 1).fill(-Infinity);
  for (let i = lastClosed; i >= 0; i--) {
    minAfter[i] = Math.min(minAfter[i + 1]!, bars[i]!.c);
    maxAfter[i] = Math.max(maxAfter[i + 1]!, bars[i]!.c);
  }
  let prevLow = -1;
  let prevHigh = -1;
  for (let p = left; p + right < n; p++) {
    for (const low of [true, false]) {
      if (!isPivot(x, p, left, right, low)) continue;
      const v = x[p]!;
      if (cfg.midline && (low ? !(v < mid) : !(v > mid))) continue;
      const prev = low ? prevLow : prevHigh;
      if (low) prevLow = p;
      else prevHigh = p;
      if (prev < 0) continue;
      const gap = p - prev;
      if (gap < rangeMin || gap > rangeMax) continue;
      const pa = low ? bars[prev]!.l : bars[prev]!.h;
      const pb = low ? bars[p]!.l : bars[p]!.h;
      const oa = x[prev]!;
      let kind: DivKind | null = null;
      if (low) {
        if (pb < pa && v > oa) kind = "regular";
        else if (cfg.hidden && pb > pa && v < oa) kind = "hidden";
      } else {
        if (pb > pa && v < oa) kind = "regular";
        else if (cfg.hidden && pb < pa && v > oa) kind = "hidden";
      }
      if (!kind) continue;
      const at = p + right;
      const barsAgo = n - 1 - at;
      const provisional = forming && at === n - 1;
      const held = low ? minAfter[p + 1]! >= pb : maxAfter[p + 1]! <= pb;
      const closes = provisional ? 0 : lastClosed - at + 1;
      const state: SignalState = provisional ? "provisional" : held && closes >= strongCloses ? "strong" : "confirmed";
      out.push({
        osc,
        kind,
        dir: low ? 1 : -1,
        from: { index: prev, t: bars[prev]!.t, price: pa, osc: oa },
        to: { index: p, t: bars[p]!.t, price: pb, osc: v },
        at,
        barsAgo,
        state,
        held,
        active: held && barsAgo <= cfg.maxAge,
      });
    }
  }
  return out;
}

/** Both oscillators of one timeframe (per `cfg.rsi` / `cfg.wt`), merged oldest first; active lists newest first. */
export function tfDivergences(bars: readonly Bar[], rsi: readonly number[], wt1: readonly number[], cfg: DivCfg, forming: boolean, strongCloses: number): TfDivergences {
  const all: Divergence[] = [];
  if (cfg.rsi) all.push(...findDivergences(bars, rsi, "rsi", cfg, forming, strongCloses));
  if (cfg.wt) all.push(...findDivergences(bars, wt1, "wt", cfg, forming, strongCloses));
  all.sort((a, b) => a.at - b.at || a.to.index - b.to.index || (a.osc < b.osc ? -1 : a.osc > b.osc ? 1 : 0));
  const act = all.filter((d) => d.active).reverse();
  return { all, long: act.filter((d) => d.dir === 1), short: act.filter((d) => d.dir === -1) };
}

/** Grade of a kind: regular 0.8, hidden 0.5 (× ½ while provisional). */
const hitGrade = (d: Divergence): number => (d.kind === "regular" ? 0.8 : 0.5) * (d.state === "provisional" ? 0.5 : 1);

/**
 * Grade 0 … 1 of one timeframe's active divergences of a direction: the best oscillator (regular 0.8, hidden 0.5,
 * provisional ½) + 0.2 when the other oscillator shows one too (regular on RSI and wt1 = 1).
 */
export function divGrade(hits: readonly Divergence[]): number {
  let rsi = 0;
  let wt = 0;
  for (const d of hits) {
    const g = hitGrade(d);
    if (d.osc === "rsi") rsi = Math.max(rsi, g);
    else wt = Math.max(wt, g);
  }
  return Math.min(1, Math.max(rsi, wt) + (rsi > 0 && wt > 0 ? 0.2 : 0));
}
