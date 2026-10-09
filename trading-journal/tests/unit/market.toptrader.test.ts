/**
 * "Prices update, Binance top traders do not" (Galaxy Tab, Samsung Internet): every path that used to take the
 * top-trader ratio feeds off Binance — or left them without a scheduled poll — while the Binance WebSocket kept
 * delivering prices. Real provider, fake timers, a scripted WebSocket that keeps sending, and a fetch that injects
 * failures per URL (incl. the CORS-style `TypeError` a browser reports for an unreadable response). Every scenario
 * ends with the top traders live again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import klines1m from "../fixtures/binance-klines-1m.json";
import klines15m from "../fixtures/binance-klines-15m.json";
import klines1h from "../fixtures/binance-klines-1h.json";
import klines4h from "../fixtures/binance-klines-4h.json";
import klines1w from "../fixtures/binance-klines-1w.json";
import premiumIndex from "../fixtures/binance-premiumIndex.json";
import ticker from "../fixtures/binance-ticker24hr.json";
import openInterest from "../fixtures/binance-openInterest.json";
import funding from "../fixtures/binance-fundingRate.json";
import serverTime from "../fixtures/binance-time.json";
import wsMark from "../fixtures/binance-ws-markPrice.json";
import wsAgg from "../fixtures/binance-ws-aggTrade.json";
import bybitKline from "../fixtures/bybit-kline.json";
import bybitTickers from "../fixtures/bybit-tickers.json";
import bybitRatio from "../fixtures/bybit-account-ratio.json";
import bybitOi from "../fixtures/bybit-open-interest.json";
import bybitFunding from "../fixtures/bybit-funding-history.json";
import bybitTime from "../fixtures/bybit-time.json";
import { createMarketProvider, type MarketProvider } from "@/market/provider";
import type { WsLike } from "@/market/sources/ws";
import { memoryKV, type KVStore } from "@/market/cache";
import { deriveTopTrader, freshnessText, topTraderFreshness } from "@/market/mapping";
import { FEED_IDS, LIVE_RATIO_BOOTSTRAP_LIMIT } from "@/market/feeds";
import type { FeedId } from "@/market/types";

const MIN = 60_000;
const HOUR = 60 * MIN;
/** 2026-09-30 10:02 UTC */
const T0 = 1790762400000 + 2 * MIN;

class FakeSocket implements WsLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closedByClient = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  send(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  close() {
    this.closedByClient = true;
    this.readyState = 3;
  }
}

const PERIOD_MS: Record<string, number> = { "5m": 5 * MIN, "15m": 15 * MIN, "30m": 30 * MIN, "1h": HOUR, "4h": 4 * HOUR };

/** Synthetic Binance futures-data rows: one point per period boundary, published 50 s after it. */
function futuresRows(periodMs: number, now: number, limit: number, kind: "ratio" | "taker" | "oi", endTime?: number) {
  const last = Math.floor((Math.min(now, endTime ?? now) - 50_000) / periodMs) * periodMs;
  const rows: Record<string, string | number>[] = [];
  for (let i = Math.min(limit, 500) - 1; i >= 0; i--) {
    const ts = last - i * periodMs;
    // top traders a little more long than retail, varying with time
    const x = (kind === "ratio" ? 0.52 : 0.5) + 0.03 * Math.sin(ts / 3_000_000);
    if (kind === "ratio") rows.push({ symbol: "BTCUSDT", longShortRatio: String(x / (1 - x)), longAccount: String(x), shortAccount: String(1 - x), timestamp: ts });
    else if (kind === "taker") rows.push({ buySellRatio: "1.1", buyVol: "100", sellVol: "90", timestamp: ts });
    else rows.push({ symbol: "BTCUSDT", sumOpenInterest: "1000", sumOpenInterestValue: "1000000", timestamp: ts });
  }
  return rows;
}

