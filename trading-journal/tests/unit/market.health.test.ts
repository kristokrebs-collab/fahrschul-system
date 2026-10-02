import { describe, expect, it } from "vitest";
import { initialHealth, reduceHealth, aggregate, worst, feedsBySource } from "@/market/health";
import { buildFeedSpecs, FEED_IDS, WS_FEEDS } from "@/market/feeds";
import type { HealthEvent, ProviderHealth } from "@/market/types";

const specs = buildFeedSpecs("1h");
const T = 1790762400000;
const run = (events: HealthEvent[], h = initialHealth(specs)): ProviderHealth => events.reduce((acc, ev) => reduceHealth(acc, ev, specs), h);

describe("health reducer", () => {
  it("starts connecting with the primary source", () => {
    const h = initialHealth(specs);
    expect(h.overall).toBe("connecting");
    for (const f of FEED_IDS) expect(h.feeds[f]).toMatchObject({ state: "connecting", source: "binance", consecutiveFailures: 0 });
  });

  it("connecting → live on rest_ok / ws_message", () => {
    const h = run([
      { type: "rest_ok", feed: "ticker24h", source: "binance", asOf: T, now: T + 10 },
      { type: "ws_message", feeds: ["markPrice"], asOf: T, now: T + 20 },
    ]);
    expect(h.feeds.ticker24h.state).toBe("live");
    expect(h.feeds.ticker24h.lastDataAt).toBe(T);
    expect(h.feeds.markPrice.state).toBe("live");
    expect(h.ws.state).toBe("live");
    expect(h.overall).toBe("live"); // pristine feeds are ignored by the aggregate
  });

  it("live → stale on tick after staleAfterMs, back to live on data", () => {
    let h = run([{ type: "rest_ok", feed: "ticker24h", source: "binance", asOf: T, now: T }]);
    const same = reduceHealth(h, { type: "tick", now: T + 60_000 }, specs);
    expect(same).toBe(h); // no change → same reference
    h = reduceHealth(h, { type: "tick", now: T + 90_001 }, specs);
    expect(h.feeds.ticker24h.state).toBe("stale");
    expect(h.overall).toBe("stale");
    h = reduceHealth(h, { type: "rest_ok", feed: "ticker24h", source: "binance", asOf: T + 91_000, now: T + 91_000 }, specs);
    expect(h.feeds.ticker24h.state).toBe("live");
  });

  it("rest_fail ×3 → fallback to the next source; ×3 on the last source → offline", () => {
    const fail = (source: "binance" | "bybit" | "proxy", n: number): HealthEvent[] => Array.from({ length: n }, () => ({ type: "rest_fail" as const, feed: "ticker24h" as const, source, kind: "network" as const, now: T }));
    let h = run(fail("binance", 2));
    expect(h.feeds.ticker24h).toMatchObject({ state: "connecting", consecutiveFailures: 2, reason: "network" });
    h = run(fail("binance", 1), h);
    expect(h.feeds.ticker24h).toMatchObject({ state: "fallback", source: "bybit", consecutiveFailures: 0 });
    h = run(fail("bybit", 3), h);
    expect(h.feeds.ticker24h).toMatchObject({ state: "fallback", source: "proxy" });
    h = run(fail("proxy", 3), h);
    expect(h.feeds.ticker24h).toMatchObject({ state: "offline", source: "cache" });
    expect(h.overall).toBe("offline");
  });

  it("blocked_451 / cors go to fallback immediately", () => {
    const h = run([{ type: "rest_fail", feed: "openInterest", source: "binance", kind: "cors", now: T }]);
    expect(h.feeds.openInterest).toMatchObject({ state: "fallback", source: "bybit", reason: "cors" });
    expect(h.feeds.ticker24h.state).toBe("connecting");
  });

  it("rest_ok from a fallback source keeps state fallback", () => {
    const h = run([
      { type: "rest_fail", feed: "ticker24h", source: "binance", kind: "blocked_451", now: T },
      { type: "rest_ok", feed: "ticker24h", source: "bybit", asOf: T + 1, now: T + 1 },
    ]);
    expect(h.feeds.ticker24h).toMatchObject({ state: "fallback", source: "bybit", lastDataAt: T + 1 });
    expect(h.overall).toBe("fallback");
  });

  it("blocked probe moves every Binance feed to fallback at once; success re-adopts the primary", () => {
    let h = run([
      { type: "rest_ok", feed: "ticker24h", source: "binance", asOf: T, now: T },
      { type: "probe", source: "binance", ok: false, blocked: true, now: T + 1 },
    ]);
    expect(h.primary).toMatchObject({ blocked: true, reachable: false, lastProbeAt: T + 1 });
    expect(feedsBySource(h, "binance")).toEqual([]);
    expect(h.feeds.ticker24h).toMatchObject({ state: "fallback", source: "bybit", reason: "blocked_451" });
    expect(h.ws.state).toBe("fallback");
    h = reduceHealth(h, { type: "rest_ok", feed: "ticker24h", source: "bybit", asOf: T + 2, now: T + 2 }, specs);
    h = reduceHealth(h, { type: "probe", source: "binance", ok: true, now: T + 300_000 }, specs);
    expect(h.primary.blocked).toBe(false);
    expect(h.feeds.ticker24h).toMatchObject({ state: "connecting", source: "binance", lastDataAt: T + 2 }); // data kept
    expect(h.ws.state).toBe("connecting");
  });

  it("ws_close after 3 failed reconnects puts WS feeds into fallback (REST polling on Binance)", () => {
    let h = run([{ type: "ws_message", feeds: ["markPrice", "aggTrade"], asOf: T, now: T }]);
    h = reduceHealth(h, { type: "ws_close", code: 1006, now: T + 1, failedAttempts: 1 }, specs);
    expect(h.ws.state).toBe("connecting");
    expect(h.feeds.markPrice.state).toBe("live");
    h = reduceHealth(h, { type: "ws_close", code: 1006, now: T + 2, failedAttempts: 3 }, specs);
    expect(h.ws.state).toBe("fallback");
    for (const f of WS_FEEDS) expect(h.feeds[f].source).toBe("binance");
    expect(h.feeds.markPrice).toMatchObject({ state: "fallback", reason: "ws_closed" });
    expect(h.feeds.ticker24h.state).toBe("connecting"); // REST feed untouched
    // a WS message brings them back
    h = reduceHealth(h, { type: "ws_message", feeds: ["markPrice"], asOf: T + 5, now: T + 5 }, specs);
    expect(h.feeds.markPrice).toMatchObject({ state: "live", reason: undefined });
  });

  it("ws_silent marks live WS feeds stale with reason ws_silent", () => {
    const h = run([
      { type: "ws_message", feeds: ["markPrice"], asOf: T, now: T },
      { type: "rest_ok", feed: "ticker24h", source: "binance", asOf: T, now: T },
      { type: "ws_silent", now: T + 10_000 },
    ]);
    expect(h.feeds.markPrice).toMatchObject({ state: "stale", reason: "ws_silent" });
    expect(h.feeds.ticker24h.state).toBe("live");
    expect(h.ws.state).toBe("stale");
  });

  it("offline → everything offline; online → connecting again", () => {
    let h = run([
      { type: "rest_ok", feed: "ticker24h", source: "binance", asOf: T, now: T },
      { type: "online", online: false, now: T + 1 },
    ]);
    expect(h.online).toBe(false);
    expect(h.overall).toBe("offline");
    for (const f of FEED_IDS) expect(h.feeds[f]).toMatchObject({ state: "offline", reason: "offline" });
    h = reduceHealth(h, { type: "online", online: true, now: T + 2 }, specs);
    expect(h.online).toBe(true);
    expect(h.feeds.ticker24h).toMatchObject({ state: "connecting", lastDataAt: T, reason: undefined });
    expect(h.overall).toBe("connecting");
  });

  it("bad_period sets the reason on the ratio feeds and survives rest_ok", () => {
    const h = run([
      { type: "bad_period", feeds: ["topAccountRatio"], detail: "Timeframe 1w wird von Binance nicht unterstützt, Ratios nutzen 1h", now: T },
      { type: "rest_ok", feed: "topAccountRatio", source: "binance", asOf: T, now: T },
    ]);
    expect(h.feeds.topAccountRatio).toMatchObject({ state: "live", reason: "bad_period" });
    expect(h.feeds.topAccountRatio.detail).toContain("Ratios nutzen 1h");
  });

  it("bad_symbol / unsupported / proxy probe", () => {
    let h = run([{ type: "bad_symbol", now: T }]);
    expect(h.feeds.aggTrade).toMatchObject({ reason: "bad_symbol", state: "offline" });
    h = run([{ type: "unsupported", feed: "topAccountRatio", source: "bybit", now: T, detail: "Bybit: alle Konten" }]);
    expect(h.feeds.topAccountRatio).toMatchObject({ state: "fallback", source: "bybit", reason: "unsupported" });
    h = run([{ type: "probe", source: "proxy", ok: true, blocked: true, now: T }]);
    expect(h.proxy).toEqual({ usable: true, blocked: true });
  });

  it("aggregates the worst state and ranks fallback between stale and offline", () => {
    expect(worst(["live", "stale"])).toBe("stale");
    expect(worst(["stale", "fallback"])).toBe("fallback");
    expect(worst(["fallback", "offline"])).toBe("offline");
    expect(worst([])).toBe("live");
    const h = run([
      { type: "rest_ok", feed: "ticker24h", source: "binance", asOf: T, now: T },
      { type: "rest_ok", feed: "openInterest", source: "bybit", asOf: T, now: T },
    ]);
    expect(aggregate(h)).toBe("fallback");
  });

  it("stop resets to connecting", () => {
    const h = run([{ type: "rest_ok", feed: "ticker24h", source: "bybit", asOf: T, now: T }, { type: "stop", now: T }]);
    expect(h.feeds.ticker24h).toMatchObject({ state: "connecting", source: "binance" });
    expect(h.ws).toEqual({ state: "connecting", attempt: 0 });
  });
});
