/**
 * MCB / WaveTrend events, ported 1:1 from the other journal (`signals.ts:117-161`), plus a per-bar series
 * with exactly the same conditions for chart markers.
 *
 * - Bottom / Top = wt1 AND price turn out of a new `revRange`-bar low / high (Potential Reversal).
 * - Buy / Sell   = wt1 crosses wt2 at ≤ wtOs / ≥ wtOb (big dot).
 * - Bull / Bear  = any other cross, counted only on the right side of the zero line (small dot) — shown as "Kreuz"
 *   (not "Einstieg": the user calls the Bottom his entry).
 * - Ours (additive): `wtTurn` — the close at which the forming candle's wt1 crosses wt2 ("dreht ab 82.447").
 */
import type { SignalCfg } from "./config";
import type { Bar } from "./indicators";

export type WtKind = "bottom" | "buy" | "bull" | "top" | "sell" | "bear";
export type WtEvent = { kind: WtKind; barsAgo: number } | null;
export interface WtSignal {
  /** most recent event of any direction (display) */
  kind: WtKind | null;
  barsAgo: number | null;
  /** strongest event per direction inside the lookback window */
  long: WtEvent;
  short: WtEvent;
  wt1: number;
  wt2: number;
}

export const WT_RANK: Readonly<Record<WtKind, number>> = { bottom: 3, buy: 2, bull: 1, top: 3, sell: 2, bear: 1 };
export const isLongKind = (k: WtKind): boolean => k === "bottom" || k === "buy" || k === "bull";

const lowest = (x: readonly number[], i: number, n: number): number => {
  let m = Infinity;
  for (let k = Math.max(0, i - n + 1); k <= i; k++) m = Math.min(m, x[k]!);
  return m;
};
const highest = (x: readonly number[], i: number, n: number): number => {
  let m = -Infinity;
  for (let k = Math.max(0, i - n + 1); k <= i; k++) m = Math.max(m, x[k]!);
  return m;
};

/**
 * Raw events at bar `i` in the original push order (bottom, top, cross up, cross down), BEFORE the zero-line
 * filter. `close` enables Bottom/Top (needs `i > revRange`). `i ≥ 1` is required by the caller.
 */
function eventsAt(wt1: readonly number[], wt2: readonly number[], cfg: Pick<SignalCfg, "wtOs" | "wtOb" | "revRange">, close: readonly number[] | undefined, i: number, out: WtKind[]): void {
  const R = cfg.revRange || 28;
  if (close && i > R) {
    const bot = wt1[i]! > lowest(wt1, i, R) && wt1[i - 1]! <= lowest(wt1, i - 1, R) && close[i]! > lowest(close, i, R) && close[i - 1]! <= lowest(close, i - 1, R);
    const top = wt1[i]! < highest(wt1, i, R) && wt1[i - 1]! >= highest(wt1, i - 1, R) && close[i]! < highest(close, i, R) && close[i - 1]! >= highest(close, i - 1, R);
    if (bot) out.push("bottom");
    if (top) out.push("top");
  }
  const up = wt1[i - 1]! <= wt2[i - 1]! && wt1[i]! > wt2[i]!;
  const dn = wt1[i - 1]! >= wt2[i - 1]! && wt1[i]! < wt2[i]!;
  if (up) out.push(wt1[i]! <= cfg.wtOs ? "buy" : "bull");
  if (dn) out.push(wt1[i]! >= cfg.wtOb ? "sell" : "bear");
}

/** Zero-line filter: a small cross counts only on the right side of the zero line. */
const passes = (e: WtKind, w: number): boolean => !((e === "bull" && w >= 0) || (e === "bear" && w <= 0));

/** MCB signals over the last `signalLookback` bars (k = 0 is the newest, i.e. the running candle). */
export function wtSignal(wt1: readonly number[], wt2: readonly number[], cfg: SignalCfg, close?: readonly number[]): WtSignal {
  const n = wt1.length;
  const out: WtSignal = { kind: null, barsAgo: null, long: null, short: null, wt1: wt1[n - 1]!, wt2: wt2[n - 1]! };
  const ev: WtKind[] = [];
  for (let k = 0; k < Math.min(cfg.signalLookback, n - 2); k++) {
    const i = n - 1 - k;
    ev.length = 0;
    eventsAt(wt1, wt2, cfg, close, i, ev);
    for (const e of ev) {
      if (!passes(e, wt1[i]!)) continue;
      if (out.kind == null) {
        out.kind = e;
        out.barsAgo = k;
      }
      const slot = isLongKind(e) ? "long" : "short";
      const cur = out[slot];
      if (!cur || WT_RANK[e] > WT_RANK[cur.kind]) out[slot] = { kind: e, barsAgo: k };
    }
  }
  return out;
}

/** One MCB event on a bar (chart marker). `index` is the bar index in the evaluated series. */
export interface McbBarEvent {
  index: number;
  kind: WtKind;
}

