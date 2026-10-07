/**
 * MCB / WaveTrend events, ported 1:1 from the other journal (`signals.ts:117-161`), plus a per-bar series
 * with exactly the same conditions for chart markers.
 *
 * - Bottom / Top = wt1 AND price turn out of a new `revRange`-bar low / high (Potential Reversal).
 * - Buy / Sell   = wt1 crosses wt2 at ≤ wtOs / ≥ wtOb (big dot).
 * - Bull / Bear  = any other cross, counted only on the right side of the zero line (small dot).
 */
import type { SignalCfg } from "./config";

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
