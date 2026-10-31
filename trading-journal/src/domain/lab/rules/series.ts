/**
 * More indicator series for the rule blocks (F06): ADX / DI, Stochastic, Keltner, Supertrend, Chandelier, Ichimoku, CCI,
 * Williams %R, OBV, VWAP, Heikin-Ashi, pivots and the funding rate. Pure; Wilder / TradingView definitions (`ta.dmi`,
 * `ta.stoch`, `ta.supertrend`, `ta.cci`, `ta.wpr`, `ta.pivothigh` …). Every value at bar i uses bars ≤ i only; `NaN` = not
 * defined yet (the blocks turn that into "unknown").
 */
import { ema, rma, rolling, sma, type Bar } from "../../signals/indicators";

const nan = (n: number): number[] => new Array<number>(n).fill(NaN);

/** True range per bar (the first bar: high − low, like Pine's `ta.tr(true)`). */
export function trueRange(bars: readonly Bar[]): number[] {
  return bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1]!.c), Math.abs(b.l - bars[i - 1]!.c))));
}

/** Rolling max / min over exactly `len` bars (NaN until the window is full) – `rolling` alone returns partial windows. */
export function windowExtreme(x: readonly number[], len: number, max: boolean): number[] {
  const r = rolling(x, len, max);
  return Array.from(r, (v, i) => (i >= len - 1 ? v : NaN));
}

/** ATR with Wilder smoothing (RMA of the true range) – NaN until `len` bars (Pine `ta.atr`). */
export const atrRma = (bars: readonly Bar[], len: number): number[] => rma(trueRange(bars), len);

/** Pine `ta.dmi(len, smooth)`: +DI, −DI and ADX. */
export function dmiSeries(bars: readonly Bar[], len: number, smooth: number): { plus: number[]; minus: number[]; adx: number[] } {
  const n = bars.length;
  const plusDM = nan(n);
  const minusDM = nan(n);
  for (let i = 1; i < n; i++) {
    const up = bars[i]!.h - bars[i - 1]!.h;
    const down = bars[i - 1]!.l - bars[i]!.l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }
  const tr = rma(trueRange(bars), len);
  const pr = rma(plusDM, len);
  const mr = rma(minusDM, len);
  const fix = (x: number[]): number[] => {
    let last = NaN;
    return x.map((v) => (Number.isFinite(v) ? (last = v) : last));
  };
  const plus = fix(pr.map((v, i) => (100 * v) / tr[i]!));
  const minus = fix(mr.map((v, i) => (100 * v) / tr[i]!));
  const dx = plus.map((p, i) => {
    const m = minus[i]!;
    const sum = p + m;
    return Number.isFinite(sum) ? Math.abs(p - m) / (sum === 0 ? 1 : sum) : NaN;
  });
  return { plus, minus, adx: rma(dx, smooth).map((v) => 100 * v) };
}

/** Stochastic: raw %K over `kLen`, %K smoothed by an SMA of `kSmooth`, %D = SMA of %K over `dSmooth` (Pine `ta.stoch` + `ta.sma`). */
export function stochSeries(bars: readonly Bar[], kLen: number, kSmooth: number, dSmooth: number): { k: number[]; d: number[] } {
  const hh = windowExtreme(bars.map((b) => b.h), kLen, true);
  const ll = windowExtreme(bars.map((b) => b.l), kLen, false);
  const raw = bars.map((b, i) => {
    const range = hh[i]! - ll[i]!;
    return range > 0 ? (100 * (b.c - ll[i]!)) / range : NaN;
  });
  const k = sma(raw, kSmooth);
  return { k, d: sma(k, dSmooth) };
}

/** Keltner channel: EMA(len) ± mult × ATR(atrLen) (TradingView's "Keltner Channels": ATR, exponential average). */
export function keltnerSeries(bars: readonly Bar[], len: number, atrLen: number, mult: number): { mid: number[]; upper: number[]; lower: number[] } {
  const mid = ema(
    bars.map((b) => b.c),
    len,
  );
  const a = atrRma(bars, atrLen);
  return { mid, upper: mid.map((m, i) => m + mult * a[i]!), lower: mid.map((m, i) => m - mult * a[i]!) };
}

/**
 * Supertrend like Pine `ta.supertrend(factor, atrLen)`: bands at hl2 ± factor × ATR that only tighten while the close stays
 * on one side. `dir` is +1 in an uptrend (the line sits below the price), −1 in a downtrend – NaN before the ATR exists.
 */
