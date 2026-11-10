/**
 * Archive collector (F26): mocked Binance answers (the documented shapes of premiumIndex, openInterest and the
 * /futures/data ratios) on fake-indexeddb. The window rule (only what appeared during the tick's window is written, so a
 * pause stays a gap), the route fallback to the proxy, failure reasons in the tick log, the rate-limit backoff, offline,
 * the quota stop, analysis states and the ring-buffer trim – with numbers worked out by hand in the comments.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ARCHIVE_CFG, findGaps, seriesDef, type ArchiveCfg } from "@/domain/archive";
import { Collector, QUOTA_STOP_SHARE, RATE_BACKOFF_MS, type CollectorDeps, type StateRead } from "@/market/archive/collector";
import { openArchiveDb, type ArchiveDb } from "@/market/archive/db";
import { binanceRest, BINANCE_REST } from "@/market/sources/binance";
import { proxyRest } from "@/market/sources/proxy";

const MIN = 60_000;
/** 2026-10-26 02:00:00 UTC */
const T0 = Date.UTC(2026, 9, 26, 2, 0, 0);
const CFG: ArchiveCfg = { ...DEFAULT_ARCHIVE_CFG, on: true, everyMin: 10 };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ratioRow = (symbol: string, t: number, long: number) => ({ symbol, longShortRatio: String((long / (1 - long)).toFixed(4)), longAccount: String(long), shortAccount: String((1 - long).toFixed(4)), timestamp: t });

interface Net {
  calls: string[];
  /** HTTP status for every path (default 200) */
  status: number;
  /** rows the ratio endpoints know: 5-minute boundaries from here to `now` */
  ratioFrom: number;
  now: number;
}

/** A fake Binance (`direct`) or proxy host answering by path. */
function host(net: Net, label: string) {
  return async (input: string): Promise<Response> => {
    net.calls.push(`${label}:${input.replace(/^https?:\/\/[^/]+/, "").replace("/api/binance", "")}`);
    if (net.status !== 200) return json({ code: -1, msg: "x" }, net.status);
    const url = new URL(input, "https://x.test");
    const symbol = url.searchParams.get("symbol") ?? "BTCUSDT";
    if (url.pathname.endsWith("/premiumIndex")) return json({ symbol, markPrice: "80000.10", indexPrice: "80001.20", estimatedSettlePrice: "80002.0", lastFundingRate: "0.00010000", interestRate: "0.00010000", nextFundingTime: net.now + 3 * 3_600_000, time: net.now });
    if (url.pathname.endsWith("/openInterest")) return json({ symbol, openInterest: "12345.678", time: net.now });
    if (url.pathname.includes("/futures/data/")) {
      const limit = Number(url.searchParams.get("limit") ?? 30);
      const last = Math.floor(net.now / (5 * MIN)) * 5 * MIN;
      const rows: ReturnType<typeof ratioRow>[] = [];
      for (let t = last; t >= net.ratioFrom && rows.length < limit; t -= 5 * MIN) rows.unshift(ratioRow(symbol, t, 0.6 + ((t / (5 * MIN)) % 7) / 100));
      return json(rows);
    }
    return json({}, 404);
  };
}

let db: ArchiveDb;
let net: Net;
let direct: Net;
let states: StateRead[];
let online: boolean;
let est: { usage: number; quota: number } | null;
let nowMs: number;

function make(over: Partial<CollectorDeps> = {}, directNet?: Net): Collector {
  const d = directNet ?? net;
  const deps: CollectorDeps = {
    db,
    rest: () => binanceRest({ base: BINANCE_REST, fetch: host(d, "direct"), now: () => nowMs }),
    proxy: () => proxyRest({ fetch: host(net, "proxy"), now: () => nowMs }),
    now: () => nowMs,
    sleep: async () => undefined,
    online: () => online,
    readStates: () => states,
    estimate: async () => est,
    ...over,
  };
  return new Collector(deps);
}

beforeEach(async () => {
  db = await openArchiveDb({ factory: new IDBFactory(), name: "t-collector" });
  nowMs = T0;
  net = { calls: [], status: 200, ratioFrom: T0 - 3 * 3_600_000, now: T0 };
  direct = net;
  states = [];
  online = true;
  est = null;
});

