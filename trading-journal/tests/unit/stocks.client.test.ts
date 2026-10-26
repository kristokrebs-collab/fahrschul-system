/**
 * The stock data contract on the client (F67/F68, `src/market/stocks`): typed results `ok | stale | unavailable(reason)`,
 * cache and stale rules, batching, the error mapping, the throttle, the news sources and the New York calendar.
 */
import { describe, expect, it, vi } from "vitest";
import { ApiError, FUNCTIONS_MISSING } from "@/cloud/api";
import { memoryKV } from "@/market/cache";
import { createStockCache } from "@/market/stocks/cache";
import { createStockData, failFrom, RATE_BACKOFF_MS } from "@/market/stocks/client";
import { loadNews, registerNewsSource, summarize, YAHOO_NEWS_SOURCE, newsSources, type NewsSource } from "@/market/stocks/news";
import { dataOf, ok, stale, stampOf, unavailable } from "@/market/stocks/result";
import { addDays, calendarKnown, closedReason, currentTradingDay, isClosedBar, isSessionOpen, nyOffsetMin, nyParts, nyToUtc, regularOnly, sessionOf } from "@/market/stocks/session";
import { createLimiter } from "@/market/stocks/throttle";
import type { NewsItem, StockResult } from "@/market/stocks/types";
import type { BarsResponse, NewsResponse, QuoteResponse, SymbolsResponse } from "@/market/stocks/wire";

const T0 = Date.UTC(2026, 9, 24, 12, 0); // Sat 2026-10-24 12:00 UTC: the market is closed
const FRI_OPEN = Date.UTC(2026, 9, 23, 13, 30); // Fri 9:30 New York

const meta = { name: "Apple Inc.", currency: "USD", exchange: "NasdaqGS", price: 347.7, prevClose: 348.2, volume: 1000, marketTime: FRI_OPEN + 6.5 * 3_600_000 };
const barsOk = (n = 3, time = FRI_OPEN): BarsResponse["results"][string] => ({ ok: true, bars: Array.from({ length: n }, (_, i) => [time + i * 86_400_000, 10, 11, 9, 10 + i, 100 + i] as [number, number, number, number, number, number]), meta });
const barsBody = (results: BarsResponse["results"], fetchedAt = T0, interval: "1d" | "5m" = "1d"): BarsResponse => ({ source: "yahoo", interval, range: interval === "1d" ? "6mo" : "1d", fetchedAt, results });

