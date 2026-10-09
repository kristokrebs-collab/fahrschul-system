import { describe, expect, it, vi } from "vitest";
import type { IChartApi, LogicalRange } from "lightweight-charts";
import { RangeAnimator, barsPerDay, lerpRange, rangeForDays, rangeIndices, sameRange } from "@/chart/animateRange";

describe("range math", () => {
  it("lerps both edges", () => {
    expect(lerpRange({ from: 0, to: 10 }, { from: 10, to: 30 }, 0.5)).toEqual({ from: 5, to: 20 });
  });
  it("knows bars per day", () => {
    expect(barsPerDay("1m")).toBe(1440);
    expect(barsPerDay("1h")).toBe(24);
    expect(barsPerDay("4h")).toBe(6);
    expect(barsPerDay("1w")).toBeCloseTo(1 / 7);
  });
  it("computes index ranges for 1W/1M/3M", () => {
    expect(rangeIndices(999, 7, "1h")).toEqual({ from: 999 - 168 + 0.5, to: 1007 });
    expect(rangeIndices(999, 30, "4h", 0)).toEqual({ from: 999 - 180 + 0.5, to: 999 });
    expect(rangeIndices(5, 90, "1h").from).toBe(-0.5);
  });
  it("prefers timeToIndex and falls back to index math", () => {
    const lastTime = 1_700_000_000;
    const viaTime = rangeForDays({ timeToIndex: () => 100, length: 500, lastTime }, 7, "1h");
    expect(viaTime).toEqual({ from: 99.5, to: 507 });
    const fallback = rangeForDays({ timeToIndex: () => null, length: 500, lastTime }, 7, "1h");
    expect(fallback).toEqual({ from: 499 - 168 + 0.5, to: 507 });
    expect(rangeForDays({ timeToIndex: () => 1, length: 0, lastTime: null }, 7, "1h")).toBeNull();
  });
  it("compares ranges with tolerance", () => {
    expect(sameRange({ from: 1, to: 2 } as LogicalRange, { from: 1.001, to: 2 })).toBe(true);
    expect(sameRange(null, { from: 1, to: 2 })).toBe(false);
  });
});

function fakeChart(initial: LogicalRange = { from: 0, to: 100 } as LogicalRange) {
  let range = initial;
  const setVisibleLogicalRange = vi.fn((r: LogicalRange) => {
    range = r;
  });
  const chart = {
    timeScale: () => ({ getVisibleLogicalRange: () => range, setVisibleLogicalRange }),
  } as unknown as IChartApi;
  return { chart, setVisibleLogicalRange, current: () => range };
}

describe("RangeAnimator", () => {
  it("sets the range directly under reduced motion", () => {
    const { chart, setVisibleLogicalRange, current } = fakeChart();
    const anim = new RangeAnimator(chart, { reducedMotion: () => true });
    anim.goTo({ from: 50, to: 120 });
    expect(setVisibleLogicalRange).toHaveBeenCalledWith({ from: 50, to: 120 });
    expect(current()).toEqual({ from: 50, to: 120 });
    expect(anim.isAnimating()).toBe(false);
    anim.dispose();
  });

  it("jumps when animate=false", () => {
    const { chart, current } = fakeChart();
    const anim = new RangeAnimator(chart);
    anim.goTo({ from: 10, to: 20 }, false);
    expect(current()).toEqual({ from: 10, to: 20 });
    anim.dispose();
  });

  it("animates and can be cancelled", async () => {
    const { chart, current } = fakeChart();
    const anim = new RangeAnimator(chart, { reducedMotion: () => false });
    anim.goTo({ from: 60, to: 160 });
    expect(anim.isAnimating()).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    anim.cancel();
    expect(anim.isAnimating()).toBe(false);
    const r = current();
    // moved from the start but (spring) not necessarily at the target yet
    expect(r.from).toBeGreaterThan(0);
    expect(r.to).toBeGreaterThan(100);
    anim.dispose();
  });

  it("ignores inverted ranges while animating", () => {
    const { chart, setVisibleLogicalRange } = fakeChart();
    const anim = new RangeAnimator(chart);
    anim.to.set(-5); // from 0 → to −5 is inverted
    expect(setVisibleLogicalRange).not.toHaveBeenCalled();
    anim.to.set(40);
    expect(setVisibleLogicalRange).toHaveBeenCalledWith({ from: 0, to: 40 });
    anim.dispose();
  });
});