const times = async (series: Parameters<ArchiveDb["range"]>[0], symbol = "BTCUSDT") => (await db.range(series, symbol, 0, Infinity)).map((p) => p.t);

describe("collector tick", () => {
  it("writes the snapshots and only the ratio points of the window (first tick: the last interval)", async () => {
    const c = make();
    const r = await c.tick(CFG, ["BTCUSDT"]);
    // window = now − 10 min = 01:50:00; 5-minute boundaries 01:50, 01:55, 02:00 → limit = ceil(10/5)+1 = 3 rows, all inside
    expect(r.record.res).toEqual({ BTCUSDT: "ok" });
    expect(await times("lsAcc")).toEqual([T0 - 10 * MIN, T0 - 5 * MIN, T0]);
    expect(await times("lsTopPos")).toHaveLength(3);
    expect(await times("lsTopAcc")).toHaveLength(3);
    const prem = await db.range("premium", "BTCUSDT", 0, Infinity);
    expect(prem).toHaveLength(1);
    expect(prem[0]!.d).toEqual({ mark: 80000.1, index: 80001.2, rate: 0.0001, next: T0 + 3 * 3_600_000 });
    expect((await db.range("oi", "BTCUSDT", 0, Infinity))[0]!.d).toEqual({ oi: 12345.678 });
    // 1 premium + 1 oi + 3 × 3 ratio rows
    expect(r.written).toBe(11);
    const log = await db.ticks();
    expect(log).toEqual([{ t: T0, iv: 10, route: "direct", res: { BTCUSDT: "ok" }, states: false }]);
  });

  it("asks for ceil(window / 5 min) + 1 ratio rows: 3 at the first tick, 4 when the app ran without a pause", async () => {
    const c = make();
    await c.tick(CFG, ["BTCUSDT"]);
    expect(net.calls.filter((x) => x.includes("limit=3"))).toHaveLength(3);
    net.calls.length = 0;
    nowMs = T0 + 10 * MIN;
    net.now = nowMs;
    await c.tick(CFG, ["BTCUSDT"]);
    // continuous: window starts at the previous tick − 5 min → 15 min → ceil(15/5)+1 = 4
    expect(net.calls.filter((x) => x.includes("limit=4"))).toHaveLength(3);
    // the 5-minute grid is seamless over both ticks: 01:50 … 02:10, each once
    expect(await times("lsAcc")).toEqual([0, 5, 10, 15, 20].map((m) => T0 - 10 * MIN + m * MIN));
  });

  it("does not fill the time the app was closed: after a 2 h pause only the last interval is written", async () => {
    const c = make();
    await c.tick(CFG, ["BTCUSDT"]);
    nowMs = T0 + 2 * 3_600_000;
    net.now = nowMs;
    await c.tick(CFG, ["BTCUSDT"]);
    // Binance would still tell the ratios of the pause (ratioFrom = 3 h back) – they are NOT taken: window = now − 10 min
    const t = await times("lsAcc");
    expect(t).toEqual([T0 - 10 * MIN, T0 - 5 * MIN, T0, nowMs - 10 * MIN, nowMs - 5 * MIN, nowMs]);
    const gaps = findGaps(seriesDef("lsAcc"), "BTCUSDT", t, await db.ticks());
    // 02:00 → 03:50 = 110 min > 2.5 × 10 min; no tick ran inside → the app was closed
    expect(gaps).toEqual([{ from: T0, to: nowMs - 10 * MIN, cause: "app", detail: null, ticks: 0 }]);
    const premGaps = findGaps(seriesDef("premium"), "BTCUSDT", await times("premium"), await db.ticks());
    expect(premGaps).toEqual([{ from: T0, to: nowMs, cause: "app", detail: null, ticks: 0 }]);
  });

  it("writes a point of the same time once (a late 5-minute point is picked up by the next tick, not duplicated)", async () => {
    const c = make();
    await c.tick(CFG, ["BTCUSDT"]);
    nowMs = T0 + 10 * MIN;
    net.now = nowMs;
    await c.tick(CFG, ["BTCUSDT"]);
    const t = await times("lsTopPos");
    expect(new Set(t).size).toBe(t.length);
  });

  it("falls back to the proxy after a 451 and stays on it for the session", async () => {
    const blocked: Net = { calls: [], status: 451, ratioFrom: T0 - 3_600_000, now: T0 };
    const c = make({}, blocked);
    const r = await c.tick(CFG, ["BTCUSDT"]);
    expect(r.record.route).toBe("proxy");
    expect(r.record.res).toEqual({ BTCUSDT: "ok" });
    expect(blocked.calls.some((x) => x.startsWith("direct:"))).toBe(true);
    expect(net.calls.some((x) => x.startsWith("proxy:"))).toBe(true);
    expect(await times("oi")).toEqual([T0]);
    blocked.calls.length = 0;
    nowMs = T0 + 10 * MIN;
    net.now = nowMs;
    const r2 = await c.tick(CFG, ["BTCUSDT"]);
    expect(r2.record.route).toBe("proxy");
    expect(blocked.calls).toEqual([]);
  });

  it("logs the reason when both routes fail – the gap then says 'Abruf fehlgeschlagen: 451'", async () => {
    const blocked: Net = { calls: [], status: 451, ratioFrom: 0, now: T0 };
    net.status = 451;
    const c = make({}, blocked);
    const r = await c.tick(CFG, ["BTCUSDT", "ETHUSDT"]);
    expect(r.record.res).toEqual({ BTCUSDT: "blocked_451", ETHUSDT: "blocked_451" });
    expect(r.written).toBe(0);
    expect(await db.overview()).toEqual([]);
    expect(await db.ticks()).toHaveLength(1);
  });

  it("marks a symbol 'partial:<reason>' when only some requests fail", async () => {
    const c = make({
      rest: () =>
        binanceRest({
          fetch: async (u) => (u.includes("/futures/data/") ? json({ code: -1 }, 500) : host(net, "direct")(u)),
          now: () => nowMs,
        }),
      proxy: () => null,
    });
    const r = await c.tick(CFG, ["BTCUSDT"]);
    expect(r.record.res).toEqual({ BTCUSDT: "partial:http_5xx" });
    expect(await times("premium")).toEqual([T0]);
    expect(await times("lsAcc")).toEqual([]);
  });

  it("backs off for five minutes after a rate-limit answer and logs it for every symbol", async () => {
    const limited: Net = { calls: [], status: 429, ratioFrom: 0, now: T0 };
    net.status = 429;
    const c = make({}, limited);
    const r = await c.tick(CFG, ["BTCUSDT", "ETHUSDT"]);
    expect(r.record.res).toEqual({ BTCUSDT: "rate_limited", ETHUSDT: "rate_limited" });
    // the second symbol was not even tried: calls of the first symbol only (direct, then the same call via the proxy)
    expect(limited.calls.every((x) => x.includes("BTCUSDT"))).toBe(true);
    limited.calls.length = 0;
    net.calls.length = 0;
    net.status = 200;
    limited.status = 200;
    nowMs = T0 + RATE_BACKOFF_MS - 1000;
    const r2 = await c.tick(CFG, ["BTCUSDT"]);
    expect(r2.record.res).toEqual({ BTCUSDT: "rate_limited" });
    expect(limited.calls).toEqual([]);
    expect(net.calls).toEqual([]);
    nowMs = T0 + RATE_BACKOFF_MS + 1000;
    limited.now = nowMs;
    net.now = nowMs;
    const r3 = await c.tick(CFG, ["BTCUSDT"]);
    expect(r3.record.res).toEqual({ BTCUSDT: "ok" });
  });

  it("asks nothing while the device is offline and says so", async () => {
    online = false;
    const c = make();
    const r = await c.tick(CFG, ["BTCUSDT"]);
    expect(r.record.res).toEqual({ BTCUSDT: "offline" });
    expect(net.calls).toEqual([]);
  });

  it("stops writing above 90 % of the browser's quota and logs the tick as 'quota'", async () => {
    est = { usage: 91, quota: 100 };
    expect(0.91).toBeGreaterThan(QUOTA_STOP_SHARE);
    const c = make();
    const r = await c.tick(CFG, ["BTCUSDT"]);
    expect(r.paused).toBe("quota");
    expect(r.written).toBe(0);
    expect(r.record.res).toEqual({ BTCUSDT: "quota" });
    expect(await db.overview()).toEqual([]);
    est = { usage: 89, quota: 100 };
    nowMs = T0 + 10 * MIN;
    net.now = nowMs;
    const r2 = await c.tick(CFG, ["BTCUSDT"]);
    expect(r2.paused).toBeNull();
    expect(r2.written).toBeGreaterThan(0);
  });

  it("writes the analysis states of the live symbol at the tick time, only when asked for", async () => {
    states = [
      { series: "lage", symbol: "BTCUSDT", d: { state: "amber", signs: 2, price: 80000, dist: -0.012 } },
      { series: "box4h", symbol: "BTCUSDT", d: { phase: "breakout", dir: 1, top: 81000, bottom: 78000, grade: "A", pos: 1.1, price: 81500 } },
    ];
    const c = make();
    const r = await c.tick({ ...CFG, states: true }, ["BTCUSDT"]);
    expect(r.record.states).toBe(true);
    expect((await db.range("lage", "BTCUSDT", 0, Infinity))[0]).toMatchObject({ t: T0, d: { state: "amber", signs: 2 } });
    expect((await db.range("box4h", "BTCUSDT", 0, Infinity))[0]!.d.phase).toBe("breakout");
    nowMs = T0 + 10 * MIN;
    net.now = nowMs;
    const r2 = await c.tick({ ...CFG, states: false }, ["BTCUSDT"]);
    expect(r2.record.states).toBe(false);
    expect(await times("lage")).toEqual([T0]);
  });

  it("takes at most 8 symbols", async () => {
    const c = make();
    const syms = Array.from({ length: 12 }, (_, i) => `S${i}USDT`);
    const r = await c.tick(CFG, syms);
    expect(Object.keys(r.record.res)).toHaveLength(8);
  });

  it("explains a failed stretch in the gap list: ticks ran, the requests did not", async () => {
    const c = make();
    await c.tick(CFG, ["BTCUSDT"]);
    net.status = 451;
    direct.status = 451;
    const failing = make({ proxy: () => null });
    for (const k of [1, 2, 3, 4]) {
      nowMs = T0 + k * 10 * MIN;
      await failing.tick(CFG, ["BTCUSDT"]);
    }
    net.status = 200;
    direct.status = 200;
    nowMs = T0 + 50 * MIN;
    net.now = nowMs;
    await c.tick(CFG, ["BTCUSDT"]);
    const gaps = findGaps(seriesDef("premium"), "BTCUSDT", await times("premium"), await db.ticks());
    // premium points at 02:00 and 02:50 → 50 min > 25 min; four failed ticks inside (02:10 … 02:40)
    expect(gaps).toEqual([{ from: T0, to: T0 + 50 * MIN, cause: "failed", detail: "blocked_451", ticks: 4 }]);
  });
});

