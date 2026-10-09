/**
 * Retro check (src/market/signals/retro.ts) and the Lage-Ampel at T: the daily page it needs can fail on its own (a
 * network blip) while the 15m / 1h / 4h pages arrive. That check then runs without a gate ("no daily data → no gate")
 * — but it must not be memoised that way: the next check of the same minute (`Neu prüfen`, the save of the trade)
 * loads the daily bars again and stores the Lage with the snapshot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Bar } from "@/domain/signals";
import { buildFeedSpecs } from "@/market/feeds";
import { initialHealth } from "@/market/health";
import type { MarketProvider } from "@/market/provider";
import type { Candle, FeedId, ProviderHealth } from "@/market/types";
import { __resetSignalEngine, attachSignalEngine, setSignalConfig } from "@/market/signals/engine";
import { __clearRetroMemo, checkTradeAt } from "@/market/signals/retro";
import { benchAgg, synthBars } from "./signals.fixtures";

const S15 = 900;
const N15 = 9000;
const T_START = Math.floor(1_780_000_000 / 14_400) * 14_400;
const HIST15 = synthBars(N15, 42, { t0: T_START, sec: S15 });
const NOW = (HIST15[N15 - 1]!.t + 400) * 1000;
/** 50 h ago, inside a 15m bar */
const T = (HIST15[N15 - 200]!.t + 123) * 1000;

const toCandle = (b: Bar, sec: number): Candle => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0, closed: true, closeTime: (b.t + sec) * 1000 - 1 });
const DAILY = synthBars(700, 9, { sec: 86_400, t0: Math.floor(NOW / 86_400_000) * 86_400 - 699 * 86_400 });

function fakeProvider() {
  const health: ProviderHealth = initialHealth(buildFeedSpecs("1h"));
  for (const f of Object.keys(health.feeds) as FeedId[]) health.feeds[f] = { ...health.feeds[f], state: "live", lastDataAt: NOW };
  const fake = {
    dailyFails: 0,
    calls: [] as string[],
    provider: {
      symbol: "BTCUSDT",
      get: () => undefined,
      subscribe: () => () => undefined,
      onHealth: () => () => undefined,
      getHealth: () => health,
      async fetchKlines(iv: string, p: { endTime?: number; limit?: number } = {}) {
        fake.calls.push(iv);
        const end = p.endTime ?? NOW;
        let data: Candle[];
        if (iv === "1d") {
          if (fake.dailyFails > 0) {
            fake.dailyFails -= 1;
            throw Object.assign(new Error("Failed to fetch"), { kind: "network" });
          }
          data = DAILY.map((b) => toCandle(b, 86_400));
        } else {
          const sec = iv === "15m" ? 900 : iv === "1h" ? 3600 : 14_400;
          data = (sec === S15 ? HIST15 : benchAgg(HIST15, sec)).map((b) => toCandle(b, sec));
        }
        return { data: data.filter((c) => c.time <= end).slice(-(p.limit ?? 500)), asOf: NOW, receivedAt: NOW, source: "binance" as const, comparable: true };
      },
    } as unknown as MarketProvider,
  };
  return fake;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetSignalEngine();
  __clearRetroMemo();
  localStorage.clear();
});
afterEach(() => {
  __resetSignalEngine();
  vi.useRealTimers();
});

describe("retro check: the Lage at T after a failed daily page", () => {
  it("is loaded again on the next check of the same minute (the ungated result is not memoised)", async () => {
    const fake = fakeProvider();
    setSignalConfig({ lage: { on: true, mode: "block" } });
    attachSignalEngine(fake.provider);
    fake.dailyFails = 1;
    const first = await checkTradeAt(T, "long");
    expect(first).not.toBeNull();
    expect(first!.lage).toBeUndefined(); // no daily bars → no gate this time
    const second = await checkTradeAt(T + 5_000, "long");
    expect(fake.calls.filter((c) => c === "1d")).toHaveLength(2);
    expect(second!.lage).toMatchObject({ state: expect.stringMatching(/^(red|amber|green)$/), on: true, mode: "block" });
  });

  it("a check whose Lage loaded stays memoised (no second page)", async () => {
    const fake = fakeProvider();
    setSignalConfig({ lage: { on: true, mode: "block" } });
    attachSignalEngine(fake.provider);
    const first = await checkTradeAt(T, "long");
    expect(first!.lage).toBeDefined();
    const n = fake.calls.length;
    await checkTradeAt(T + 5_000, "short");
    expect(fake.calls).toHaveLength(n);
  });
});
