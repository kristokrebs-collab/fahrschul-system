import { describe, expect, it } from "vitest";
import { fitToWidth, rightOffsetBars, rangeForDays } from "@/chart/animateRange";
import { AXIS_LABEL_GAP, filterTickLabels } from "@/chart/axisLabels";
import { resampleCandles, resampleTail } from "@/chart/resample";
import { dotColor, dotStyle, SIGNAL_MARKER_PREFIX, signalDots, signalMarkersKey } from "@/chart/signalMarkers";
import { DOT_GAP, DOT_RADIUS, DOT_STACK_GAP } from "@/chart/overlayLayout";
import { ink } from "@/chart/ink";
import type { Candle } from "@/market/types";

const M15 = 900_000;
const M30 = 1_800_000;
const DAY0 = Date.UTC(2026, 9, 7); // UTC midnight

function c15(i: number, o: number, h: number, l: number, cl: number, closed = true): Candle {
  return { time: DAY0 + i * M15, open: o, high: h, low: l, close: cl, volume: 10, closed };
}

describe("resampleCandles (30m from 15m)", () => {
  it("aggregates UTC-aligned buckets and closes a bucket only with its last 15m bar", () => {
    const src = [c15(0, 100, 110, 95, 105), c15(1, 105, 120, 101, 118), c15(2, 118, 119, 90, 92), c15(3, 92, 99, 91, 97, false)];
    const out = resampleCandles(src, M15, M30);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ time: DAY0, open: 100, high: 120, low: 95, close: 118, volume: 20, closed: true, closeTime: DAY0 + M30 - 1 });
    expect(out[1]).toMatchObject({ time: DAY0 + M30, open: 118, high: 119, low: 90, close: 97, closed: false });
  });

  it("a bucket with only its first 15m bar is still forming", () => {
    const out = resampleCandles([c15(0, 1, 2, 0.5, 1.5)], M15, M30);
    expect(out[0]!.closed).toBe(false);
  });

  it("starts mid-bucket correctly (history beginning at :15)", () => {
    const out = resampleCandles([c15(1, 5, 6, 4, 5.5), c15(2, 5.5, 7, 5, 6)], M15, M30);
    expect(out.map((c) => c.time)).toEqual([DAY0, DAY0 + M30]);
    expect(out[0]).toMatchObject({ open: 5, close: 5.5, closed: true });
  });

  it("resampleTail rebuilds only the last two buckets", () => {
    const src = Array.from({ length: 12 }, (_, i) => c15(i, i, i + 1, i - 1, i + 0.5, i < 11));
    const tail = resampleTail(src, M15, M30);
    expect(tail.map((c) => (c.time - DAY0) / M30)).toEqual([4, 5]);
    expect(tail[1]).toMatchObject({ open: 10, close: 11.5, closed: false });
    expect(resampleTail([], M15, M30)).toEqual([]);
  });
});

