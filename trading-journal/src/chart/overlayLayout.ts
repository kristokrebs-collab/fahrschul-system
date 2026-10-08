/**
 * Pure geometry of the Einstiegs-Check chart overlay (`primitives/SignalOverlay.ts`): bar lookup, MCB dot stacking,
 * label boxes and their collision-free placement, and the price-axis label guard. No `lightweight-charts` import, so it
 * is unit-testable and costs nothing in the main chunk.
 */

/** An axis-aligned box in CSS px (chart-relative). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Index of the bar whose open time is `t` (UTC seconds) in an ascending list, `-1` when absent. O(log n). */
export function barIndex(times: { readonly length: number; readonly [i: number]: { time: number } }, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = times[mid]!.time;
    if (v === t) return mid;
    if (v < t) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Index of the first bar at or after `t` (`length` when every bar is older). */
export function barIndexAtOrAfter(times: { readonly length: number; readonly [i: number]: { time: number } }, t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]!.time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const overlaps = (a: Box, b: Box, pad = 0): boolean => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** A label that wants a place: `box` is its preferred position, `nudge` the vertical offsets it may try instead. */
export interface LabelCandidate<T = unknown> {
  box: Box;
  /** lower = placed first */
  prio: number;
  /** extra vertical offsets (px) tried in order when the preferred spot is taken (default: none → dropped) */
  nudge?: readonly number[];
  data: T;
}

/**
 * Greedy collision-free placement: candidates in priority order (stable), each at its preferred box or the first
 * nudged box that overlaps neither an obstacle nor an already placed label (with `pad` px air) and stays inside
 * `bounds`; otherwise it is dropped. Text never overlaps text.
 */
export function placeLabels<T>(cands: readonly LabelCandidate<T>[], obstacles: readonly Box[], bounds: Box, pad = 2): Array<{ box: Box; data: T }> {
  const order = cands.map((c, i) => ({ c, i })).sort((a, b) => a.c.prio - b.c.prio || a.i - b.i);
  const placed: Array<{ box: Box; data: T }> = [];
  const inside = (b: Box) => b.x >= bounds.x && b.y >= bounds.y && b.x + b.w <= bounds.x + bounds.w && b.y + b.h <= bounds.y + bounds.h;
  for (const { c } of order) {
    const tries = [0, ...(c.nudge ?? [])];
    for (const dy of tries) {
      const box = { ...c.box, y: c.box.y + dy };
      if (!inside(box)) continue;
      if (obstacles.some((o) => overlaps(box, o, pad))) continue;
      if (placed.some((p) => overlaps(box, p.box, pad))) continue;
      placed.push({ box, data: c.data });
      break;
    }
  }
  return placed;
}

/** Vertical nudges for a label beside a horizontal line: up, down, then further out. */
export const LINE_NUDGE: readonly number[] = [-14, 14, -28, 28];

/**
 * Visibility of a price-axis label at `y`: hidden when another axis label (`others`, CSS px) sits within `gap` px –
 * that label carries a price there, and lightweight-charts would otherwise shove one of them off its price.
 */
export function axisLabelClear(y: number | null, others: readonly (number | null)[], gap: number): boolean {
  if (y == null || !Number.isFinite(y)) return false;
  for (const o of others) if (o != null && Number.isFinite(o) && Math.abs(o - y) < gap) return false;
  return true;
}

/** MCB dot radius (CSS px) per kind: Bottom/Top big, Kauf/Verkauf medium, the small crosses smaller. */
export const DOT_RADIUS: Readonly<Record<"bottom" | "top" | "buy" | "sell" | "bull" | "bear", number>> = { bottom: 3.5, top: 3.5, buy: 2.75, sell: 2.75, bull: 2, bear: 2 };
/** Air between the bar's wick tip and the first dot (CSS px). */
export const DOT_GAP = 6;
/** Air between stacked dots of one bar. */
export const DOT_STACK_GAP = 2;

/**
 * Centre offsets (CSS px from the wick tip, growing away from the bar) of the dots of ONE bar side in their order:
 * the first dot sits `DOT_GAP` below the low (long) / above the high (short), the next one stacked beyond it.
 */
export function stackDots(radii: readonly number[]): number[] {
  const out: number[] = [];
  let edge = DOT_GAP;
  for (const r of radii) {
    out.push(edge + r);
    edge += 2 * r + DOT_STACK_GAP;
  }
  return out;
}

/** Text width estimate (CSS px) when no canvas is available (tests / SSR): monospace ≈ 0.6 em per glyph. */
export const estimateTextWidth = (text: string, px: number): number => Math.ceil(text.length * px * 0.6);
