/**
 * Decision 14 — "zuverlässig immer alle Daten abrufbar und aktualisiert": every feed keeps refreshing on its natural
 * cadence through the things a Galaxy Tab running Samsung Internet does to a page — a hidden tab, a device sleep
 * (timers do not run), the network dropping, Binance answering 429 / 418 / 451 or a CORS-less error, a socket that
 * stays open but stops sending, a single stream that stalls — and with a device clock that is minutes off.
 * Real provider, fake timers, a synthetic Binance whose rows follow the (server) clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketProvider } from "@/market/provider";
import { FEED_IDS, WS_FEEDS } from "@/market/feeds";
import { Budget, BUCKETS, BULK_RESERVE } from "@/market/budget";
import { ClockSkew, skewText } from "@/market/clock";
import { Scheduler } from "@/market/schedule";
import type { Candle, FeedId } from "@/market/types";
import { FakeSocket, HOUR, MIN, SEC, T0, flush, holes, pumpWs, requests, runFor, setup, unarmed } from "./market.netHarness";

const REST_FEEDS = (p: MarketProvider) => FEED_IDS.filter((f) => p.specs[f].transport === "rest");
const series = (p: MarketProvider, f: FeedId) => (p.get(f)?.data ?? []) as Candle[];
const klineLimits = (net: Parameters<typeof requests>[0], iv: string, since: number) =>
  requests(net, "/fapi/v1/klines", since)
    .filter((u) => u.searchParams.get("interval") === iv)
    .map((u) => Number(u.searchParams.get("limit")));

describe("decision 14: every feed keeps refreshing", () => {
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

  async function startLive(o: Parameters<typeof setup>[0] = {}) {
    const env = setup(o);
    p = env.provider;
    env.provider.start();
    await flush();
    await runFor(env.net, 30 * SEC);
    return env;
  }

  it("hidden 10 min, then visible: every REST feed is re-polled within seconds, the silent socket reconnects and the kline gap is filled", async () => {
    const { provider, net, setHidden } = await startLive();
    expect(provider.getHealth().feeds.ticker24h.state).toBe("live");
    setHidden(true);
    await runFor(net, 10 * MIN, { ws: false }); // the stream goes quiet with the tab in the background
    expect(provider.getHealth().feeds.ticker24h.state).toBe("live"); // no ticks while hidden: nothing re-labelled
    const sockets = FakeSocket.all.length;

    const back = Date.now();
    setHidden(false);
    await vi.advanceTimersByTimeAsync(4 * SEC);
    // REST: everything whose data is older than one cadence asked again within 4 s (staggered, not all in one tick)
    for (const path of ["/fapi/v1/ticker/24hr", "/fapi/v1/openInterest", "topLongShortAccountRatio?symbol=BTCUSDT&period=5m"]) {
      expect(requests(net, path, back).length, path).toBeGreaterThan(0);
    }
    const first = Math.min(...net.log.filter((r) => r.at >= back).map((r) => r.at));
    expect(first - back).toBeGreaterThanOrEqual(1_000); // spread out (radio waking up), not in the visibilitychange tick
    // WS: a new socket right away; every kline feed is fetched since the newest cached bar (REST stand-in for the
    // dead socket and/or the gap fill when it opens — a request answered < 1 s ago is shared, not repeated)
    expect(FakeSocket.all.length).toBeGreaterThan(sockets);
    pumpWs(net);
    await flush();
    const limits1m = klineLimits(net, "1m", back);
    expect(Math.max(...limits1m)).toBeGreaterThanOrEqual(11); // 10 min of 1m bars + the forming one
    for (const iv of ["15m", "1h", "4h", "1w"]) expect(klineLimits(net, iv, back).length, iv).toBeGreaterThan(0);

    await runFor(net, 10 * SEC);
    const h = provider.getHealth();
    for (const f of FEED_IDS) {
      if (f === "bookTop") continue;
      expect(["live"], `${f}: ${h.feeds[f].state}`).toContain(h.feeds[f].state);
    }
    expect(holes(series(provider, "kline_1m"), MIN)).toBe(0);
    expect(series(provider, "kline_1m").at(-1)!.time).toBe(Math.floor(Date.now() / MIN) * MIN);
    expect(unarmed(provider)).toEqual([]);
  });

  it("device sleep with the tab visible (timers frozen 20 min): the next tick detects it, fires the lost polls and reconnects", async () => {
    const { provider, net } = await startLive();
    const before = net.log.length;
    // the device sleeps: wall clock jumps, no timer fires (Android does not run timers in deep sleep)
    vi.setSystemTime(Date.now() + 20 * MIN);
    const woke = Date.now();
    await vi.advanceTimersByTimeAsync(10 * SEC); // first tick after waking (≤ 5 s) + the staggered polls
    expect(net.log.length).toBeGreaterThan(before);
    for (const path of ["/fapi/v1/ticker/24hr", "/fapi/v1/openInterest", "period=5m"]) expect(requests(net, path, woke).length, path).toBeGreaterThan(0);
    // the socket (last frame 20 min ago) is replaced; on open the 1m gap (≥ 20 bars) is requested
    const live = FakeSocket.live()!;
    expect(live.readyState).toBe(0);
    const opened = Date.now();
    pumpWs(net);
    await flush();
    expect(Math.max(...klineLimits(net, "1m", opened))).toBeGreaterThanOrEqual(21);
    await runFor(net, 10 * SEC);
    expect(holes(series(provider, "kline_1m"), MIN)).toBe(0);
    expect(provider.getHealth().feeds.ticker24h.state).toBe("live");
    expect(unarmed(provider)).toEqual([]);
  });

  it("offline → online event: failures while offline never move a feed, every REST feed is re-polled on `online`", async () => {
    const offlineFail = { on: false };
    const { provider, net, setOnline } = await startLive({ fail: () => (offlineFail.on ? "typeerror" : undefined) });
    offlineFail.on = true;
    setOnline(false);
    await runFor(net, 3 * MIN, { ws: false });
    const h = provider.getHealth();
    expect(h.online).toBe(false);
    expect(h.overall).toBe("offline");
    for (const f of REST_FEEDS(provider)) expect(h.feeds[f].source, f).not.toBe("bybit");
    expect(requests(net, "api.bybit.com").length).toBe(0);
    // retries stay armed (30 s) while offline
    expect(h.feeds.ticker24h.nextRefreshAt).toBeGreaterThan(Date.now() - 1);

    offlineFail.on = false;
    const back = Date.now();
    setOnline(true);
    await vi.advanceTimersByTimeAsync(8 * SEC);
    for (const f of REST_FEEDS(provider)) {
      if (provider.getHealth().feeds[f].source === "cache") continue;
      expect(provider.getHealth().feeds[f].lastDataAt, f).toBeDefined();
    }
    expect(requests(net, "/fapi/v1/ticker/24hr", back).length).toBeGreaterThan(0);
    expect(requests(net, "period=5m", back).length).toBeGreaterThan(0);
    expect(FakeSocket.all.at(-1)!.readyState).toBe(0); // `online` reconnected the silent socket
    await runFor(net, 10 * SEC);
    expect(provider.getHealth().overall).toBe("live");
  });

  it("offline → online WITHOUT the event (missed by a frozen tab): the 30-s offline retry brings everything back", async () => {
    const offlineFail = { on: false };
    const { provider, net, setOnline, state } = await startLive({ fail: () => (offlineFail.on ? "typeerror" : undefined) });
    offlineFail.on = true;
    setOnline(false);
    await runFor(net, 2 * MIN, { ws: false });
    offlineFail.on = false;
    state.online = true; // navigator.onLine is true again, but no `online` event arrives
    await runFor(net, 40 * SEC);
    expect(provider.getHealth().online).toBe(true);
    expect(provider.getHealth().feeds.ticker24h.state).toBe("live");
    expect(provider.getHealth().feeds.topAccountRatio5m.state).toBe("live");
    expect(unarmed(provider)).toEqual([]);
  });

  it("429 on the ticker: the Binance weight bucket pauses 60 s, the futures-data feeds keep polling, the ticker recovers on Binance", async () => {
    let fails = 0;
    const limited = { on: false };
    const { provider, net } = await startLive({
      fail: (u, host) => {
        if (limited.on && host === "binance" && u.pathname === "/fapi/v1/ticker/24hr" && fails < 2) {
          fails += 1;
          return 429;
        }
        return undefined;
      },
    });
    limited.on = true;
    await runFor(net, 31 * SEC); // the 30-s poll gets the 429
    expect(fails).toBe(1);
    const fh = provider.getHealth().feeds.ticker24h;
    expect(fh).toMatchObject({ reason: "rate_limited", source: "binance", detail: "HTTP 429 · zu viele Anfragen" });
    const paused = Date.now();
    await runFor(net, 50 * SEC);
    // no Binance weight request during the pause (the socket keeps the price live) …
    expect(requests(net, "fapi.binance.com/fapi/v1/ticker/24hr", paused).length).toBe(0);
    expect(requests(net, "fapi.binance.com/fapi/v1/openInterest", paused).length).toBe(0);
    expect(provider.getHealth().feeds.aggTrade.state).toBe("live");
    // … while the other bucket (futures data) is untouched: the 5-min ratios still poll on their boundary
    await runFor(net, 6 * MIN);
    expect(requests(net, "period=5m", paused).length).toBeGreaterThan(0);
    expect(provider.getHealth().feeds.topAccountRatio5m.state).toBe("live");
    // the ticker came back on Binance (never parked: Bybit not asked)
    expect(provider.getHealth().feeds.ticker24h).toMatchObject({ state: "live", source: "binance", consecutiveFailures: 0 });
    expect(requests(net, "api.bybit.com").length).toBe(0);
    expect(unarmed(provider)).toEqual([]);
  });

  it("418 IP ban: the direct REST feeds move to the proxy at once (Binance from another IP, not Bybit); a probe brings them back", async () => {
    const ban = { on: false };
    const { provider, net } = await startLive({ proxy: true, proxyUp: true, fail: (u, host) => (ban.on && host === "binance" && (u.pathname.startsWith("/fapi/") || u.pathname.startsWith("/futures/")) ? 418 : undefined) });
    expect(provider.getHealth().proxy.usable).toBe(true);
    ban.on = true;
    await runFor(net, 31 * SEC);
    let h = provider.getHealth();
    expect(h.feeds.ticker24h.source).toBe("proxy");
    expect(h.feeds.openInterest.source).toBe("proxy");
    expect(h.feeds.topAccountRatio5m.source).toBe("proxy");
    const at = Date.now();
    await runFor(net, 100 * SEC);
    expect(requests(net, "fapi.binance.com/fapi/v1/", at).length).toBe(0); // the bucket pauses 2 min, nothing hammers the ban
    expect(requests(net, "/api/binance/fapi/v1/ticker/24hr", at).length).toBeGreaterThanOrEqual(3); // the ticker keeps its 30 s
    await runFor(net, 5 * MIN);
    h = provider.getHealth();
    expect(h.feeds.ticker24h).toMatchObject({ source: "proxy" });
    expect(h.feeds.ticker24h.lastDataAt).toBeGreaterThan(Date.now() - MIN);
    expect(h.feeds.aggTrade.state).toBe("live"); // the socket is not affected by a REST ban
    expect(requests(net, "api.bybit.com").length).toBe(0);
    expect(unarmed(provider)).toEqual([]);
    expect(h.primary.nextProbeAt).toBeGreaterThan(Date.now());
    // the ban ends: the next probe moves the direct feeds back (the futures-data series may stay on the proxy)
    ban.on = false;
    await runFor(net, 12 * MIN);
    h = provider.getHealth();
    expect(h.feeds.ticker24h.source).toBe("binance");
    expect(h.feeds.openInterest.source).toBe("binance");
    expect(h.feeds.ticker24h.state).toBe("live");
  });

  it("451 everywhere on Binance (region block): prices from Bybit, top traders through the proxy, every feed armed; Binance back → feeds return", async () => {
    const block = { on: false };
    const { provider, net } = await startLive({ proxy: true, proxyUp: true, fail: (_u, host) => (block.on && host === "binance" ? 451 : undefined) });
    block.on = true;
    net.wsUp = false;
    FakeSocket.live()?.drop();
    await runFor(net, 3 * MIN, { ws: false });
    let h = provider.getHealth();
    expect(h.primary.blocked).toBe(true);
    expect(h.feeds.ticker24h.source).toBe("bybit");
    expect(h.feeds.topAccountRatio5m.source).toBe("proxy");
    expect(h.feeds.topAccountRatio5m.state).not.toBe("offline");
    expect(unarmed(provider)).toEqual([]);
    expect(h.primary.nextProbeAt).toBeGreaterThan(Date.now());
    // the block ends: the next re-probe (≤ 5 min) brings the Binance feeds back
    block.on = false;
    net.wsUp = true;
    await runFor(net, 6 * MIN);
    h = provider.getHealth();
    expect(h.primary.blocked).toBe(false);
    expect(h.feeds.ticker24h.source).toBe("binance");
    expect(h.feeds.aggTrade).toMatchObject({ source: "binance", state: "live" });
  });

  it("CORS: /fapi/v1/openInterest unreadable (TypeError) while the rest of Binance answers → the proxy after the second failure, not Bybit", async () => {
    const { provider, net } = await startLive({ proxy: true, proxyUp: true, fail: (u, host) => (host === "binance" && u.pathname === "/fapi/v1/openInterest" ? "typeerror" : undefined) });
    await runFor(net, 3 * MIN);
    const h = provider.getHealth();
    expect(h.primary.blocked).toBe(false);
    expect(h.feeds.openInterest).toMatchObject({ source: "proxy" });
    expect(h.feeds.openInterest.lastDataAt).toBeGreaterThan(Date.now() - 2 * MIN);
    expect(h.feeds.ticker24h.source).toBe("binance");
    expect(requests(net, "api.bybit.com/v5/market/tickers").length).toBe(0);
  });

  it("CORS without a proxy (file:// edition): the feed stays on its route, keeps retrying, and says why", async () => {
    const { provider, net } = await startLive({ fail: (u, host) => (host === "binance" && u.pathname.includes("topLongShortAccountRatio") ? "typeerror" : undefined) });
    await runFor(net, 10 * MIN);
    const fh = provider.getHealth().feeds.topAccountRatio5m;
    expect(fh.source).toBe("binance");
    expect(fh.consecutiveFailures).toBeGreaterThan(1);
    expect(fh.reason).toBe("network");
    expect(fh.nextRefreshAt).toBeGreaterThan(Date.now());
    expect(provider.statusLabel("topAccountRatio5m").text).toMatch(/Netzwerk\/CORS-Fehler/);
    expect(provider.getHealth().feeds.ticker24h.state).toBe("live"); // nothing else suffers
  });

  it("stalled socket (open, no frames): silent after 10 s → reconnect; REST stands in meanwhile; no hole once it delivers again", async () => {
    const { provider, net } = await startLive();
    const sockets = FakeSocket.all.length;
    const since = Date.now();
    net.wsUp = false; // the server stops sending; new handshakes hang
    await runFor(net, 3 * MIN, { ws: false });
    expect(FakeSocket.all.length).toBeGreaterThan(sockets + 2); // silent → reconnect, hung handshakes time out (15 s) and retry
    expect(provider.getHealth().ws.state).toBe("fallback");
    expect(klineLimits(net, "1m", since).length).toBeGreaterThan(5); // REST every 10 s while the socket is down
    expect(provider.statusLabel("kline_1m").text).toBe("Binance-Daten · alle 10 s");
    net.wsUp = true;
    await runFor(net, 40 * SEC);
    expect(provider.getHealth().ws.state).toBe("live");
    expect(provider.getHealth().feeds.kline_1m).toMatchObject({ state: "live", source: "binance" });
    expect(holes(series(provider, "kline_1m"), MIN)).toBe(0);
    expect(series(provider, "kline_1m").at(-1)!.time).toBe(Math.floor(Date.now() / MIN) * MIN);
  });

  it("one stalled stream (kline_15m silent while mark price and trades flow): fetched over REST, then the socket re-subscribes", async () => {
    const { provider, net } = await startLive();
    const sockets = FakeSocket.all.length;
    const since = Date.now();
    await runFor(net, 100 * SEC, { skip: ["kline_15m"] });
    expect(klineLimits(net, "15m", since).length).toBeGreaterThan(0); // REST stood in for the stream
    await runFor(net, 3 * MIN, { skip: ["kline_15m"] });
    expect(FakeSocket.all.length).toBeGreaterThan(sockets); // second stall → re-subscribe
    expect(holes(series(provider, "kline_15m"), 15 * MIN)).toBe(0);
    expect(series(provider, "kline_15m").at(-1)!.time).toBe(Math.floor(Date.now() / (15 * MIN)) * 15 * MIN);
  });

  it("a failed gap fill stays pending: the next retry still sends it although the socket covers the feed", async () => {
    const failKlines = { on: false };
    const { provider, net } = await startLive({ fail: (u, host) => (failKlines.on && host === "binance" && u.pathname === "/fapi/v1/klines" ? "typeerror" : undefined) });
    await runFor(net, 3 * MIN, { ws: false }); // silent → reconnect pending
    failKlines.on = true;
    pumpWs(net); // the new socket opens; its gap fill fails
    await flush();
    failKlines.on = false;
    await runFor(net, 20 * SEC); // the feed's retry (15 s) sends the gap fill again
    expect(holes(series(provider, "kline_1m"), MIN)).toBe(0);
    expect(series(provider, "kline_1m").at(-1)!.time).toBe(Math.floor(Date.now() / MIN) * MIN);
  });

  it("device clock 3 min BEHIND Binance: feeds stay live, the offset is published, the gap fill counts on the Binance clock", async () => {
    const { provider, net, setHidden } = await startLive({ serverSkewMs: 3 * MIN });
    await runFor(net, 5 * MIN);
    const h = provider.getHealth();
    expect(Math.abs((h.clockSkewMs ?? 0) - 3 * MIN)).toBeLessThan(2 * SEC);
    for (const f of WS_FEEDS) if (f !== "bookTop") expect(h.feeds[f].state, f).toBe("live");
    expect(h.feeds.ticker24h.state).toBe("live");
    expect(h.feeds.topAccountRatio5m.state).toBe("live");
    expect(Math.abs(provider.serverNow() - (Date.now() + 3 * MIN))).toBeLessThan(2 * SEC);
    // 10 min in the background (no REST, the stream dies): on return the gap fill counts the missing bars on the
    // SERVER clock — with the device clock 3 min behind, a device-clock count would leave the last 3 bars out
    setHidden(true);
    await runFor(net, 10 * MIN, { ws: false });
    setHidden(false);
    await vi.advanceTimersByTimeAsync(SEC);
    const opened = Date.now();
    pumpWs(net);
    await flush();
    expect(Math.max(...klineLimits(net, "1m", opened))).toBeGreaterThanOrEqual(11);
    await runFor(net, 5 * SEC);
    expect(holes(series(provider, "kline_1m"), MIN)).toBe(0);
  });

  it("device clock 4 min AHEAD: nothing is marked stale, and the 5-min ratio polls land after Binance published (server time)", async () => {
    const { provider, net } = await startLive({ serverSkewMs: -4 * MIN });
    await runFor(net, 16 * MIN);
    const h = provider.getHealth();
    expect(h.clockSkewMs).toBeLessThan(-3 * MIN);
    expect(h.feeds.ticker24h.state).toBe("live");
    expect(h.feeds.kline_1m.state).toBe("live");
    expect(h.feeds.topAccountRatio5m.state).toBe("live");
    // every live 5-min poll (limit 3) after the offset was learned happened 60–105 s after a SERVER boundary
    const polls = net.log.filter((r) => r.url.includes("topLongShortAccountRatio") && r.url.includes("period=5m") && r.url.includes("limit=3") && r.at > T0 + 2 * MIN);
    expect(polls.length).toBeGreaterThan(1);
    for (const r of polls.slice(1)) {
      const server = r.at - 4 * MIN;
      const into = server % (5 * MIN);
      expect(into, new Date(server).toISOString()).toBeGreaterThanOrEqual(59 * SEC);
    }
  });

  it("an hourly series whose point stops advancing is re-polled at least every 5 min once stale (never left for the next hour)", async () => {
    const { provider, net } = await startLive({ period: "1h" });
    const stuckAt = provider.getHealth().feeds.topAccountRatio.lastDataAt!;
    const frozen = Date.now();
    net.futuresAt = () => frozen; // Binance stops publishing new points
    await runFor(net, 3 * HOUR, { step: 10 * SEC });
    const fh = provider.getHealth().feeds.topAccountRatio;
    expect(fh.lastDataAt).toBe(stuckAt);
    expect(fh.state).toBe("stale");
    const lastHour = requests(net, "topLongShortAccountRatio?symbol=BTCUSDT&period=1h", Date.now() - HOUR).length;
    expect(lastHour).toBeGreaterThanOrEqual(11); // ≥ 1 per 5 min
    expect(lastHour).toBeLessThanOrEqual(24); // … but no hammering (≈ every 2.5 min at most: kicks + late-point retries)
    net.futuresAt = undefined; // publishing resumes
    await runFor(net, 6 * MIN, { step: 10 * SEC });
    expect(provider.getHealth().feeds.topAccountRatio.state).toBe("live");
    expect(provider.getHealth().feeds.topAccountRatio.lastDataAt).toBeGreaterThan(stuckAt);
  });

  it("pageshow (back/forward cache), focus and the Page Lifecycle `resume` run the re-check at once; repeats are throttled", async () => {
    const { provider, net, win, doc } = await startLive({ tickMs: 60_000 });
    expect(win.listeners("pageshow")).toBe(1);
    expect(win.listeners("focus")).toBe(1);
    expect(doc.listeners("resume")).toBe(1);
    // the page was frozen 10 min in the back/forward cache: no timer ran meanwhile
    vi.setSystemTime(Date.now() + 10 * MIN);
    const back = Date.now();
    win.fire("pageshow", { type: "pageshow", persisted: true });
    await vi.advanceTimersByTimeAsync(4 * SEC); // well before the next health tick (60 s here)
    for (const path of ["/fapi/v1/ticker/24hr", "/fapi/v1/openInterest", "period=5m"]) expect(requests(net, path, back).length, path).toBeGreaterThan(0);
    expect(FakeSocket.live()!.readyState).toBe(0); // the silent socket was replaced
    const n = net.log.length;
    win.fire("focus");
    doc.fire("resume");
    await vi.advanceTimersByTimeAsync(500);
    expect(net.log.length).toBe(n); // within 5 s of the last re-check: nothing new
    // later, a focus after the device slept again does the same as pageshow
    pumpWs(net);
    await runFor(net, 20 * SEC);
    vi.setSystemTime(Date.now() + 5 * MIN);
    const again = Date.now();
    win.fire("focus");
    await vi.advanceTimersByTimeAsync(4 * SEC);
    expect(requests(net, "/fapi/v1/ticker/24hr", again).length).toBeGreaterThan(0);
    provider.stop();
    expect(win.listeners("pageshow")).toBe(0);
    expect(win.listeners("focus")).toBe(0);
    expect(doc.listeners("resume")).toBe(0);
  });

  it("budget: bulk pages (history, retro checks) never take the live reserve — the ticker keeps its 30-s cadence", async () => {
    const { provider, net } = await startLive();
    const since = Date.now();
    // 40 retro pages of 1500 bars (weight 10 each = 400 > the 240/min reserve)
    const pages = Array.from({ length: 40 }, () => provider.fetchKlines("15m", { limit: 1500, maxWaitMs: 5 * SEC }).then(() => "ok", () => "busy"));
    await runFor(net, 2 * MIN);
    const results = await Promise.all(pages);
    expect(results).toContain("busy"); // the bulk class waited / gave up …
    const tickers = requests(net, "fapi.binance.com/fapi/v1/ticker/24hr", since).length;
    expect(tickers).toBeGreaterThanOrEqual(3); // … the live ticker polled on time (every 30 s)
    expect(provider.getHealth().feeds.ticker24h.state).toBe("live");
  });
});

describe("budget classes", () => {
  it("bulk never takes the last BULK_RESERVE of a bucket; live may", () => {
    const b = new Budget(0);
    const cap = BUCKETS["binance.weight"].capacity;
    let bulk = 0;
    while (b.take("binance.weight", 10, 0, "bulk")) bulk += 10;
    expect(bulk).toBeLessThanOrEqual(cap * (1 - BULK_RESERVE));
    expect(b.take("binance.weight", 10, 0)).toBe(true);
    expect(b.waitFor("binance.weight", 10, 0, "bulk")).toBeGreaterThan(b.waitFor("binance.weight", 10, 0));
  });
});

describe("clock skew estimator", () => {
  it("applies only large, consistent offsets (max over the window: latency never shrinks the estimate)", () => {
    const c = new ClockSkew();
    for (let i = 0; i < 4; i++) c.sample(1_000_000 + i * 1000 + 180_000, 1_000_000 + i * 1000 + 50 + (i % 2) * 200);
    expect(c.offsetMs).toBe(0); // < 5 samples
    c.sample(1_005_000 + 180_000, 1_005_000 + 40);
    expect(c.offsetMs).toBeGreaterThan(179_000);
    expect(c.offsetMs).toBeLessThanOrEqual(180_000);
    const d = new ClockSkew();
    for (let i = 0; i < 10; i++) d.sample(1_000_000 + i * 1000 + 300, 1_000_000 + i * 1000); // 300 ms: latency, not skew
    expect(d.offsetMs).toBe(0);
    const e = new ClockSkew();
    for (let i = 0; i < 10; i++) e.sample(1_790_000_000_000, 1_000_000 + i * 60_000); // a replayed fixture
    expect(e.offsetMs).toBe(0);
  });
  it("German line: device clock ahead / behind", () => {
    expect(skewText(-130_000)).toBe("Geräteuhr geht 2:10 min vor · Zeiten nach Binance-Uhr");
    expect(skewText(45_000)).toBe("Geräteuhr geht 0:45 min nach · Zeiten nach Binance-Uhr");
    expect(skewText(0)).toBe("");
  });
});

describe("scheduler overdue jobs", () => {
  it("lists jobs whose timer did not fire (device sleep) and nothing while paused", () => {
    let now = 0;
    const timers: (() => void)[] = [];
    const s = new Scheduler({ now: () => now, setTimeout: (fn) => timers.push(fn), clearTimeout: () => undefined });
    s.at("a", 1_000, () => undefined);
    s.at("b", 60_000, () => undefined);
    now = 30_000; // slept: "a" should have fired 29 s ago
    expect(s.overdue(now, 3_000)).toEqual(["a"]);
    s.pause();
    expect(s.overdue(now, 3_000)).toEqual([]);
  });
});