describe("MCB signal dots (candle-close states)", () => {
  const bars = [{ time: 1000 }, { time: 2800 }, { time: 4600 }];
  it("long kinds below the bar in win green, short kinds above in loss red; provisional = soft ring, strong = halo", () => {
    const d = signalDots(
      [
        { time: 4_600_000, kind: "top", live: true, state: "provisional" },
        { time: 1_000_000, kind: "bottom", state: "strong" },
        { time: 2_800_000, kind: "sell", state: "confirmed" },
        { time: 9_999_000, kind: "buy" }, // not a loaded bar → dropped
      ],
      bars,
    );
    expect(d.map((x) => x.index)).toEqual([0, 1, 2]);
    expect(d[0]).toMatchObject({ long: true, color: ink.win, style: "strong", r: DOT_RADIUS.bottom, id: `${SIGNAL_MARKER_PREFIX}1000:bottom` });
    expect(d[1]).toMatchObject({ long: false, color: ink.loss, style: "confirmed", r: DOT_RADIUS.sell });
    expect(d[2]).toMatchObject({ long: false, color: ink.lossSoft, style: "provisional" });
  });

  it("an old marker without state: live → provisional, else confirmed", () => {
    expect(dotStyle({ live: true })).toBe("provisional");
    expect(dotStyle({})).toBe("confirmed");
    expect(dotStyle({ state: "none" })).toBe("confirmed");
    expect(dotColor(true, "provisional")).toBe(ink.winSoft);
    expect(dotColor(false, "strong")).toBe(ink.loss);
  });

  it("several events on one bar side stack outwards, strongest next to the bar", () => {
    const d = signalDots(
      [
        { time: 1_000_000, kind: "buy" },
        { time: 1_000_000, kind: "bottom" },
        { time: 1_000_000, kind: "top" },
      ],
      bars,
    );
    const long = d.filter((x) => x.long);
    expect(long.map((x) => x.kind)).toEqual(["bottom", "buy"]);
    expect(long[0]!.offset).toBe(DOT_GAP + DOT_RADIUS.bottom);
    expect(long[1]!.offset).toBe(DOT_GAP + 2 * DOT_RADIUS.bottom + DOT_STACK_GAP + DOT_RADIUS.buy);
    expect(d.find((x) => !x.long)!.offset).toBe(DOT_GAP + DOT_RADIUS.top);
  });

  it("key changes only with content (state included)", () => {
    expect(signalMarkersKey([{ time: 1, kind: "top" }])).toBe(signalMarkersKey([{ time: 1, kind: "top" }]));
    expect(signalMarkersKey([{ time: 1, kind: "top" }])).not.toBe(signalMarkersKey([{ time: 1, kind: "top", live: true }]));
    expect(signalMarkersKey([{ time: 1, kind: "top", state: "confirmed" }])).not.toBe(signalMarkersKey([{ time: 1, kind: "top", state: "strong" }]));
  });
});

describe("price-axis collision guard", () => {
  const toY = (p: number) => 1000 - p; // 1 px per price unit
  const fmt = (p: number) => String(p);
  it("blanks ticks within the gap of a label, keeps the rest", () => {
    const out = filterTickLabels([100, 200, 300], [205, 400], toY, fmt);
    expect(out).toEqual(["100", "", "300"]);
    expect(filterTickLabels([100], [100 + AXIS_LABEL_GAP], toY, fmt)).toEqual(["100"]);
    expect(filterTickLabels([100], [], toY, fmt)).toEqual(["100"]);
    expect(filterTickLabels([100], [100], () => null, fmt)).toEqual(["100"]);
  });
});

describe("pixel-aware right offset", () => {
  it("keeps ≥ 72 px free right of the last bar on dense windows, never fewer than 8 bars", () => {
    expect(rightOffsetBars(42, 1100)).toBe(8); // 4h · 1W: 8 bars are plenty
    const dense = rightOffsetBars(1440, 1100); // 30m · 1M
    expect(dense).toBeGreaterThan(90);
    // free px = offset · width / (bars + offset)
    expect((dense * 1100) / (1440 + dense)).toBeGreaterThanOrEqual(72);
    expect(rightOffsetBars(100, 0)).toBe(8);
  });

  it("rangeForDays takes a function offset of the window's bar count", () => {
    const src = { length: 1000, lastTime: 1_000_000, timeToIndex: () => 500 };
    const r = rangeForDays(src, 7, "30m", (bars) => bars / 10);
    expect(r).toEqual({ from: 499.5, to: 999 + 50 });
  });
});

describe("fitToWidth (window wider than the narrowest bar spacing allows)", () => {
  it("keeps the newest bars that fit and the free space right of the last bar", () => {
    // 1W of 30m (336 bars + offset) on a 220 px time scale at ≥ 3 px per bar → 73 bars
    const r = fitToWidth({ from: 413.5, to: 913 }, 749, 220, 3);
    expect(r.to).toBe(749 + 24);
    expect(r.to - r.from).toBeCloseTo(220 / 3, 6);
    expect(r.from).toBeLessThan(749);
  });
  it("leaves a window that fits untouched", () => {
    const r = { from: 600, to: 760 };
    expect(fitToWidth(r, 749, 1200, 3)).toBe(r);
    expect(fitToWidth(r, 749, 0, 3)).toBe(r);
  });
});
