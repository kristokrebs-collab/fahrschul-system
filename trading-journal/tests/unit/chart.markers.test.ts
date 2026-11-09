import { describe, expect, it } from "vitest";
import { MismatchDirection, type UTCTimestamp } from "lightweight-charts";
import {
  boundsOf,
  buildMarkers,
  exitTone,
  hitMarker,
  isInsideHistory,
  markerTradeId,
  snapTime,
  toTradeMarkers,
  type SnapSource,
  type TradeMarker,
} from "@/chart/markers";
import fixture from "../fixtures/candles-1h.json";
import type { Candle } from "@/market/types";

const candles = fixture as Candle[];
const times = candles.map((c) => Math.floor(c.time / 1000));
const first = times[0]!;
const last = times[times.length - 1]!;

/** Fake time scale + series that behaves like lightweight-charts for regular 1h data. */
const src: SnapSource = {
  timeToIndex(time, findNearest) {
    const t = time as number;
    const exact = times.indexOf(t);
    if (exact >= 0) return exact;
    if (!findNearest) return null;
    if (t < first) return 0;
    if (t > last) return times.length - 1;
    return times.findIndex((x) => x > t);
  },
  dataByIndex(index, dir) {
    if (index < 0 || index >= times.length) return null;
    const i = dir === MismatchDirection.NearestLeft ? index : index;
    return { time: times[i] as UTCTimestamp };
  },
};

const bounds = boundsOf(times.map((t) => ({ time: t as UTCTimestamp })), 3600)!;

function trade(over: Partial<TradeMarker> = {}): TradeMarker {
  return { id: "t1", time: (first + 5 * 3600 + 1200) * 1000, side: "long", entry: 84300, exit: 85100, pnl: 120.5, result: "win", ...over };
}

describe("snapTime", () => {
  it("snaps an exact candle open to itself", () => {
    expect(snapTime(src, first + 3600)).toBe(first + 3600);
  });
  it("snaps a mid-candle time to a candle time", () => {
    const t = snapTime(src, first + 5 * 3600 + 1200);
    expect(times).toContain(t);
  });
  it("returns null when the index cannot be resolved", () => {
    expect(snapTime({ timeToIndex: () => null, dataByIndex: () => null }, first)).toBeNull();
  });
});

describe("bounds", () => {
  it("counts the last bar as inside for its whole interval", () => {
    expect(isInsideHistory(last + 3599, bounds)).toBe(true);
    expect(isInsideHistory(last + 3600, bounds)).toBe(false);
    expect(isInsideHistory(first - 1, bounds)).toBe(false);
  });
});

describe("buildMarkers", () => {
  const snap = (t: number) => snapTime(src, t);

  it("creates entry + exit markers with journal colours and ids", () => {
    const built = buildMarkers([trade()], snap, bounds);
    expect(built.outside).toBe(0);
    expect(built.markers).toHaveLength(2);
    const [entry, exit] = built.markers;
    expect(entry).toMatchObject({ id: "e:t1", shape: "arrowUp", color: "#3ddc84", position: "atPriceMiddle", price: 84300, text: "▲ Long" });
    expect(exit).toMatchObject({ id: "x:t1", shape: "circle", color: "#3ddc84", price: 85100, text: "+120,50" });
    expect(built.byId.get("e:t1")).toBe("t1");
    expect(built.byId.get("x:t1")).toBe("t1");
  });

  it("uses ▼ / red for shorts and tones the exit by result", () => {
    const built = buildMarkers([trade({ side: "short", result: "loss", pnl: -40 })], snap, bounds);
    expect(built.markers[0]).toMatchObject({ shape: "arrowDown", color: "#ff4d4f", text: "▼ Short" });
    expect(built.markers[1]).toMatchObject({ color: "#ff4d4f", text: "−40,00" });
    expect(exitTone("be")).toBe("#9b9b9b");
    expect(exitTone("open")).toBe("#f2f2f2");
  });

  it("omits open trades' exit and counts trades outside the history", () => {
    const built = buildMarkers(
      [trade({ exit: null, pnl: null, result: "open" }), trade({ id: "old", time: (first - 86400) * 1000 }), trade({ id: "future", time: (last + 7200) * 1000 })],
      snap,
      bounds,
    );
    expect(built.markers).toHaveLength(1);
    expect(built.outside).toBe(2);
  });

  it("drops everything without bounds", () => {
    expect(buildMarkers([trade()], snap, null)).toMatchObject({ outside: 1, markers: [] });
  });

  it("sorts markers by time", () => {
    const built = buildMarkers([trade({ id: "b", time: (first + 10 * 3600) * 1000 }), trade({ id: "a", time: (first + 2 * 3600) * 1000 })], snap, bounds);
    const ts = built.markers.map((m) => m.time as number);
    expect([...ts].sort((x, y) => x - y)).toEqual(ts);
  });
});

describe("marker lookup", () => {
  it("maps marker ids back to trade ids", () => {
    expect(markerTradeId("e:abc")).toBe("abc");
    expect(markerTradeId("x:abc")).toBe("abc");
    expect(markerTradeId("zone")).toBeNull();
    expect(markerTradeId(undefined)).toBeNull();
  });

  it("hitMarker picks the closest marker within the radius", () => {
    const built = buildMarkers([trade(), trade({ id: "t2", entry: 86000, exit: null, result: "open", pnl: null })], (t) => snapTime(src, t), bounds);
    const toX = () => 100;
    const toY = (price: number) => (price - 84000) / 10; // 84300 → 30, 85100 → 110, 86000 → 200
    expect(hitMarker(built.markers, { x: 104, y: 34 }, toX, toY)).toBe("t1");
    expect(hitMarker(built.markers, { x: 100, y: 205 }, toX, toY)).toBe("t2");
    expect(hitMarker(built.markers, { x: 100, y: 160 }, toX, toY)).toBeNull();
  });
});

describe("toTradeMarkers", () => {
  it("derives the trade time from `date` (local wall clock)", () => {
    const [m] = toTradeMarkers([{ id: "x", side: "long", entry: 1, exit: null, pnl: null, result: "open", date: "2026-09-03T10:30", createdAt: "" }]);
    expect(m?.time).toBe(new Date("2026-09-03T10:30").getTime());
  });
});
