/**
 * The Labor's candle loader can no longer hang (`src/views/labor/historySource.ts`): a time limit per request that covers the
 * whole answer, limited retries with a back-off, real page-by-page progress, an abort that reaches the request under way, and a
 * fallback chain Binance-Futures → EU proxy → Bybit → Binance spot that says which source served the candles. Everything runs
 * against fakes with tiny time limits – no network, real timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAB_CACHE_PREFIX, __setHistoryDeps, attemptsFor, failuresOf, forgetRoutes, loadErrorKind, loadLabData, withDeadline, type LoadStatus, type LoadRequest } from "@/views/labor/historySource";
import { fetchJson, RestError } from "@/market/sources/http";
import { klinesSchema } from "@/market/sources/binance";
import { spotRest } from "@/market/sources/binanceSpot";
import type { BinanceRest } from "@/market/sources/binance";
import type { BybitRest } from "@/market/sources/bybit";
import type { SpotRest } from "@/market/sources/binanceSpot";
import type { Candle } from "@/market/types";
import type { SeriesStore } from "@/domain/backtest/index";

const H4 = 14_400_000;
const START = Date.UTC(2024, 0, 1);
/** bars 0 … 3999 are closed, bar 4000 is forming */
const NOW = START + 4000 * H4 + 60_000;
const FAST = { timeoutMs: 60, backoffMs: [4, 8], maxBudgetWaitMs: 100, skipMemoMs: 60_000 };

const candle = (i: number): Candle => ({ time: START + i * H4, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 5, closed: true });
/** the exchange: bars `first` … 3999 (a listing after START leaves the earlier ones out) */
const all = (first = 0): Candle[] => Array.from({ length: 4000 - first }, (_, k) => candle(first + k));
const from = (rows: Candle[], startTime: number, limit: number): Candle[] => rows.filter((c) => c.time >= startTime).slice(0, limit);
const never = <T>(): Promise<T> => new Promise<T>(() => {});

function futures(opts: { first?: number; klines?: (symbol: string, interval: string, p: { startTime?: number; limit?: number; signal?: AbortSignal }) => Promise<unknown> } = {}) {
  const rows = all(opts.first);
  const klines = vi.fn(opts.klines ?? (async (_s: string, _i: string, p: { startTime?: number; limit?: number }) => ({ data: from(rows, p.startTime ?? 0, p.limit ?? 500), asOf: NOW, receivedAt: NOW, source: "binance", comparable: true })));
  const fundingRate = vi.fn(async () => ({ data: [{ time: START + 8 * 3_600_000, fundingRate: 0.0001 }], asOf: NOW, receivedAt: NOW, source: "binance", comparable: true }));
  return { klines, fundingRate } as unknown as BinanceRest & { klines: ReturnType<typeof vi.fn>; fundingRate: ReturnType<typeof vi.fn> };
}
function spot(opts: { first?: number; klines?: (symbol: string, interval: string, p: { startTime?: number; limit?: number; signal?: AbortSignal }) => Promise<unknown> } = {}) {
  const rows = all(opts.first);
  const klines = vi.fn(opts.klines ?? (async (_s: string, _i: string, p: { startTime?: number; limit?: number }) => from(rows, p.startTime ?? 0, Math.min(1000, p.limit ?? 1000))));
  return { klines } as unknown as SpotRest & { klines: ReturnType<typeof vi.fn> };
}
/** Bybit has no "first n bars from startTime": a window [start, end] comes back */
function bybit(opts: { first?: number; klines?: (symbol: string, interval: string, p: { start?: number; end?: number; limit?: number }) => Promise<unknown> } = {}) {
  const rows = all(opts.first);
  const klines = vi.fn(opts.klines ?? (async (_s: string, _i: string, p: { start?: number; end?: number; limit?: number }) => ({ data: rows.filter((c) => c.time >= (p.start ?? 0) && c.time <= (p.end ?? Infinity)).slice(0, p.limit ?? 200), asOf: NOW, receivedAt: NOW, source: "bybit", comparable: true })));
  return { klines } as unknown as BybitRest & { klines: ReturnType<typeof vi.fn> };
}

