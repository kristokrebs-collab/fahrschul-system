/**
 * Live top-trader / retail series for the Einstiegs-Check (decision 5 / 11 / 14): the 5-min twins as one API with an
 * honest status, and `provider.fetchRatios` (budget-aware pages on the ratio feeds' Binance route).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildFeedSpecs } from "@/market/feeds";
import { initialHealth } from "@/market/health";
import type { FeedSnapshot } from "@/market/mapping";
import { deriveTraderSeries, traderHealthSignature, traderSeriesKey, TRADER_SERIES_FRESH_MS, TRADER_SERIES_STEP_MS } from "@/market/traders";
import type { MarketProvider } from "@/market/provider";
import type { FeedHealth, ProviderHealth, RatioPoint, Source, Stamped } from "@/market/types";
import { MIN, SEC, T0, flush, requests, runFor, setup } from "./market.netHarness";

const NOW = Date.UTC(2026, 9, 8, 12, 0);
const STEP = 5 * MIN;

function pts(n: number, newest: number, longPct = (i: number) => 60 + i * 0.1): RatioPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const l = longPct(i);
    return { time: newest - (n - 1 - i) * STEP, longPct: l, shortPct: 100 - l, ratio: l / (100 - l) };
  });
}
const stamped = (data: RatioPoint[], source: Source = "binance"): Stamped<RatioPoint[]> => ({ data, asOf: data.at(-1)?.time ?? 0, receivedAt: NOW, source, comparable: true });

function health(patch: Partial<Record<"topPositionRatio5m" | "topAccountRatio5m" | "globalAccountRatio5m", Partial<FeedHealth>>> = {}, extra: Partial<ProviderHealth> = {}): ProviderHealth {
  const h = initialHealth(buildFeedSpecs("1h"));
  for (const f of ["topPositionRatio5m", "topAccountRatio5m", "globalAccountRatio5m"] as const) {
    h.feeds[f] = { ...h.feeds[f], state: "live", source: "binance", consecutiveFailures: 0, lastDataAt: NOW - MIN, nextRefreshAt: NOW + 3 * MIN, ...patch[f] };
  }
  return { ...h, online: true, ...extra };
}

function feeds(newest = NOW - 2 * MIN, source: Source = "binance"): FeedSnapshot {
  return {
    topPositionRatio5m: stamped(pts(36, newest, (i) => 66 + i * 0.01), source),
    topAccountRatio5m: stamped(pts(36, newest, (i) => 65 + i * 0.01), source),
    globalAccountRatio5m: stamped(pts(36, newest, (i) => 55 - i * 0.05), source),
  };
}

describe("deriveTraderSeries", () => {
  it("live: three Binance 5-min series, newest point, next poll, route", () => {
    const s = deriveTraderSeries(feeds(), health(), NOW);
    expect(s.status).toBe("live");
    expect(s.detail).toBeUndefined();
    expect(s.step).toBe(TRADER_SERIES_STEP_MS);
    expect(s.position).toHaveLength(36);
    expect(s.retail.at(-1)!.longPct).toBeCloseTo(55 - 35 * 0.05, 6); // retail long share falling → "Retail rot"
    expect(s.asOf).toBe(NOW - 2 * MIN);
    expect(s.nextAt).toBe(NOW + 3 * MIN);
    expect(s.source).toBe("binance");
  });

  it("through the EU proxy the route says so and the data still counts", () => {
    const h = health({ topPositionRatio5m: { source: "proxy" }, topAccountRatio5m: { source: "proxy" }, globalAccountRatio5m: { source: "proxy" } });
    const s = deriveTraderSeries(feeds(NOW - 2 * MIN, "proxy"), h, NOW);
    expect(s.status).toBe("live");
    expect(s.source).toBe("proxy");
  });

  it("stale: the newest point is older than two steps + 5 min (judged on the Binance clock)", () => {
    const old = NOW - TRADER_SERIES_FRESH_MS - MIN;
    expect(deriveTraderSeries(feeds(old), health(), NOW).status).toBe("stale");
    // a device clock 20 min ahead would call fresh data stale — the caller passes serverNow(), not Date.now()
    expect(deriveTraderSeries(feeds(), health(), NOW).status).toBe("live");
  });

  it("retrying: a failing poll names the cause and keeps the last points", () => {
    const h = health({ globalAccountRatio5m: { consecutiveFailures: 2, reason: "network", nextRefreshAt: NOW + 30 * SEC } });
    const s = deriveTraderSeries(feeds(NOW - 16 * MIN), h, NOW);
    expect(s.status).toBe("retrying");
    expect(s.detail).toBe("Binance antwortet nicht (Netzwerk/CORS-Fehler)");
    expect(s.nextAt).toBe(NOW + 30 * SEC);
    expect(s.retail).toHaveLength(36);
  });

  it("never Bybit/OKX: a non-Binance value or source yields empty series and `unsupported` / `blocked`", () => {
    const bybit = deriveTraderSeries(feeds(NOW - 2 * MIN, "bybit"), health({ globalAccountRatio5m: { source: "bybit" } }), NOW);
    expect(bybit.retail).toHaveLength(0);
    expect(bybit.status).toBe("unsupported");
    expect(bybit.detail).toBe("Nur mit Binance");
    const parked = health(
      { topPositionRatio5m: { reason: "unsupported", source: "cache" }, topAccountRatio5m: { reason: "unsupported", source: "cache" }, globalAccountRatio5m: { reason: "unsupported", source: "cache" } },
      { primary: { source: "binance", reachable: false, blocked: true } },
    );
    const blocked = deriveTraderSeries({}, parked, NOW);
    expect(blocked.status).toBe("blocked");
    expect(blocked.source).toBeNull();
  });

  it("loading before the first point, offline when the device is offline", () => {
    expect(deriveTraderSeries({}, health({ topPositionRatio5m: { state: "connecting", lastDataAt: undefined } }), NOW).status).toBe("loading");
    expect(deriveTraderSeries(feeds(), health({}, { online: false }), NOW).status).toBe("offline");
  });

  it("key and health signature change only when the data / the relevant health changes", () => {
    const a = deriveTraderSeries(feeds(), health(), NOW);
    const b = deriveTraderSeries(feeds(), health(), NOW + SEC);
    expect(traderSeriesKey(a)).toBe(traderSeriesKey(b));
    const c = deriveTraderSeries(feeds(NOW + 3 * MIN), health(), NOW + 3 * MIN);
    expect(traderSeriesKey(c)).not.toBe(traderSeriesKey(a));
    const h1 = health();
    const h2 = { ...h1, ws: { ...h1.ws, lastMessageAt: NOW } };
    expect(traderHealthSignature(h2)).toBe(traderHealthSignature(h1));
    expect(traderHealthSignature(health({ topAccountRatio5m: { consecutiveFailures: 1, reason: "timeout" } }))).not.toBe(traderHealthSignature(h1));
  });
});

describe("live provider: the 5-min series keep coming and fetchRatios stays on Binance", () => {
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

  it("a new 5-min point arrives every 5 minutes for all three series (period 1h)", async () => {
    const env = setup();
    p = env.provider;
    p.start();
    await flush();
    await runFor(env.net, 30 * SEC);
    const read = () => {
      const f: FeedSnapshot = {};
      for (const k of ["topPositionRatio5m", "topAccountRatio5m", "globalAccountRatio5m"] as const) (f as Record<string, unknown>)[k] = p!.get(k);
      return deriveTraderSeries(f, p!.getHealth(), p!.serverNow());
    };
    const first = read();
    expect(first.status).toBe("live");
    await runFor(env.net, 11 * MIN, { step: 5 * SEC });
    const later = read();
    expect(later.status).toBe("live");
    expect(later.asOf! - first.asOf!).toBeGreaterThanOrEqual(2 * STEP);
    expect(later.retail.at(-1)!.time).toBe(later.position.at(-1)!.time);
  });

  it("fetchRatios: one page at any period, direct; on the proxy while the twins use it; `unsupported` without a Binance route", async () => {
    const env = setup({ proxy: true, proxyUp: true });
    p = env.provider;
    p.start();
    await flush();
    await runFor(env.net, 10 * SEC);
    const since = Date.now();
    const page = await p.fetchRatios("globalAccountRatio", "15m", { limit: 8, endTime: Date.now() - 60 * MIN });
    expect(page.data).toHaveLength(8);
    expect(page.data.at(-1)!.time).toBeLessThanOrEqual(Date.now() - 60 * MIN);
    const direct = requests(env.net, "globalLongShortAccountRatio", since);
    expect(direct.some((u) => u.hostname === "fapi.binance.com" && u.searchParams.get("period") === "15m")).toBe(true);

    p.setPreferProxy(true);
    await flush();
    const since2 = Date.now();
    await p.fetchRatios("topPositionRatio", "1h", { limit: 3 });
    // (the switch itself re-bootstraps the moved feeds through the proxy too; ours is the limit-3 page)
    expect(requests(env.net, "/api/binance/futures/data/topLongShortPositionRatio", since2).filter((u) => u.searchParams.get("limit") === "3")).toHaveLength(1);

    // blocked without a usable proxy → no Bybit, a clear error
    p.dispatch({ type: "probe", source: "binance", ok: false, blocked: true, now: Date.now() });
    p.dispatch({ type: "probe", source: "proxy", ok: false, now: Date.now() });
    await expect(p.fetchRatios("topAccountRatio", "5m")).rejects.toMatchObject({ kind: "unsupported" });
  });
});

describe("file version (opened from disk): the Top-Trader note says why and what helps", () => {
  it("a CORS/network failure on the ratio feeds reads `Datei-Version: … Web-Link nutzen`; on the web the usual cause", async () => {
    const { topTraderFreshness, deriveTopTrader } = await import("@/market/mapping");
    const edition = await import("@/edition");
    const h = health({ topAccountRatio5m: { consecutiveFailures: 2, reason: "network", nextRefreshAt: NOW + 30 * SEC } });
    const tt = deriveTopTrader(feeds(NOW - 2 * MIN), h, "accounts");
    expect(topTraderFreshness(tt, h).lead).toBe("Binance antwortet nicht (Netzwerk/CORS)");
    const spy = vi.spyOn(edition, "isFileProtocol").mockReturnValue(true);
    try {
      expect(topTraderFreshness(tt, h).lead).toBe("Datei-Version: Browser liest Binance-Top-Trader nicht (CORS) – Web-Link nutzen");
    } finally {
      spy.mockRestore();
    }
  });
});
