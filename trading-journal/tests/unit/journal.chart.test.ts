/**
 * Chart side of Journal v3 (P06): drawings in time / price coordinates (`AnnotationPrimitive`) and the pure replay
 * model (window, spans, markers, phases).
 */
import { describe, expect, it, vi } from "vitest";
import type { Annotation } from "@/domain/types";
import { AnnotationPrimitive, distToSegment, logicalOf, timeOfLogical } from "@/chart/primitives/AnnotationPrimitive";
import { barAt, buildReplay, defaultReplayInterval, INTERVAL_MS, padBars, phaseLabel, readoutAt, replayTimes, replayWindow } from "@/views/trades/replay/replayModel";
import { enriched, mkTrade } from "./domain.fixtures";

const TIMES = [1000, 1060, 1120, 1180]; // 1-minute bars (UTC seconds)

describe("annotation coordinates", () => {
  it("logicalOf interpolates between bars and extrapolates beyond both ends; timeOfLogical inverts it", () => {
    expect(logicalOf(TIMES, 1060, 60)).toBe(1);
    expect(logicalOf(TIMES, 1090, 60)).toBe(1.5);
    expect(logicalOf(TIMES, 1300, 60)).toBe(5);
    expect(logicalOf(TIMES, 940, 60)).toBe(-1);
    expect(logicalOf([], 1, 60)).toBeNull();
    for (const t of [940, 1000, 1090, 1180, 1300]) expect(timeOfLogical(TIMES, logicalOf(TIMES, t, 60)!, 60)).toBe(t);
    expect(timeOfLogical(TIMES, Number.NaN, 60)).toBeNull();
  });

  it("distance to a segment clamps to its ends", () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(distToSegment(-4, 3, 0, 0, 10, 0)).toBe(5);
    expect(distToSegment(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2, 9);
  });
});

/** A fake chart: 10 px per logical bar, y = 200 − price. */
function attach(reduced = true) {
  const prim = new AnnotationPrimitive({ times: () => TIMES, intervalSec: () => 60, reducedMotion: () => reduced });
  const requestUpdate = vi.fn();
  const timeScale = { logicalToCoordinate: (l: number) => l * 10, coordinateToLogical: (x: number) => x / 10, width: () => 300 };
  const chart = { timeScale: () => timeScale };
  const series = { priceToCoordinate: (p: number) => 200 - p, coordinateToPrice: (y: number) => 200 - y };
  prim.attached({ chart, series, requestUpdate } as unknown as Parameters<AnnotationPrimitive["attached"]>[0]);
  return { prim, requestUpdate };
}

describe("AnnotationPrimitive", () => {
  const LINE: Annotation = { id: "h", kind: "hline", points: [{ time: 1000, price: 100 }] };
  const TREND: Annotation = { id: "t", kind: "trend", points: [{ time: 1000, price: 50 }, { time: 1180, price: 80 }] };
  const BOX: Annotation = { id: "b", kind: "box", points: [{ time: 1060, price: 150 }, { time: 1120, price: 130 }] };

  it("pointAt maps a pixel to time / price; layout maps drawings back to pixels", () => {
    const { prim } = attach();
    expect(prim.pointAt(15, 120)).toEqual({ time: 1090, price: 80 });
    prim.setAnnotations([TREND]);
    const { shapes, width } = prim.layout();
    expect(width).toBe(300);
    expect(shapes[0]).toMatchObject({ id: "t", pts: [{ x: 0, y: 150 }, { x: 30, y: 120 }], progress: 1, draft: false });
  });

  it("hitAt finds the topmost drawing within 6 px; the draft is never hit", () => {
    const { prim } = attach();
    prim.setAnnotations([LINE, TREND, BOX]);
    expect(prim.hitAt(200, 103)).toBe("h");
    expect(prim.hitAt(15, 136)).toBe("t"); // on the trend line (x 15 → y 135)
    expect(prim.hitAt(15, 60)).toBe("b"); // inside the box (y 50–70)
    expect(prim.hitAt(250, 10)).toBeNull();
    prim.setAnnotations([]);
    prim.setDraft({ kind: "hline", points: [{ time: 1000, price: 100 }] });
    expect(prim.layout().shapes[0]).toMatchObject({ id: "__draft", draft: true });
    expect(prim.hitAt(100, 100)).toBeNull();
  });

  it("a new drawing draws itself in (progress < 1), not under reduced motion; selection is dropped with the drawing", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1);
    const { prim } = attach(false);
    prim.setAnnotations([LINE]);
    expect(prim.layout().shapes[0]!.progress).toBeLessThan(1);
    prim.select("h");
    expect(prim.layout().shapes[0]!.selected).toBe(true);
    prim.setAnnotations([]);
    expect(prim.selectedId()).toBeNull();
    prim.detached();
    raf.mockRestore();
    const reduced = attach(true).prim;
    reduced.setAnnotations([LINE]);
    expect(reduced.layout().shapes[0]!.progress).toBe(1);
  });
});

