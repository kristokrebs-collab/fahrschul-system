import { describe, expect, it } from "vitest";
import topPos from "../fixtures/binance-topLongShortPositionRatio.json";
import topAcc from "../fixtures/binance-topLongShortAccountRatio.json";
import globalAcc from "../fixtures/binance-globalLongShortAccountRatio.json";
import taker from "../fixtures/binance-takerlongshortRatio.json";
import klines4h from "../fixtures/binance-klines-4h.json";
import klines1w from "../fixtures/binance-klines-1w.json";
import { mapRatio, mapTaker, mapKline, ratioSchema, takerSchema, klinesSchema } from "@/market/sources/binance";
import { deltaSeries, deltaCandles, topTraderLongPct, takerDelta, fundingLine, fundingPct, lastPrice, deriveMarket, deriveTopTrader, virtualReading, openInterestChange24h, triggerDistances, legacyStatus, topTraderFreshness, freshnessText, mmss, topTraderHealthSignature } from "@/market/mapping";
import { closedBar, rsiWilder, lastClosed4h, weeklyClose, currentBar } from "@/market/indicators";
import { statusLabel, liveAgeLabel, refreshRingProgress, fallbackBadge, STRINGS } from "@/market/statusLabel";
import { initialHealth, reduceHealth } from "@/market/health";
import { buildFeedSpecs } from "@/market/feeds";
import type { FeedHealth, ProviderHealth, RatioPoint, Stamped } from "@/market/types";

const T0 = 1790762400000;
const specs = buildFeedSpecs("1h");
const pos = mapRatio(ratioSchema.parse(topPos));
const acc = mapRatio(ratioSchema.parse(topAcc));
const glob = mapRatio(ratioSchema.parse(globalAcc));
const tk = mapTaker(takerSchema.parse(taker));
const k4 = klinesSchema.parse(klines4h).map((r) => mapKline(r, T0));
const kw = klinesSchema.parse(klines1w).map((r) => mapKline(r, T0));
const st = <T>(data: T, asOf = T0, source: Stamped<T>["source"] = "binance", comparable = true): Stamped<T> => ({ data, asOf, receivedAt: asOf + 100, source, comparable });