function harness(opts: { responder?: (path: string, query: Record<string, string>) => unknown; start?: number } = {}) {
  let t = opts.start ?? T0;
  const calls: { path: string; query: Record<string, string> }[] = [];
  const api = vi.fn(async (path: string, init?: { query?: Record<string, string | number | boolean | null | undefined>; signal?: AbortSignal }) => {
    const query = Object.fromEntries(Object.entries(init?.query ?? {}).map(([k, v]) => [k, String(v)]));
    calls.push({ path, query });
    if (init?.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    const r = opts.responder ? opts.responder(path, query) : {};
    if (r instanceof Error) throw r;
    return r;
  });
  const limiter = createLimiter({ capacity: 1000, concurrency: 4, now: () => t });
  const data = createStockData({ api: api as never, now: () => t, kv: memoryKV(), limiter, online: () => true });
  return { data, api, calls, limiter, advance: (ms: number) => (t += ms), now: () => t };
}

describe("typed results", () => {
  it("builds ok / stale / unavailable and reads data and stamp out of them", () => {
    const stamp = { source: "yahoo", asOf: 5, receivedAt: 6 };
    const a = ok("x", stamp);
    const b = stale("y", stamp, "network", "weg", 9);
    const c = unavailable<string>("blocked", 7);
    expect(a).toEqual({ status: "ok", data: "x", ...stamp });
    expect(b).toMatchObject({ status: "stale", data: "y", reason: "network", message: "weg", failedAt: 9, asOf: 5 });
    expect(c).toMatchObject({ status: "unavailable", reason: "blocked", at: 7 });
    expect(c.status === "unavailable" && c.message).toContain("verweigert");
    expect([dataOf(a), dataOf(b), dataOf(c)]).toEqual(["x", "y", null]);
    expect(stampOf(a)).toEqual(stamp);
    expect(stampOf(c)).toBeNull();
    expect(dataOf(undefined)).toBeNull();
  });
});

describe("bars", () => {
  it("answers ok with the stamp of the source and marks complete candles from the fetch time", async () => {
    const h = harness({ responder: () => barsBody({ AAPL: barsOk(2, FRI_OPEN - 86_400_000) }, FRI_OPEN + 3_600_000) });
    const r = await h.data.bars("aapl", "1d");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r).toMatchObject({ source: "yahoo", asOf: meta.marketTime, receivedAt: T0, fetchedAt: FRI_OPEN + 3_600_000 });
    expect(r.data.symbol).toBe("AAPL");
    expect(r.data.candles).toHaveLength(2);
    // fetched Friday 10:30: Thursday's session is over, Friday's (the second candle) is still running
    expect(r.data.candles.map((c) => c.closed)).toEqual([true, false]);
    expect(h.calls[0]).toEqual({ path: "/stocks/bars", query: { symbols: "AAPL", interval: "1d", range: "6mo" } });
  });

  it("serves a second ask from the cache within the time to live and fetches again after it – or on 'fresh'", async () => {
    const h = harness({ responder: () => barsBody({ AAPL: barsOk() }) });
    await h.data.bars("AAPL", "1d");
    h.advance(5 * 60_000);
    const cached = await h.data.bars("AAPL", "1d");
    expect(cached.status).toBe("ok");
    expect(h.api).toHaveBeenCalledTimes(1);
    expect(cached.status === "ok" && cached.receivedAt).toBe(T0); // the stamp of the original receipt
    await h.data.bars("AAPL", "1d", { fresh: true });
    expect(h.api).toHaveBeenCalledTimes(2);
    h.advance(11 * 60_000);
    await h.data.bars("AAPL", "1d");
    expect(h.api).toHaveBeenCalledTimes(3);
  });

  it("asks for several symbols in batches of eight and returns one result for each", async () => {
    const syms = Array.from({ length: 19 }, (_, i) => `S${String.fromCharCode(65 + i)}`);
    const h = harness({ responder: (_p, q) => barsBody(Object.fromEntries(q.symbols!.split(",").map((s) => [s, barsOk()]))) });
    const res = await h.data.barsMany(syms, "1d");
    expect(Object.keys(res)).toHaveLength(19);
    expect(h.calls.map((c) => c.query.symbols!.split(",").length).sort((a, b) => b - a)).toEqual([8, 8, 3]);
    expect(Object.values(res).every((r) => r.status === "ok")).toBe(true);
    // duplicates and case do not cause a second request for the same symbol
    expect(Object.keys(await h.data.barsMany(["sa", "SA", " SA "], "1d"))).toEqual(["SA"]);
  });

  it("reports an unknown ticker on its own and the others as ok", async () => {
    const h = harness({ responder: () => barsBody({ AAPL: barsOk(), ZZZZ: { ok: false, reason: "bad-symbol", message: "Yahoo Finance kennt dieses Kürzel nicht." } }) });
    const res = await h.data.barsMany(["AAPL", "ZZZZ"], "1d");
    expect(res["AAPL"]!.status).toBe("ok");
    expect(res["ZZZZ"]).toMatchObject({ status: "unavailable", reason: "bad-symbol", message: "Yahoo Finance kennt dieses Kürzel nicht.", source: "yahoo" });
  });

  it("shows the last good data as 'stale' with the reason when the refresh fails – inside the age limit only", async () => {
    let fail = false;
    const h = harness({ responder: () => (fail ? new ApiError(502, "stock_upstream_blocked", "Yahoo Finance verweigert die Abrufe dieses Servers (HTTP 403).") : barsBody({ AAPL: barsOk() })) });
    await h.data.bars("AAPL", "1d");
    fail = true;
    h.advance(11 * 60_000);
    const r = await h.data.bars("AAPL", "1d");
    expect(r).toMatchObject({ status: "stale", reason: "blocked", message: expect.stringContaining("verweigert"), source: "yahoo", receivedAt: T0, failedAt: T0 + 11 * 60_000 });
    h.advance(8 * 86_400_000); // beyond the 7 days a daily answer may stand in
    expect((await h.data.bars("AAPL", "1d")).status).toBe("unavailable");
  });

  it("does not stand in with old data for a ticker the source does not know", async () => {
    let known = true;
    const h = harness({ responder: () => barsBody({ AAPL: known ? barsOk() : { ok: false, reason: "bad-symbol", message: "weg" } }) });
    await h.data.bars("AAPL", "1d");
    known = false;
    h.advance(11 * 60_000);
    expect((await h.data.bars("AAPL", "1d")).status).toBe("unavailable");
  });

  it("calls an answer in an unknown shape 'bad-response' instead of using part of it", async () => {
    const h = harness({ responder: () => ({ hello: "world" }) });
    expect(await h.data.bars("AAPL", "1d")).toMatchObject({ status: "unavailable", reason: "bad-response" });
    const h2 = harness({ responder: () => barsBody({ MSFT: barsOk() }) }); // the asked symbol is missing
    expect(await h2.data.bars("AAPL", "1d")).toMatchObject({ status: "unavailable", reason: "bad-response" });
  });

  it("pauses the throttle after a limit", async () => {
    const h = harness({ responder: () => new ApiError(429, "rate_limited", "Zu viele Anfragen – bitte kurz warten.") });
    const spy = vi.spyOn(h.limiter, "backoff");
    expect(await h.data.bars("AAPL", "1d")).toMatchObject({ status: "unavailable", reason: "rate-limited" });
    expect(spy).toHaveBeenCalledWith(RATE_BACKOFF_MS);
  });

  it("stops quietly on abort and caches nothing for it", async () => {
    const h = harness({ responder: () => barsBody({ AAPL: barsOk() }) });
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await h.data.bars("AAPL", "1d", { signal: ctrl.signal })).toMatchObject({ status: "unavailable", reason: "aborted" });
    expect((await h.data.bars("AAPL", "1d")).status).toBe("ok");
  });

  it("asks for the interval's default range and accepts another", async () => {
    const h = harness({ responder: (_p, q) => barsBody({ AAPL: barsOk() }, T0, q.interval as "1d") });
    await h.data.bars("AAPL", "5m");
    await h.data.bars("AAPL", "1d", { range: "1y" });
    expect(h.calls.map((c) => `${c.query.interval}/${c.query.range}`)).toEqual(["5m/1d", "1d/1y"]);
  });
});

