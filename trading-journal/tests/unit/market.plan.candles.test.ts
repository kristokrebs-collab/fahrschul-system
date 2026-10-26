/**
 * Kerzen des Handelsplans: Zwischenspeicher zuerst, nur das Fehlende holen, ein lückenloser Block, Umweg über den Proxy,
 * ehrliche Fehler. Mit eingespritztem Netz und Speicher – keine Uhr, kein echtes Netz.
 */
import { describe, expect, it, vi } from "vitest";
import { candleWindow, sessionDay } from "@/domain/plan";
import { loadErrorText, loadPlanCandles, PAGE_LIMIT, PLAN_INTERVAL_MS, type PlanCandleDeps, type Row } from "@/market/plan/candles";
import { PLAN_SOURCES, sourceOf } from "@/market/plan/sources";
import { RestError } from "@/market/sources/http";
import type { Candle } from "@/market/types";

const IV = PLAN_INTERVAL_MS["5m"];
const T0 = Date.UTC(2026, 9, 19, 13, 30);
const NOW = T0 + 100 * IV + 90_000; // 90 s into the candle that opens at slot 100

const mk = (slot: number, now: number): Candle => {
  const time = T0 + slot * IV;
  return { time, open: 100 + slot, high: 101 + slot, low: 99 + slot, close: 100.5 + slot, volume: 10, closed: time + IV - 1 < now, closeTime: time + IV - 1 };
};

interface Rig {
  deps: PlanCandleDeps;
  pages: Array<{ startTime: number; endTime: number; route: string }>;
  blocks: Map<string, { v: 1; rows: Row[] }>;
}
function rig(opts: { now?: number; blocks?: Map<string, { v: 1; rows: Row[] }>; fail?: (route: string, n: number) => Error | null } = {}): Rig {
  const now = opts.now ?? NOW;
  const pages: Rig["pages"] = [];
  const blocks = opts.blocks ?? new Map();
  let calls = 0;
  const deps: PlanCandleDeps = {
    fetchPage: async (q) => {
      calls++;
      const err = opts.fail?.(q.route, calls);
      if (err) throw err;
      pages.push({ startTime: q.startTime, endTime: q.endTime, route: q.route });
      const out: Candle[] = [];
      for (let t = q.startTime; t <= q.endTime && out.length < q.limit; t += IV) out.push(mk((t - T0) / IV, now));
      return out;
    },
    proxy: () => true,
    read: async (k) => blocks.get(k) ?? null,
    write: async (k, b) => void blocks.set(k, b),
    now: () => now,
  };
  return { deps, pages, blocks };
}
const req = (from: number, to: number) => ({ symbol: "BTCUSDT", interval: "5m" as const, from, to });
const rowsOf = (from: number, to: number, now = NOW): Row[] => {
  const out: Row[] = [];
  for (let t = from; t <= to; t += IV) {
    const c = mk((t - T0) / IV, now);
    out.push([c.time, c.open, c.high, c.low, c.close, c.volume]);
  }
  return out;
};