const req = (over: Partial<LoadRequest> = {}): LoadRequest => ({ symbol: "BTCUSDT", intervals: ["4h"], from: START, to: NOW, funding: false, ...over });

function memStore(): SeriesStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, structuredClone(v)) };
}

interface Wired {
  rest: BinanceRest;
  proxy: BinanceRest | null;
  bybit: BybitRest | null;
  spot: SpotRest | null;
  spotApp: SpotRest | null;
  store: SeriesStore | null;
  timing: typeof FAST;
}
function wire(w: Partial<Wired>): void {
  __setHistoryDeps({
    rest: () => w.rest ?? futures(),
    proxy: () => w.proxy ?? null,
    bybit: () => w.bybit ?? null,
    spot: () => w.spot ?? null,
    spotApp: () => w.spotApp ?? null,
    store: () => w.store ?? null,
    now: () => NOW,
    timing: w.timing ?? FAST,
  });
}

beforeEach(() => __setHistoryDeps(null));
afterEach(() => __setHistoryDeps(null));

describe("Zeitlimit", () => {
  it("ein hängender Abruf endet nach dem Zeitlimit mit einem klaren Grund – und das Netz-Signal wird abgebrochen", async () => {
    let seen: AbortSignal | undefined;
    const rest = futures({ klines: (_s, _i, p) => ((seen = p.signal), never()) });
    wire({ rest });
    const t0 = Date.now();
    const err = await loadLabData(req()).catch((e: unknown) => e);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(err).toMatchObject({ name: "LabLoadError", kind: "timeout" });
    expect(failuresOf(err)).toEqual([{ source: "binance", kind: "timeout", limitMs: 60 }]);
    expect(loadErrorKind(err)).toBe("blocked");
    expect(seen?.aborted).toBe(true);
    // a host that hangs on its FIRST page is not asked again
    expect(rest.klines).toHaveBeenCalledTimes(1);
  });

  it("withDeadline hält auch einen Aufruf nicht länger, der sein Signal ignoriert", async () => {
    const t0 = Date.now();
    await expect(withDeadline(() => never(), 30)).rejects.toMatchObject({ kind: "timeout" });
    expect(Date.now() - t0).toBeLessThan(500);
    await expect(withDeadline(async () => 7, 30)).resolves.toBe(7);
    const ctl = new AbortController();
    ctl.abort();
    await expect(withDeadline(async () => 1, 30, ctl.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("der Zeitlimit-Timer gilt auch für den Inhalt der Antwort: ein steckengebliebener Body hängt nicht mehr (fetchJson)", async () => {
    // headers arrive, the body never does – the old timer was cleared at the headers
    const fetchFake = (_u: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))),
      } as unknown as Response);
    const t0 = Date.now();
    await expect(fetchJson("https://x.test/k", klinesSchema, { fetch: fetchFake, timeoutMs: 40 })).rejects.toMatchObject({ kind: "timeout" });
    expect(Date.now() - t0).toBeLessThan(500);
    // an already aborted signal never starts a request
    const ctl = new AbortController();
    ctl.abort();
    const sent = vi.fn(fetchFake);
    await expect(fetchJson("https://x.test/k", klinesSchema, { fetch: sent, signal: ctl.signal, timeoutMs: 40 })).rejects.toBeInstanceOf(RestError);
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("Wiederholung mit Backoff", () => {
  it("eine Seite, die mitten im Lauf zweimal scheitert, wird wiederholt und kommt an", async () => {
    let calls = 0;
    const rows = all();
    const rest = futures({
      klines: async (_s, _i, p) => {
        calls++;
        if (calls === 2 || calls === 3) throw new RestError("http_5xx", "HTTP 503", 503); // page 2, attempts 1 and 2
        return { data: from(rows, p.startTime ?? 0, p.limit ?? 500), asOf: NOW, receivedAt: NOW, source: "binance", comparable: true };
      },
    });
    wire({ rest });
    const status: LoadStatus[] = [];
    const out = await loadLabData(req({ onStatus: (s) => status.push(s) }));
    expect(out.data["4h"]).toHaveLength(4000);
    expect(out.source).toBe("binance");
    expect(rest.klines).toHaveBeenCalledTimes(5); // 3 pages + 2 repeats
    const retries = status.filter((s) => s.step === "retry");
    expect(retries.map((s) => s.step === "retry" && [s.attempt, s.reason, s.inMs])).toEqual([
      [2, "http_5xx", 4],
      [3, "http_5xx", 8],
    ]);
  });

  it("nach der letzten erlaubten Wiederholung ist Schluss – und der Grund bleibt erhalten", async () => {
    const rest = futures({ klines: async () => Promise.reject(new RestError("network", "Failed to fetch")) });
    wire({ rest });
    const err = await loadLabData(req()).catch((e: unknown) => e);
    // not yet answered once: two attempts only, then the chain is over (no fallback asked for)
    expect(rest.klines).toHaveBeenCalledTimes(2);
    expect(err).toMatchObject({ name: "LabLoadError", kind: "network" });
  });

  it("was eine Wiederholung nicht ändert, wird nicht wiederholt", () => {
    expect(attemptsFor("blocked_451", true)).toBe(1);
    expect(attemptsFor("bad_symbol", true)).toBe(1);
    expect(attemptsFor("timeout", false)).toBe(1);
    expect(attemptsFor("timeout", true)).toBe(3);
    expect(attemptsFor("network", false)).toBe(2);
    expect(attemptsFor("http_5xx", true)).toBe(3);
  });

  it("das Abruf-Limit wartet nicht still: eine lange Sperre ist ein Fehler mit Grund", async () => {
    let calls = 0;
    const rows = all();
    const rest = futures({
      klines: async (_s, _i, p) => {
        if (++calls === 2) throw new RestError("rate_limited", "HTTP 429", 429); // page 2 of a proven source
        return { data: from(rows, p.startTime ?? 0, p.limit ?? 500), asOf: NOW, receivedAt: NOW, source: "binance", comparable: true };
      },
    });
    wire({ rest, timing: { ...FAST, maxBudgetWaitMs: 100 } });
    const t0 = Date.now();
    const err = await loadLabData(req()).catch((e: unknown) => e);
    expect(Date.now() - t0).toBeLessThan(1000); // the 5-s back-off is longer than the cap: it ends at once instead of waiting
    expect(err).toMatchObject({ name: "LabLoadError", kind: "rate_limited" });
    expect(loadErrorKind(err)).toBe("rate");
  });
});

describe("Fortschritt", () => {
  it("meldet Seite für Seite „n von m“ und bleibt nie bei 0 stehen", async () => {
    wire({ rest: futures() });
    const seen: [number, number][] = [];
    const out = await loadLabData(req({ onProgress: (d, t) => seen.push([d, t]) }));
    expect(out.pages).toBe(3); // 4000 bars, 1500 per page
    expect(seen[0]).toEqual([0, 3]);
    expect(seen.map((s) => s[0])).toEqual([0, 1, 2, 3]);
    expect(new Set(seen.map((s) => s[1]))).toEqual(new Set([3]));
  });

  it("zählt bei den 1000er-Seiten der Ausweichquelle mit deren Seitengröße", async () => {
    const rest = futures({ klines: async () => Promise.reject(new RestError("blocked_451", "HTTP 451", 451)) });
    wire({ rest, spot: spot() });
    const seen: [number, number][] = [];
    const out = await loadLabData(req({ fallback: true, onProgress: (d, t) => seen.push([d, t]) }));
    expect(out.source).toBe("spot");
    expect(out.data["4h"]).toHaveLength(4000);
    expect(out.pages).toBe(4); // 4000 bars, 1000 per page – a short page must not end the load early
    expect(seen[seen.length - 1]).toEqual([4, 4]);
  });
});

describe("Abbrechen", () => {
  it("beendet einen hängenden Abruf sofort und bricht die Anfrage ab", async () => {
    let seen: AbortSignal | undefined;
    wire({ rest: futures({ klines: (_s, _i, p) => ((seen = p.signal), never()) }), timing: { ...FAST, timeoutMs: 5_000 } });
    const ctl = new AbortController();
    const p = loadLabData(req({ signal: ctl.signal })).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 20));
    const t0 = Date.now();
    ctl.abort();
    const err = await p;
    expect(Date.now() - t0).toBeLessThan(200);
    expect(err).toMatchObject({ name: "AbortError" });
    expect(seen?.aborted).toBe(true);
  });

  it("beendet auch die Pause vor der nächsten Wiederholung sofort", async () => {
    wire({ rest: futures({ klines: async () => Promise.reject(new RestError("network", "x")) }), timing: { ...FAST, backoffMs: [5_000] } });
    const ctl = new AbortController();
    const p = loadLabData(req({ signal: ctl.signal })).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 30));
    const t0 = Date.now();
    ctl.abort();
    expect(await p).toMatchObject({ name: "AbortError" });
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it("ein schon abgebrochenes Signal startet gar nichts", async () => {
    const rest = futures();
    wire({ rest });
    const ctl = new AbortController();
    ctl.abort();
    await expect(loadLabData(req({ signal: ctl.signal }))).rejects.toMatchObject({ name: "AbortError" });
    expect(rest.klines).not.toHaveBeenCalled();
  });
});

describe("Ausweichkette", () => {
  it("geht der Reihe nach: Futures → EU-Proxy → Bybit → Spot, und nennt die Quelle samt den Gründen", async () => {
    const order: string[] = [];
    const rest = futures({ klines: () => (order.push("binance"), never()) });
    const proxy = futures({ klines: async () => (order.push("proxy"), Promise.reject(new RestError("blocked_451", "HTTP 451", 451))) });
    const by = bybit({ klines: async () => (order.push("bybit"), Promise.reject(new RestError("network", "Failed to fetch"))) });
    const sp = spot({
      klines: async (_s, _i, p) => {
        order.push("spot");
        return from(all(), p.startTime ?? 0, 1000);
      },
    });
    const spApp = spot();
    wire({ rest, proxy, bybit: by, spot: sp, spotApp: spApp });
    const status: LoadStatus[] = [];
    const out = await loadLabData(req({ fallback: true, onStatus: (s) => status.push(s) }));
    expect(out.source).toBe("spot");
    expect(out.viaProxy).toBe(false);
    expect(out.failed).toEqual([
      { source: "binance", kind: "timeout", limitMs: 60 },
      { source: "proxy", kind: "blocked_451", status: 451 },
      { source: "bybit", kind: "network" },
    ]);
    // each source was asked before the next one (the page pager of one source never mixes into another)
    expect([...new Set(order)]).toEqual(["binance", "proxy", "bybit", "spot"]);
    expect(spApp.klines).not.toHaveBeenCalled();
    // the status line saw every switch, in order
    const switches = status.filter((s) => s.step === "switch").map((s) => s.step === "switch" && `${s.from}>${s.to}:${s.reason}`);
    expect(switches).toEqual(["binance>proxy:timeout", "proxy>bybit:blocked_451", "bybit>spot:network"]);
    expect(out.data["4h"]).toHaveLength(4000);
  });

  it("die App-Funktion ist die letzte Stufe, wenn auch der Spot-Host nicht erreichbar ist", async () => {
    const rest = futures({ klines: async () => Promise.reject(new RestError("network", "x")) });
    const sp = spot({ klines: async () => Promise.reject(new RestError("cors", "x")) });
    const spApp = spot();
    wire({ rest, spot: sp, spotApp: spApp });
    const out = await loadLabData(req({ fallback: true }));
    expect(out.source).toBe("spot-app");
    expect(out.failed.map((f) => f.source)).toEqual(["binance", "spot"]);
  });

  it("ohne `fallback` (alle anderen Nutzer des Laders) bleibt es bei Futures und EU-Proxy", async () => {
    const rest = futures({ klines: async () => Promise.reject(new RestError("blocked_451", "HTTP 451", 451)) });
    const proxy = futures({ klines: async () => Promise.reject(new RestError("http_5xx", "HTTP 502", 502)) });
    const by = bybit();
    const sp = spot();
    wire({ rest, proxy, bybit: by, spot: sp });
    const err = await loadLabData(req()).catch((e: unknown) => e);
    expect(failuresOf(err).map((f) => f.source)).toEqual(["binance", "proxy"]);
    expect(by.klines).not.toHaveBeenCalled();
    expect(sp.klines).not.toHaveBeenCalled();
    expect(loadErrorKind(err)).toBe("blocked");
  });

  it("Futures direkt gelingt: Quelle „binance“, keine Fehlerliste; über den Proxy: „proxy“ und viaProxy", async () => {
    wire({ rest: futures() });
    const a = await loadLabData(req({ fallback: true }));
    expect(a).toMatchObject({ source: "binance", viaProxy: false, failed: [] });
    wire({ rest: futures({ klines: async () => Promise.reject(new RestError("blocked_451", "HTTP 451", 451)) }), proxy: futures() });
    const b = await loadLabData(req({ fallback: true }));
    expect(b).toMatchObject({ source: "proxy", viaProxy: true, failed: [{ source: "binance", kind: "blocked_451" }] });
  });

  it("ein unbekannter Markt beendet die Kette: kein Wechsel auf einen anderen Markt", async () => {
    const rest = futures({ klines: async () => Promise.reject(new RestError("bad_symbol", "HTTP 400", 400)) });
    const sp = spot();
    wire({ rest, proxy: futures(), spot: sp });
    const err = await loadLabData(req({ symbol: "FOOUSDT", fallback: true })).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "LabLoadError", kind: "bad_symbol" });
    expect(loadErrorKind(err)).toBe("symbol");
    expect(sp.klines).not.toHaveBeenCalled();
  });

  it("ohne Internet (offline) wird nicht erst durch die ganze Kette probiert", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    try {
      const rest = futures({ klines: async () => Promise.reject(new TypeError("Failed to fetch")) });
      const sp = spot();
      wire({ rest, proxy: futures(), spot: sp });
      const err = await loadLabData(req({ fallback: true })).catch((e: unknown) => e);
      expect(err).toMatchObject({ name: "LabLoadError", kind: "offline" });
      expect(sp.klines).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    }
  });

  it("Bybit liefert die erste Seite ab startTime, auch wenn der Markt später gelistet wurde (Fenster werden übersprungen)", async () => {
    const rest = futures({ klines: async () => Promise.reject(new RestError("blocked_451", "HTTP 451", 451)) });
    const by = bybit({ first: 1200 }); // listed at bar 1200: the first two windows of 1000 bars are empty / short
    wire({ rest, bybit: by });
    const out = await loadLabData(req({ fallback: true }));
    expect(out.source).toBe("bybit");
    const bars = out.data["4h"]!;
    expect(bars).toHaveLength(2800);
    expect(bars[0]!.t * 1000).toBe(START + 1200 * H4);
    expect(bars[bars.length - 1]!.t * 1000).toBe(START + 3999 * H4);
    for (let i = 1; i < bars.length; i++) expect(bars[i]!.t - bars[i - 1]!.t).toBe(H4 / 1000);
  });

  it("ein Bybit-Markt, den Bybit nicht kennt (kein USDT-Perp), wird übersprungen", async () => {
    const rest = futures({ klines: async () => Promise.reject(new RestError("blocked_451", "HTTP 451", 451)) });
    const by = bybit();
    wire({ rest, bybit: by, spot: spot() });
    const out = await loadLabData(req({ symbol: "BTCUSDC", fallback: true }));
    expect(out.source).toBe("spot");
    expect(by.klines).not.toHaveBeenCalled();
    expect(out.failed.map((f) => f.source)).toEqual(["binance"]);
  });

  it("die Funding-Historie kommt nur von Futures – eine Ausweichquelle liefert keine und sagt das über `funding: null`", async () => {
    const rest = futures();
    wire({ rest });
    const a = await loadLabData(req({ fallback: true, funding: true }));
    expect(a.funding).toEqual([{ t: START + 8 * 3_600_000, rate: 0.0001 }]);
    const down = futures({ klines: async () => Promise.reject(new RestError("blocked_451", "HTTP 451", 451)) });
    wire({ rest: down, spot: spot() });
    const b = await loadLabData(req({ fallback: true, funding: true }));
    expect(b.source).toBe("spot");
    expect(b.funding).toBeNull();
    expect(down.fundingRate).not.toHaveBeenCalled();
  });

  it("jede Quelle hat ihren eigenen Cache – Spot-Kerzen landen nie in der Futures-Reihe", async () => {
    const store = memStore();
    const rest = futures({ klines: async () => Promise.reject(new RestError("blocked_451", "HTTP 451", 451)) });
    wire({ rest, spot: spot(), store });
    const out = await loadLabData(req({ fallback: true }));
    expect(out.source).toBe("spot");
    const keys = [...store.data.keys()];
    expect(keys).toEqual([`${LAB_CACHE_PREFIX}:spot:BTCUSDT:4h`]);
    // a later run with Binance back is a futures run: it does not read the spot cache
    const futuresRest = futures();
    wire({ rest: futuresRest, spot: spot(), store });
    const again = await loadLabData(req({ fallback: true }));
    expect(again.source).toBe("binance");
    expect(futuresRest.klines).toHaveBeenCalled();
    expect([...store.data.keys()].sort()).toEqual([`${LAB_CACHE_PREFIX}:BTCUSDT:4h`, `${LAB_CACHE_PREFIX}:spot:BTCUSDT:4h`].sort());
  });

  it("liegt alles im Futures-Cache, braucht der Lauf kein Netz – und die Quelle bleibt Futures", async () => {
    const store = memStore();
    wire({ rest: futures(), store });
    await loadLabData(req({ fallback: true }));
    const dead = futures({ klines: () => never() });
    wire({ rest: dead, store });
    const out = await loadLabData(req({ fallback: true }));
    expect(out).toMatchObject({ source: "binance", pages: 0, failed: [] });
    expect(dead.klines).not.toHaveBeenCalled();
  });

  it("eine Quelle, die eben erst gehangen hat, wird beim nächsten Lauf nicht noch einmal zuerst gefragt – „Erneut versuchen“ fragt wieder alle", async () => {
    const rest = futures({ klines: () => never() });
    wire({ rest, proxy: futures() });
    const first = await loadLabData(req({ fallback: true }));
    expect(first).toMatchObject({ source: "proxy", failed: [{ source: "binance", kind: "timeout" }] });
    expect(rest.klines).toHaveBeenCalledTimes(1);
    const second = await loadLabData(req({ fallback: true }));
    expect(rest.klines).toHaveBeenCalledTimes(1); // skipped
    expect(second.failed).toEqual([{ source: "binance", kind: "timeout", skipped: true }]);
    forgetRoutes();
    await loadLabData(req({ fallback: true }));
    expect(rest.klines).toHaveBeenCalledTimes(2);
  });
});

describe("Spot-Client", () => {
  it("liest den Marktdaten-Host (CORS-fähig) und über die App-Funktion denselben Satz Zeilen", async () => {
    const row = [START, "1", "2", "0.5", "1.5", "10", START + H4 - 1, "15", 3, "5", "7", "0"];
    const f = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify([row]), { status: 200, headers: { "content-type": "application/json" } }));
    const direct = await spotRest({ fetch: f as never, now: () => NOW }).klines("BTCUSDT", "4h", { startTime: START, limit: 5000 });
    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({ time: START, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, closed: true });
    const url = new URL(String(f.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://data-api.binance.vision/api/v3/klines");
    expect(url.searchParams.get("limit")).toBe("1000"); // never above Binance's spot page
    await spotRest({ fetch: f as never, now: () => NOW, viaApp: true }).klines("BTCUSDT", "4h", { startTime: START });
    const app = new URL(String(f.mock.calls[1]![0]), "https://app.test");
    expect(app.pathname).toBe("/api/v1/klines");
    expect(app.searchParams.get("venue")).toBe("spot");
    expect(app.searchParams.get("symbol")).toBe("BTCUSDT");
  });
});
