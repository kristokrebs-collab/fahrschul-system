/**
 * "Was müsste stimmen?" – the reverse of the DCF. Given a target value per share (for example +50 % or three times the
 * price the user typed), which CONSTANT yearly revenue growth would the other assumptions need to reach it? A calculation of
 * what a hypothesis requires, not a forecast. Bisection on the growth; the value rises with growth when margin and
 * reinvestment leave a positive FCF, otherwise the answer is "not reachable" with the reason.
 */
import { runDcf } from "./dcf";
import { buildAssumptions, type SimpleAssumptions } from "./series";

export interface ImpliedGrowth {
  /** the constant yearly growth that reaches the target, `null` when none in the search range does */
  growth: number | null;
  reason: "ok" | "missing" | "below-range" | "above-range" | "no-value";
  /** the inputs that are missing (reason `missing`) */
  missing: string[];
  /** value per share at the bounds of the search range (for the sentence "auch bei … nicht erreichbar") */
  atLow: number | null;
  atHigh: number | null;
}

export const GROWTH_RANGE: readonly [number, number] = [-0.3, 1.0];

/** Value per share for a constant growth, or `null` when the inputs give no value. */
function perShareAt(s: SimpleAssumptions, growth: number): number | null {
  const b = buildAssumptions({ ...s, growthStart: growth, growthEnd: growth });
  if (!b.assumptions) return null;
  const r = runDcf(b.assumptions);
  return r.status === "ok" && r.value ? r.value.perShare : null;
}

export function impliedGrowth(s: SimpleAssumptions, target: number): ImpliedGrowth {
  const probe = buildAssumptions({ ...s, growthStart: s.growthStart ?? 0, growthEnd: s.growthEnd ?? 0 });
  if (probe.missing.length) return { growth: null, reason: "missing", missing: probe.missing, atLow: null, atHigh: null };
  let lo: number = GROWTH_RANGE[0];
  let hi: number = GROWTH_RANGE[1];
  const vLo = perShareAt(s, lo);
  const vHi = perShareAt(s, hi);
  if (vLo == null || vHi == null) return { growth: null, reason: "no-value", missing: [], atLow: vLo, atHigh: vHi };
  if (target < vLo) return { growth: null, reason: "below-range", missing: [], atLow: vLo, atHigh: vHi };
  if (target > vHi) return { growth: null, reason: "above-range", missing: [], atLow: vLo, atHigh: vHi };
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const v = perShareAt(s, mid);
    if (v == null) return { growth: null, reason: "no-value", missing: [], atLow: vLo, atHigh: vHi };
    if (v < target) lo = mid;
    else hi = mid;
  }
  return { growth: (lo + hi) / 2, reason: "ok", missing: [], atLow: vLo, atHigh: vHi };
}
