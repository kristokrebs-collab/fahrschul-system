/**
 * MAE / MFE measurement through the market provider (Journal v3, P06): statuses, the stored patch, a trade edited
 * while the candles loaded, the backfill candidates and the idle queue.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Trade } from "@/domain/types";
import type { MarketProvider } from "@/market/provider";
import { TRIED_KEY, backfillCandidates, excursionPatch, measureAndStore, measureTrade, measuredEntry, measurablePair, startExcursionBackfill, tradeSymbol } from "@/market/excursion";
import { mkTrade } from "./domain.fixtures";

const M15 = 900_000;
const H1 = 3_600_000;
const ENTRY = new Date("2026-10-01T10:00").getTime();

/** 15m bars: flat 99.5–101 with one dip to 97 (10:30) and one spike to 106 (11:15); 1h bars: range 2 around 100. */
function fakeProvider(symbol = "BTCUSDT") {
  const calls: { interval: string; startTime?: number; endTime?: number }[] = [];
  const fetchKlines = vi.fn(async (interval: string, p: { startTime?: number; endTime?: number } = {}) => {
    calls.push({ interval, ...p });
    const step = interval === "1h" ? H1 : M15;
    const data = [];
    for (let t = p.startTime!; t <= p.endTime!; t += step) {
      let high = 101;
      let low = 99.5;
      if (interval === "1h") low = 99;
      else if (t === ENTRY + 2 * M15) low = 97;
      else if (t === ENTRY + 5 * M15) high = 106;
      data.push({ time: t, open: 100, high, low, close: 100, volume: 1 });
    }
    return { data, at: Date.now(), source: "binance" };
  });
  return { provider: { symbol, fetchKlines } as unknown as MarketProvider, calls, fetchKlines };
}

const trade = (p: Partial<Trade> = {}): Trade =>
  mkTrade({ id: "m1", date: "2026-10-01T10:00", exitDate: "2026-10-01T12:00", pair: "BTC/USDT", entry: 100, stop: 98, exit: 103, size: 1000, ...p });
const LATER = ENTRY + 3 * 86_400_000;

afterEach(() => localStorage.removeItem(TRIED_KEY));

describe("measureTrade", () => {
  it("MAE / MFE from the 15m bars between entry and exit, ATR(14) % from the 1h bars before the entry", async () => {
    const { provider, calls } = fakeProvider();
    const r = await measureTrade(trade(), provider, LATER);
    expect(r.status).toBe("ok");
    expect(r.interval).toBe("15m");
    expect(r.excursion).toMatchObject({ mae: 3, mfe: 6, maeR: 1.5, mfeR: 3 });
    expect(r.atrPct).toBeCloseTo(2, 9);
    expect(calls.map((c) => c.interval).sort()).toEqual(["15m", "1h"]);
    expect(excursionPatch(r)).toEqual({ mae: 3, mfe: 6, maeR: 1.5, mfeR: 3, atrPct: 2 });
  });

  it("short mirrors; the fills' Ø entry is the reference", async () => {
    const { provider } = fakeProvider();
    const fills: Trade["fills"] = [
      { id: "a", at: "2026-10-01T10:00", side: "open", price: 101, qty: 1, kind: "entry" },
      { id: "b", at: "2026-10-01T10:30", side: "open", price: 99, qty: 1, kind: "add" },
      { id: "c", at: "2026-10-01T12:00", side: "close", price: 98, qty: 2, kind: "exit" },
    ];
    expect(measuredEntry({ entry: 101, fills, side: "short" })).toBe(100);
    const r = await measureTrade(trade({ side: "short", stop: 102, entry: 101, fills }), provider, LATER);
    expect(r.excursion).toMatchObject({ mae: 6, mfe: 3, maeR: 3, mfeR: 1.5 });
  });

  it("honest statuses instead of numbers", async () => {
    const { provider } = fakeProvider();
    expect((await measureTrade(trade(), null, LATER)).status).toBe("noProvider");
    expect((await measureTrade(trade({ pair: "ETH/USDT" }), provider, LATER)).status).toBe("otherPair");
    expect((await measureTrade(trade({ entry: null }), provider, LATER)).status).toBe("noEntry");
    const noExit = await measureTrade(trade({ exitDate: undefined }), provider, LATER);
    expect(noExit.status).toBe("noExit");
    expect(noExit.atrPct).toBeCloseTo(2, 9); // the ATR needs only the entry
    const failing = { symbol: "BTCUSDT", fetchKlines: vi.fn(async () => Promise.reject(new Error("429"))) } as unknown as MarketProvider;
    expect((await measureTrade(trade(), failing, LATER)).status).toBe("failed");
    const empty = { symbol: "BTCUSDT", fetchKlines: vi.fn(async () => ({ data: [] })) } as unknown as MarketProvider;
    expect((await measureTrade(trade(), empty, LATER)).status).toBe("noData");
  });

  it("pair matching ignores separators and perp suffixes", () => {
    expect(tradeSymbol("BTC/USDT")).toBe("BTCUSDT");
    expect(measurablePair("BTC/USDT", { symbol: "BTCUSDT" })).toBe(true);
    expect(measurablePair("ETH/USDT", { symbol: "BTCUSDT" })).toBe(false);
    expect(measurablePair("BTC/USDT", null)).toBe(false);
  });
});

