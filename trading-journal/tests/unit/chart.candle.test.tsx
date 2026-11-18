import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Activity, StrictMode, createRef } from "react";
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
    // P02: the RSI pane resolves its pane from its series (never a hard-coded index)
    getPane: () => ({ paneIndex: () => 1, getHeight: () => 100, getHTMLElement: () => null }),
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
  const pane = { getHeight: () => 300, setStretchFactor: vi.fn(), paneIndex: () => 0, getSeries: () => [], getHTMLElement: () => null };
  return {
    ...actual,
    createChart: vi.fn((host: HTMLElement) => {
      calls.create += 1;
      // what lightweight-charts appends to its host: a div holding a <table> of canvases
      const element = document.createElement("div");
      element.appendChild(document.createElement("table"));
      host.appendChild(element);
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
        chartElement: () => element,
        remove: () => {
          calls.remove += 1;
          element.remove();
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

  it("a copy of the same bars landing before the reveal frames still reveals the chart (no skeleton forever)", async () => {
    const { container, rerender } = render(<NothingCandleChart candles={candles} interval="1h" />);
    // the first apply ran (font promise settled) and drew the bars; its two reveal frames are still pending
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(seriesSpies.setData).toHaveBeenCalledTimes(2);
    expect(container.firstElementChild?.getAttribute("data-ready")).toBe("false");
    // a new array identity with the same bars (a feed re-emit / a loaded box cancels those frames): the tail path
    rerender(<NothingCandleChart candles={[...candles]} interval="1h" />);
    await ready(container);
    expect(seriesSpies.setData).toHaveBeenCalledTimes(2);
  });

  it("data-settled: true once the bars are drawn, false while a range morph runs, true again once it landed", async () => {
    const { container, rerender } = render(<NothingCandleChart candles={candles} interval="1h" rangeDays={30} />);
    const settled = () => container.firstElementChild?.getAttribute("data-settled");
    await ready(container);
    await waitFor(() => expect(settled()).toBe("true"));
    rerender(<NothingCandleChart candles={candles} interval="1h" rangeDays={7} />);
    expect(settled()).toBe("false");
    await waitFor(() => expect(settled()).toBe("true"), { timeout: 5_000 });
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
  it("keeps the chart while a keep-alive <Activity> hides it: no re-create, no setData on the way back", async () => {
    const markers = [{ id: "t1", time: candles[10]!.time + 60_000, side: "long" as const, entry: 84300, exit: 84900, pnl: 50, result: "win" as const }];
    const view = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <NothingCandleChart candles={candles} interval="1h" markers={markers} />
      </Activity>
    );
    const { container, rerender, unmount } = render(view("visible"));
    await ready(container);
    expect(calls.create).toBe(1);
    seriesSpies.setData.mockClear();
    seriesSpies.setMarkers.mockClear();
    rerender(view("hidden"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // the hidden page holds no table of canvases
    expect(container.querySelector("table")).toBeNull();
    rerender(view("visible"));
    expect(container.querySelector("[role=img][aria-label=Kerzenchart] table")).not.toBeNull();
    await ready(container);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(calls.create).toBe(1);
    expect(calls.remove).toBe(0);
    expect(seriesSpies.setData).not.toHaveBeenCalled();
    expect(seriesSpies.setMarkers).not.toHaveBeenCalled();
    unmount();
    expect(calls.remove).toBe(1);
    expect(rangeHandlers.size).toBe(0);
  });

  it("tears a parked chart down once its hidden host left the document", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const view = (mode: "visible" | "hidden", on = true) => <Activity mode={mode}>{on ? <NothingCandleChart candles={candles} interval="1h" /> : null}</Activity>;
      const { rerender } = render(view("visible"));
      expect(calls.create).toBe(1);
      rerender(view("hidden"));
      // unmounted while hidden: React runs no cleanup, the sweep finds the detached host
      rerender(view("hidden", false));
      expect(calls.remove).toBe(0);
      vi.advanceTimersByTime(10_000);
      expect(calls.remove).toBe(1);
      expect(rangeHandlers.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("P02: the RSI pane gets the RSI of the chart's bars and a legend; Box-zu-Box boxes are a primitive, set once per identity", async () => {
    const boxes = [{ id: "b1", from: candles[20]!.time, to: null, top: 85_000, btm: 84_000, tone: "neutral" as const, active: true }];
    const { container, rerender } = render(<NothingCandleChart candles={candles} interval="1h" pane="rsi" boxes={boxes} />);
    await ready(container);
    // candles + volume + the RSI line (values 0..100 on the candle grid, whitespace lead-in)
    const rsiCall = seriesSpies.setData.mock.calls.find((c) => (c[0] as Array<{ value?: number }>).some((p) => typeof p.value === "number" && p.value >= 0 && p.value <= 100) && (c[0] as unknown[]).length === candles.length);
    expect(rsiCall).toBeDefined();
    expect("value" in (rsiCall![0] as object[])[0]!).toBe(false);
    // reference lines 70 / 50 / 30
    for (const price of [70, 50, 30]) expect(seriesSpies.createPriceLine).toHaveBeenCalledWith(expect.objectContaining({ price, axisLabelVisible: false }));
    const legend = screen.getByTestId("rsi-legend");
    expect(legend.getAttribute("aria-hidden")).toBeNull();
    await waitFor(() => expect(legend.textContent).toMatch(/^RSI 14\d+,\d$/));
    // the same boxes again: nothing re-set; switching the pane off removes the legend
    rerender(<NothingCandleChart candles={candles} interval="1h" pane="none" boxes={boxes} />);
    expect(screen.queryByTestId("rsi-legend")).toBeNull();
  });
});
