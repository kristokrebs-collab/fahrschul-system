/**
 * Excursion (Journal v3, P06): MAE / MFE, ATR at entry, holding time, capture ratio and the replay steps.
 */
import { describe, expect, it } from "vitest";
import { atrPctAt, barsInWindow, captureRatio, excursion, excursionInterval, holdLabel, holdMs, replaySteps, type ExcursionBar } from "@/domain/excursion";

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 1, 0);
const bar = (i: number, o: number, h: number, l: number, c: number): ExcursionBar => ({ time: T0 + i * H, open: o, high: h, low: l, close: c });

// 0: before · 1–3: in the trade · 4: after
const BARS = [bar(0, 100, 130, 60, 100), bar(1, 100, 104, 97, 102), bar(2, 102, 110, 99, 108), bar(3, 108, 109, 95, 96), bar(4, 96, 150, 50, 140)];

describe("excursion", () => {
  it("long: MAE from the lowest low, MFE from the highest high inside the window, in R", () => {
    const x = excursion(BARS, { side: "long", entry: 100, stop: 98, from: T0 + H + 5 * 60_000, to: T0 + 3 * H + 30 * 60_000, intervalMs: H });
    expect(x).toMatchObject({ mae: 5, mfe: 10, maeR: 2.5, mfeR: 5, maePrice: 95, mfePrice: 110, bars: 3 });
    expect(x?.maeAt).toBe(T0 + 3 * H);
    expect(x?.mfeAt).toBe(T0 + 2 * H);
  });
  it("short mirrors; no stop → R null; distances never negative", () => {
    const x = excursion(BARS, { side: "short", entry: 100, from: T0 + H, to: T0 + 3 * H, intervalMs: H });
    expect(x).toMatchObject({ mae: 10, mfe: 5, maeR: null, mfeR: null });
    const fav = excursion([bar(1, 90, 92, 80, 85)], { side: "long", entry: 100, from: T0 + H, to: T0 + H, intervalMs: H });
    expect(fav?.mfe).toBe(0);
    expect(fav?.mae).toBe(20);
  });
  it("null without entry, window or bars", () => {
    expect(excursion(BARS, { side: "long", entry: 0, from: T0, to: T0 + H, intervalMs: H })).toBeNull();
    expect(excursion(BARS, { side: "long", entry: 100, from: T0 + H, to: T0, intervalMs: H })).toBeNull();
    expect(excursion([], { side: "long", entry: 100, from: T0, to: T0 + H, intervalMs: H })).toBeNull();
  });
  it("barsInWindow counts the bar an edge falls into", () => {
    expect(barsInWindow(BARS, T0 + H + 1, T0 + 2 * H, H).map((b) => b.time)).toEqual([T0 + H, T0 + 2 * H]);
  });
});

describe("atrPctAt / holding time / capture", () => {
  it("ATR(2) of the bars closed before the entry, in % of the last close", () => {
    const bars = [bar(0, 100, 102, 98, 100), bar(1, 100, 104, 99, 103), bar(2, 103, 104, 96, 97), bar(3, 97, 200, 1, 150)];
    // closed before T0 + 3h: bars 0–2 → TR1 = max(5, 4, 1) = 5, TR2 = max(8, 1, 7) = 8 → ATR 6.5 / 97
    expect(atrPctAt(bars, T0 + 3 * H, H, 2)).toBeCloseTo((6.5 / 97) * 100, 10);
    expect(atrPctAt(bars, T0 + 2 * H, H, 2)).toBeNull();
  });
  it("holdMs / holdLabel", () => {
    expect(holdMs({ date: "2026-10-01T10:00", exitDate: "2026-10-01T13:20" })).toBe(200 * 60_000);
    expect(holdMs({ date: "2026-10-01T10:00" })).toBeNull();
    expect(holdMs({ date: "2026-10-01T10:00", exitDate: "2026-10-01T09:00" })).toBeNull();
    expect(holdLabel(45 * 60_000)).toBe("45 Min");
    expect(holdLabel(200 * 60_000)).toBe("3 Std 20 Min");
    expect(holdLabel(3 * H)).toBe("3 Std");
    expect(holdLabel(52 * H)).toBe("2 T 4 Std");
    expect(holdLabel(48 * H)).toBe("2 T");
    expect(holdLabel(null)).toBe("–");
  });
  it("captureRatio: realised move ÷ MFE", () => {
    expect(captureRatio("long", 100, 106, 10)).toBeCloseTo(0.6, 12);
    expect(captureRatio("short", 100, 104, 10)).toBeCloseTo(-0.4, 12);
    expect(captureRatio("long", 100, null, 10)).toBeNull();
    expect(captureRatio("long", 100, 110, 0)).toBeNull();
  });
  it("excursionInterval: 15 min up to 3 days, else 1 h", () => {
    expect(excursionInterval(2 * 86_400_000)).toBe("15m");
    expect(excursionInterval(4 * 86_400_000)).toBe("1h");
  });
});

describe("replaySteps", () => {
  it("nothing before the entry, running MAE/MFE inside, frozen at the exit after it", () => {
    const steps = replaySteps(BARS, { side: "long", entry: 100, stop: 98, exit: 96, from: T0 + H, to: T0 + 3 * H, intervalMs: H });
    expect(steps.map((s) => s.phase)).toEqual([0, 1, 1, 1, 2]);
    expect(steps[0]).toMatchObject({ mae: 0, mfe: 0, r: 0 });
    expect(steps[1]).toMatchObject({ mae: 3, mfe: 4, r: 1 });
    expect(steps[2]).toMatchObject({ mae: 3, mfe: 10, r: 4 });
    expect(steps[3]).toMatchObject({ mae: 5, mfe: 10, r: -2 });
    // after the exit: values freeze, R = realised (96 − 100) / 2
    expect(steps[4]).toMatchObject({ mae: 5, mfe: 10, r: -2, phase: 2 });
    expect(steps[3]!.movePct).toBeCloseTo(-4, 12);
  });
});