describe("mapping numbers", () => {
  it("Top Trader Long % follows the base setting", () => {
    expect(topTraderLongPct(acc, pos, "accounts")).toBeCloseTo(Number(topAcc.at(-1)!.longAccount) * 100, 6);
    expect(topTraderLongPct(acc, pos, "positions")).toBeCloseTo(Number(topPos.at(-1)!.longAccount) * 100, 6);
    expect(topTraderLongPct(undefined, pos, "accounts")).toBeNull();
  });
  it("delta = top-position long % − global long %, joined by timestamp", () => {
    const ds = deltaSeries(pos, glob);
    expect(ds).toHaveLength(30);
    const last = ds.at(-1)!;
    const expected = (Number(topPos.at(-1)!.longAccount) - Number(globalAcc.at(-1)!.longAccount)) * 100;
    expect(last.delta).toBeCloseTo(expected, 6);
    expect(last.time).toBe(Number(topPos.at(-1)!.timestamp));
    // unmatched timestamps are dropped
    expect(deltaSeries(pos.slice(0, 5), glob.slice(3))).toHaveLength(2);
    expect(deltaSeries(undefined, glob)).toEqual([]);
  });
  it("deltaCandles counts trailing positive deltas (fixture: exactly 3)", () => {
    const ds = deltaSeries(pos, glob).map((d) => d.delta);
    expect(ds.at(-1)).toBeGreaterThan(0);
    expect(ds.at(-4)).toBeLessThanOrEqual(0);
    expect(deltaCandles(ds)).toBe(3);
    expect(deltaCandles([1, 2, -1])).toBe(0);
    expect(deltaCandles([-1, 0.1, 0.2])).toBe(2);
    expect(deltaCandles([])).toBe(0);
  });
  it("takerDelta is buy share minus sell share in percentage points", () => {
    expect(takerDelta({ time: 1, buyVol: 150, sellVol: 50, buySellRatio: 3 })).toBeCloseTo(50);
    expect(takerDelta({ time: 1, buyVol: 100, sellVol: 100, buySellRatio: 1 })).toBe(0);
    expect(takerDelta({ time: 1, buyVol: 0, sellVol: 0, buySellRatio: 0 })).toBeNull();
    expect(takerDelta(tk.at(-1))).not.toBeNull();
  });
  it("funding line uses 4 decimals, U+2212 and a HH:mm:ss countdown", () => {
    expect(fundingPct(0.0001)).toBe("+0,0100 %");
    expect(fundingPct(-0.00025)).toBe("\u22120,0250 %");
    const line = fundingLine({ markPrice: 84212.3, indexPrice: 0, fundingRate: 0.0001, nextFundingTime: T0 + 6 * 3_600_000, time: T0 }, T0);
    expect(line!.text).toBe("Mark 84.212 · Funding +0,0100 % · nächstes Funding in 06:00:00");
    expect(fundingLine(undefined, T0)).toBeNull();
  });
  it("last price prefers aggTrade, then book mid, then ticker – never the mark price", () => {
    const mark = st({ markPrice: 1, indexPrice: 1, fundingRate: 0, nextFundingTime: 0, time: T0 });
    expect(lastPrice({ markPrice: mark })).toBeNull();
    expect(lastPrice({ markPrice: mark, ticker24h: st({ lastPrice: 3, priceChangePercent: 0, high: 0, low: 0, volume: 0, quoteVolume: 0, time: T0 }) })!.price).toBe(3);
    expect(lastPrice({ bookTop: st({ bid: 4, ask: 6, time: T0 }), ticker24h: st({ lastPrice: 3, priceChangePercent: 0, high: 0, low: 0, volume: 0, quoteVolume: 0, time: T0 }) })!.price).toBe(5);
    const lp = lastPrice({ aggTrade: st({ price: 2, qty: 1, isBuyerMaker: false, time: T0 }, T0, "bybit"), bookTop: st({ bid: 4, ask: 6, time: T0 }) })!;
    expect(lp.price).toBe(2);
    expect(lp.provenance.source).toBe("bybit");
  });
  it("OI 24h change uses the point ≥ 24 h before the last", () => {
    const hist = Array.from({ length: 30 }, (_, i) => ({ time: T0 - (29 - i) * 3_600_000, openInterest: 100 + i, openInterestValue: 0 }));
    expect(openInterestChange24h(hist)).toBeCloseTo(((129 - 105) / 105) * 100);
    expect(openInterestChange24h(hist.slice(-5))).toBeNull();
  });
  it("trigger distances", () => {
    const d = triggerDistances(85_700, { longTrigger: 85_900, shortTrigger: 84_500 })!;
    expect(d.toLong).toBeCloseTo(200 / 85_700);
    expect(d.longInReach).toBe(true);
    expect(d.shortInReach).toBe(false);
    expect(triggerDistances(null, { longTrigger: 1, shortTrigger: 1 })).toBeNull();
  });
});