describe("Plan-Kerzen laden", () => {
  it("ohne Zwischenspeicher: das ganze Fenster holen; die laufende Kerze kommt mit, wird aber nicht gespeichert", async () => {
    const r = rig();
    const res = await loadPlanCandles(req(T0, T0 + 100 * IV), r.deps);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]).toMatchObject({ startTime: T0, route: "direct" });
    expect(res.candles).toHaveLength(101);
    expect(res.candles[100]!.closed).toBe(false); // läuft noch
    expect(res.source).toBe("binance");
    expect(res.fromCache).toBe(false);
    expect(res.fetchedAt).toBe(NOW);
    expect(res.error).toBeNull();
    const stored = r.blocks.get("BTCUSDT|5m")!;
    expect(stored.rows).toHaveLength(100); // nur die geschlossenen
    expect(stored.rows[0]![0]).toBe(T0);
    expect(stored.rows[99]![0]).toBe(T0 + 99 * IV);
  });

  it("mit Zwischenspeicher: erst der Block (onCache), dann nur der Rest ab der letzten geschlossenen Kerze", async () => {
    const blocks = new Map([["BTCUSDT|5m", { v: 1 as const, rows: rowsOf(T0, T0 + 99 * IV) }]]);
    const r = rig({ blocks });
    const onCache = vi.fn();
    const res = await loadPlanCandles({ ...req(T0, T0 + 100 * IV), onCache }, r.deps);
    expect(onCache).toHaveBeenCalledTimes(1);
    expect(onCache.mock.calls[0]![0]).toMatchObject({ fromCache: true, source: "cache", fetchedAt: null });
    expect(onCache.mock.calls[0]![0].candles).toHaveLength(100);
    expect(r.pages).toEqual([{ startTime: T0 + 100 * IV, endTime: T0 + 100 * IV + IV - 1, route: "direct" }]);
    expect(res.candles).toHaveLength(101);
    expect(res.fromCache).toBe(false);
  });

  it("ein ganz geschlossenes, ganz gespeichertes Fenster braucht kein Netz", async () => {
    const blocks = new Map([["BTCUSDT|5m", { v: 1 as const, rows: rowsOf(T0, T0 + 99 * IV) }]]);
    const r = rig({ blocks });
    const res = await loadPlanCandles(req(T0 + 10 * IV, T0 + 50 * IV), r.deps);
    expect(r.pages).toHaveLength(0);
    expect(res).toMatchObject({ fromCache: true, source: "cache", fetchedAt: null, error: null });
    expect(res.candles).toHaveLength(41);
  });

  it("ein früheres Fenster holt nur das Stück davor und lässt den Block lückenlos", async () => {
    const blocks = new Map([["BTCUSDT|5m", { v: 1 as const, rows: rowsOf(T0 + 50 * IV, T0 + 99 * IV) }]]);
    const r = rig({ blocks });
    await loadPlanCandles(req(T0, T0 + 99 * IV), r.deps);
    expect(r.pages).toEqual([{ startTime: T0, endTime: T0 + 49 * IV + IV - 1, route: "direct" }]);
    const rows = r.blocks.get("BTCUSDT|5m")!.rows;
    expect(rows).toHaveLength(100);
    expect(rows.every((row, i) => row[0] === T0 + i * IV)).toBe(true);
  });

  it("ein Fenster abseits des Blocks ersetzt ihn (er bliebe sonst voller Löcher)", async () => {
    const blocks = new Map([["BTCUSDT|5m", { v: 1 as const, rows: rowsOf(T0 - 5000 * IV, T0 - 4900 * IV) }]]);
    const r = rig({ blocks });
    await loadPlanCandles(req(T0, T0 + 99 * IV), r.deps);
    expect(r.pages).toHaveLength(1);
    const rows = r.blocks.get("BTCUSDT|5m")!.rows;
    expect(rows[0]![0]).toBe(T0);
    expect(rows).toHaveLength(100);
  });

  it("mehr als eine Seite: das Fenster wird abschnittsweise geholt", async () => {
    const wide = PAGE_LIMIT + 200;
    const now = T0 + (wide + 5) * IV;
    const r = rig({ now });
    const res = await loadPlanCandles(req(T0, T0 + (wide - 1) * IV), r.deps);
    expect(r.pages).toHaveLength(2);
    expect(r.pages[1]!.startTime).toBe(T0 + PAGE_LIMIT * IV);
    expect(res.candles).toHaveLength(wide);
  });

  it("Börse gesperrt (451) → derselbe Abruf über den Proxy; die Quelle sagt es", async () => {
    const r = rig({ fail: (route) => (route === "direct" ? new RestError("blocked_451", "HTTP 451", 451) : null) });
    const res = await loadPlanCandles(req(T0, T0 + 20 * IV), r.deps);
    expect(res.source).toBe("proxy");
    expect(r.pages.every((p) => p.route === "proxy")).toBe(true);
    expect(res.candles).toHaveLength(21);
  });

  it("Netzfehler ohne Proxy-Rettung: die Kerzen aus dem Zwischenspeicher, mit dem Grund – nicht als aktuell ausgegeben", async () => {
    const blocks = new Map([["BTCUSDT|5m", { v: 1 as const, rows: rowsOf(T0, T0 + 50 * IV) }]]);
    const r = rig({ blocks, fail: () => new RestError("network", "Failed to fetch") });
    const res = await loadPlanCandles(req(T0, T0 + 99 * IV), r.deps);
    expect(res).toMatchObject({ fromCache: true, source: "cache", fetchedAt: null, error: "Die Börse ist gerade nicht erreichbar." });
    expect(res.candles).toHaveLength(51);
    // ohne Zwischenspeicher: nichts, mit Grund
    const none = await loadPlanCandles(req(T0, T0 + 99 * IV), rig({ fail: () => new RestError("rate_limited", "429", 429) }).deps);
    expect(none.candles).toEqual([]);
    expect(none.error).toBe("Die Börse hat die Anfragen gebremst – gleich noch einmal versuchen.");
  });

  it("ein Fenster in der Zukunft ist leer; ein Abbruch wird nicht verschluckt", async () => {
    const r = rig();
    expect((await loadPlanCandles(req(NOW + 10 * IV, NOW + 20 * IV), r.deps)).candles).toEqual([]);
    const ctl = new AbortController();
    ctl.abort();
    const aborted = rig({ fail: () => Object.assign(new Error("aborted"), { name: "AbortError" }) });
    await expect(loadPlanCandles({ ...req(T0, T0 + 5 * IV), signal: ctl.signal }, aborted.deps)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("Fehlertexte", () => {
    expect(loadErrorText(new RestError("bad_symbol", "x", 400))).toContain("kennt dieses Symbol nicht");
    expect(loadErrorText(new RestError("offline", "x"))).toBe("Du bist offline.");
    expect(loadErrorText(new RestError("timeout", "x"))).toBe("Die Börse antwortet zu langsam.");
    expect(loadErrorText(new RestError("blocked_451", "x", 451))).toBe("Die Börse ist von hier aus gesperrt.");
  });
});

describe("Fenster und Quellen", () => {
  it("das Fenster einer Sitzung: 40 Kerzen Vorlauf bis jetzt – bei einer vergangenen Sitzung bis zu ihrem Ende", () => {
    const s = sessionDay("newyork", "2026-10-19");
    expect(candleWindow(s, IV, s.openMs + 30 * 60_000)).toEqual({ from: s.openMs - 40 * IV, to: s.openMs + 30 * 60_000 });
    expect(candleWindow(s, IV, s.closeMs + 99_999_999).to).toBe(s.closeMs);
  });

  it("Krypto ist angebunden, Aktien sagen ehrlich, dass ihre Kerzen noch nicht angebunden sind", () => {
    expect(sourceOf("crypto")).toMatchObject({ id: "binance", ready: true, label: "Binance USDⓈ-M" });
    const stocks = sourceOf("stocks");
    expect(stocks.ready).toBe(false);
    expect(stocks.notReady).toContain("noch nicht angebunden");
    expect(stocks.load).toBeUndefined();
    expect(PLAN_SOURCES).toHaveLength(2);
  });
});
