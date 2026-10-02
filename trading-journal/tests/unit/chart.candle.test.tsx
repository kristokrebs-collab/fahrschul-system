import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, createRef } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { motionValue } from "motion/react";

const calls = { create: 0, remove: 0 };
const seriesSpies = { setData: vi.fn(), update: vi.fn(), createPriceLine: vi.fn(), setMarkers: vi.fn() };
const rangeHandlers = new Set<(r: { from: number; to: number } | null) => void>();

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
    subscribeVisibleLogicalRangeChange: (h: (r: { from: number; to: number } | null) => void) => void rangeHandlers.add(h),
    unsubscribeVisibleLogicalRangeChange: (h: (r: { from: number; to: number } | null) => void) => void rangeHandlers.delete(h),
  };
  const pane = { getHeight: () => 300, setStretchFactor: vi.fn() };
  return {
    ...actual,
    createChart: vi.fn(() => {
      calls.create += 1;
      return {
        addSeries: vi.fn(makeSeries),
        removeSeries: vi.fn(),
        panes: () => [pane],
        removePane: vi.fn(),
        timeScale: () => timeScale,
        priceScale: () => ({ width: () => 64, applyOptions: vi.fn() }),
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

import { NothingCandleChart, type BarsListener, type ChartHandle } from "@/chart/NothingCandleChart";
import fixture from "../fixtures/candles-1h.json";
import type { Candle } from "@/market/types";

const candles = fixture as Candle[];
const last = candles[candles.length - 1]!;
const lastSec = last.time / 1000;

beforeEach(() => {
  calls.create = 0;
  calls.remove = 0;
  seriesSpies.setData.mockClear();
  seriesSpies.update.mockClear();
  seriesSpies.setMarkers.mockClear();
  rangeHandlers.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function ready(container: HTMLElement): Promise<void> {
  await waitFor(() => expect(container.firstElementChild?.getAttribute("data-ready")).toBe("true"));
}

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
    expect(rangeHandlers.size).toBe(0);
  });

  it("sets data once, applies live ticks via update and exposes the handle", async () => {
    const ref = createRef<ChartHandle>();
    const outside = vi.fn();
    const markers = [{ id: "t1", time: candles[10]!.time + 60_000, side: "long" as const, entry: 84300, exit: 84900, pnl: 50, result: "win" as const }];
    const { container, rerender } = render(
      <NothingCandleChart ref={ref} candles={candles} interval="1h" markers={markers} onOutsideCount={outside} />,
    );
    await ready(container);
    // candles + volume each get one setData for a single history load (the price pulse is a DOM overlay)
    expect(seriesSpies.setData).toHaveBeenCalledTimes(2);
    expect(seriesSpies.setMarkers).toHaveBeenCalled();
    expect(outside).toHaveBeenLastCalledWith(0);
    expect(ref.current?.chart).not.toBeNull();

    const live: Candle = { ...last, close: last.close + 10, closed: false };
    rerender(<NothingCandleChart ref={ref} candles={candles} interval="1h" markers={markers} onOutsideCount={outside} live={live} />);
    await waitFor(() => expect(seriesSpies.update).toHaveBeenCalled());
    expect(seriesSpies.setData).toHaveBeenCalledTimes(2);
    expect(seriesSpies.update).toHaveBeenCalledWith(expect.objectContaining({ close: last.close + 10 }));

    act(() => {
      ref.current?.fitRange(7, false);
      ref.current?.follow();
    });
    expect(ref.current?.takeScreenshot()).toBeInstanceOf(HTMLCanvasElement);
  });

  it("moves the forming candle with every trade print and places the price pulse", async () => {
    const price = motionValue(0);
    const tradeTime = motionValue(0);
    const { container } = render(<NothingCandleChart candles={candles} interval="1h" price={price} tradeTime={tradeTime} />);
    await ready(container);
    seriesSpies.update.mockClear();

    const p = last.high + 25;
    act(() => {
      tradeTime.set(last.time + 600_000);
      price.set(p);
    });
    // high widens at once and the close jumps onto the print (the live canvas never glides)
    await waitFor(() => expect(seriesSpies.update).toHaveBeenCalledWith(expect.objectContaining({ time: lastSec, open: last.open, high: p, close: p })), { timeout: 3000 });
    expect(seriesSpies.setData).toHaveBeenCalledTimes(2);
    const pulse = container.querySelector<HTMLElement>("[data-fx='price-pulse']");
    await waitFor(() => expect(pulse?.style.opacity).toBe("1"));
    expect(pulse?.style.transform).toBe("translate3d(50px, 10px, 0)");
    expect(pulse?.getAttribute("aria-hidden")).toBe("true");

    // the first print of the next hour opens a new bar on that print
    const q = p - 40;
    act(() => {
      tradeTime.set(last.time + 3_600_000 + 2_000);
      price.set(q);
    });
    await waitFor(() => expect(seriesSpies.update).toHaveBeenCalledWith({ time: lastSec + 3600, open: q, high: q, low: q, close: q }));
  });

  it("never lets an older kline pull the close back, but takes its range", async () => {
    const price = motionValue(0);
    const tradeTime = motionValue(0);
    let push: BarsListener | null = null;
    const subscribeBars = (l: BarsListener) => {
      push = l;
      return () => {
        push = null;
      };
    };
    const { container } = render(<NothingCandleChart candles={candles} interval="1h" price={price} tradeTime={tradeTime} subscribeBars={subscribeBars} />);
    await ready(container);
    const p = last.close + 5;
    act(() => {
      tradeTime.set(last.time + 900_000);
      price.set(p);
    });
    await waitFor(() => expect(seriesSpies.update).toHaveBeenCalledWith(expect.objectContaining({ close: p })), { timeout: 3000 });
    seriesSpies.update.mockClear();

    // a kline 1 s older than the print, with a lower close and a deeper low
    const low = last.low - 100;
    act(() => push?.([{ ...last, close: last.close - 50, low, closed: false }], last.time + 899_000));
    await waitFor(() => expect(seriesSpies.update).toHaveBeenCalledWith(expect.objectContaining({ time: lastSec, low, close: p })));
    expect(seriesSpies.update).not.toHaveBeenCalledWith(expect.objectContaining({ time: lastSec, close: last.close - 50 }));
  });

  it("shows the follow pill only while the live bar is out of view", async () => {
    const { container } = render(<NothingCandleChart candles={candles} interval="1h" followLabel="Folgen" />);
    await ready(container);
    expect(screen.queryByRole("button", { name: "Folgen" })).toBeNull();
    act(() => {
      for (const h of rangeHandlers) h({ from: 10, to: 120 });
    });
    const pill = await screen.findByRole("button", { name: "Folgen" });
    expect(pill.style.right).toBe("76px");
    act(() => {
      for (const h of rangeHandlers) h({ from: 150, to: candles.length - 1 + 8 });
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Folgen" })).toBeNull());
  });

  it("hides the follow pill and the pulse while paused (collapsed card)", async () => {
    const price = motionValue(0);
    const tradeTime = motionValue(0);
    const { container, rerender } = render(<NothingCandleChart candles={candles} interval="1h" price={price} tradeTime={tradeTime} followLabel="Folgen" />);
    await ready(container);
    act(() => {
      tradeTime.set(last.time + 60_000);
      price.set(last.close + 1);
    });
    const pulse = container.querySelector<HTMLElement>("[data-fx='price-pulse']");
    await waitFor(() => expect(pulse?.style.opacity).toBe("1"));
    rerender(<NothingCandleChart candles={candles} interval="1h" price={price} tradeTime={tradeTime} followLabel="Folgen" paused />);
    act(() => {
      for (const h of rangeHandlers) h({ from: 10, to: 120 });
    });
    await waitFor(() => expect(pulse?.style.opacity).toBe("0"));
    expect(screen.queryByRole("button", { name: "Folgen" })).toBeNull();
  });
});