describe("indicators", () => {
  it("closedBar picks the last bar whose end is ≤ now + 60 s (bundle UM)", () => {
    const cb = closedBar(k4, 14_400, T0)!;
    const running = k4.at(-1)!;
    expect(cb.bar.time).toBe(running.time - 14_400_000);
    expect(cb.t).toBe(running.time);
    expect(cb.c).toBe(k4.at(-2)!.close);
    // 30 s before the running candle closes it still does not count …
    expect(closedBar(k4, 14_400, running.time + 14_400_000 - 61_000)!.bar.time).toBe(cb.bar.time);
    // … 59 s before it does (now + 60 s tolerance)
    expect(closedBar(k4, 14_400, running.time + 14_400_000 - 59_000)!.bar.time).toBe(running.time);
    expect(closedBar([], 14_400, T0)).toBeNull();
    expect(lastClosed4h(k4, T0)!.t).toBe(running.time);
    expect(weeklyClose(kw, T0)!.bar.time).toBe(kw.at(-2)!.time);
    expect(currentBar(k4, 14_400, T0)).toBe(running);
  });
  it("Wilder RSI matches a hand-computed reference", () => {
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
    const rsi = rsiWilder(closes, 14)!;
    expect(rsi).toBeGreaterThan(50);
    expect(rsi).toBeLessThan(70);
    expect(rsiWilder(closes.slice(0, 15), 14)).toBeCloseTo(70.46, 1); // classic textbook seed value
    expect(rsiWilder([1, 2, 3], 14)).toBeNull();
    expect(rsiWilder(Array.from({ length: 20 }, (_, i) => 100 + i), 14)).toBe(100);
    expect(rsiWilder(Array.from({ length: 20 }, () => 5), 14)).toBe(50);
  });
});

describe("status labels", () => {
  const fh = (patch: Partial<FeedHealth>): FeedHealth => ({ feed: "topAccountRatio", state: "live", source: "binance", consecutiveFailures: 0, ...patch });
  const spec = specs.topAccountRatio;
  const tz = "Europe/Berlin";
  it("live → Live · {cadence} from the point cadence", () => {
    expect(statusLabel({ health: fh({}), spec })).toEqual({ tone: "live", text: "Live · stündlich", detail: undefined });
    expect(statusLabel({ health: fh({}), spec: buildFeedSpecs("5m").topAccountRatio }).text).toBe("Live · alle 5 min");
    expect(statusLabel({ health: fh({ feed: "markPrice" }), spec: specs.markPrice }).text).toBe("Live · 1 s");
    expect(statusLabel({ health: fh({ feed: "kline_1m" }), spec: specs.kline_1m }).text).toBe("Live · Echtzeit");
    expect(statusLabel({ health: fh({ feed: "ticker24h" }), spec: specs.ticker24h }).text).toBe("Live · alle 30 s");
  });
  it("stale → Zuletzt HH:mm · veraltet from asOf", () => {
    const l = statusLabel({ health: fh({ state: "stale", lastDataAt: T0 }), spec, value: st([], T0), timeZone: tz });
    expect(l).toEqual({ tone: "warn", text: "Zuletzt 12:00 · veraltet", detail: undefined });
  });
  it("fallback → {Source}-Daten · cadence with detail", () => {
    const l = statusLabel({ health: fh({ state: "fallback", source: "bybit", feed: "globalAccountRatio" }), spec: specs.globalAccountRatio });
    expect(l).toEqual({ tone: "warn", text: "Bybit-Daten · stündlich", detail: "Binance nicht erreichbar (451/CORS)" });
    expect(statusLabel({ health: fh({ state: "fallback", source: "bybit", feed: "markPrice" }), spec: specs.markPrice }).text).toBe("Bybit-Daten · alle 5 s");
    expect(statusLabel({ health: fh({ state: "fallback", source: "binance", feed: "markPrice", reason: "ws_closed" }), spec: specs.markPrice })).toEqual({ tone: "warn", text: "Binance-Daten · alle 10 s", detail: "WebSocket getrennt, REST-Abfrage" });
    expect(fallbackBadge("bybit")).toBe("Ersatzquelle Bybit");
  });
  it("offline / connecting / bad_symbol / unsupported", () => {
    expect(statusLabel({ health: fh({ state: "offline", lastDataAt: T0 }), spec, timeZone: tz })).toEqual({ tone: "error", text: "Offline · Stand 12:00", detail: undefined });
    expect(statusLabel({ health: fh({ state: "offline" }), spec }).text).toBe("Offline");
    expect(statusLabel({ health: fh({ state: "connecting" }), spec })).toEqual({ tone: "muted", text: "Verbinde …", detail: undefined });
    // first paint from the cache snapshot: never blank
    expect(statusLabel({ health: fh({ state: "connecting" }), spec, value: st([], T0), timeZone: tz }).text).toBe("Zuletzt 12:00 · veraltet");
    expect(statusLabel({ health: fh({ reason: "bad_symbol" }), spec }).text).toBe("Kein Live-Kurs");
    expect(statusLabel({ health: fh({ state: "fallback", source: "bybit", reason: "unsupported" }), spec })).toEqual({ tone: "muted", text: "Nur mit Binance", detail: "Bybit: alle Konten, keine Top-Trader-Kohorte." });
  });
  it("carries the bad_period detail as tooltip", () => {
    const l = statusLabel({ health: fh({ reason: "bad_period", detail: "Timeframe 1w wird von Binance nicht unterstützt, Ratios nutzen 1h" }), spec });
    expect(l.text).toBe("Live · stündlich");
    expect(l.detail).toContain("Ratios nutzen 1h");
  });
  it("LivePill age label rules", () => {
    expect(liveAgeLabel(T0, T0 + 1400)).toEqual({ text: "Live", warn: false, ageSec: 1 });
    expect(liveAgeLabel(T0, T0 + 1500).text).toBe("Live · vor 2s");
    expect(liveAgeLabel(T0, T0 + 900).text).toBe("Live");
    expect(liveAgeLabel(T0, T0 + 12_000).text).toBe("Live · vor 12s");
    expect(liveAgeLabel(T0, T0 + 65_000).text).toBe("vor 1 min");
    expect(liveAgeLabel(T0, T0 + 130_000)).toMatchObject({ text: "vor 2 min", warn: true });
    expect(liveAgeLabel(T0, T0, true).text).toBe(STRINGS.refreshing);
    expect(liveAgeLabel(undefined, T0).text).toBe("Live");
    expect(refreshRingProgress(T0 + 15_000, T0)).toBeCloseTo(0.5);
    expect(refreshRingProgress(undefined, T0)).toBe(0);
  });
});

