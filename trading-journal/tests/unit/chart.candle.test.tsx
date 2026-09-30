import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, createRef } from "react";
import { act, render, waitFor } from "@testing-library/react";

const calls = { create: 0, remove: 0 };
const seriesSpies = { setData: vi.fn(), update: vi.fn(), createPriceLine: vi.fn(), setMarkers: vi.fn() };

vi.mock("lightweight-charts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lightweight-charts")>();
  const makeSeries = () => ({
    setData: seriesSpies.setData,
    update: seriesSpies.update,
    applyOptions: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
    createPriceLine: (o: unknown) => {
      seriesSpies.createPriceLine(o);
      return { applyOptions: vi.fn(), options: () => o };
    },
    removePriceLine: vi.fn(),
    attachPrimitive: vi.fn(),
    detachPrimitive: vi.fn(),
    dataByIndex: (i: number) => ({ time: 1_788_220_800 + i * 3600 }),
    priceToCoordinate: () => 10,
    coordinateToPrice: () => 85000,
    data: () => [],
  });
  const timeScale = {
    getVisibleLogicalRange: () => ({ from: 0, to: 100 }),
    setVisibleLogicalRange: vi.fn(),
    timeToIndex: (t: number) => Math.max(0, Math.round((t - 1_788_220_800) / 3600)),
    timeToCoordinate: () => 50,
    scrollToRealTime: vi.fn(),
    fitContent: vi.fn(),
    width: () => 600,
  };
  return {
    ...actual,
    createChart: vi.fn(() => {
      calls.create += 1;
      return {
        addSeries: vi.fn(makeSeries),
        removeSeries: vi.fn(),
        panes: () => [],
        removePane: vi.fn(),
        timeScale: () => timeScale,
        subscribeCrosshairMove: vi.fn(),
        unsubscribeCrosshairMove: vi.fn(),
        subscribeClick: vi.fn(),
        unsubscribeClick: vi.fn(),
        applyOptions: vi.fn(),
        takeScreenshot: () => document.createElement("canvas"),
        remove: () => {
          calls.remove += 1;
        },
      };
    }),
    createSeriesMarkers: vi.fn(() => ({ setMarkers: seriesSpies.setMarkers, markers: () => [], detach: vi.fn() })),
  };
});

import { NothingCandleChart, type ChartHandle } from "@/chart/NothingCandleChart";
import fixture from "../fixtures/candles-1h.json";
import type { Candle } from "@/market/types";

const candles = fixture as Candle[];

beforeEach(() => {
  calls.create = 0;
  calls.remove = 0;
  seriesSpies.setData.mockClear();
  seriesSpies.update.mockClear();
  seriesSpies.setMarkers.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("NothingCandleChart", () => {
  it("shows the skeleton while candles are empty", () => {
    const { getByRole } = render(<NothingCandleChart candles={[]} interval="1h" />);
    expect(getByRole("img", { name: "Chart wird geladen" })).toBeInTheDocument();
  });

  it("creates and destroys the chart symmetrically under StrictMode", () => {
    const { unmount } = render(
      <StrictMode>
        <NothingCandleChart candles={[]} interval="1h" />
      </StrictMode>,
    );
    unmount();
    expect(calls.create).toBeGreaterThan(0);
    expect(calls.remove).toBe(calls.create);
  });

  it("sets data once, applies live ticks via update and exposes the handle", async () => {
    const ref = createRef<ChartHandle>();
    const outside = vi.fn();
    const markers = [{ id: "t1", time: candles[10]!.time + 60_000, side: "long" as const, entry: 84300, exit: 84900, pnl: 50, result: "win" as const }];
    const { container, rerender } = render(
      <NothingCandleChart ref={ref} candles={candles} interval="1h" markers={markers} onOutsideCount={outside} />,
    );
    await waitFor(() => expect(container.firstElementChild?.getAttribute("data-ready")).toBe("true"));
    // candles + volume + pulse each get one setData for a single history load
    expect(seriesSpies.setData).toHaveBeenCalledTimes(3);
    expect(seriesSpies.setMarkers).toHaveBeenCalled();
    expect(outside).toHaveBeenLastCalledWith(0);
    expect(ref.current?.chart).not.toBeNull();

    const last = candles[candles.length - 1]!;
    const live: Candle = { ...last, close: last.close + 10, closed: false };
    rerender(<NothingCandleChart ref={ref} candles={candles} interval="1h" markers={markers} onOutsideCount={outside} live={live} />);
    await waitFor(() => expect(seriesSpies.update).toHaveBeenCalled());
    expect(seriesSpies.setData).toHaveBeenCalledTimes(3);
    expect(seriesSpies.update).toHaveBeenCalledWith(expect.objectContaining({ close: last.close + 10 }));

    act(() => {
      ref.current?.fitRange(7, false);
      ref.current?.follow();
    });
    expect(ref.current?.takeScreenshot()).toBeInstanceOf(HTMLCanvasElement);
  });
});
