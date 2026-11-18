import { describe, expect, it } from "vitest";
import { lastClosed4h, type Candle, type Stamped } from "@/market";
import { sameClosed4h, selectClosed4h } from "@/app/ScenarioWatcher";
import { feedKey, selectClosed4hClose } from "@/views/overview/ChartCard";
import { H4, makeCandles } from "./views.overview.harness";

const stamp = (data: Candle[]): Stamped<Candle[]> => ({ data, asOf: Date.now(), receivedAt: Date.now(), source: "binance", comparable: true });

describe("closed-bar selectors (render only on a new closed 4h bar)", () => {
  it("match the full-history closed bar while scanning only the tail", () => {
    const bars = makeCandles(H4, 500, 86_200, Date.now());
    const full = lastClosed4h(bars);
    expect(full).not.toBeNull();
    expect(selectClosed4h(stamp(bars))).toEqual({ t: full?.t, c: full?.c });
    expect(selectClosed4hClose(stamp(bars))).toBe(full?.c);
    expect(selectClosed4h(undefined)).toBeNull();
    expect(selectClosed4hClose(undefined)).toBeNull();
  });

  it("treats equal closed bars as the same selection", () => {
    expect(sameClosed4h(null, null)).toBe(true);
    expect(sameClosed4h({ t: 1, c: 2 }, { t: 1, c: 2 })).toBe(true);
    expect(sameClosed4h({ t: 1, c: 2 }, { t: 1, c: 3 })).toBe(false);
    expect(sameClosed4h({ t: 1, c: 2 }, null)).toBe(false);
  });

  it("keys the history on bar count and last open time, not on forming-bar ticks", () => {
    const bars = makeCandles(H4, 10, 86_200, Date.now());
    const tick = bars.map((b, i) => (i === bars.length - 1 ? { ...b, close: b.close + 5 } : b));
    expect(feedKey(stamp(bars))).toBe(feedKey(stamp(tick)));
    expect(feedKey(stamp([...bars, { ...bars[bars.length - 1]!, time: bars[bars.length - 1]!.time + H4 }]))).not.toBe(feedKey(stamp(bars)));
  });
});
