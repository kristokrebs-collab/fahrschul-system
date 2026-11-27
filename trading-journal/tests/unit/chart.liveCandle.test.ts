import { describe, expect, it, vi } from "vitest";
import { motionValue } from "motion/react";
import type { UTCTimestamp } from "lightweight-charts";
import { LiveCandle, bucketOpen, extendsTail, reconcileBar, tradeStep, withClose, type Bar } from "@/chart/liveCandle";
import { isAwayFromRealtime } from "@/chart/overlays";
import type { Candle } from "@/market/types";

const H = 3_600_000;
const T0 = 1_788_220_800_000; // 2026-09-01 00:00 UTC (a Tuesday)
const s = (ms: number) => (ms / 1000) as UTCTimestamp;
const bar = (ms: number, o: number, h: number, l: number, c: number): Bar => ({ time: s(ms), open: o, high: h, low: l, close: c });
const candle = (ms: number, o: number, h: number, l: number, c: number, volume = 10, closed = false): Candle => ({ time: ms, open: o, high: h, low: l, close: c, volume, closed });

describe("bucketOpen / tradeStep", () => {
  it("aligns minute, hour and 4h buckets to the epoch", () => {
    expect(bucketOpen(T0 + 59_999, "1m")).toBe(T0);
    expect(bucketOpen(T0 + H - 1, "1h")).toBe(T0);
    expect(bucketOpen(T0 + H, "1h")).toBe(T0 + H);
    expect(bucketOpen(T0 + 5 * H, "4h")).toBe(T0 + 4 * H);
  });

  it("opens weekly buckets on Monday 00:00 UTC like Binance", () => {
    const monday = Date.UTC(2026, 7, 31); // 2026-08-31 is a Monday
    expect(new Date(monday).getUTCDay()).toBe(1);
    expect(bucketOpen(T0 + 3 * 86_400_000, "1w")).toBe(monday);
    expect(bucketOpen(monday, "1w")).toBe(monday);
    expect(bucketOpen(monday - 1, "1w")).toBe(monday - 7 * 86_400_000);
  });

  it("merges into the last bar, opens only the next one and skips everything else", () => {
    expect(tradeStep(s(T0), T0 + 1000, "1h")).toBe("merge");
    expect(tradeStep(s(T0), T0 + H + 1, "1h")).toBe("open");
    expect(tradeStep(s(T0), T0 + 2 * H + 1, "1h")).toBe("skip"); // gap: the kline stream fills it
    expect(tradeStep(s(T0), T0 - 1, "1h")).toBe("skip");
    expect(tradeStep(s(T0), 0, "1h")).toBe("skip");
  });
});

describe("withClose / reconcileBar", () => {
  it("keeps high/low around open, close and the raw print", () => {
    expect(withClose(bar(T0, 100, 105, 95, 101), 108)).toEqual(bar(T0, 100, 108, 95, 108));
    expect(withClose(bar(T0, 100, 105, 95, 101), 99, 90)).toEqual(bar(T0, 100, 105, 90, 99));
  });

  it("keeps the live close while trades are ahead of the kline, otherwise the kline wins", () => {
    const kline = bar(T0, 100, 110, 90, 95);
    const live = bar(T0, 100, 112, 96, 104);
    expect(reconcileBar(kline, live, true)).toEqual(bar(T0, 100, 112, 90, 104));
    expect(reconcileBar(kline, live, false)).toBe(kline);
    expect(reconcileBar(kline, bar(T0 + H, 1, 1, 1, 1), true)).toBe(kline);
  });
});

describe("extendsTail / isAwayFromRealtime", () => {
  const prev = [{ time: 1 }, { time: 2 }, { time: 3 }];
  it("accepts the same history plus up to two bars on the right", () => {
    expect(extendsTail(prev, [...prev])).toBe(true);
    expect(extendsTail(prev, [...prev, { time: 4 }, { time: 5 }])).toBe(true);
    expect(extendsTail(prev, [...prev, { time: 4 }, { time: 5 }, { time: 6 }])).toBe(false);
    expect(extendsTail(prev, [{ time: 0 }, ...prev])).toBe(false); // older bars → setData
    expect(extendsTail(prev, prev.slice(0, 2))).toBe(false);
    expect(extendsTail([], prev)).toBe(false);
  });

  it("flags a live bar that left the visible range", () => {
    expect(isAwayFromRealtime({ from: 100, to: 208 }, 200)).toBe(false);
    expect(isAwayFromRealtime({ from: 50, to: 150 }, 200)).toBe(true);
    expect(isAwayFromRealtime({ from: 205, to: 300 }, 200)).toBe(true);
    expect(isAwayFromRealtime(null, 200)).toBe(false);
  });
});

