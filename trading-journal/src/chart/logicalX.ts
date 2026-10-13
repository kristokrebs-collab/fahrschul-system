/**
 * x of a FRACTIONAL logical index on the time scale.
 *
 * lightweight-charts 5.2 `timeScale().logicalToCoordinate(l)` only maps whole indices: for a fractional one its
 * `indexToCoordinate` returns `0` (`!isInteger(index) → 0`) – the left pane edge. Every overlay that asks for a bar edge
 * (`i − 0.5`), a time inside a bar or a time in the future space (`last + Δt / interval`) must interpolate between the
 * two whole neighbours instead (the scale is linear in the index, also left of the first and right of the last bar).
 *
 * The x is snapped to 1/1024 px (`snapX`): bar centres sit on half pixels (`(k + ½) × barSpacing`), and the same view
 * reached another way – a range morph's last frame, a history shift – can carry a bar spacing one ulp off
 * (`3.0000000000000004`) while the visible range reads the same. Unsnapped, the overlays' whole-pixel rounding then
 * flips at those half pixels (`79.49999999999977` → 79, `79.5` → 80): labels and dash patterns jump 1 px between two
 * draws of the same picture. Type-only lwc import: free in the main chunk.
 */
import type { Logical } from "lightweight-charts";

/** The part of `ITimeScaleApi` this needs (easy to fake in tests). */
export interface LogicalScale {
  logicalToCoordinate(logical: Logical): number | null;
}

/** Grid the overlay x is snapped to (a power of two: values on it stay exact). */
const X_GRID = 1024;

/** `x` without its floating-point noise (to 1/1024 px – far below anything a canvas pixel shows). */
export const snapX = (x: number): number => Math.round(x * X_GRID) / X_GRID;

/** CSS-px x of a (fractional) logical index; `null` when the scale has no data or the index is not finite. */
export function logicalToX(ts: LogicalScale, logical: number): number | null {
  if (!Number.isFinite(logical)) return null;
  const a = Math.floor(logical);
  const xa = ts.logicalToCoordinate(a as Logical);
  if (xa == null) return null;
  if (a === logical) return snapX(xa);
  const xb = ts.logicalToCoordinate((a + 1) as Logical);
  return xb == null ? null : snapX(xa + (xb - xa) * (logical - a));
}