describe("derived views", () => {
  const live = (h: ProviderHealth, feeds: Parameters<typeof reduceHealth>[1][]) => feeds.reduce((a, ev) => reduceHealth(a, ev, specs), h);
  const health = live(initialHealth(specs), [
    { type: "ws_message", feeds: ["aggTrade", "markPrice", "kline_4h", "kline_1w"], asOf: T0, now: T0 },
    { type: "rest_ok", feed: "ticker24h", source: "binance", asOf: T0, now: T0, nextRefreshAt: T0 + 30_000 },
    { type: "rest_ok", feed: "topAccountRatio", source: "binance", asOf: T0, now: T0 },
    { type: "rest_ok", feed: "topPositionRatio", source: "binance", asOf: T0, now: T0 },
    { type: "rest_ok", feed: "globalAccountRatio", source: "binance", asOf: T0, now: T0 },
  ]);
  const snap = {
    aggTrade: st({ price: 84206.1, qty: 0.1, isBuyerMaker: false, time: T0 }),
    markPrice: st({ markPrice: 84212.3, indexPrice: 84198, fundingRate: 0.0001, nextFundingTime: T0 + 6 * 3_600_000, time: T0 }),
    ticker24h: st({ lastPrice: 84205.9, priceChangePercent: -1.316, high: 0, low: 0, volume: 0, quoteVolume: 0, time: T0 }),
    kline_4h: st(k4),
    kline_1w: st(kw),
    topAccountRatio: st(acc),
    topPositionRatio: st(pos),
    globalAccountRatio: st(glob),
    takerRatio: st(tk),
  };

  it("deriveMarket maps the legacy fields", () => {
    const m = deriveMarket(snap, health, { now: T0 + 500 });
    expect(m.status).toBe("live");
    expect(m.price).toBe(84206);
    expect(m.change).toBeCloseTo(-1.316);
    expect(m.close4h).toBe(k4.at(-2)!.close);
    expect(m.close4hAt).toBe(k4.at(-1)!.time);
    expect(m.closeW).toBe(kw.at(-2)!.close);
    expect(m.rsiW).not.toBeNull();
    expect(m.live4hClose).toBe(k4.at(-1)!.close);
    expect(m.fundingLine!.text).toContain("Mark 84.212 · Funding +0,0100 %");
    expect(m.updatedAt).toBe(T0 + 100);
    expect(m.nextTickerRefreshAt).toBe(T0 + 30_000);
    expect(m.taker).not.toBeNull();
    expect(m.sourceBadge).toBeUndefined();
    expect(deriveMarket(snap, health, { now: T0, rsiWOverride: 62.09 }).rsiW).toBe(62.09);
  });
  it("legacy status: stale price > 120 s → error with Zuletzt message; Bybit price → live with badge", () => {
    const stale = legacyStatus(health, { provenance: { source: "binance", comparable: true, asOf: T0, receivedAt: T0 } }, T0 + 121_000);
    expect(stale.status).toBe("error");
    expect(stale.message).toMatch(/^Zuletzt \d\d:\d\d · veraltet$/);
    const bybit = legacyStatus(health, { provenance: { source: "bybit", comparable: true, asOf: T0, receivedAt: T0 } }, T0 + 1000);
    expect(bybit).toEqual({ status: "live", sourceBadge: "Ersatzquelle Bybit", message: "Binance nicht erreichbar (451/CORS)" });
    expect(legacyStatus(initialHealth(specs), null, T0)).toEqual({ status: "connecting", message: undefined });
    const off = reduceHealth(health, { type: "online", online: false, now: T0 }, specs);
    expect(legacyStatus(off, null, T0).status).toBe("error");
    expect(legacyStatus(off, null, T0).message).toMatch(/^Offline · Stand \d\d:\d\d$/);
    expect(legacyStatus(reduceHealth(initialHealth(specs), { type: "online", online: false, now: T0 }, specs), null, T0).message).toBe("Offline");
    const bad = reduceHealth(health, { type: "bad_symbol", now: T0 }, specs);
    expect(legacyStatus(bad, null, T0)).toEqual({ status: "error", message: "Kein Live-Kurs" });
  });
  it("deriveTopTrader + virtual reading", () => {
    const tt = deriveTopTrader(snap, health, "accounts");
    expect(tt.longPct).toBeCloseTo(Number(topAcc.at(-1)!.longAccount) * 100, 6);
    expect(tt.deltaCandles).toBe(3);
    expect(tt.delta).toBeGreaterThan(0);
    expect(tt.sparkline).toHaveLength(20);
    expect(tt.onlyBinance).toBe(false);
    expect(tt.liveReadingOk).toBe(true);
    const vr = virtualReading(tt, { id: "r1", structure: true, rsi: false })!;
    expect(vr).toMatchObject({ id: "r1", longPct: tt.longPct, delta: tt.delta, deltaCandles: 3, structure: true, rsi: false, note: "Live von Binance" });
    expect(vr.at).toBe(new Date(T0).toISOString());
    // Bybit fallback: no top-trader series → no virtual reading, `Nur mit Binance`
    const hb = live(health, [{ type: "unsupported", feed: "topAccountRatio", source: "bybit", now: T0 }, { type: "unsupported", feed: "topPositionRatio", source: "bybit", now: T0 }]);
    const ttb = deriveTopTrader(snap, hb, "accounts");
    expect(ttb.onlyBinance).toBe(true);
    expect(ttb.liveReadingOk).toBe(false);
    expect(virtualReading(ttb, undefined)).toBeNull();
    expect(deriveTopTrader(snap, health, "positions").longPct).toBeCloseTo(Number(topPos.at(-1)!.longAccount) * 100, 6);
  });

  // 5-min twins: the last chosen-period point (T0) + one more 5-min snapshot at T0 + 5 min
  const five = (series: RatioPoint[], longPct: number): RatioPoint[] => [...series.slice(-3), { time: T0 + 300_000, longPct, shortPct: 100 - longPct, ratio: longPct / (100 - longPct) }];
  const liveHealth = live(health, [
    { type: "rest_ok", feed: "topAccountRatio5m", source: "binance", asOf: T0 + 300_000, now: T0 + 360_000, nextRefreshAt: T0 + 660_000 },
    { type: "rest_ok", feed: "topPositionRatio5m", source: "binance", asOf: T0 + 300_000, now: T0 + 360_000 },
    { type: "rest_ok", feed: "globalAccountRatio5m", source: "binance", asOf: T0 + 300_000, now: T0 + 360_000 },
    { type: "schedule", feed: "topAccountRatio5m", nextRefreshAt: T0 + 660_000 },
  ]);
  const liveSnap = { ...snap, topAccountRatio5m: st(five(acc, 61.5), T0 + 300_000), topPositionRatio5m: st(five(pos, 58), T0 + 300_000), globalAccountRatio5m: st(five(glob, 50), T0 + 300_000) };

  it("Long % and Delta show the newest Binance snapshot (5-min twin); Δ+ Kerzen and sparkline stay on the chosen period", () => {
    const tt = deriveTopTrader(liveSnap, liveHealth, "accounts");
    expect(tt).toMatchObject({ longPct: 61.5, delta: 8, asOf: T0 + 300_000, fromLive: true, readingFeed: "topAccountRatio5m", liveReadingOk: true, deltaCandles: 3 });
    expect(tt.longPctPositions).toBe(58);
    expect(tt.globalLongPct).toBe(50);
    expect(tt.sparkline).toEqual(acc.slice(-20).map((p) => p.longPct));
    expect(virtualReading(tt, undefined)).toMatchObject({ longPct: 61.5, delta: 8, deltaCandles: 3, note: "Live von Binance · 5-min-Wert" });
    // an older 5-min point never overrides a newer chosen-period point
    const old = { ...snap, topAccountRatio5m: st(acc.slice(-5, -2), T0 - 600_000) };
    expect(deriveTopTrader(old, liveHealth, "accounts")).toMatchObject({ fromLive: false, readingFeed: "topAccountRatio" });
  });

  it("the live reading needs Binance data per health AND per value (no Bybit cohort mixed into the delta)", () => {
    // retail ratio served from Bybit (another population) → no virtual reading, even if its state ticks to `stale`
    const hb = live(liveHealth, [{ type: "rest_ok", feed: "globalAccountRatio", source: "bybit", asOf: T0, now: T0 }, { type: "tick", now: T0 + 3 * 3_600_000 }]);
    const sb = { ...liveSnap, globalAccountRatio: st(glob, T0, "bybit", false) };
    expect(hb.feeds.globalAccountRatio.source).toBe("bybit");
    expect(deriveTopTrader(sb, hb).liveReadingOk).toBe(false);
    // the EU proxy is Binance's own data: fine
    const hp = live(liveHealth, [{ type: "rest_ok", feed: "globalAccountRatio", source: "proxy", asOf: T0, now: T0 }]);
    const sp = { ...liveSnap, globalAccountRatio: st(glob, T0, "proxy") };
    expect(hp.feeds.globalAccountRatio.state).toBe("fallback");
    expect(deriveTopTrader(sp, hp).liveReadingOk).toBe(true);
  });

  it("freshness distinguishes `Binance liefert alle 5 min neu` from `antwortet nicht`, `blockiert`, proxy and offline", () => {
    const tt = deriveTopTrader(liveSnap, liveHealth, "accounts");
    const f = topTraderFreshness(tt, liveHealth, 3_600_000);
    expect(f).toMatchObject({ kind: "live", tone: "live", lead: "Binance liefert alle 5 min neu", standAt: T0 + 300_000, nextAt: T0 + 660_000, nextLabel: "nächste Daten" });
    expect(freshnessText(f, T0 + 468_000, "UTC")).toBe("Binance liefert alle 5 min neu · Stand 10:05 · nächste Daten in 3:12");
    expect(freshnessText(f, T0 + 700_000, "UTC")).toBe("Binance liefert alle 5 min neu · Stand 10:05 · lädt …");
    // chosen period only (no twins yet): the cadence of the chosen period
    expect(topTraderFreshness(deriveTopTrader(snap, health), health, 3_600_000).lead).toBe("Binance liefert stündlich neu");
    // failing on Binance: retry countdown with the cause
    const hr = live(liveHealth, [
      { type: "rest_fail", feed: "topAccountRatio5m", source: "binance", kind: "network", now: T0 + 700_000, detail: "Netzwerk/CORS: Failed to fetch" },
      { type: "schedule", feed: "topAccountRatio5m", nextRefreshAt: T0 + 715_000 },
    ]);
    const fr = topTraderFreshness(deriveTopTrader(liveSnap, hr), hr, 3_600_000);
    expect(fr).toMatchObject({ kind: "retrying", tone: "warn", lead: "Binance antwortet nicht (Netzwerk/CORS)", detail: "Netzwerk/CORS: Failed to fetch" });
    expect(freshnessText(fr, T0 + 702_000, "UTC")).toBe("Binance antwortet nicht (Netzwerk/CORS) · Stand 10:05 · neuer Versuch in 0:13");
    expect(freshnessText(fr, T0 + 716_000, "UTC")).toBe("Binance antwortet nicht (Netzwerk/CORS) · Stand 10:05 · neuer Versuch läuft …");
    // blocked: next re-probe
    const hbk = live(liveHealth, [{ type: "probe", source: "binance", ok: false, blocked: true, now: T0 + 720_000 }, { type: "probe_scheduled", at: T0 + 1_020_000, now: T0 + 720_000 }]);
    const fb = topTraderFreshness(deriveTopTrader(liveSnap, hbk), hbk, 3_600_000);
    expect(fb).toMatchObject({ kind: "blocked", lead: "Binance blockiert (Region)", nextAt: T0 + 1_020_000, nextLabel: "neuer Versuch" });
    // through the proxy
    const hp = live(liveHealth, [{ type: "probe", source: "proxy", ok: true, now: T0 }, { type: "move", feed: "topAccountRatio5m", source: "proxy", now: T0 }, { type: "rest_ok", feed: "topAccountRatio5m", source: "proxy", asOf: T0 + 300_000, now: T0 + 360_000 }]);
    const sp = { ...liveSnap, topAccountRatio5m: { ...liveSnap.topAccountRatio5m, source: "proxy" as const } };
    expect(topTraderFreshness(deriveTopTrader(sp, hp), hp, 3_600_000)).toMatchObject({ kind: "proxy", lead: "Binance über EU-Proxy · alle 5 min neu" });
    // offline
    const ho = live(liveHealth, [{ type: "online", online: false, now: T0 }]);
    expect(topTraderFreshness(deriveTopTrader(liveSnap, ho), ho).kind).toBe("offline");
    expect(mmss(0)).toBe("0:00");
    expect(mmss(61_001)).toBe("1:02");
  });

  it("the health signature moves only with what the card reads", () => {
    const a = topTraderHealthSignature(liveHealth);
    expect(topTraderHealthSignature(live(liveHealth, [{ type: "ws_message", feeds: ["aggTrade"], asOf: T0 + 9000, now: T0 + 9000 }]))).toBe(a);
    expect(topTraderHealthSignature(live(liveHealth, [{ type: "schedule", feed: "topAccountRatio5m", nextRefreshAt: T0 + 999_000 }]))).not.toBe(a);
  });
});