type Fail = "typeerror" | "timeout" | number | undefined;
interface Net {
  log: string[];
  /** failure injection for direct calls to fapi.binance.com */
  binanceFail: (u: URL) => Fail;
  bybitDown: boolean;
  /** `/api/binance/*`: Binance through the same-origin proxy (else the SPA's index.html) */
  proxyUp: boolean;
}

function makeFetch(net: Net) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const binanceAnswer = (u: URL): Response => {
    const now = Date.now();
    const path = u.pathname.replace(/^\/api\/binance/, "");
    if (path === "/fapi/v1/klines") {
      const iv = u.searchParams.get("interval");
      const limit = Number(u.searchParams.get("limit") ?? 500);
      const src = iv === "1m" ? klines1m : iv === "15m" ? klines15m : iv === "1h" ? klines1h : iv === "4h" ? klines4h : klines1w;
      return json(src.slice(-limit));
    }
    if (path === "/fapi/v1/premiumIndex") return json({ ...premiumIndex, time: now });
    if (path === "/fapi/v1/ticker/24hr") return json({ ...ticker, closeTime: now });
    if (path === "/fapi/v1/openInterest") return json({ ...openInterest, time: now });
    if (path === "/fapi/v1/fundingRate") return json(funding);
    if (path === "/fapi/v1/time") return json({ ...serverTime, serverTime: now });
    if (path.startsWith("/futures/data/")) {
      const per = PERIOD_MS[u.searchParams.get("period") ?? "1h"]!;
      const limit = Number(u.searchParams.get("limit") ?? 30);
      const endTime = u.searchParams.get("endTime");
      const kind = path.includes("taker") ? "taker" : path.includes("openInterestHist") ? "oi" : "ratio";
      return json(futuresRows(per, now, limit, kind, endTime ? Number(endTime) : undefined));
    }
    return json({ code: -1, msg: "nf" }, 404);
  };
  return async (url: string): Promise<Response> => {
    net.log.push(url);
    const u = new URL(url, "https://site.invalid");
    if (u.hostname === "fapi.binance.com") {
      const f = net.binanceFail(u);
      if (f === "typeerror") throw new TypeError("Failed to fetch");
      if (f === "timeout") throw new DOMException("The operation was aborted.", "AbortError");
      if (typeof f === "number") return json({ code: -1, msg: "err" }, f);
      return binanceAnswer(u);
    }
    if (u.hostname === "api.bybit.com") {
      if (net.bybitDown) throw new TypeError("Failed to fetch");
      const routes: Record<string, unknown> = {
        "/v5/market/kline": bybitKline,
        "/v5/market/tickers": { ...bybitTickers, time: Date.now() },
        "/v5/market/account-ratio": bybitRatio,
        "/v5/market/open-interest": bybitOi,
        "/v5/market/funding/history": bybitFunding,
        "/v5/market/time": bybitTime,
      };
      const hit = routes[u.pathname];
      return hit ? json(hit) : json({ retCode: 10001, retMsg: "nf", result: {} });
    }
    if (u.pathname.startsWith("/api/binance/")) {
      if (!net.proxyUp) return new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } });
      return binanceAnswer(u);
    }
    throw new TypeError("unknown host");
  };
}

interface SetupOpts {
  period?: string;
  kv?: KVStore;
  binanceFail?: Net["binanceFail"];
  online?: () => boolean;
  proxy?: boolean;
  proxyUp?: boolean;
  preferProxy?: boolean;
}

