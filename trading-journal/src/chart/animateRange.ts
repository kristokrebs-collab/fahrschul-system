/**
 * Range morph (Plan 5.6): animates `timeScale().setVisibleLogicalRange` with Motion's `animate()`
 * on two MotionValues (`spring.smooth`). Retargetable (keeps velocity), abortable on user input,
 * reduced motion → set directly.
 */
import { animate, motionValue, type AnimationPlaybackControls, type MotionValue } from "motion/react";
import type { IChartApi, LogicalRange, Time } from "lightweight-charts";
import { spring } from "@/motion/tokens";
import { INTERVAL_SECONDS, type ChartInterval } from "./panes";

export interface Range {
  from: number;
  to: number;
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpRange = (a: Range, b: Range, t: number): Range => ({ from: lerp(a.from, b.from, t), to: lerp(a.to, b.to, t) });

/** Bars per day at a given interval (1w → 1/7). */
export const barsPerDay = (interval: ChartInterval): number => 86400 / INTERVAL_SECONDS[interval];

/** Index-based range for the last `days` days ending at `lastIndex` (+ right offset in bars). */
export function rangeIndices(lastIndex: number, days: number, interval: ChartInterval, rightOffset = 8): Range {
  const bars = Math.max(1, Math.round(days * barsPerDay(interval)));
  return { from: Math.max(-0.5, lastIndex - bars + 0.5), to: lastIndex + rightOffset };
}

export interface RangeSource {
  timeToIndex(time: Time, findNearest?: boolean): number | null;
  /** number of bars in the series */
  length: number;
  /** last bar time in seconds */
  lastTime: number | null;
}

/** Time-aware range for the last `days` days (falls back to index math when `timeToIndex` fails). */
export function rangeForDays(src: RangeSource, days: number, interval: ChartInterval, rightOffset = 8): Range | null {
  if (src.length === 0 || src.lastTime == null) return null;
  const lastIndex = src.length - 1;
  const fromIdx = src.timeToIndex((src.lastTime - days * 86400) as Time, true);
  if (fromIdx == null) return rangeIndices(lastIndex, days, interval, rightOffset);
  return { from: Math.max(-0.5, fromIdx - 0.5), to: lastIndex + rightOffset };
}

export const sameRange = (a: LogicalRange | Range | null, b: Range, eps = 0.01): boolean =>
  !!a && Math.abs(a.from - b.from) < eps && Math.abs(a.to - b.to) < eps;

export interface RangeAnimatorOptions {
  reducedMotion?: () => boolean;
}

/** Drives the visible logical range through two MotionValues. One instance per chart. */
export class RangeAnimator {
  readonly from: MotionValue<number>;
  readonly to: MotionValue<number>;
  private controls: AnimationPlaybackControls[] = [];
  private unsub: (() => void)[] = [];
  private disposed = false;

  constructor(
    private readonly chart: IChartApi,
    private readonly opts: RangeAnimatorOptions = {},
  ) {
    const cur = chart.timeScale().getVisibleLogicalRange();
    this.from = motionValue(cur?.from ?? 0);
    this.to = motionValue(cur?.to ?? 0);
    const push = () => this.push();
    this.unsub.push(this.from.on("change", push), this.to.on("change", push));
  }

  private push(): void {
    if (this.disposed) return;
    const from = this.from.get();
    const to = this.to.get();
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
    this.chart.timeScale().setVisibleLogicalRange({ from, to });
  }

  isAnimating(): boolean {
    return this.controls.length > 0;
  }

  /** Jump or morph to `target`. Retargeting mid-flight keeps the spring's velocity. */
  goTo(target: Range, animated = true): void {
    if (this.disposed) return;
    const reduce = this.opts.reducedMotion?.() ?? false;
    const cur = this.chart.timeScale().getVisibleLogicalRange();
    if (!animated || reduce || !cur) {
      this.cancel();
      this.from.jump(target.from);
      this.to.jump(target.to);
      this.chart.timeScale().setVisibleLogicalRange(target);
      return;
    }
    if (!this.isAnimating()) {
      // sync with wherever the user scrolled since the last morph
      this.from.jump(cur.from);
      this.to.jump(cur.to);
    }
    this.stopControls();
    const done = () => {
      this.controls = [];
    };
    this.controls = [
      animate(this.from, target.from, { ...spring.smooth, onComplete: done }),
      animate(this.to, target.to, { ...spring.smooth, onComplete: done }),
    ];
  }

  /** Abort a running morph (user wheel/pointerdown); the range stays where it is. */
  cancel(): void {
    this.stopControls();
  }

  private stopControls(): void {
    for (const c of this.controls) c.stop();
    this.controls = [];
  }

  dispose(): void {
    this.disposed = true;
    this.stopControls();
    for (const u of this.unsub) u();
    this.unsub = [];
    this.from.destroy();
    this.to.destroy();
  }
}