function setup(opts: { active?: boolean } = {}) {
  const host = { data: [bar(T0 - H, 90, 101, 89, 100), bar(T0, 100, 105, 95, 102)] };
  const candles = { update: vi.fn() };
  const volume = { update: vi.fn() };
  let queued: (() => void) | null = null;
  const state = { active: opts.active ?? true };
  const onAppend = vi.fn();
  const onPush = vi.fn();
  const live = new LiveCandle({
    host,
    target: { candles, volume },
    isActive: () => state.active,
    isSmooth: () => false,
    minMove: 0.1,
    onAppend,
    onPush,
    schedule: (cb) => {
      queued = cb;
      return () => {
        queued = null;
      };
    },
  });
  live.reset("1h", 50);
  const flush = () => {
    const cb = queued;
    queued = null;
    cb?.();
  };
  flush(); // the reset jump settles without a push
  return { host, candles, volume, live, flush, state, onAppend, onPush };
}

describe("LiveCandle", () => {
  it("merges prints into the forming bar, one push per frame", () => {
    const { host, candles, flush, live, onPush } = setup();
    expect(candles.update).not.toHaveBeenCalled();
    live.trade(107, T0 + 10_000);
    live.trade(94, T0 + 20_000);
    live.trade(99, T0 + 30_000);
    flush();
    expect(candles.update).toHaveBeenCalledTimes(1);
    expect(candles.update).toHaveBeenLastCalledWith(bar(T0, 100, 107, 94, 99));
    expect(host.data).toHaveLength(2);
    expect(onPush).toHaveBeenCalledTimes(1);
    // nothing new → nothing pushed
    flush();
    live.resume();
    flush();
    expect(candles.update).toHaveBeenCalledTimes(1);
  });

  it("opens the next bar on its first print and finalises the previous one on its last print", () => {
    const { host, candles, flush, live, onAppend } = setup();
    live.trade(104, T0 + 50_000);
    live.trade(103, T0 + H + 1_000);
    flush();
    expect(onAppend).toHaveBeenCalledTimes(1);
    expect(host.data).toHaveLength(3);
    expect(candles.update).toHaveBeenNthCalledWith(1, bar(T0, 100, 105, 95, 104), false);
    expect(candles.update).toHaveBeenNthCalledWith(2, bar(T0 + H, 103, 103, 103, 103));
  });

  it("ignores prints across a gap and the zero of a symbol reset", () => {
    const { host, candles, flush, live } = setup();
    live.trade(120, T0 + 3 * H);
    live.trade(0, T0 + 1000);
    flush();
    expect(candles.update).not.toHaveBeenCalled();
    expect(host.data).toHaveLength(2);
  });

  it("reconciles klines: older ones keep the live close, newer ones win, closed bars update historically", () => {
    const { host, candles, flush, live } = setup();
    live.trade(104, T0 + 60_000);
    flush();
    candles.update.mockClear();

    live.bars([candle(T0, 100, 106, 92, 101)], T0 + 59_000);
    flush();
    expect(candles.update).toHaveBeenLastCalledWith(bar(T0, 100, 106, 92, 104));

    live.bars([candle(T0, 100, 106, 92, 103)], T0 + 61_000);
    flush();
    expect(candles.update).toHaveBeenLastCalledWith(bar(T0, 100, 106, 92, 103));

    // the trade stream opens the next bar; the bar it leaves closes on the newest known price (the kline's 103)
    live.trade(103.5, T0 + H + 500);
    flush();
    expect(host.data[1]).toEqual(bar(T0, 100, 106, 92, 103));
    // the closing kline of the previous bar arrives late
    candles.update.mockClear();
    live.bars([candle(T0, 100, 106.5, 92, 103.2, 40, true), candle(T0 + H, 103.4, 103.6, 103.4, 103.5, 1)], T0 + H + 400);
    flush();
    expect(host.data[1]).toEqual(bar(T0, 100, 106.5, 92, 103.2));
    expect(candles.update).toHaveBeenCalledWith(bar(T0, 100, 106.5, 92, 103.2), true);
    expect(candles.update).toHaveBeenLastCalledWith(bar(T0 + H, 103.4, 103.6, 103.4, 103.5));
  });

  it("keeps bars current while inactive and replays every touched bar on resume", () => {
    const { host, candles, flush, live, state } = setup({ active: false });
    live.trade(104, T0 + 1000);
    live.trade(103, T0 + H + 1000);
    flush();
    expect(candles.update).not.toHaveBeenCalled();
    expect(host.data).toHaveLength(3);
    state.active = true;
    live.resume();
    flush();
    expect(candles.update).toHaveBeenCalledTimes(2);
    expect(candles.update).toHaveBeenLastCalledWith(bar(T0 + H, 103, 103, 103, 103));
  });

  it("grows the forming bar's volume with the traded volume between klines", () => {
    const { volume, flush, live } = setup();
    const price = motionValue(0);
    const tradeTime = motionValue(0);
    const traded = motionValue(1000);
    live.connect({ price, tradeTime, volume: traded });
    live.bars([candle(T0, 100, 105, 95, 102, 60)], T0 + 1000);
    flush();
    expect(volume.update).toHaveBeenLastCalledWith(expect.objectContaining({ time: s(T0), value: 60 }));
    traded.set(1002.5);
    tradeTime.set(T0 + 2000);
    price.set(102.2);
    flush();
    expect(volume.update).toHaveBeenLastCalledWith(expect.objectContaining({ time: s(T0), value: 62.5 }));
    live.dispose();
  });
});
