/**
 * F32 Ausgänge laden: candles per market through the lab's history source (mocked here), the outcome read per signal, a market
 * that fails marks only its own signals, final results are cached (and an open one is not), priming from the cache needs no
 * request, nothing is fetched until it is asked for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bar } from "@/domain/backtest";
import { __resetOutcomes, cachedOutcomes, computeOutcomes, getOutcomeState, OUTCOME_CACHE_KEY, outcomeFingerprint, parseOutcomeCache, primeOutcomes } from "@/views/coach/signalOutcomes";
import { H, signalEvent } from "./missed.fixtures";

const loadLabData = vi.fn();
vi.mock("@/views/labor/historySource", () => ({
  loadLabData: (req: unknown) => loadLabData(req),
  loadErrorKind: (e: unknown) => (e as { kind?: string })?.kind ?? "failed",
}));

const M15 = 900_000;
const NOW = new Date(2026, 2, 6, 12).getTime();
const T = NOW - 2 * 24 * H;
/** 15m candle number `i` after T, by open time (seconds). */
const c15 = (i: number, o: number, h: number, l: number): Bar => ({ t: (T + (i + 1) * M15) / 1000, o, h, l, c: o });
const flat1h = (n: number, price = 100): Bar[] => Array.from({ length: n }, (_, i) => ({ t: (T - (n - i) * H) / 1000, o: price, h: price + 1, l: price - 1, c: price }));

const long = (key: string, over = {}) => signalEvent({ key, at: T, symbol: "BTCUSDT", stop: 95, target: 110, ...over });

beforeEach(() => {
  __resetOutcomes();
  loadLabData.mockReset();
  localStorage.removeItem(OUTCOME_CACHE_KEY);
});

