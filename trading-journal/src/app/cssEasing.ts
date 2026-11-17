import { springAt, springSettleTime, type SpringConfig } from "@/motion/pulse/engine";

/**
 * Measured pack curves as CSS `linear()` easings, so hover states can run as plain CSS transitions on the compositor
 * (no rAF, no React state) while keeping the exact shape: exponential approach `1 − e^(−t/τ)` and the exact damped
 * spring of `engine.springAt`.
 */
export interface CssCurve {
  /** transition duration in ms */
  ms: number;
  /** CSS `linear(…)` easing */
  easing: string;
}

const fmt = (v: number) => (Math.round(v * 10_000) / 10_000).toString();

/**
 * Exponential approach with time constant `tauMs`, cut at `cut · τ` (default 5 τ ≈ 99.3 %) and normalised so the
 * curve lands exactly on 1. `points` samples are evenly spaced in time.
 */
export function expoCurve(tauMs: number, cut = 5, points = 16): CssCurve {
  const end = 1 - Math.exp(-cut);
  const stops: string[] = [];
  for (let i = 0; i <= points; i++) {
    const p = i / points;
    stops.push(fmt((1 - Math.exp(-cut * p)) / end));
  }
  return { ms: Math.round(tauMs * cut), easing: `linear(${stops.join(", ")})` };
}

/** Exact spring progress (overshoot included) sampled over its settle time. */
export function springCurve(cfg: SpringConfig, points = 24): CssCurve {
  const settle = springSettleTime(cfg, 0.002);
  const stops: string[] = [];
  for (let i = 0; i <= points; i++) stops.push(fmt(i === points ? 1 : springAt((settle * i) / points, cfg)));
  return { ms: Math.round(settle * 1000), easing: `linear(${stops.join(", ")})` };
}
