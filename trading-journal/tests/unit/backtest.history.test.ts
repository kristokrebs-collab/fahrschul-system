import { describe, expect, it } from "vitest";
import { estimatePages, KLINE_PAGE, loadFunding, loadKlines, type Bar, type KlineQuery, type SeriesStore } from "@/domain/backtest/index";

const H4 = 14_400_000;
const START = Date.UTC(2025, 0, 1);

/** A fake exchange: 4h bars from START (listing) to `now`, Binance `startTime` semantics. */
function exchange(now: number) {
  const calls: KlineQuery[] = [];
  const all: Bar[] = [];
  for (let t = START; t + H4 <= now + H4; t += H4) all.push({ t: t / 1000, o: 1, h: 2, l: 0.5, c: 1.5, v: 3 });
  const fetchPage = async (q: KlineQuery): Promise<Bar[]> => {
    calls.push(q);
    return all.filter((b) => b.t * 1000 >= q.startTime).slice(0, q.limit);
  };
  return { calls, fetchPage, all };
}

function memStore(): SeriesStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, structuredClone(v)) };
}

describe("Historie laden", () => {
  it("blättert vorwärts, liefert nur geschlossene Kerzen und cached sie", async () => {
    const now = START + 4000 * H4 + 5 * 60_000; // bar 4000 is forming
    const ex = exchange(now);
    const store = memStore();
    const from = START + 100 * H4;
    const res = await loadKlines({ symbol: "BTCUSDT", interval: "4h", from, to: now, now, fetchPage: ex.fetchPage, store });
    expect(res.data[0]!.t * 1000).toBe(from);
    expect(res.data[res.data.length - 1]!.t * 1000).toBe(START + 3999 * H4); // the forming bar is not there
    expect(res.data).toHaveLength(3900);
    expect(res.fetched).toBe(Math.ceil(3900 / KLINE_PAGE));
    // second run: everything from the cache
    const again = await loadKlines({ symbol: "BTCUSDT", interval: "4h", from, to: now, now, fetchPage: ex.fetchPage, store });
    expect(again.fetched).toBe(0);
    expect(again.data).toHaveLength(3900);
    // later: only the tail is fetched
    const later = now + 3 * H4;
    const ex2 = exchange(later);
    const tail = await loadKlines({ symbol: "BTCUSDT", interval: "4h", from, to: later, now: later, fetchPage: ex2.fetchPage, store });
    expect(ex2.calls).toHaveLength(1);
    expect(ex2.calls[0]!.startTime).toBe(START + 4000 * H4);
    expect(tail.data).toHaveLength(3903);
  });

  it("merkt sich den Listing-Beginn und fragt davor nicht erneut", async () => {
    const now = START + 300 * H4;
    const ex = exchange(now);
    const store = memStore();
    const early = START - 500 * H4;
    const a = await loadKlines({ symbol: "XUSDT", interval: "4h", from: early, to: now, now, fetchPage: ex.fetchPage, store });
    expect(a.origin).toBe(START);
    expect(a.data[0]!.t * 1000).toBe(START);
    const before = ex.calls.length;
    const b = await loadKlines({ symbol: "XUSDT", interval: "4h", from: early, to: now, now, fetchPage: ex.fetchPage, store });
    expect(ex.calls.length).toBe(before);
    expect(b.data).toHaveLength(a.data.length);
  });

  it("bricht zwischen den Seiten ab und funktioniert ohne Cache", async () => {
    const now = START + 4000 * H4;
    const ex = exchange(now);
    const ctl = new AbortController();
    let pages = 0;
    const p = loadKlines({
      symbol: "BTCUSDT",
      interval: "4h",
      from: START,
      to: now,
      now,
      fetchPage: async (q) => {
        if (++pages === 1) ctl.abort();
        return ex.fetchPage(q);
      },
      signal: ctl.signal,
    });
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    const broken: SeriesStore = { get: async () => Promise.reject(new Error("idb")), set: async () => Promise.reject(new Error("quota")) };
    const ok = await loadKlines({ symbol: "BTCUSDT", interval: "4h", from: START, to: START + 10 * H4, now, fetchPage: ex.fetchPage, store: broken });
    expect(ok.data).toHaveLength(11);
    expect(estimatePages("4h", START, START + 3000 * H4)).toBe(3);
  });

  it("lädt Funding-Abrechnungen seitenweise und aus dem Cache", async () => {
    const pts = Array.from({ length: 2500 }, (_, i) => ({ t: START + i * 8 * 3_600_000, rate: i % 2 ? 0.0001 : -0.00005 }));
    const now = pts[pts.length - 1]!.t + 1000;
    let calls = 0;
    const fetchPage = async (q: { startTime: number; limit: number }) => {
      calls++;
      return pts.filter((p) => p.t >= q.startTime).slice(0, q.limit);
    };
    const store = memStore();
    const r = await loadFunding({ symbol: "BTCUSDT", from: START, to: now, now, fetchPage, store });
    expect(r.data).toHaveLength(2500);
    expect(calls).toBe(3);
    const again = await loadFunding({ symbol: "BTCUSDT", from: START, to: now, now, fetchPage, store });
    expect(again.fetched).toBe(0);
    expect(again.data[1]!.rate).toBe(0.0001);
  });
});