function setup(o: SetupOpts = {}) {
  const net: Net = { log: [], binanceFail: o.binanceFail ?? (() => undefined), bybitDown: false, proxyUp: o.proxyUp ?? false };
  FakeSocket.all = [];
  const doc = { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const win = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const provider = createMarketProvider({
    symbol: "BINANCE:BTCUSDT",
    period: o.period ?? "1h",
    preferProxy: o.preferProxy,
    deps: {
      fetch: makeFetch(net),
      wsFactory: (url) => new FakeSocket(url),
      kv: o.kv ?? memoryKV(),
      documentRef: doc as unknown as Document,
      windowRef: win as unknown as Window,
      online: o.online ?? (() => true),
      probeProxy: o.proxy ?? false,
      random: () => 0.5,
      timeZone: "UTC",
    },
  });
  const listener = (type: string) => (doc.addEventListener.mock.calls.find((c) => c[0] === type)?.[1] ?? win.addEventListener.mock.calls.find((c) => c[0] === type)?.[1]) as (() => void) | undefined;
  return { provider, net, doc, win, listener };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const calls = (net: Net, needle: string) => net.log.filter((u) => u.includes(needle)).length;
const direct = (path: string) => `fapi.binance.com/futures/data/${path}`;

/** Keeps the Binance socket alive: prices keep updating, like on the tablet. */
function pumpWs(): void {
  const ws = FakeSocket.all.at(-1);
  if (!ws || ws.closedByClient) return;
  if (ws.readyState === 0) ws.open();
  ws.send({ ...wsMark, data: { ...wsMark.data, E: Date.now() } });
  ws.send({ ...wsAgg, data: { ...wsAgg.data, T: Date.now(), E: Date.now() } });
}
async function runFor(ms: number, step = 5_000, ws = true): Promise<void> {
  for (let t = 0; t < ms; t += step) {
    if (ws) pumpWs();
    await vi.advanceTimersByTimeAsync(Math.min(step, ms - t));
  }
}

const tt = (p: MarketProvider, base: "accounts" | "positions" = "accounts") => deriveTopTrader(p.snapshot(), p.getHealth(), base);

/**
 * Invariant: no REST feed is left without a way forward — a pending poll (`nextRefreshAt` ahead) or, when parked on
 * another exchange / the cache / unsupported, a pending primary probe.
 */
function expectArmed(p: MarketProvider): void {
  const h = p.getHealth();
  const now = Date.now();
  for (const f of FEED_IDS) {
    if (p.specs[f].transport !== "rest") continue;
    const fh = h.feeds[f];
    const parked = fh.source === "cache" || fh.reason === "unsupported";
    if (parked) expect(h.primary.nextProbeAt, `${f} parked without probe`).toBeGreaterThan(now - 1);
    else expect(fh.nextRefreshAt, `${f} without pending poll`).toBeGreaterThan(now - 1);
  }
}

describe("top traders keep updating while the Binance WebSocket delivers", () => {
  let p: MarketProvider | null = null;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    p?.stop();
    p = null;
    vi.useRealTimers();
  });

  it("R1: one TypeError on a ratio poll never declares Binance blocked; the feed retries on Binance in 15 s", async () => {
    let failOnce = true;
    const { provider, net } = setup({
      binanceFail: (u) => {
        if (failOnce && u.pathname.includes("topLongShortAccountRatio") && u.searchParams.get("limit") === "3") {
          failOnce = false;
          return "typeerror";
        }
        return undefined;
      },
    });
    p = provider;
    provider.start();
    await flush();
    pumpWs();
    expect(tt(provider).liveReadingOk).toBe(true);
    await runFor(6 * MIN);
    const h = provider.getHealth();
    expect(failOnce).toBe(false);
    expect(h.primary.blocked).toBe(false);
    expect(net.log.some((u) => u.includes("api.bybit.com"))).toBe(false); // Bybit never asked
    expect(h.feeds.topAccountRatio5m).toMatchObject({ source: "binance", state: "live", consecutiveFailures: 0 });
    expect(h.feeds.topAccountRatio).toMatchObject({ source: "binance", state: "live" });
    expect(tt(provider)).toMatchObject({ onlyBinance: false, liveReadingOk: true, fromLive: true });
    expectArmed(provider);
  });

  it("R1': failures on two different paths while the socket is silent but REST answered < 60 s ago are no block either", async () => {
    let fail = false;
    const { provider, net } = setup({ binanceFail: (u) => (fail && u.pathname.startsWith("/futures/data/") ? "typeerror" : undefined) });
    p = provider;
    provider.start();
    await flush(); // bootstrap succeeded (REST proof), the socket never opens
    fail = true;
    await vi.advanceTimersByTimeAsync(40_000);
    await provider.refresh("topAccountRatio", { force: true });
    await provider.refresh("globalAccountRatio", { force: true });
    expect(provider.getHealth().primary.blocked).toBe(false);
    expect(net.log.some((u) => u.includes("api.bybit.com/v5/market/time"))).toBe(false);
  });

  it("R1b/R7: a resume after 30 min hidden staggers the overdue polls; a failure in the first seconds is no block", async () => {
    let failFirst = false;
    const { provider, doc, listener, net } = setup({
      binanceFail: (u) => {
        if (failFirst && u.pathname.startsWith("/futures/data/")) {
          failFirst = false;
          return "typeerror";
        }
        return undefined;
      },
    });
    p = provider;
    provider.start();
    await flush();
    await runFor(10 * MIN);
    const onVis = listener("visibilitychange")!;
    doc.hidden = true;
    onVis();
    await vi.advanceTimersByTimeAsync(30 * MIN); // screen off: scheduler paused, socket silent
    failFirst = true;
    const before = net.log.length;
    doc.hidden = false;
    onVis();
    await flush();
    // nothing fires in the resume tick itself …
    expect(net.log.slice(before).filter((u) => u.includes("/futures/data/")).length).toBe(0);
    // … the overdue polls are spread over the next seconds
    const due = FEED_IDS.filter((f) => provider.specs[f].transport === "rest").map((f) => provider.getHealth().feeds[f].nextRefreshAt ?? 0);
    expect(new Set(due).size).toBeGreaterThan(3);
    await runFor(MIN, 1_000);
    const h = provider.getHealth();
    expect(h.primary.blocked).toBe(false);
    expect(h.feeds.topAccountRatio.source).toBe("binance");
    expect(tt(provider).liveReadingOk).toBe(true);
    expectArmed(provider);
  });

  it("R2: HTTP 503 ×3 on a top-trader ratio keeps it on Binance with backoff; it updates again once Binance answers", async () => {
    let failing = false;
    let failures = 0;
    const { provider, net } = setup({
      binanceFail: (u) => {
        if (failing && u.pathname.includes("topLongShortAccountRatio")) {
          failures++;
          return 503;
        }
        return undefined;
      },
    });
    p = provider;
    provider.start();
    await flush();
    failing = true;
    // the 5-min poll at 10:06:22 → 503, retries after 15 s / 30 s / 60 s fail too
    await runFor(7 * MIN, 5_000);
    let h = provider.getHealth();
    expect(failures).toBeGreaterThanOrEqual(3);
    expect(h.feeds.topAccountRatio5m).toMatchObject({ source: "binance", reason: "http_5xx" });
    expect(h.feeds.topAccountRatio5m.consecutiveFailures).toBeGreaterThanOrEqual(3);
    expect(net.log.some((u) => u.includes("api.bybit.com"))).toBe(false);
    expect(provider.statusLabel("topAccountRatio5m")).toMatchObject({ tone: "warn" });
    expect(provider.statusLabel("topAccountRatio5m").text).toMatch(/^Zuletzt \d\d:\d\d · Serverfehler$/);
    const fresh = topTraderFreshness(tt(provider), h, HOUR);
    expect(fresh.kind).toBe("retrying");
    expect(freshnessText(fresh, Date.now(), "UTC")).toMatch(/^Binance antwortet nicht \(Serverfehler\) · Stand \d\d:\d\d · neuer Versuch in \d+:\d\d$/);
    expectArmed(provider);
    // "Jetzt aktualisieren" goes to Binance itself
    const before = calls(net, direct("topLongShortAccountRatio"));
    await provider.refresh("topAccountRatio", { force: true });
    expect(calls(net, direct("topLongShortAccountRatio"))).toBe(before + 1);
    failing = false;
    await runFor(5 * MIN);
    h = provider.getHealth();
    expect(h.feeds.topAccountRatio5m).toMatchObject({ source: "binance", state: "live", consecutiveFailures: 0 });
    expect(h.feeds.topAccountRatio).toMatchObject({ source: "binance", state: "live", consecutiveFailures: 0 });
    expect(tt(provider)).toMatchObject({ onlyBinance: false, liveReadingOk: true });
  });

  it("R2b: HTTP 429 ×3 on the retail ratio never hands it to Bybit (other cohort) and the delta keeps its cohorts", async () => {
    let failures = 0;
    const { provider, net } = setup({
      binanceFail: (u) => {
        if (u.pathname.includes("globalLongShortAccountRatio") && u.searchParams.get("limit") === "30" && failures < 3) {
          failures++;
          return 429;
        }
        return undefined;
      },
    });
    p = provider;
    provider.start();
    await flush();
    await runFor(70 * MIN, 5_000);
    expect(failures).toBe(3);
    expect(net.log.some((u) => u.includes("api.bybit.com/v5/market/account-ratio"))).toBe(false);
    const h = provider.getHealth();
    expect(h.feeds.globalAccountRatio).toMatchObject({ source: "binance", state: "live" });
    expect(provider.get("globalAccountRatio")!.source).toBe("binance");
    expect(tt(provider).liveReadingOk).toBe(true);
    expectArmed(provider);
  });

  it("a non-ratio REST feed moved to Bybit by soft failures comes back to Binance through the probe", async () => {
    let failures = 0;
    const { provider } = setup({
      binanceFail: (u) => {
        if (u.pathname === "/fapi/v1/openInterest" && failures < 3) {
          failures++;
          return 502;
        }
        return undefined;
      },
    });
    p = provider;
    provider.start();
    await flush();
    await runFor(3 * MIN);
    expect(provider.getHealth().feeds.openInterest.source).toBe("bybit");
    expect(provider.getHealth().primary.nextProbeAt).toBeDefined();
    await runFor(6 * MIN);
    expect(provider.getHealth().feeds.openInterest).toMatchObject({ source: "binance", state: "live" });
  });

  it("R3 / CORS: /futures/data unreadable in the browser (TypeError) while the rest of Binance answers → the ratios move to the same-origin proxy", async () => {
    const { provider, net } = setup({ proxy: true, proxyUp: true, binanceFail: (u) => (u.pathname.startsWith("/futures/data/") ? "typeerror" : undefined) });
    p = provider;
    provider.start();
    await flush();
    pumpWs();
    expect(provider.getHealth().proxy.usable).toBe(true);
    await runFor(2 * MIN, 5_000);
    const h = provider.getHealth();
    expect(h.primary.blocked).toBe(false);
    for (const f of ["topAccountRatio", "topPositionRatio", "globalAccountRatio", "takerRatio", "topAccountRatio5m", "topPositionRatio5m", "globalAccountRatio5m"] as FeedId[]) {
      expect(h.feeds[f].source, f).toBe("proxy");
    }
    expect(provider.get("topAccountRatio5m")!.source).toBe("proxy");
    expect(tt(provider)).toMatchObject({ liveReadingOk: true, onlyBinance: false, fromLive: true });
    expect(topTraderFreshness(tt(provider), h, HOUR).kind).toBe("proxy");
    // no flip-flop: the WebSocket is never torn down, Binance is never re-probed for this
    const sockets = FakeSocket.all.length;
    const proxied = calls(net, "/api/binance/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=5m");
    await runFor(HOUR, 5_000);
    expect(FakeSocket.all.length).toBe(sockets);
    expect(calls(net, "fapi.binance.com/fapi/v1/time")).toBe(0);
    expect(calls(net, "/api/binance/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=5m")).toBeGreaterThanOrEqual(proxied + 11);
    expect(tt(provider).liveReadingOk).toBe(true);
    expectArmed(provider);
  });

  it("R3 without a proxy (file:// / not deployed): the ratios stay on Binance with a capped retry and say so honestly", async () => {
    const { provider, net } = setup({ proxy: true, proxyUp: false, binanceFail: (u) => (u.pathname.startsWith("/futures/data/") ? "typeerror" : undefined) });
    p = provider;
    provider.start();
    await flush();
    await runFor(30 * MIN, 5_000);
    const h = provider.getHealth();
    expect(h.proxy.usable).toBe(false);
    expect(h.primary.blocked).toBe(false);
    expect(h.feeds.topAccountRatio).toMatchObject({ source: "binance", reason: "network" });
    expect(h.feeds.topAccountRatio.consecutiveFailures).toBeGreaterThan(3);
    const fresh = topTraderFreshness(tt(provider), h, HOUR);
    expect(fresh).toMatchObject({ kind: "retrying", lead: "Binance antwortet nicht (Netzwerk/CORS)" });
    // capped at one attempt per 5 min per feed (no hammering), WS untouched
    const n = calls(net, `${direct("topLongShortAccountRatio")}?symbol=BTCUSDT&period=5m`);
    await runFor(30 * MIN, 5_000);
    expect(calls(net, `${direct("topLongShortAccountRatio")}?symbol=BTCUSDT&period=5m`) - n).toBeLessThanOrEqual(7);
    expect(FakeSocket.all.length).toBe(1);
    expectArmed(provider);
  });

  it("R4: with period 1h the card still refreshes every 5 min from the 5-min series; the 1h series is polled once per hour", async () => {
    const { provider, net } = setup({ period: "1h" });
    p = provider;
    provider.start();
    await flush();
    pumpWs();
    const first = tt(provider);
    expect(first).toMatchObject({ liveReadingOk: true, fromLive: true, readingFeed: "topAccountRatio5m" });
    const asOf0 = first.asOf!;
    const hourly0 = calls(net, "topLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=30");
    const live0 = calls(net, "topLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=3");
    await runFor(30 * MIN, 30_000);
    const later = tt(provider);
    expect(later.asOf! - asOf0).toBe(30 * MIN); // a new 5-min point every 5 minutes
    expect(calls(net, "topLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=3") - live0).toBe(6);
    expect(calls(net, "topLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=30") - hourly0).toBe(0); // next at 11:01
    await runFor(31 * MIN, 30_000);
    expect(calls(net, "topLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=30") - hourly0).toBe(1);
    const fresh = topTraderFreshness(tt(provider), provider.getHealth(), HOUR);
    expect(fresh.kind).toBe("live");
    expect(freshnessText(fresh, Date.now(), "UTC")).toMatch(/^Binance liefert alle 5 min neu · Stand \d\d:\d\d · nächste Daten in [0-4]:\d\d$/);
    expect(provider.statusLabel("topAccountRatio5m").text).toBe("Live · alle 5 min");
  });

  it("period 5m: the live twins ride along with the chosen-period request (no duplicate calls)", async () => {
    const { provider, net } = setup({ period: "5m" });
    p = provider;
    provider.start();
    await flush();
    await runFor(20 * MIN, 30_000);
    expect(calls(net, `limit=${LIVE_RATIO_BOOTSTRAP_LIMIT}`)).toBe(0);
    expect(provider.getHealth().feeds.topAccountRatio5m).toMatchObject({ state: "live", source: "binance" });
    expect(provider.get("topAccountRatio5m")!.data.at(-1)!.time).toBe(provider.get("topAccountRatio")!.data.at(-1)!.time);
    expect(tt(provider).liveReadingOk).toBe(true);
    expectArmed(provider);
  });

  it("R5: the persisted ring is per period — switching 1h → 4h never shows a 1h point as the newest 4h value", async () => {
    const kv = memoryKV();
    const a = setup({ period: "1h", kv });
    a.provider.start();
    await flush();
    a.provider.stop();
    await flush();
    vi.setSystemTime(T0 + 90 * MIN);
    const b = setup({ period: "4h", kv });
    p = b.provider;
    b.provider.start();
    await vi.advanceTimersByTimeAsync(1000);
    const times = b.provider.get("topAccountRatio")!.data.map((x) => x.time);
    expect(times.every((t) => t % (4 * HOUR) === 0)).toBe(true);
    expect((await kv.keys()).some((k) => k === "binance:BTCUSDT:1h:topAccountRatio")).toBe(true);
  });

  it("R6: a failure while the browser reports offline keeps a retry armed; data flows again without the 'online' event", async () => {
    let online = true;
    let fail = false;
    const { provider, net } = setup({ online: () => online, binanceFail: () => (fail ? "typeerror" : undefined) });
    p = provider;
    provider.start();
    await flush();
    online = false;
    fail = true;
    await runFor(6 * MIN);
    expect(provider.getHealth().online).toBe(false);
    online = true; // back, but the event was lost (tab frozen)
    fail = false;
    const n = calls(net, direct("topLongShortAccountRatio"));
    await runFor(MIN);
    expect(calls(net, direct("topLongShortAccountRatio"))).toBeGreaterThan(n);
    expect(provider.getHealth().online).toBe(true);
    await runFor(5 * MIN);
    expect(tt(provider).liveReadingOk).toBe(true);
    expectArmed(provider);
  });

  it("a timeout is a soft failure (never a block) and is retried", async () => {
    let failures = 0;
    const { provider } = setup({
      binanceFail: (u) => {
        if (u.pathname.startsWith("/futures/data/") && u.searchParams.get("period") === "5m" && failures < 6) {
          failures++;
          return "timeout";
        }
        return undefined;
      },
    });
    p = provider;
    provider.start();
    await flush();
    await runFor(10 * MIN);
    expect(failures).toBe(6);
    const h = provider.getHealth();
    expect(h.primary.blocked).toBe(false);
    expect(h.feeds.topAccountRatio5m).toMatchObject({ source: "binance", state: "live" });
  });

  it("a real geo-block (no socket, every Binance call fails, Bybit answers) still falls back — and a WS frame brings Binance back within seconds", async () => {
    let blocked = true;
    const { provider } = setup({ binanceFail: () => (blocked ? "typeerror" : undefined) });
    p = provider;
    provider.start();
    await vi.advanceTimersByTimeAsync(50);
    let h = provider.getHealth();
    expect(h.primary.blocked).toBe(true);
    expect(h.feeds.topAccountRatio).toMatchObject({ source: "bybit", reason: "unsupported" });
    expect(h.feeds.topAccountRatio5m).toMatchObject({ reason: "unsupported" });
    expect(h.primary.nextProbeAt).toBe(Date.now() - 50 + 5 * MIN);
    expect(topTraderFreshness(tt(provider), h, HOUR)).toMatchObject({ kind: "blocked", lead: "Binance blockiert (Region)" });
    expectArmed(provider);
    // the network heals; the socket delivers a frame → probe within 5 s instead of the 5-min backoff
    blocked = false;
    await vi.advanceTimersByTimeAsync(20_000);
    pumpWs();
    await vi.advanceTimersByTimeAsync(6_000);
    h = provider.getHealth();
    expect(h.primary.blocked).toBe(false);
    await runFor(MIN);
    h = provider.getHealth();
    expect(h.feeds.topAccountRatio).toMatchObject({ source: "binance", state: "live" });
    expect(tt(provider).liveReadingOk).toBe(true);
  });

  it("the page load's own `pageshow` / `focus` is no resume: a geo-block still falls back within the first second", async () => {
    // every page load ends with a non-persisted `pageshow` (and may focus the window) a few hundred ms after the
    // provider started; the 10-s resume grace (a radio waking up after a sleep) must not hold the fallback back
    const { provider, listener } = setup({ binanceFail: () => "typeerror" });
    p = provider;
    provider.start();
    // the load events arrive while the boot requests are still on their way (they fail a few hundred ms later)
    listener("pageshow")!(); // persisted: false
    listener("focus")!();
    await vi.advanceTimersByTimeAsync(1_000);
    const h = provider.getHealth();
    expect(h.primary.blocked).toBe(true);
    expect(h.feeds.ticker24h.source).toBe("bybit");
    expect(h.feeds.kline_15m.source).toBe("bybit");
  });

  it("a resume after the tab was away keeps the grace: a failure in its first seconds is no block", async () => {
    let failing = false;
    const { provider, listener } = setup({ binanceFail: () => (failing ? "typeerror" : undefined) });
    p = provider;
    provider.start();
    await flush();
    await runFor(MIN);
    failing = true;
    listener("pageshow")!(); // back from the back/forward cache
    await vi.advanceTimersByTimeAsync(3_000);
    expect(provider.getHealth().primary.blocked).toBe(false);
  });

  it("a socket that delivers while Binance REST stays unreachable re-probes at most every 2 min (no probe storm)", async () => {
    const { provider, net } = setup({ binanceFail: (u) => (u.hostname === "fapi.binance.com" ? "typeerror" : undefined) });
    p = provider;
    provider.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(provider.getHealth().primary.blocked).toBe(true);
    await runFor(10 * MIN, 1_000);
    const probes = calls(net, "fapi.binance.com/fapi/v1/time");
    expect(probes).toBeGreaterThanOrEqual(2);
    expect(probes).toBeLessThanOrEqual(6);
    expect(provider.getHealth().primary.blocked).toBe(true);
    expect(provider.getHealth().feeds.ticker24h.source).toBe("bybit");
  });

  it("blocked with a usable proxy: the top traders come through the proxy instead of 'Nur mit Binance'", async () => {
    const { provider } = setup({ proxy: true, proxyUp: true, binanceFail: (u) => (u.hostname === "fapi.binance.com" ? "typeerror" : undefined) });
    p = provider;
    provider.start();
    await runFor(MIN, 5_000, false);
    const h = provider.getHealth();
    expect(h.primary.blocked).toBe(true);
    expect(h.feeds.topAccountRatio.source).toBe("proxy");
    expect(h.feeds.globalAccountRatio.source).toBe("proxy");
    expect(h.feeds.topAccountRatio5m.source).toBe("proxy");
    expect(h.feeds.ticker24h.source).toBe("bybit");
    expect(tt(provider)).toMatchObject({ liveReadingOk: true, onlyBinance: false });
    expect(topTraderFreshness(tt(provider), h, HOUR).kind).toBe("proxy");
  });

  it("a ratio feed parked on another source is never left without a way back (watchdog + probe)", async () => {
    const { provider } = setup();
    p = provider;
    provider.start();
    await flush();
    await runFor(MIN);
    provider.dispatch({ type: "move", feed: "topAccountRatio", source: "bybit", now: Date.now() });
    await provider.refresh("topAccountRatio"); // polls Bybit → Unsupported → parked
    await runFor(MIN);
    expect(provider.getHealth().feeds.topAccountRatio).toMatchObject({ source: "bybit", reason: "unsupported" });
    expectArmed(provider);
    await runFor(6 * MIN);
    expect(provider.getHealth().feeds.topAccountRatio).toMatchObject({ source: "binance", state: "live" });
  });

  it("EU-Proxy verwenden: the ratio feeds switch to the proxy and back", async () => {
    const { provider, net } = setup({ proxy: true, proxyUp: true });
    p = provider;
    provider.start();
    await flush();
    await runFor(MIN);
    expect(provider.getHealth().feeds.topAccountRatio.source).toBe("binance");
    provider.setPreferProxy(true);
    await runFor(10_000);
    expect(provider.getHealth().feeds.topAccountRatio.source).toBe("proxy");
    expect(provider.getHealth().feeds.topAccountRatio5m.source).toBe("proxy");
    expect(provider.getHealth().feeds.ticker24h.source).toBe("binance"); // prices stay direct
    expect(calls(net, "/api/binance/futures/data/")).toBeGreaterThan(0);
    provider.setPreferProxy(false);
    await runFor(10_000);
    expect(provider.getHealth().feeds.topAccountRatio.source).toBe("binance");
    expect(tt(provider).liveReadingOk).toBe(true);
  });
});