describe("measureAndStore", () => {
  it("stores the patch on the latest version of the trade", async () => {
    const { provider } = fakeProvider();
    const t = trade();
    const save = vi.fn(async (_t: Trade) => {});
    await measureAndStore(t, { latest: () => ({ ...t, notes: "neu" }), save }, provider);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toMatchObject({ id: "m1", notes: "neu", mae: 3, mfe: 6, atrPct: 2 });
  });

  it("writes nothing when the trade's entry / times changed meanwhile, or it is gone", async () => {
    const { provider } = fakeProvider();
    const t = trade();
    const save = vi.fn(async (_t: Trade) => {});
    await measureAndStore(t, { latest: () => ({ ...t, entry: 101 }), save }, provider);
    await measureAndStore(t, { latest: () => undefined, save }, provider);
    expect(save).not.toHaveBeenCalled();
  });

  it("an open trade gets the ATR only (no running excursion is stored)", async () => {
    const { provider } = fakeProvider();
    const t = trade({ status: "open", exitDate: undefined, exit: null });
    const save = vi.fn(async (_t: Trade) => {});
    await measureAndStore(t, { latest: () => t, save }, provider);
    const saved = save.mock.calls[0]![0] as Trade;
    expect(saved.atrPct).toBe(2);
    expect(saved.mae).toBeUndefined();
  });
});

describe("backfill", () => {
  it("candidates: closed, with exit time, unmeasured, on the live pair, not tried within a day – newest first", () => {
    const now = LATER;
    const list = [
      trade({ id: "a", date: "2026-09-01T10:00", exitDate: "2026-09-01T11:00" }),
      trade({ id: "b" }),
      trade({ id: "measured", mae: 1 }),
      trade({ id: "open", status: "open" }),
      trade({ id: "noexit", exitDate: undefined }),
      trade({ id: "eth", pair: "ETH/USDT" }),
      trade({ id: "tried" }),
      trade({ id: "old-try", date: "2026-08-01T10:00", exitDate: "2026-08-01T11:00" }),
    ];
    const tried = { tried: now - 1000, "old-try": now - 2 * 86_400_000 };
    expect(backfillCandidates(list, { symbol: "BTCUSDT" }, tried, now).map((t) => t.id)).toEqual(["b", "a", "old-try"]);
    expect(backfillCandidates(list, null, {}, now)).toEqual([]);
  });

  it("the idle queue measures the newest candidate, remembers the attempt and stops on request", async () => {
    const { provider } = fakeProvider();
    const t = trade();
    const save = vi.fn(async (_t: Trade) => {});
    const q = startExcursionBackfill({ trades: () => [t], latest: () => t, save }, { provider: () => provider, delayMs: 0 });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    q.stop();
    expect(Object.keys(JSON.parse(localStorage.getItem(TRIED_KEY) ?? "{}"))).toEqual(["m1"]);
  });
});
