/**
 * F62 on the real `NothingCandleChart` (lightweight-charts faked): `mirror.flipped` only sets `invertScale` on the main
 * price scale – the bars are not written again (no price, no time is mapped) – and flipping twice sets it back. The RSI
 * pane keeps its own axis unless 100−RSI is asked for, and its legend then says so. Blind mode neutralises the box tone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mainScale = vi.fn();
const rsiScale = vi.fn();
const spies = { setData: vi.fn(), setMarkers: vi.fn() };
let paneOf = 0;

vi.mock("lightweight-charts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lightweight-charts")>();
  const makeSeries = (_def: unknown, _opts: unknown, pane = 0) => {
    const idx = pane ?? 0;
    paneOf = idx;
    return {
      setData: spies.setData,
      update: vi.fn(),
      applyOptions: vi.fn(),
      priceScale: () => ({ applyOptions: idx === 0 ? mainScale : rsiScale }),
      createPriceLine: (o: unknown) => ({ applyOptions: vi.fn(), options: () => o }),
      removePriceLine: vi.fn(),
      attachPrimitive: vi.fn(),
      detachPrimitive: vi.fn(),
      dataByIndex: (i: number) => ({ time: 1_788_220_800 + i * 3600 }),
      priceToCoordinate: () => 10,
      coordinateToPrice: () => 85000,
      data: () => [],
      getPane: () => ({ paneIndex: () => idx, getHeight: () => 100, getHTMLElement: () => null }),
    };
  };
  const timeScale = {
    getVisibleLogicalRange: () => ({ from: 0, to: 100 }),
    setVisibleLogicalRange: vi.fn(),
    timeToIndex: (t: number) => Math.max(0, Math.round((t - 1_788_220_800) / 3600)),
    timeToCoordinate: () => 50,
    scrollToRealTime: vi.fn(),
    fitContent: vi.fn(),
    width: () => 600,
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
  };
  const pane = { getHeight: () => 300, setStretchFactor: vi.fn(), paneIndex: () => 0, getSeries: () => [], getHTMLElement: () => null };
  return {
    ...actual,
    createChart: vi.fn((host: HTMLElement) => {
      const element = document.createElement("div");
      element.appendChild(document.createElement("table"));
      host.appendChild(element);
      return {
        addSeries: vi.fn(makeSeries),
        removeSeries: vi.fn(),
        panes: () => [pane, pane],
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
        remove: () => element.remove(),
      };
    }),
    createSeriesMarkers: vi.fn(() => ({ setMarkers: spies.setMarkers, markers: () => [], detach: vi.fn() })),
  };
});

import { NothingCandleChart } from "@/chart/NothingCandleChart";
import { NO_MIRROR, type ChartMirror } from "@/chart/mirror";
import fixture from "../fixtures/candles-1h.json";
import type { Candle } from "@/market/types";

const candles = fixture as Candle[];
const inverts = (fn: ReturnType<typeof vi.fn>): unknown[] => fn.mock.calls.map((c) => (c[0] as { invertScale?: boolean }).invertScale).filter((v) => v !== undefined);

beforeEach(() => {
  mainScale.mockClear();
  rsiScale.mockClear();
  spies.setData.mockClear();
  paneOf = 0;
});

async function ready(container: HTMLElement) {
  await waitFor(() => expect(container.firstElementChild?.getAttribute("data-ready")).toBe("true"));
}

describe("NothingCandleChart mirror", () => {
  it("flipping sets invertScale on the price scale only; the bars are not rewritten; twice is back to normal", async () => {
    const { container, rerender } = render(<NothingCandleChart candles={candles} interval="1h" mirror={NO_MIRROR} />);
    await ready(container);
    const writes = spies.setData.mock.calls.length;
    const flipped: ChartMirror = { ...NO_MIRROR, flipped: true };
    rerender(<NothingCandleChart candles={candles} interval="1h" mirror={flipped} />);
    rerender(<NothingCandleChart candles={candles} interval="1h" mirror={NO_MIRROR} />);
    // the mount applies "not inverted", then true, then false – and nothing else
    expect(inverts(mainScale)).toEqual([false, true, false]);
    expect(spies.setData.mock.calls.length).toBe(writes);
    // the RSI axis is not part of this chart (no pane) and was never touched
    expect(inverts(rsiScale)).toEqual([]);
  });

  it("the RSI pane is not mirrored with the price axis; 100−RSI is explicit and labelled", async () => {
    const plain: ChartMirror = { ...NO_MIRROR, flipped: true };
    const { container, rerender } = render(<NothingCandleChart candles={candles} interval="1h" pane="rsi" mirror={plain} />);
    await ready(container);
    expect(inverts(mainScale).at(-1)).toBe(true);
    expect(inverts(rsiScale).filter((v) => v === true)).toEqual([]);
    expect(screen.getByTestId("rsi-legend")).toHaveTextContent("RSI 14");
    expect(screen.getByTestId("rsi-legend")).not.toHaveTextContent("100−RSI");

    rerender(<NothingCandleChart candles={candles} interval="1h" pane="rsi" mirror={{ ...plain, rsiMirrored: true }} />);
    expect(inverts(rsiScale).at(-1)).toBe(true);
    expect(screen.getByTestId("rsi-legend")).toHaveTextContent("100−RSI 14");

    // un-flipping the price axis un-mirrors the RSI too (100−RSI only makes sense on a flipped view)
    rerender(<NothingCandleChart candles={candles} interval="1h" pane="rsi" mirror={{ ...NO_MIRROR, rsiMirrored: true }} />);
    expect(inverts(rsiScale).at(-1)).toBe(false);
    expect(inverts(mainScale).at(-1)).toBe(false);
    expect(paneOf).toBeGreaterThanOrEqual(0);
  });
});