describe("error mapping", () => {
  const f = (e: unknown, online = true) => failFrom(e, () => online);
  it("names the reason of every failure the app can meet", () => {
    expect(f(new ApiError(0, "unavailable", FUNCTIONS_MISSING)).reason).toBe("no-server");
    expect(f(new ApiError(0, "unavailable", "In der Offline-Datei gibt es keine Server-Funktionen.")).reason).toBe("no-server");
    expect(f(new ApiError(0, "unavailable", "Der Server ist gerade nicht erreichbar.")).reason).toBe("network");
    expect(f(new ApiError(0, "unavailable", "x"), false).reason).toBe("offline");
    expect(f(new ApiError(401, "unauthenticated", "Für die Aktien-Daten bitte anmelden."))).toEqual({ reason: "login", message: "Für die Aktien-Daten bitte anmelden." });
    expect(f(new ApiError(402, "plan_required", "Box-Scanner ist in deinem Tarif nicht enthalten.")).reason).toBe("plan");
    expect(f(new ApiError(429, "rate_limited", "x")).reason).toBe("rate-limited");
    expect(f(new ApiError(502, "stock_upstream_rate_limited", "x")).reason).toBe("rate-limited");
    expect(f(new ApiError(502, "stock_upstream_blocked", "x")).reason).toBe("blocked");
    expect(f(new ApiError(502, "stock_upstream_unavailable", "x")).reason).toBe("upstream");
    expect(f(new ApiError(400, "bad_symbols", "Kein gültiges US-Kürzel: X.")).reason).toBe("bad-symbol");
    expect(f(new ApiError(400, "bad_interval", "x")).reason).toBe("bad-response");
    expect(f(new ApiError(404, "http_404", "x")).reason).toBe("no-server");
    expect(f(new ApiError(500, "internal", "x")).reason).toBe("upstream");
    expect(f(Object.assign(new Error("a"), { name: "AbortError" })).reason).toBe("aborted");
    expect(f(new TypeError("fetch failed")).reason).toBe("network");
    expect(f(new TypeError("fetch failed"), false).reason).toBe("offline");
  });
});