describe("computeOutcomes", () => {
  it("fetches nothing until asked, then loads the 15m candles of each market once and reads every signal", async () => {
    const a = long("a");
    const b = long("b", { at: T + H }); // same market: one load
    loadLabData.mockResolvedValue({ data: { "15m": [c15(0, 100, 101, 99), c15(1, 100, 111, 99), c15(5, 105, 106, 104)] }, funding: null, pages: 1, viaProxy: false });
    expect(loadLabData).not.toHaveBeenCalled();
    const out = await computeOutcomes([a, b], NOW);
    expect(loadLabData).toHaveBeenCalledTimes(1);
    expect(loadLabData.mock.calls[0]![0]).toMatchObject({ symbol: "BTCUSDT", intervals: ["15m"], funding: false });
    expect(out.get(a.id)).toMatchObject({ kind: "target", basis: "own" });
    expect(out.get(b.id)!.kind).toBe("open"); // the later signal only sees the quiet candle
    expect(getOutcomeState()).toMatchObject({ status: "done", error: null });
  });

  it("a signal with no stop of its own loads the 1h candles for the standard measure", async () => {
    const e = long("std", { stop: null, target: null });
    loadLabData.mockImplementation(async (req: { intervals: string[] }) => (req.intervals[0] === "1h" ? { data: { "1h": flat1h(30) }, funding: null, pages: 1, viaProxy: false } : { data: { "15m": [c15(0, 100, 101, 99.9), c15(1, 100, 104, 99.9)] }, funding: null, pages: 1, viaProxy: false }));
    const out = await computeOutcomes([e], NOW);
    expect(loadLabData.mock.calls.map((c) => (c[0] as { intervals: string[] }).intervals[0])).toEqual(["15m", "1h"]);
    // ATR of the flat 1h candles = 2 on 100 = 2 % → stop 3, target 6: the second candle (high 104) stops short of it
    expect(out.get(e.id)).toMatchObject({ kind: "open", basis: "standard", stop: 97, target: 106 });
  });

  it("a market that fails marks only its own signals, with the reason", async () => {
    const btc = long("btc");
    const bad = long("bad", { symbol: "NOPEUSDT" });
    loadLabData.mockImplementation(async (req: { symbol: string }) => {
      if (req.symbol === "NOPEUSDT") throw Object.assign(new Error("x"), { kind: "symbol" });
      return { data: { "15m": [c15(0, 100, 111, 99)] }, funding: null, pages: 1, viaProxy: false };
    });
    const out = await computeOutcomes([btc, bad], NOW);
    expect(out.get(btc.id)!.kind).toBe("target");
    expect(out.get(bad.id)).toMatchObject({ kind: "unusable", reason: expect.stringContaining("nicht bekannt") });
    expect(getOutcomeState().error).toContain("1 Signal ohne Marktdaten");
  });

  it("events without a direction or a market are unusable with the reason and cost no request", async () => {
    const noMarket = long("m", { symbol: "" });
    const out = await computeOutcomes([noMarket, long("ctx", { entry: false })], NOW);
    expect(loadLabData).not.toHaveBeenCalled();
    expect(out.get(noMarket.id)).toMatchObject({ kind: "unusable", reason: expect.stringContaining("Markt") });
    expect(out.has("ctx")).toBe(false); // context events have no outcome
  });

  it("final results are cached; a second run and a fresh page load need no request for them – an open one is recomputed", async () => {
    const win = long("win");
    const live = long("live", { at: T + 6 * H });
    loadLabData.mockResolvedValue({ data: { "15m": [c15(0, 100, 111, 99), c15(30, 100, 101, 99)] }, funding: null, pages: 1, viaProxy: false });
    await computeOutcomes([win, live], NOW);
    const stored = JSON.parse(localStorage.getItem(OUTCOME_CACHE_KEY)!);
    expect(Object.keys(stored.items)).toEqual([win.id]);
    expect(stored.v).toBe(1);

    loadLabData.mockClear();
    __resetOutcomes();
    primeOutcomes([win, live]); // a reload: the final one shows at once, with no request
    expect(getOutcomeState().outcomes.get(win.id)!.kind).toBe("target");
    expect(getOutcomeState().outcomes.has(live.id)).toBe(false);
    expect(loadLabData).not.toHaveBeenCalled();

    await computeOutcomes([win, live], NOW);
    // only the open signal needed candles
    expect(loadLabData).toHaveBeenCalledTimes(1);
  });

  it("the cache key includes everything the reading used: a changed mark invalidates it", async () => {
    const e = long("k");
    loadLabData.mockResolvedValue({ data: { "15m": [c15(0, 100, 111, 99)] }, funding: null, pages: 1, viaProxy: false });
    await computeOutcomes([e], NOW);
    expect(cachedOutcomes([e]).size).toBe(1);
    expect(cachedOutcomes([{ ...e, stop: 96 }]).size).toBe(0);
    expect(outcomeFingerprint(e)).not.toBe(outcomeFingerprint({ ...e, at: e.at + 1 }));
  });

  it("reads a broken or foreign cache as empty", () => {
    for (const bad of [null, "x", [], { v: 9, items: {} }, { v: 1, items: [] }, { v: 1, items: { a: { fp: 1 } } }]) expect(parseOutcomeCache(bad)).toEqual({});
  });

  it("does not start a second run while one is running", async () => {
    let release: (v: unknown) => void = () => undefined;
    loadLabData.mockImplementation(() => new Promise((r) => (release = r)));
    const first = computeOutcomes([long("one")], NOW);
    await vi.waitFor(() => expect(loadLabData).toHaveBeenCalledTimes(1));
    await computeOutcomes([long("two")], NOW); // returns at once
    expect(loadLabData).toHaveBeenCalledTimes(1);
    expect(getOutcomeState().status).toBe("loading");
    release({ data: { "15m": [c15(0, 100, 101, 99)] }, funding: null, pages: 1, viaProxy: false });
    await first;
    expect(getOutcomeState().status).toBe("done");
  });
});
