/**
 * x of a FRACTIONAL logical index on the time scale.
 *
 * lightweight-charts 5.2 `timeScale().logicalToCoordinate(l)` only maps whole indices: for a fractional one its
 * `indexToCoordinate` returns `0` (`!isInteger(index) → 0`) – the left pane edge. Every overlay that asks for a bar edge
 * (`i − 0.5`), a time inside a bar or a time in the future space (`last + Δt / interval`) must interpolate between the
 * two whole neighbours instead (the scale is linear in the index, also left of the first and right of the last bar).
 * Type-only lwc import: free in the main chunk.
 */
import type { Logical } from "lightweight-charts";

/** The part of `ITimeScaleApi` this needs (easy to fake in tests). */
export interface LogicalScale {
  logicalToCoordinate(logical: Logical): number | null;
}

/** CSS-px x of a (fractional) logical index; `null` when the scale has no data or the index is not finite. */
export function logicalToX(ts: LogicalScale, logical: number): number | null {
  if (!Number.isFinite(logical)) return null;
  const a = Math.floor(logical);
  const xa = ts.logicalToCoordinate(a as Logical);
  if (xa == null || a === logical) return xa;
  const xb = ts.logicalToCoordinate((a + 1) as Logical);
  return xb == null ? null : xa + (xb - xa) * (logical - a);
}