describe("quotes, symbols and news", () => {
  it("maps a quote and caches it for fifteen seconds", async () => {
    const q: QuoteResponse = { source: "yahoo", fetchedAt: T0, results: { AAPL: { ok: true, name: "Apple Inc.", currency: "USD", exchange: "NasdaqGS", price: 347.7, prevClose: 348.2, change: -0.5, changePct: -0.14, dayHigh: 351, dayLow: 345, volume: 1000, fiftyTwoWeekHigh: 352, fiftyTwoWeekLow: 243, marketTime: FRI_OPEN } } };
    const h = harness({ responder: () => q });
    const r = await h.data.quote("aapl");
    expect(r).toMatchObject({ status: "ok", source: "yahoo", asOf: FRI_OPEN, data: { symbol: "AAPL", price: 347.7, prevClose: 348.2, changePct: -0.14 } });
    h.advance(10_000);
    await h.data.quote("AAPL");
    expect(h.api).toHaveBeenCalledTimes(1);
    h.advance(10_000);
    await h.data.quote("AAPL");
    expect(h.api).toHaveBeenCalledTimes(2);
  });

  it("maps the symbol directory and keeps it for the day", async () => {
    const s: SymbolsResponse = { source: "nasdaqtrader", fileTime: FRI_OPEN, fetchedAt: T0, counts: { rows: 3, kept: 2, dropped: { ETFs: 1 } }, symbols: [["AAPL", "Apple Inc. - Common Stock", "NASDAQ", "N"], ["BRK.B", "Berkshire", "NYSE", null]] };
    const h = harness({ responder: () => s });
    const r = await h.data.symbols();
    expect(r).toMatchObject({ status: "ok", source: "nasdaqtrader", asOf: FRI_OPEN, data: { fileTime: FRI_OPEN, counts: { kept: 2 } } });
    expect(dataOf(r)!.entries[1]).toEqual({ symbol: "BRK.B", name: "Berkshire", exchange: "NYSE", fin: null });
    h.advance(11 * 3_600_000);
    await h.data.symbols();
    expect(h.api).toHaveBeenCalledTimes(1);
    h.advance(2 * 3_600_000);
    await h.data.symbols();
    expect(h.api).toHaveBeenCalledTimes(2);
  });

  it("says why the directory is missing, and shows an older one as stale", async () => {
    const s: SymbolsResponse = { source: "nasdaqtrader", fileTime: null, fetchedAt: T0, counts: { rows: 1, kept: 1, dropped: {} }, symbols: [["AAPL", "Apple", "NASDAQ", "N"]] };
    let fail = false;
    const h = harness({ responder: () => (fail ? new ApiError(502, "stock_upstream_unavailable", "Nasdaq Trader ist nicht erreichbar.") : s) });
    expect(await h.data.symbols()).toMatchObject({ status: "ok", asOf: null });
    fail = true;
    h.advance(13 * 3_600_000);
    expect(await h.data.symbols()).toMatchObject({ status: "stale", reason: "upstream", message: "Nasdaq Trader ist nicht erreichbar." });
    const h2 = harness({ responder: () => new ApiError(0, "unavailable", FUNCTIONS_MISSING) });
    expect(await h2.data.symbols()).toMatchObject({ status: "unavailable", reason: "no-server", source: "nasdaqtrader" });
  });

  it("maps headlines with their symbol and origin and stamps them with the newest one", async () => {
    const n: NewsResponse = { source: "yahoo-rss", fetchedAt: T0, results: { TSLA: { ok: true, items: [{ id: "a", title: "Tesla news", url: "https://x.example/a", publisher: "x.example", publishedAt: T0 - 60_000, summary: null }, { id: "b", title: "Older", url: "https://x.example/b", publisher: null, publishedAt: T0 - 120_000, summary: "s" }] }, NVDA: { ok: false, reason: "no-data", message: "keine" } } };
    const h = harness({ responder: () => n });
    const res = await h.data.news(["tsla", "nvda"]);
    expect(res["TSLA"]).toMatchObject({ status: "ok", source: "yahoo-rss", asOf: T0 - 60_000 });
    expect(dataOf(res["TSLA"])![0]).toMatchObject({ symbol: "TSLA", origin: "yahoo-rss", title: "Tesla news" });
    expect(res["NVDA"]).toMatchObject({ status: "unavailable", reason: "no-data" });
  });
});

