import { describe, expect, it, vi } from "vitest";
import { LineStyle, type ISeriesApi } from "lightweight-charts";
import { LEVEL_KEYS, LEVEL_STYLES, clearLevels, levelColor, levelWidth, setLevels, zoneIsSet } from "@/chart/levels";
import { ZonePrimitive, positionsBox } from "@/chart/primitives/ZonePrimitive";
import type { MarketLevels } from "@/domain/types";

const levels: MarketLevels = {
  symbol: "BINANCE:BTCUSDT",
  longTrigger: 85900,
  longStop: 85300,
  shortTrigger: 84500,
  lowerHigh: 82829,
  rsiWeekly: 62.09,
  invalidation: 75500,
  zoneLow: 81500,
  zoneHigh: 82200,
};

function fakeSeries() {
  const created: { opts: Record<string, unknown>; applyOptions: ReturnType<typeof vi.fn> }[] = [];
  const series = {
    createPriceLine: vi.fn((opts: Record<string, unknown>) => {
      const line = { opts, applyOptions: vi.fn(), options: () => opts };
      created.push(line);
      return line;
    }),
    removePriceLine: vi.fn(),
    attachPrimitive: vi.fn(),
    detachPrimitive: vi.fn(),
  };
  return { series: series as unknown as ISeriesApi<"Candlestick">, created, raw: series };
}

describe("level styles", () => {
  it("keeps the grey ramp and reserves red for the hard invalidation", () => {
    expect(levelColor("invalidation")).toBe("#e5202e");
    for (const key of LEVEL_KEYS.filter((k) => k !== "invalidation")) expect(levelColor(key)).not.toBe("#e5202e");
    expect(levelColor("longTrigger")).toBe("#f2f2f2");
    expect(levelColor("longStop")).toBe("#9b9b9b");
    expect(levelColor("lowerHigh")).toBe("#5f5f5f");
    expect(LEVEL_STYLES.invalidation.lineStyle).toBe(LineStyle.Dashed);
  });

  it("carries the German settings labels", () => {
    expect(LEVEL_STYLES.longTrigger.label).toBe("Long-Trigger (4H über)");
    expect(LEVEL_STYLES.shortTrigger.label).toBe("Short-Trigger (4H unter)");
    expect(LEVEL_STYLES.longStop.label).toBe("Long-Invalidierung");
    expect(LEVEL_STYLES.invalidation.label).toBe("Harte Invalidierung");
  });

  it("highlights the active scenario's trigger", () => {
    expect(levelWidth("longTrigger", "long")).toBe(2);
    expect(levelWidth("shortTrigger", "long")).toBe(1);
    expect(levelWidth("shortTrigger", "short")).toBe(2);
    expect(levelWidth("invalidation", "short")).toBe(1);
  });
});

describe("setLevels", () => {
  it("creates five lines + a zone, then updates in place", () => {
    const { series, created, raw } = fakeSeries();
    const handle = setLevels(series, levels, null, { reducedMotion: true, from: 1 as never });
    expect(raw.createPriceLine).toHaveBeenCalledTimes(5);
    expect(raw.attachPrimitive).toHaveBeenCalledTimes(1);
    expect(created.map((l) => l.opts.price)).toEqual([85900, 85300, 84500, 75500, 82829]);
    expect(created[3]?.opts).toMatchObject({ color: "#e5202e", title: "HART" });
    expect(handle.zone).toBeInstanceOf(ZonePrimitive);
    expect(handle.zone.range).toMatchObject({ low: 81500, high: 82200 });

    const same = setLevels(series, { ...levels, longTrigger: 86100, zoneLow: 82400 }, handle, { active: "long" });
    expect(same).toBe(handle);
    expect(raw.createPriceLine).toHaveBeenCalledTimes(5);
    expect(created[0]?.applyOptions).toHaveBeenCalledWith(expect.objectContaining({ price: 86100, lineWidth: 2 }));
    expect(handle.zone.range).toMatchObject({ low: 82200, high: 82400 });

    clearLevels(series, handle);
    expect(raw.removePriceLine).toHaveBeenCalledTimes(5);
    expect(raw.detachPrimitive).toHaveBeenCalledWith(handle.zone);
  });

  it("hides lines for non-finite prices", () => {
    const { series, created } = fakeSeries();
    setLevels(series, { ...levels, lowerHigh: Number.NaN }, null, { reducedMotion: true });
    expect(created[4]?.opts).toMatchObject({ lineVisible: false, axisLabelVisible: false });
  });

  it("treats 0 as not set: no line, no axis label, no zone band (share edition)", () => {
    const { series, created } = fakeSeries();
    const unset = { ...levels, longTrigger: 0, longStop: 0, shortTrigger: 0, invalidation: 0, lowerHigh: 0, zoneLow: 0, zoneHigh: 0 };
    expect(zoneIsSet(unset)).toBe(false);
    expect(zoneIsSet(levels)).toBe(true);
    const handle = setLevels(series, unset, null, { reducedMotion: true });
    for (const l of created) expect(l.opts).toMatchObject({ lineVisible: false, axisLabelVisible: false });
    // a hidden band never pulls the autoscale down to 0
    expect(handle.zone.autoscaleInfo(0 as never, 1 as never)).toBeNull();
    setLevels(series, levels, handle, {});
    expect(handle.zone.options.opacity).toBe(1);
  });
});

describe("ZonePrimitive", () => {
  it("reports its band to autoscale and hit-tests as 'zone'", () => {
    const zone = new ZonePrimitive({ low: 100, high: 120 });
    expect(zone.autoscaleInfo(0 as never, 1 as never)).toEqual({ priceRange: { minValue: 100, maxValue: 120 } });
    zone.applyOptions({ opacity: 0 });
    expect(zone.autoscaleInfo(0 as never, 1 as never)).toBeNull();
    expect(zone.priceAxisViews()).toHaveLength(2);
    // edge prices on the axis (high first), the `Zone` caption is drawn inside the band
    expect(zone.priceAxisViews()[0]?.text()).toBe("120");
    expect(zone.priceAxisViews()[1]?.text()).toBe("100");
    expect(zone.options.label).toBe("Zone");
    expect(zone.hitTest(10, 10)).toBeNull(); // not attached → no coordinates
  });

  it("positionsBox is pixel aligned", () => {
    expect(positionsBox(10.2, 20.7, 2)).toEqual({ position: 20, length: 22 });
  });
});