export function supertrendSeries(bars: readonly Bar[], atrLen: number, factor: number): { line: number[]; dir: number[] } {
  const n = bars.length;
  const atr = atrRma(bars, atrLen);
  const upper = nan(n);
  const lower = nan(n);
  const line = nan(n);
  const dir = nan(n);
  const nz = (v: number): number => (Number.isFinite(v) ? v : 0);
  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    const src = (b.h + b.l) / 2;
    let up = src + factor * atr[i]!;
    let lo = src - factor * atr[i]!;
    const prevLo = i > 0 ? nz(lower[i - 1]!) : 0;
    const prevUp = i > 0 ? nz(upper[i - 1]!) : 0;
    const pc = i > 0 ? bars[i - 1]!.c : NaN;
    lo = lo > prevLo || pc < prevLo ? lo : prevLo;
    up = up < prevUp || pc > prevUp ? up : prevUp;
    lower[i] = lo;
    upper[i] = up;
    // Pine's direction: −1 = uptrend, +1 = downtrend
    let d: number;
    if (i === 0 || !Number.isFinite(atr[i - 1]!)) d = 1;
    else if (line[i - 1] === upper[i - 1]) d = b.c > up ? -1 : 1;
    else d = b.c < lo ? 1 : -1;
    line[i] = d === -1 ? lo : up;
    if (Number.isFinite(atr[i]!)) dir[i] = d === -1 ? 1 : -1;
  }
  return { line, dir };
}

/**
 * Chandelier exit: the long stop trails the highest high of `len` bars by `mult` × ATR(len) and only rises while the close
 * stays above it; the short stop mirrors it. `dir` is +1 / −1 and flips when the close crosses the opposite stop.
 */
export function chandelierSeries(bars: readonly Bar[], len: number, mult: number): { longStop: number[]; shortStop: number[]; dir: number[] } {
  const n = bars.length;
  const a = atrRma(bars, len);
  const hh = windowExtreme(bars.map((b) => b.h), len, true);
  const ll = windowExtreme(bars.map((b) => b.l), len, false);
  const longStop = nan(n);
  const shortStop = nan(n);
  const dir = nan(n);
  let d = 1;
  for (let i = 0; i < n; i++) {
    const raw = hh[i]! - mult * a[i]!;
    const rawS = ll[i]! + mult * a[i]!;
    if (!Number.isFinite(raw) || !Number.isFinite(rawS)) continue;
    const prevL = i > 0 && Number.isFinite(longStop[i - 1]!) ? longStop[i - 1]! : raw;
    const prevS = i > 0 && Number.isFinite(shortStop[i - 1]!) ? shortStop[i - 1]! : rawS;
    const pc = i > 0 ? bars[i - 1]!.c : NaN;
    longStop[i] = pc > prevL ? Math.max(raw, prevL) : raw;
    shortStop[i] = pc < prevS ? Math.min(rawS, prevS) : rawS;
    d = bars[i]!.c > prevS ? 1 : bars[i]!.c < prevL ? -1 : d;
    dir[i] = d;
  }
  return { longStop, shortStop, dir };
}

/**
 * Ichimoku: Tenkan (conversion) and Kijun (base) are the midpoints of the `conv` / `base` bar ranges, the cloud edges are
 * Senkou A = (Tenkan + Kijun) / 2 and Senkou B = midpoint of `spanB` bars, both plotted `shift − 1` bars ahead like
 * TradingView's indicator (displacement 26 → offset 25). `cloudA[i]` / `cloudB[i]` are the cloud edges AT bar i, i.e. the
 * values computed `shift − 1` bars earlier – no future bar is used.
 */
export function ichimokuSeries(bars: readonly Bar[], conv: number, base: number, spanB: number, shift: number): { tenkan: number[]; kijun: number[]; cloudA: number[]; cloudB: number[] } {
  const hs = bars.map((b) => b.h);
  const ls = bars.map((b) => b.l);
  const mid = (len: number): number[] => {
    const h = windowExtreme(hs, len, true);
    const l = windowExtreme(ls, len, false);
    return h.map((v, i) => (v + l[i]!) / 2);
  };
  const tenkan = mid(conv);
  const kijun = mid(base);
  const a = tenkan.map((t, i) => (t + kijun[i]!) / 2);
  const b = mid(spanB);
  const off = Math.max(0, shift - 1);
  return { tenkan, kijun, cloudA: a.map((_, i) => (i - off >= 0 ? a[i - off]! : NaN)), cloudB: b.map((_, i) => (i - off >= 0 ? b[i - off]! : NaN)) };
}

/** Commodity Channel Index on the typical price (hlc3): (tp − SMA) / (0.015 × mean absolute deviation) – Pine `ta.cci`. */
export function cciSeries(bars: readonly Bar[], len: number): number[] {
  const tp = bars.map((b) => (b.h + b.l + b.c) / 3);
  const m = sma(tp, len);
  return tp.map((x, i) => {
    if (!Number.isFinite(m[i]!)) return NaN;
    let dev = 0;
    for (let k = i - len + 1; k <= i; k++) dev += Math.abs(tp[k]! - m[i]!);
    dev /= len;
    return dev > 0 ? (x - m[i]!) / (0.015 * dev) : 0;
  });
}