describe("replay model", () => {
  const NOW = new Date("2026-10-10T12:00").getTime();
  const closed = enriched([mkTrade({ id: "r", date: "2026-10-01T10:00", exitDate: "2026-10-01T14:00", entry: 100, stop: 98, exit: 104, size: 1000 })])[0]!;

  it("times, default interval and the padded window", () => {
    expect(replayTimes(closed, NOW)).toEqual({ from: new Date("2026-10-01T10:00").getTime(), to: new Date("2026-10-01T14:00").getTime() });
    expect(replayTimes({ ...closed, status: "open" }, NOW).to).toBe(NOW);
    expect(replayTimes({ ...closed, exitDate: undefined }, NOW).to).toBeNull();
    expect(defaultReplayInterval(closed, NOW)).toBe("15m");
    expect(defaultReplayInterval({ ...closed, exitDate: "2026-10-05T10:00" }, NOW)).toBe("1h");
    expect(defaultReplayInterval({ ...closed, exitDate: "2026-10-20T10:00" }, NOW)).toBe("4h");
    expect(padBars(1)).toBe(12);
    expect(padBars(50)).toBe(30);
    expect(padBars(500)).toBe(60);
    const w = replayWindow(closed, "15m", NOW);
    expect(w.from).toBe(replayTimes(closed).from - 12 * INTERVAL_MS["15m"]); // 16 bars in the trade → 12 padding
    expect(w.to).toBe(replayTimes(closed).to! + 12 * INTERVAL_MS["15m"]);
  });

  it("barAt finds the bar that holds a time, clamped", () => {
    const bars = [{ time: 0 }, { time: 10 }, { time: 20 }];
    expect(barAt(bars, -5)).toBe(0);
    expect(barAt(bars, 15)).toBe(1);
    expect(barAt(bars, 99)).toBe(2);
    expect(barAt([], 1)).toBe(-1);
  });

  it("buildReplay: entry / exit bars, spans, markers, readouts and phases", () => {
    const from = replayTimes(closed).from;
    const step = INTERVAL_MS["15m"];
    const bars = Array.from({ length: 40 }, (_, i) => ({ time: from + (i - 12) * step, open: 100, high: 101 + (i === 20 ? 5 : 0), low: 99, close: 100 }));
    const m = buildReplay(closed, bars, "15m", NOW)!;
    expect(m.trade).toMatchObject({ entryIndex: 12, exitIndex: 28, entry: 100 });
    expect(m.spans.map((s) => [s.id, s.start, s.duration])).toEqual([
      ["before", 0, 13],
      ["trade", 13, 16],
      ["after", 29, 11],
    ]);
    expect(m.markers.map((x) => [x.label, x.at])).toEqual([
      ["Einstieg", 13],
      ["Ausstieg", 29],
    ]);
    expect(phaseLabel(m, 5)).toBe("Vor dem Einstieg");
    expect(phaseLabel(m, 20)).toBe("Im Trade");
    expect(phaseLabel(m, 35)).toBe("Nach dem Ausstieg");
    expect(readoutAt(m.steps, 0)).toBeNull();
    expect(readoutAt(m.steps, 999)).toBe(m.steps[m.steps.length - 1]);
    expect(m.steps[25]!.mfe).toBeGreaterThanOrEqual(6); // the spike at bar 20 is inside the trade
    expect(buildReplay(closed, [], "15m", NOW)).toBeNull();
  });
});
