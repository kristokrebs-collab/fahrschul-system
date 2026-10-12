/** P05 `src/market/multiDaily.ts`: one fetch per pair and UTC day, honest failures, retry, cache, proxy fallback. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetMultiDaily, getMultiDaily, requestDaily, retryDaily, utcDay, DAILY_CACHE_PREFIX, DAILY_LIMIT } from "@/market/multiDaily";
import { memoryKV } from "@/market/cache";
import { RestError } from "@/market/sources/http";
import type { BinanceRest } from "@/market/sources/binance";
import type { Candle } from "@/market/types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 14, 12);

function candles(n: number, now = NOW): Candle[] {
  const today = Math.floor(now / DAY) * DAY;
  return Array.from({ length: n }, (_, i) => {
    const t = today - (n - 1 - i) * DAY;
    return { time: t, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1, closed: t + DAY <= now };
  });
}

function fakeRest(fail: Set<string> = new Set(), kind: RestError["kind"] = "network") {
  const calls: string[] = [];
  const rest = {
    klines: vi.fn(async (symbol: string, interval: string, p: { limit?: number }) => {
      calls.push(`${symbol}:${interval}:${p.limit}`);
      if (fail.has(symbol)) throw new RestError(kind, "x");
      return { data: candles(p.limit ?? 10), asOf: NOW, receivedAt: NOW, source: "binance" as const, comparable: true };
    }),
  } as unknown as BinanceRest;
  return { rest, calls };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("Tageskerzen mehrerer Paare", () => {
  afterEach(() => __resetMultiDaily());

  it("fetches each symbol once per UTC day (closed days only), sequentially, page of DAILY_LIMIT", async () => {
    const { rest, calls } = fakeRest();
    __resetMultiDaily({ rest: () => rest, proxy: () => null, kv: () => null, now: () => NOW });
    await requestDaily(["BTCUSDT", "ETHUSDT"]);
    await settle();
    expect(calls).toEqual([`BTCUSDT:1d:${DAILY_LIMIT}`, `ETHUSDT:1d:${DAILY_LIMIT}`]);
    const v = getMultiDaily();
    expect(v.state).toBe("ok");
    expect(v.series.BTCUSDT).toHaveLength(DAILY_LIMIT - 1); // the forming day is dropped
    await requestDaily(["ETHUSDT", "BTCUSDT"]);
    await settle();
    expect(calls).toHaveLength(2);
  });

  it("a new UTC day fetches again; a failure is not repeated that day – only retryDaily()", async () => {
    let now = NOW;
    const fail = new Set(["XRPUSDT"]);
    const { rest, calls } = fakeRest(fail, "http_5xx");
    __resetMultiDaily({ rest: () => rest, proxy: () => null, kv: () => null, now: () => now });
    await requestDaily(["BTCUSDT", "XRPUSDT"]);
    await settle();
    expect(getMultiDaily().failed).toEqual(["XRPUSDT"]);
    expect(getMultiDaily().detail).toMatch(/1 Paar nicht lesbar/);
    await requestDaily(["BTCUSDT", "XRPUSDT"]);
    await settle();
    expect(calls).toHaveLength(2);
    fail.clear();
    await retryDaily();
    await settle();
    expect(calls).toHaveLength(3);
    expect(getMultiDaily().failed).toEqual([]);
    now += DAY;
    await requestDaily(["BTCUSDT"]);
    await settle();
    expect(calls.filter((c) => c.startsWith("BTCUSDT"))).toHaveLength(2);
  });

  it("today's cache entry is used without a fetch; the fetch is persisted", async () => {
    const kv = memoryKV();
    await kv.set(`${DAILY_CACHE_PREFIX}:SOLUSDT`, { day: utcDay(NOW), closes: [[1, 10], [2, 11], [3, 12]] });
    const { rest, calls } = fakeRest();
    __resetMultiDaily({ rest: () => rest, proxy: () => null, kv: () => kv, now: () => NOW });
    await requestDaily(["SOLUSDT", "BTCUSDT"]);
    await settle();
    expect(calls).toEqual([`BTCUSDT:1d:${DAILY_LIMIT}`]);
    expect(getMultiDaily().series.SOLUSDT).toEqual([{ t: 1, c: 10 }, { t: 2, c: 11 }, { t: 3, c: 12 }]);
    expect(((await kv.get(`${DAILY_CACHE_PREFIX}:BTCUSDT`)) as { day: string }).day).toBe(utcDay(NOW));
  });

  it("a blocked direct route switches to the same-origin proxy for the session", async () => {
    const direct = fakeRest(new Set(["BTCUSDT"]), "blocked_451");
    const proxy = fakeRest();
    __resetMultiDaily({ rest: () => direct.rest, proxy: () => proxy.rest, kv: () => null, now: () => NOW });
    await requestDaily(["BTCUSDT", "ETHUSDT"]);
    await settle();
    expect(direct.calls).toHaveLength(1);
    expect(proxy.calls).toHaveLength(2);
    expect(getMultiDaily().viaProxy).toBe(true);
    expect(getMultiDaily().series.BTCUSDT).toBeDefined();
  });

  it("no proxy (file build) and everything blocked → the honest error", async () => {
    const direct = fakeRest(new Set(["BTCUSDT"]), "cors");
    __resetMultiDaily({ rest: () => direct.rest, proxy: () => null, kv: () => null, now: () => NOW });
    await requestDaily(["BTCUSDT"]);
    await settle();
    expect(getMultiDaily().state).toBe("error");
    expect(getMultiDaily().detail).toMatch(/kein Proxy/);
  });
});