/**
 * Every MCB event of the series, bar by bar, with the same conditions as `wtSignal` (zero-line filter
 * included). `from` limits the scan to the tail (default: the whole series from bar 2, which is where
 * `wtSignal` can look). Several events on one bar are returned in the original order.
 */
export function mcbEvents(wt1: readonly number[], wt2: readonly number[], cfg: Pick<SignalCfg, "wtOs" | "wtOb" | "revRange">, close?: readonly number[], from = 2): McbBarEvent[] {
  const n = wt1.length;
  const res: McbBarEvent[] = [];
  const ev: WtKind[] = [];
  for (let i = Math.max(1, from); i < n; i++) {
    ev.length = 0;
    eventsAt(wt1, wt2, cfg, close, i, ev);
    for (const e of ev) if (passes(e, wt1[i]!)) res.push({ index: i, kind: e });
  }
  return res;
}

// ------------------------------------------------------------------ turn price (ours, 2026-10-08 TradingView check)

/** Where the MCB cross of the forming candle sits (`wtTurn`). */
export interface WtTurn {
  /** close of the forming candle at which wt1 crosses wt2 (the MCB dot appears): above it the cross is up, below it down */
  price: number;
  /** wt1 (= wt2) at the cross: < 0 → an up-cross counts for long (≤ `wtOs` = Kaufsignal, else Kreuz); > 0 → a down-cross counts for short */
  level: number;
  /** wt1 is above wt2 on the forming candle right now (the up-cross is lit or was earlier in the window) */
  above: boolean;
}

/**
 * Turn price of the forming candle (proposal 2 of the TradingView check: "MCB −57,4 · dreht ab 82.447"): the close at
 * which wt1 would cross wt2 on the last bar, everything before it fixed. wt1 of the last bar is monotonic in its close
 * (ci = x / (0.015·(a·|x| + de)) with x = src − esa[i−1]), so a bisection over the close finds it in ~60 O(1) steps
 * (< 0.05 ms incl. the EMA pass). `null` when the series is too short, wt2 is the plain wt1 (`wtSignal` ≤ 1) or no
 * close within ±50 % of the previous one reaches the cross. Exact arithmetic of `waveTrend` (same EMA order); the
 * forming candle's high / low follow the close (`hlc3`).
 */
export function wtTurn(bars: readonly Bar[], cfg: Pick<SignalCfg, "wtSource" | "wtChannel" | "wtAverage" | "wtSignal">): WtTurn | null {
  const n = bars.length;
  const L = Math.round(cfg.wtSignal);
  if (n < Math.max(3, L + 1) || L < 2) return null;
  const hlc3 = cfg.wtSource === "hlc3";
  const src = bars.map((b) => (hlc3 ? (b.h + b.l + b.c) / 3 : b.c));
  // EMA states up to the bar before the forming one (indicators.ts `ema`: seeded with the first finite value)
  const a = 2 / (cfg.wtChannel + 1);
  const b2 = 2 / (cfg.wtAverage + 1);
  let esa = NaN;
  let de = NaN;
  let w = NaN;
  const wt1: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const x = src[i]!;
    if (isFinite(x)) esa = isFinite(esa) ? a * x + (1 - a) * esa : x;
    const d = Math.abs(x - esa);
    if (isFinite(d)) de = isFinite(de) ? a * d + (1 - a) * de : d;
    const ci = de ? (x - esa) / (0.015 * de) : 0;
    if (isFinite(ci)) w = isFinite(w) ? b2 * ci + (1 - b2) * w : ci;
    wt1[i] = w;
  }
  // wt2 of the last bar = (wt1 + the previous L − 1 values) / L → the cross level is their mean
  let sum = 0;
  for (let k = n - L; k < n - 1; k++) {
    const v = wt1[k]!;
    if (!isFinite(v)) return null;
    sum += v;
  }
  const level = sum / (L - 1);
  if (!isFinite(esa) || !isFinite(de) || !isFinite(w)) return null;
  const last = bars[n - 1]!;
  const wtAt = (c: number): number => {
    const s = hlc3 ? (Math.max(last.h, c) + Math.min(last.l, c) + c) / 3 : c;
    const e = a * s + (1 - a) * esa;
    const dd = a * Math.abs(s - e) + (1 - a) * de;
    const ci = dd ? (s - e) / (0.015 * dd) : 0;
    return b2 * ci + (1 - b2) * w;
  };
  // wt1 − wt2 = (wt1 − level) · (L − 1) / L: the sign of wt1 − level decides
  const ref = bars[n - 2]!.c;
  let lo = ref * 0.5;
  let hi = ref * 1.5;
  if (!(ref > 0) || !(wtAt(lo) <= level) || !(wtAt(hi) > level)) return null;
  for (let k = 0; k < 64 && hi - lo > ref * 1e-12; k++) {
    const m = (lo + hi) / 2;
    if (wtAt(m) > level) hi = m;
    else lo = m;
  }
  return { price: hi, level, above: wtAt(last.c) > level };
}
