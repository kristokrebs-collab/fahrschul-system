/**
 * Indicator series for the rule blocks (pure). Every value at index i uses bars ≤ i only. Where the app already has the
 * indicator (`@/domain/signals`: EMA / SMA / RSI / WaveTrend / MCB events / premium-discount) the blocks reuse it; the
 * rest (MACD, Bollinger, percent rank, the per-bar premium/discount series) lives here.
 */
import { ema, rolling, sma, type Bar } from "../../signals/indicators";
import { FALSE, TRUE, UNKNOWN, type Tri } from "./types";

/** MACD line, signal line and histogram (EMA seeded with the first value like the app's `ema`). */
export function macdSeries(close: readonly number[], fast: number, slow: number, signal: number): { macd: number[]; sig: number[]; hist: number[] } {
  const f = ema(close, fast);
  const s = ema(close, slow);
  const macd = close.map((_, i) => f[i]! - s[i]!);
  const sig = ema(macd, signal);
  return { macd, sig, hist: macd.map((m, i) => m - sig[i]!) };
}

/** Bollinger bands: SMA(len) ± mult × population standard deviation (TradingView's `ta.bb`). NaN until `len` bars. */
export function bollingerSeries(close: readonly number[], len: number, mult: number): { mid: number[]; upper: number[]; lower: number[]; width: number[] } {
  const n = close.length;
  const mid = sma(close, len);
  const upper: number[] = new Array(n).fill(NaN);
  const lower: number[] = new Array(n).fill(NaN);
  const width: number[] = new Array(n).fill(NaN);
  for (let i = len - 1; i < n; i++) {
    const m = mid[i]!;
    if (!Number.isFinite(m)) continue;
    let v = 0;
    for (let k = i - len + 1; k <= i; k++) v += (close[k]! - m) ** 2;
    const sd = Math.sqrt(v / len);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
    width[i] = m !== 0 ? (upper[i]! - lower[i]!) / Math.abs(m) : NaN;
  }
  return { mid, upper, lower, width };
}

/**
 * Percent rank of x[i] among the last `lookback` values ending at i (inclusive): the share of the OTHER values of that
 * window that are strictly below x[i], in percent (a flat series ranks 0, a new high ranks 100). NaN until `lookback`
 * finite values exist.
 */
export function percentRank(x: readonly number[], lookback: number): number[] {
  const n = x.length;
  const out: number[] = new Array(n).fill(NaN);
  for (let i = lookback - 1; i < n; i++) {
    const v = x[i]!;
    if (!Number.isFinite(v)) continue;
    let lt = 0;
    let ok = true;
    for (let k = i - lookback + 1; k <= i; k++) {
      const w = x[k]!;
      if (!Number.isFinite(w)) {
        ok = false;
        break;
      }
      if (w < v) lt++;
    }
    if (ok) out[i] = (lt / Math.max(1, lookback - 1)) * 100;
  }
  return out;
}

/**
 * Position (0 … 1) of the close inside the LuxAlgo swing range at EVERY bar – the per-bar version of `luxZone`
 * (`@/domain/signals/zones`): pivots of `size` bars (right side only, so a pivot is known `size` bars later), the range
 * trails the extremes since the last confirmed swing. `pos[i]` equals `luxZone(bars.slice(0, i + 1), size).pos`
 * (tested). NaN while there is no range yet.
 */
export function luxZoneSeries(bars: readonly Bar[], size: number): Float64Array {
  const n = bars.length;
  const pos = new Float64Array(n).fill(NaN);
  const rh = rolling(
    bars.map((b) => b.h),
    size,
    true,
  );
  const rl = rolling(
    bars.map((b) => b.l),
    size,
    false,
  );
  let leg = 0;
  let prevLeg = -1;
  let top = NaN;
  let bottom = NaN;
  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    if (b.h >= top) top = b.h;
    if (b.l <= bottom) bottom = b.l;
    if (i >= size) {
      const p = bars[i - size]!;
      if (p.h > rh[i]!) leg = 0;
      else if (p.l < rl[i]!) leg = 1;
    }
    if (prevLeg !== -1 && leg !== prevLeg) {
      const p = bars[i - size]!;
      if (leg === 1) bottom = p.l;
      else top = p.h;
    }
    prevLeg = leg;
    if (top > bottom) pos[i] = Math.max(0, Math.min(1, (b.c - bottom) / (top - bottom)));
  }
  return pos;
}

/** Kleene NOT. */
export const notTri = (v: Tri): Tri => (v === TRUE ? FALSE : v === FALSE ? TRUE : UNKNOWN);

/**
 * "Happened within the last `n` bars" over an event series: true when any bar in (i − n, i] is true; else unknown when the
 * current bar is unknown; else false.
 */
export function withinBars(ev: Uint8Array, n: number): Uint8Array {
  const len = ev.length;
  if (n <= 1) return ev;
  const out = new Uint8Array(len);
  let lastTrue = -Infinity;
  for (let i = 0; i < len; i++) {
    if (ev[i] === TRUE) lastTrue = i;
    out[i] = i - lastTrue < n ? TRUE : ev[i] === UNKNOWN ? UNKNOWN : FALSE;
  }
  return out;
}

/** A tri-state series from a per-bar predicate that returns `null` for "unknown". */
export function triFrom(n: number, f: (i: number) => boolean | null): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = f(i);
    out[i] = v === null ? UNKNOWN : v ? TRUE : FALSE;
  }
  return out;
}