describe("collector trim", () => {
  it("keeps the newest points under the size limit: 1 000 bytes / 131,1 bytes average = 7 points for one row", async () => {
    const c = make();
    const pts = Array.from({ length: 50 }, (_, i) => ({ series: "oi" as const, symbol: "BTCUSDT", t: T0 + i * MIN, d: { oi: i } }));
    await db.putPoints(pts);
    // average over the nine series = (150+100+120+120+120+120+150+150+150) / 9 = 131,11 bytes; 0,001 MB = 1 000 bytes → floor(7,63) = 7
    const removed = await c.trim(0.001);
    expect(removed).toBe(43);
    expect(await times("oi")).toEqual(pts.slice(-7).map((p) => p.t));
  });

  it("shares the budget over all rows alike", async () => {
    const c = make();
    await db.putPoints([
      ...Array.from({ length: 30 }, (_, i) => ({ series: "oi" as const, symbol: "BTCUSDT", t: i, d: { oi: i } })),
      ...Array.from({ length: 30 }, (_, i) => ({ series: "oi" as const, symbol: "ETHUSDT", t: i, d: { oi: i } })),
    ]);
    // two rows → floor(7,63 / 2)… 1 000 / 131,11 / 2 = 3,81 → 3 each
    await c.trim(0.001);
    expect(await times("oi", "BTCUSDT")).toHaveLength(3);
    expect(await times("oi", "ETHUSDT")).toHaveLength(3);
  });
});