describe("throttle", () => {
  it("never runs more calls at once than allowed and waits for tokens", async () => {
    let t = 0;
    const slept: number[] = [];
    const lim = createLimiter({ capacity: 2, windowMs: 1000, concurrency: 1, now: () => t, sleep: async (ms) => void (slept.push(ms), (t += ms)) });
    let running = 0;
    let peak = 0;
    const job = async () => {
      running++;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running--;
      return t;
    };
    const times = await Promise.all([1, 2, 3, 4].map(() => lim.run(job)));
    expect(peak).toBe(1);
    expect(times.slice(0, 2)).toEqual([0, 0]); // two tokens at once
    expect(slept.length).toBeGreaterThan(0); // the third had to wait
    expect(times[2]!).toBeGreaterThan(0);
  });

  it("holds every call back after a backoff and rejects a waiting call on abort", async () => {
    let t = 0;
    const lim = createLimiter({ capacity: 10, now: () => t, sleep: async (ms) => void (t += ms) });
    lim.backoff(30_000);
    await lim.run(async () => 1);
    expect(t).toBeGreaterThanOrEqual(30_000);
    const ctrl = new AbortController();
    const lim2 = createLimiter({ concurrency: 1 });
    let release: () => void = () => undefined;
    const first = lim2.run(() => new Promise<void>((r) => (release = r)));
    const waiting = lim2.run(async () => 2, { signal: ctrl.signal });
    ctrl.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    release();
    await first;
    expect(lim2.pending()).toEqual({ waiting: 0, running: 0 });
  });
});

describe("cache", () => {
  it("keeps entries in memory and in the store, drops corrupt ones and prunes old ones", async () => {
    const kv = memoryKV();
    const c = createStockCache(kv);
    const stamp = { source: "yahoo", asOf: 1, receivedAt: 2 };
    await c.set("stocks:a", { v: 1, data: [1], stamp, storedAt: 1000 });
    await c.set("stocks:b", { v: 1, data: [2], stamp, storedAt: 9_000_000 });
    await kv.set("stocks:c", { garbage: true });
    await kv.set("tj:other", { v: 1 });
    expect((await createStockCache(kv).get<number[]>("stocks:a"))!.data).toEqual([1]);
    expect(await createStockCache(kv).get("stocks:c")).toBeNull();
    expect(await c.prune(10_000_000, 5_000_000)).toBe(2); // a (old) and c (corrupt)
    expect(await kv.get("stocks:a")).toBeUndefined();
    expect(await kv.get("tj:other")).toEqual({ v: 1 }); // other caches are not touched
    await c.clear();
    expect(await kv.keys()).toEqual(["tj:other"]);
  });
});

describe("news sources", () => {
  const item = (symbol: string, title: string, at: number, origin = "test"): NewsItem => ({ id: title, symbol, title, url: `https://e.example/${title}`, publisher: "e.example", publishedAt: at, summary: null, origin });
  const stamp = { source: "test", asOf: 100, receivedAt: 200 };
  const source = (id: string, results: Record<string, StockResult<NewsItem[]>>): NewsSource => ({ id, label: `Quelle ${id}`, load: async () => results });

  it("registers Yahoo by default and lets another source plug in and out", () => {
    expect(newsSources().map((s) => s.id)).toContain("yahoo-rss");
    expect(newsSources().find((s) => s.id === "yahoo-rss")).toBe(YAHOO_NEWS_SOURCE);
    const off = registerNewsSource(source("sec-test", {}));
    expect(newsSources().map((s) => s.id)).toContain("sec-test");
    off();
    expect(newsSources().map((s) => s.id)).not.toContain("sec-test");
  });

  it("merges the items of all sources and reports each source's state", async () => {
    const a = source("a", { TSLA: ok([item("TSLA", "one", 5)], stamp), NVDA: ok([item("NVDA", "two", 6)], stamp) });
    const b = source("b", { TSLA: unavailable("blocked", 9), NVDA: unavailable("blocked", 9) });
    const c = source("c", { TSLA: ok([item("TSLA", "three", 7)], stamp), NVDA: unavailable("rate-limited", 9) });
    const d = source("d", { TSLA: stale([item("TSLA", "four", 1)], stamp, "network", "Server weg", 9) });
    const boom: NewsSource = { id: "boom", label: "Kaputt", load: async () => Promise.reject(new Error("x")) };
    const batch = await loadNews(["TSLA", "NVDA"], {}, [a, b, c, d, boom]);
    expect(batch.items.map((i) => i.title).sort()).toEqual(["four", "one", "three", "two"]);
    const by = Object.fromEntries(batch.sources.map((s) => [s.id, s]));
    expect(by.a).toMatchObject({ status: "ok", okSymbols: 2, failedSymbols: 0, asOf: 100, receivedAt: 200 });
    expect(by.b).toMatchObject({ status: "unavailable", reason: "blocked", okSymbols: 0, failedSymbols: 2 });
    expect(by.c).toMatchObject({ status: "partial", reason: "rate-limited", okSymbols: 1, failedSymbols: 1 });
    expect(by.d).toMatchObject({ status: "stale", reason: "network", message: "Server weg" });
    expect(by.boom).toMatchObject({ status: "unavailable", reason: "network", failedSymbols: 2 });
    expect(summarize(a, {})).toMatchObject({ status: "unavailable", okSymbols: 0 });
  });
});

