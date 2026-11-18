/**
 * Premium / Equilibrium / Discount, ported 1:1 from the other journal (`signals.ts:163-205`).
 *
 * "Discount" / "Premium" = below 47.5 % / above 52.5 % of the swing range; the LuxAlgo boxes are only the outer
 * 5 % (`deep`). The entry rule uses `zone`, not `deep`.
 */
import { rolling, type Bar } from "./indicators";

export type Zone = "premium" | "equilibrium" | "discount";
export interface ZoneBreak {
  kind: "BOS" | "CHoCH";
  dir: 1 | -1;
}
export interface ZoneInfo {
  hi: number;
  lo: number;
  /** position of the last close in the range, 0..1 */
  pos: number;
  zone: Zone;
  /** inside the outer 5 % LuxAlgo box */
  deep: boolean;
  eq: number;
  bias: -1 | 0 | 1;
  brk: ZoneBreak | null;
  /** true = LuxAlgo swing logic, false = fallback range of the last N bars */
  lux: boolean;
}

export const zoneOf = (pos: number): Zone => (pos > 0.525 ? "premium" : pos >= 0.475 ? "equilibrium" : "discount");

/** Bars the fallback range spans (a literal in the other journal's `checkTf`). */
export const PD_FALLBACK_BARS = 120;

/** Simple range of the last N bars (fallback while LuxAlgo has no swing yet). */
export function pdZone(bars: readonly Bar[], lookback: number): ZoneInfo {
  const start = Math.max(0, bars.length - lookback);
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = start; i < bars.length; i++) {
    const b = bars[i]!;
    if (b.h > hi) hi = b.h;
    if (b.l < lo) lo = b.l;
  }
  // Math.max/min semantics for NaN inputs (the original spreads the window into Math.max/min)
  for (let i = start; i < bars.length; i++) {
    const b = bars[i]!;
    if (Number.isNaN(b.h)) hi = NaN;
    if (Number.isNaN(b.l)) lo = NaN;
  }
  const c = bars[bars.length - 1]!.c;
  const pos = hi > lo ? (c - lo) / (hi - lo) : 0.5;
  return { hi, lo, pos, zone: zoneOf(pos), deep: pos <= 0.05 || pos >= 0.95, eq: (hi + lo) / 2, bias: 0, brk: null, lux: false };
}

/**
 * Premium/Discount like LuxAlgo Smart Money Concepts: swing pivots (size 50, right side only), trailing extremes
 * since the last confirmed swing high / low, zone boxes = outer 5 %. `null` while there is no range yet.
 */
export function luxZone(bars: readonly Bar[], size = 50): ZoneInfo | null {
  let leg = 0;
  let prevLeg = -1;
  let shL = NaN;
  let slL = NaN;
  let shX = false;
  let slX = false;
  let pShL = NaN;
  let pSlL = NaN;
  let top = NaN;
  let bottom = NaN;
  let bias: -1 | 0 | 1 = 0;
  let brk: ZoneBreak | null = null;
  // the window extremes of the last `size` bars: O(n) rolling max / min (monotonic deque, the same as `legPivots`);
  // a series with a NaN high / low keeps the plain window loop (Math.max / min NaN semantics of the original)
  const fast = Number.isInteger(size) && size >= 1 && bars.length > size && bars.every((b) => !Number.isNaN(b.h) && !Number.isNaN(b.l));
  const rh = fast ? rolling(bars.map((b) => b.h), size, true) : null;
  const rl = fast ? rolling(bars.map((b) => b.l), size, false) : null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    if (b.h >= top) top = b.h;
    if (b.l <= bottom) bottom = b.l;
    if (i >= size) {
      let hh = -Infinity;
      let ll = Infinity;
      if (rh && rl) {
        hh = rh[i]!;
        ll = rl[i]!;
      } else {
        for (let k = i - size + 1; k <= i; k++) {
          hh = Math.max(hh, bars[k]!.h);
          ll = Math.min(ll, bars[k]!.l);
        }
      }
      const p = bars[i - size]!;
      if (p.h > hh) leg = 0;
      else if (p.l < ll) leg = 1;
    }
    if (prevLeg !== -1 && leg !== prevLeg) {
      const p = bars[i - size]!;
      if (leg === 1) {
        slL = p.l;
        slX = false;
        bottom = p.l;
      } else {
        shL = p.h;
        shX = false;
        top = p.h;
      }
    }
    prevLeg = leg;
    if (i > 0 && !shX && b.c > shL && bars[i - 1]!.c <= pShL) {
      brk = { kind: bias === -1 ? "CHoCH" : "BOS", dir: 1 };
      bias = 1;
      shX = true;
    }
    if (i > 0 && !slX && b.c < slL && bars[i - 1]!.c >= pSlL) {
      brk = { kind: bias === 1 ? "CHoCH" : "BOS", dir: -1 };
      bias = -1;
      slX = true;
    }
    pShL = shL;
    pSlL = slL;
  }
  if (!(top > bottom)) return null;
  const pos = Math.max(0, Math.min(1, (bars[bars.length - 1]!.c - bottom) / (top - bottom)));
  return { hi: top, lo: bottom, pos, zone: zoneOf(pos), deep: pos <= 0.05 || pos >= 0.95, eq: (top + bottom) / 2, bias, brk, lux: true };
}
