/**
 * The Zeitmaschine slot of the Handelsplan: nothing loads before the click, the Labor's loader is asked for the longer history of
 * the plan's market and timeframe, the card gets the closed candles and the plan's prices, and every failure keeps its reason.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const load = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/views/labor/historySource", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/views/labor/historySource")>();
  return { ...actual, loadLabData: load.fn };
});
vi.mock("@/views/timemachine/TimeMachineCard", () => ({
  default: (p: { symbol: string; entry: number; stop: number; target: number; interval: string; candles: readonly unknown[] }) => (
    <div data-testid="tm-card-stub">{`${p.symbol} ${p.interval} ${p.entry}/${p.stop}/${p.target} · ${p.candles.length}`}</div>
  ),
}));

const { TimeMachineSlotImpl } = await import("@/views/plan/slotsImpl");

const PLAN = {
  symbol: "BTCUSDT",
  side: "long" as const,
  entry: 100,
  stop: 98,
  target: 104,
  qty: 1,
  candles: [],
  intervalMs: 900_000,
  sessionOpenMs: 0,
  sessionCloseMs: 1,
  tz: "UTC",
  entryAt: null,
  flatByMs: null,
  tick: 0.1,
  currency: "USDT",
  source: { label: "Binance USDⓈ-M", fetchedAt: 1 },
};

/** closed 15m bars, oldest first, in the loader's shape (seconds) */
const bars = (n: number) => {
  const end = Math.floor(Date.now() / 900_000) * 900_000 - 900_000;
  return Array.from({ length: n }, (_, i) => ({ t: (end - (n - 1 - i) * 900_000) / 1000, o: 100, h: 101, l: 99, c: 100, v: 1 }));
};

afterEach(() => load.fn.mockReset());

describe("Zeitmaschine slot of the Handelsplan", () => {
  it("loads nothing before the click and says what it will load", () => {
    render(<TimeMachineSlotImpl {...PLAN} />);
    expect(screen.getByTestId("hplan-timemachine")).toHaveAttribute("data-state", "idle");
    expect(screen.getByTestId("hplan-timemachine")).toHaveTextContent("erst nach deinem Klick");
    expect(load.fn).not.toHaveBeenCalled();
  });

  it("asks the Labor loader for the plan's market and timeframe and hands the closed candles to the card", async () => {
    load.fn.mockResolvedValue({ data: { "15m": bars(400) }, pages: 1 });
    render(<TimeMachineSlotImpl {...PLAN} />);
    fireEvent.click(screen.getByTestId("hplan-timemachine-start"));
    expect(await screen.findByTestId("tm-card-stub")).toHaveTextContent("BTCUSDT 15m 100/98/104 · 400");
    expect(load.fn).toHaveBeenCalledTimes(1);
    expect(load.fn.mock.calls[0]![0]).toMatchObject({ symbol: "BTCUSDT", intervals: ["15m"], funding: false });
  });

  it("replays a 5-minute plan on 15-minute candles and says so", () => {
    render(<TimeMachineSlotImpl {...PLAN} intervalMs={300_000} />);
    expect(screen.getByTestId("hplan-timemachine")).toHaveTextContent("15-Minuten-Kerzen");
  });

  it("keeps the reason when the exchange does not know the market or there are too few candles", async () => {
    load.fn.mockResolvedValue({ data: { "15m": bars(20) }, pages: 1 });
    render(<TimeMachineSlotImpl {...PLAN} />);
    fireEvent.click(screen.getByTestId("hplan-timemachine-start"));
    expect(await screen.findByTestId("hplan-timemachine-error")).toHaveTextContent("nur 20 Kerzen");
    expect(screen.queryByTestId("tm-card-stub")).toBeNull();
  });

  it("cancels a running load without leaving a half state", async () => {
    let signal: AbortSignal | undefined;
    load.fn.mockImplementation((o: { signal: AbortSignal }) => {
      signal = o.signal;
      return new Promise(() => undefined);
    });
    render(<TimeMachineSlotImpl {...PLAN} />);
    fireEvent.click(screen.getByTestId("hplan-timemachine-start"));
    fireEvent.click(await screen.findByTestId("hplan-timemachine-cancel"));
    await waitFor(() => expect(screen.getByTestId("hplan-timemachine")).toHaveAttribute("data-state", "idle"));
    expect(signal?.aborted).toBe(true);
  });
});