describe("New York calendar", () => {
  it("knows daylight saving time on the right Sundays", () => {
    expect(nyOffsetMin(Date.UTC(2026, 2, 8, 6, 59))).toBe(-300); // before 2:00 EST on 8 March 2026
    expect(nyOffsetMin(Date.UTC(2026, 2, 8, 7, 0))).toBe(-240);
    expect(nyOffsetMin(Date.UTC(2026, 10, 1, 5, 59))).toBe(-240); // before 2:00 EDT on 1 November
    expect(nyOffsetMin(Date.UTC(2026, 10, 1, 6, 0))).toBe(-300);
    expect(nyParts(Date.UTC(2026, 9, 23, 13, 30))).toMatchObject({ date: "2026-10-23", minutes: 9 * 60 + 30, weekday: 5 });
    expect(nyToUtc("2026-10-23", 9 * 60 + 30)).toBe(FRI_OPEN);
    expect(nyToUtc("2026-12-01", 9 * 60 + 30)).toBe(Date.UTC(2026, 11, 1, 14, 30)); // winter: 9:30 EST = 14:30 UTC
  });

  it("opens 9:30 to 16:00, closes at 13:00 on an early close, and is shut on weekends and holidays", () => {
    expect(sessionOf("2026-10-23")).toEqual({ date: "2026-10-23", openMs: FRI_OPEN, closeMs: FRI_OPEN + 6.5 * 3_600_000, early: false });
    expect(sessionOf("2026-11-27")).toMatchObject({ early: true, closeMs: nyToUtc("2026-11-27", 13 * 60) });
    expect(sessionOf("2026-10-24")).toBeNull();
    expect(sessionOf("2026-11-26")).toBeNull();
    expect(closedReason("2026-10-24")).toBe("Wochenende");
    expect(closedReason("2026-11-26")).toBe("Feiertag (Thanksgiving)");
    expect(closedReason("2026-10-23")).toBeNull();
    expect(calendarKnown("2027-06-01")).toBe(true);
    expect(calendarKnown("2028-06-01")).toBe(false);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("finds the trading day the market is at – the last session on a weekend", () => {
    expect(currentTradingDay(T0).date).toBe("2026-10-23"); // Saturday → Friday
    expect(currentTradingDay(Date.UTC(2026, 9, 26, 12, 0)).date).toBe("2026-10-23"); // Monday 8:00 NY: not yet open
    expect(currentTradingDay(Date.UTC(2026, 9, 26, 15, 0)).date).toBe("2026-10-26");
    expect(currentTradingDay(Date.UTC(2026, 10, 27, 15, 0)).date).toBe("2026-11-27"); // the day after Thanksgiving
    expect(isSessionOpen(FRI_OPEN + 3_600_000)).toBe(true);
    expect(isSessionOpen(FRI_OPEN - 60_000)).toBe(false);
    expect(isSessionOpen(T0)).toBe(false);
  });

  it("keeps only candles inside the regular session and calls a bar complete when its interval or session is over", () => {
    const c = (time: number) => ({ time });
    const kept = regularOnly([c(FRI_OPEN - 300_000), c(FRI_OPEN), c(FRI_OPEN + 6.5 * 3_600_000 - 300_000), c(FRI_OPEN + 6.5 * 3_600_000), c(T0)]);
    expect(kept.map((k) => k.time)).toEqual([FRI_OPEN, FRI_OPEN + 6.5 * 3_600_000 - 300_000]);
    expect(isClosedBar("5m", FRI_OPEN, FRI_OPEN + 299_999)).toBe(false);
    expect(isClosedBar("5m", FRI_OPEN, FRI_OPEN + 300_000)).toBe(true);
    expect(isClosedBar("1d", FRI_OPEN, FRI_OPEN + 3_600_000)).toBe(false);
    expect(isClosedBar("1d", FRI_OPEN, FRI_OPEN + 6.5 * 3_600_000)).toBe(true);
  });
});
