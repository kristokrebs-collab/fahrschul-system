/**
 * "Chart spiegeln" (F62) – the PURE part: what a mirrored chart view is and how it maps.
 *
 * The mirror is a DISPLAY transform of the price axis only. Prices, times, bars and every analysis signal stay exactly
 * as they are; the chart library draws the same data on an inverted axis (`invertScale`). There is no mathematical
 * inversion of the asset (no `1/price`, no synthetic counter-return) – a real inverse series would be a separate,
 * explicitly named feature.
 *
 * - `flipped`      the price axis runs upside down (the lows are on top). Flipping twice is the original chart.
 * - `rsiMirrored`  OPTIONAL and off by default: the RSI pane is inverted too, i.e. read as `100 − RSI`. The RSI is never
 *                  mirrored silently – its legend then says "100−RSI".
 * - `layers`       signals / overlays that can be switched off one by one (breakouts, trendlines, boxes, own trades, RSI).
 *
 * No lightweight-charts runtime import: everything here is plain data + arithmetic and is unit-tested.
 */

/** Signals / overlays of the chart, each individually toggleable. */
export interface MirrorLayers {
  /** RSI breaks (the break dot, its glow and the broken line) */
  breakouts: boolean;
  /** the active diagonal RSI trendlines */
  trendlines: boolean;
  /** Box-zu-Box boxes and their targets */
  boxes: boolean;
  /** the trader's own trades (entry / exit markers) */
  trades: boolean;
  /** the RSI pane itself */
  rsi: boolean;
}

export const MIRROR_LAYER_KEYS = ["breakouts", "trendlines", "boxes", "trades", "rsi"] as const satisfies readonly (keyof MirrorLayers)[];

export const DEFAULT_MIRROR_LAYERS: Readonly<MirrorLayers> = Object.freeze({ breakouts: true, trendlines: true, boxes: true, trades: true, rsi: true });

/** A complete mirrored (or plain) view of one chart. */
export interface MirrorView {
  flipped: boolean;
  rsiMirrored: boolean;
  layers: MirrorLayers;
}

export const PLAIN_VIEW: Readonly<MirrorView> = Object.freeze({ flipped: false, rsiMirrored: false, layers: DEFAULT_MIRROR_LAYERS });

/** One flip: the price axis upside down / back. The layers and the RSI choice are untouched. */
export const flip = (v: MirrorView): MirrorView => ({ ...v, flipped: !v.flipped });

/** `100 − RSI`, the only mirror the RSI knows (and only on request). */
export const mirrorRsi = (v: number): number => 100 - v;

/** Vertical position of `price` inside the axis range `[lo, hi]`: 0 = top edge, 1 = bottom edge. A flipped axis swaps them. */
export function axisFraction(price: number, lo: number, hi: number, flipped: boolean): number {
  const span = hi - lo;
  if (!(span > 0)) return 0.5;
  const f = (hi - price) / span;
  return flipped ? 1 - f : f;
}

/** Inverse of `axisFraction` for the same `lo`, `hi`, `flipped`. */
export function priceAtFraction(fraction: number, lo: number, hi: number, flipped: boolean): number {
  const f = flipped ? 1 - fraction : fraction;
  return hi - f * (hi - lo);
}

/** The scale options a view asks for: the main price axis, and the RSI axis only when the user asked for 100−RSI. */
export function scaleInversion(v: Pick<MirrorView, "flipped" | "rsiMirrored">): { price: boolean; rsi: boolean } {
  return { price: v.flipped, rsi: v.flipped && v.rsiMirrored };
}

/**
 * The bars a view draws. A mirror never rewrites data, so this returns the SAME array – the type documents (and the tests
 * assert) that nothing is mapped: no price, no time.
 */
export function viewBars<T>(bars: readonly T[], _view: MirrorView): readonly T[] {
  return bars;
}

/** What the candle chart needs from a view (flat, so the chart's memoised props stay primitive). */
export interface ChartMirror {
  flipped: boolean;
  rsiMirrored: boolean;
  trendlines: boolean;
  breakouts: boolean;
  /** blind mode: no long / short (win / loss) colours on boxes, targets and RSI breaks */
  neutral: boolean;
}

export const NO_MIRROR: Readonly<ChartMirror> = Object.freeze({ flipped: false, rsiMirrored: false, trendlines: true, breakouts: true, neutral: false });

export const chartMirrorOf = (v: MirrorView, neutral = false): ChartMirror => ({ flipped: v.flipped, rsiMirrored: v.rsiMirrored, trendlines: v.layers.trendlines, breakouts: v.layers.breakouts, neutral });

/** True when `layers` shows everything (nothing is hidden). */
export const allLayersOn = (l: MirrorLayers): boolean => MIRROR_LAYER_KEYS.every((k) => l[k]);

/** Keeps only candles/bars opened at or before `anchorMs` (no look-ahead: a test freezes its picture at the anchor). */
export function clipAtAnchor<T extends { time: number }>(bars: readonly T[], anchorMs: number): T[] {
  return bars.filter((b) => b.time <= anchorMs);
}

/**
 * Open time (ms) of the newest bar that is already CLOSED at `now` (`time + intervalMs ≤ now`). A test freezes its
 * picture there: the forming bar is not part of it, so its remaining path is genuinely unknown. `null` without one.
 */
export function lastClosedAnchor(bars: readonly { time: number }[], intervalMs: number, now: number): number | null {
  let best: number | null = null;
  for (const b of bars) if (b.time + intervalMs <= now && (best === null || b.time > best)) best = b.time;
  return best;
}

/** Open time (ms) of the last bar, `null` for an empty series. */
export function anchorOf(bars: readonly { time: number }[]): number | null {
  let last: number | null = null;
  for (const b of bars) if (last === null || b.time > last) last = b.time;
  return last;
}