/** Williams %R: 100 × (close − highest high) / (highest high − lowest low) over `len` bars, −100 … 0 (Pine `ta.wpr`). */
export function williamsRSeries(bars: readonly Bar[], len: number): number[] {
  const hh = windowExtreme(bars.map((b) => b.h), len, true);
  const ll = windowExtreme(bars.map((b) => b.l), len, false);
  return bars.map((b, i) => {
    const range = hh[i]! - ll[i]!;
    return range > 0 ? (100 * (b.c - hh[i]!)) / range : NaN;
  });
}

/** On-balance volume: running sum of ±volume by the close's direction (a bar without volume adds 0). */
export function obvSeries(bars: readonly Bar[]): number[] {
  let acc = 0;
  return bars.map((b, i) => {
    if (i > 0) acc += Math.sign(b.c - bars[i - 1]!.c) * (b.v ?? 0);
    return acc;
  });
}

/** VWAP of the typical price (hlc3) since the anchor `key(t)` last changed; a bar without volume makes the rest of the anchor NaN. */
export function vwapSeries(bars: readonly Bar[], key: (t: number) => number): number[] {
  let k = NaN;
  let pv = 0;
  let vol = 0;
  let bad = false;
  return bars.map((b) => {
    const kk = key(b.t);
    if (kk !== k) {
      k = kk;
      pv = 0;
      vol = 0;
      bad = false;
    }
    if (b.v === undefined || !Number.isFinite(b.v)) bad = true;
    pv += ((b.h + b.l + b.c) / 3) * (b.v ?? 0);
    vol += b.v ?? 0;
    return bad || !(vol > 0) ? NaN : pv / vol;
  });
}

/** Heikin-Ashi candles (open seeded with (o + c) / 2, then the average of the previous HA open and close). */
export function heikinAshi(bars: readonly Bar[]): { o: number[]; h: number[]; l: number[]; c: number[] } {
  const o: number[] = [];
  const h: number[] = [];
  const l: number[] = [];
  const c: number[] = [];
  bars.forEach((b, i) => {
    const hc = (b.o + b.h + b.l + b.c) / 4;
    const ho = i === 0 ? (b.o + b.c) / 2 : (o[i - 1]! + c[i - 1]!) / 2;
    o.push(ho);
    c.push(hc);
    h.push(Math.max(b.h, ho, hc));
    l.push(Math.min(b.l, ho, hc));
  });
  return { o, h, l, c };
}

/**
 * The last CONFIRMED pivot high / low as of every bar: a pivot at bar p needs `left` bars before it that are lower and
 * `right` bars after it that are not higher (Pine `ta.pivothigh(left, right)`), so it is only known at bar p + right.
 * `hiAt` / `loAt` are the bar indices of those pivots.
 */
export function pivotLevels(bars: readonly Bar[], left: number, right: number): { hi: number[]; lo: number[]; hiAt: number[]; loAt: number[] } {
  const n = bars.length;
  const hi = nan(n);
  const lo = nan(n);
  const hiAt = nan(n);
  const loAt = nan(n);
  let ph = NaN;
  let pl = NaN;
  let pha = NaN;
  let pla = NaN;
  for (let i = 0; i < n; i++) {
    const p = i - right;
    if (p >= left) {
      let isH = true;
      let isL = true;
      for (let k = p - left; k <= p + right && (isH || isL); k++) {
        if (k === p) continue;
        const before = k < p;
        if (isH && (before ? !(bars[k]!.h < bars[p]!.h) : !(bars[k]!.h <= bars[p]!.h))) isH = false;
        if (isL && (before ? !(bars[k]!.l > bars[p]!.l) : !(bars[k]!.l >= bars[p]!.l))) isL = false;
      }
      if (isH) {
        ph = bars[p]!.h;
        pha = p;
      }
      if (isL) {
        pl = bars[p]!.l;
        pla = p;
      }
    }
    hi[i] = ph;
    lo[i] = pl;
    hiAt[i] = pha;
    loAt[i] = pla;
  }
  return { hi, lo, hiAt, loAt };
}

/** Funding rate (percent per 8 h) known at each bar's CLOSE: the mean of the last `avgN` settlements up to then; NaN without. */
export function fundingSeries(bars: readonly Bar[], tfSec: number, points: readonly { t: number; rate: number }[], avgN: number): number[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  let k = -1;
  return bars.map((b) => {
    const closeMs = (b.t + tfSec) * 1000;
    while (k + 1 < sorted.length && sorted[k + 1]!.t <= closeMs) k++;
    if (k + 1 < avgN) return NaN;
    let sum = 0;
    for (let j = k - avgN + 1; j <= k; j++) sum += sorted[j]!.rate;
    return (sum / avgN) * 100;
  });
}
