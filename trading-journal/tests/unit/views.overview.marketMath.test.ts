import { describe, expect, it } from "vitest";
import { evaluateTrigger } from "@/domain/trigger";
import type { MarketLevels } from "@/domain/types";
import { buildFeedSpecs, initialHealth, PRICE_POLL_FRESH_MS, type Candle, type FeedSnapshot, type ProviderHealth, type Stamped } from "@/market";
import {
  buyShare,
  change24h,
  createFlowWindow,
  distanceLabel,
  FLOW_PEAK_DECAY,
  flowWindowStep,
  formingScenarioKey,
  nextDeadline,
  orFallback,
  panelHealthKey,
  priceDecimals,
  priceTick,
  STALE_PRICE_MS,
  topTraderHealthKey,
  triggerFlagsKey,
  triggerProximity,
  viewDeadlines,
} from "@/views/overview/marketMath";

const LEVELS = { longTrigger: 85_900, longStop: 85_300, shortTrigger: 84_500, lowerHigh: 82_829, rsiWeekly: 62.09, invalidation: 75_500, zoneLow: 81_500, zoneHigh: 82_200 } as MarketLevels;

function stamp<T>(data: T, asOf: number): Stamped<T> {
  return { data, asOf, receivedAt: asOf, source: "binance", comparable: true };
}

function bar(time: number, close: number, closed: boolean): Candle {
  return { time, open: close, high: close, low: close, close, volume: 1, closed };
}

describe("market panel math", () => {
  it("picks the live price precision by magnitude", () => {
    expect(priceDecimals(86_100)).toBe(1);
    expect(priceDecimals(null)).toBe(1);
    expect(priceDecimals(3_012.5)).toBe(1);
    expect(priceDecimals(145.2)).toBe(2);
    expect(priceDecimals(2.4)).toBe(3);
    expect(priceDecimals(0.081)).toBe(5);
  });

  it("derives the live 24 h change from price and reference open, NaN while unknown", () => {
    const open = 86_100 / 1.012;
    expect(change24h(86_100, open)).toBeCloseTo(1.2, 10);
    expect(change24h(86_100, 0)).toBeNaN();
    expect(change24h(0, open)).toBeNaN();
    expect(orFallback(0, 42)).toBe(42);
    expect(orFallback(7, 42)).toBe(7);
    expect(orFallback(0, null)).toBe(0);
  });

  it("turns accumulator deltas into signed, peak-normalised meter columns", () => {
    const w = createFlowWindow(10, 10);
    // all buying: full positive column at the first burst
    expect(flowWindowStep(w, 12, 10)).toBe(1);
    // nothing traded in the next window
    expect(flowWindowStep(w, 12, 10)).toBe(0);
    // a quarter of the (decayed) peak, all selling → −sqrt(0.5 / (2·decay²)) compressed
    const v = flowWindowStep(w, 12, 10.5);
    const peak = 2 * FLOW_PEAK_DECAY * FLOW_PEAK_DECAY;
    expect(v).toBeCloseTo(-Math.sqrt(0.5 / peak), 10);
    // balanced flow nets to zero even with volume
    expect(flowWindowStep(w, 13, 11.5)).toBe(0);
    // a symbol switch resets the accumulators: the window reads empty, no negative spike
    expect(flowWindowStep(w, 0, 0)).toBe(0);
    expect(w.peak).toBe(0);
    expect(flowWindowStep(w, 0.5, 0)).toBe(1);
  });

  it("buy share from the decayed imbalance", () => {
    expect(buyShare(0, 0)).toBeNaN();
    expect(buyShare(0.2, 5)).toBeCloseTo(0.6, 10);
    expect(buyShare(-1, 5)).toBe(0);
    expect(buyShare(1, 5)).toBe(1);
  });

  it("builds the same distance labels as the trigger engine, plus a proximity in 0..1", () => {
    const price = 85_700;
    const t = evaluateTrigger({ price, levels: LEVELS });
    expect(distanceLabel("long", LEVELS.longTrigger, price)).toBe(t.distance.longLabel);
    expect(distanceLabel("short", LEVELS.shortTrigger, price)).toBe(t.distance.shortLabel);
    expect(distanceLabel("long", LEVELS.longTrigger, 0)).toBe("Long-Trigger in –");
    expect(triggerProximity("long", LEVELS.longTrigger, LEVELS.longTrigger)).toBe(1);
    expect(triggerProximity("long", LEVELS.longTrigger, 80_000)).toBe(0);
    const near = triggerProximity("long", LEVELS.longTrigger, 85_471);
    expect(near).toBeGreaterThan(0.7);
    expect(near).toBeLessThan(0.8);
  });

  it("flags key flips exactly when a price-dependent flag of evaluateTrigger flips", () => {
    const flags = (p: number, key: "long" | "range" | null = "range") => {
      const t = evaluateTrigger({ price: p, close4h: key === "long" ? 86_200 : 85_000, levels: LEVELS });
      return `${+t.distance.longInReach}${+t.distance.shortInReach}${+t.zone.inZone}${+t.longInvalidated}`;
    };
    for (const p of [86_500, 85_880, 85_000, 84_510, 82_000, 85_200]) {
      expect(triggerFlagsKey(p, LEVELS, "range")).toBe(flags(p));
      expect(triggerFlagsKey(p, LEVELS, "long")).toBe(flags(p, "long"));
    }
    expect(triggerFlagsKey(null, LEVELS, null)).toBe("none");
    // ticks inside one class keep the key
    expect(triggerFlagsKey(86_400, LEVELS, "range")).toBe(triggerFlagsKey(86_401.5, LEVELS, "range"));
  });

  it("classifies the forming bar for the live preview, ignoring closed bars", () => {
    expect(formingScenarioKey(undefined, LEVELS)).toBe("");
    expect(formingScenarioKey([bar(0, 86_000, false)], LEVELS)).toBe("long");
    expect(formingScenarioKey([bar(0, 85_000, false)], LEVELS)).toBe("range");
    expect(formingScenarioKey([bar(0, 86_000, true)], LEVELS)).toBe("");
  });
});

describe("change keys", () => {
  const base = (): ProviderHealth => {
    const h = initialHealth(buildFeedSpecs("1h"));
    h.feeds.aggTrade = { ...h.feeds.aggTrade, state: "live", lastDataAt: 1_000 };
    h.feeds.markPrice = { ...h.feeds.markPrice, state: "live", lastDataAt: 1_000 };
    h.ws = { ...h.ws, state: "live", connectedAt: 500, lastMessageAt: 1_000 };
    return h;
  };

  it("panel health key ignores the per-second lastDataAt refresh but sees state, reason and ring changes", () => {
    const a = base();
    const b = base();
    b.feeds.aggTrade = { ...b.feeds.aggTrade, lastDataAt: 9_000 };
    b.feeds.markPrice = { ...b.feeds.markPrice, lastDataAt: 9_500 };
    b.ws = { ...b.ws, lastMessageAt: 9_500 };
    expect(panelHealthKey(b)).toBe(panelHealthKey(a));
    const stale = base();
    stale.feeds.aggTrade = { ...stale.feeds.aggTrade, state: "stale" };
    expect(panelHealthKey(stale)).not.toBe(panelHealthKey(a));
    const ring = base();
    ring.feeds.ticker24h = { ...ring.feeds.ticker24h, nextRefreshAt: 30_000 };
    expect(panelHealthKey(ring)).not.toBe(panelHealthKey(a));
    const offline = base();
    offline.online = false;
    expect(panelHealthKey(offline)).not.toBe(panelHealthKey(a));
    // the socket stops delivering (silent → stale) while the price feeds still read live: the pill must switch
    const silent = base();
    silent.ws = { ...silent.ws, state: "stale", lastMessageAt: 1_000 };
    expect(panelHealthKey(silent)).not.toBe(panelHealthKey(a));
  });

  it("top-trader health key follows the selected base", () => {
    const a = base();
    const b = base();
    b.feeds.topAccountRatio = { ...b.feeds.topAccountRatio, state: "live" };
    expect(topTraderHealthKey(b, "accounts")).not.toBe(topTraderHealthKey(a, "accounts"));
    expect(topTraderHealthKey(b, "positions")).toBe(topTraderHealthKey(a, "positions"));
  });

  it("deadlines cover the polled price's freshness, price staleness and the 4 h / weekly closes (one minute early)", () => {
    const H4 = 14_400_000;
    const W1 = 7 * 86_400_000;
    const feeds: FeedSnapshot = {
      aggTrade: { ...stamp({ price: 86_100, qty: 1, isBuyerMaker: false, time: 5_000 }, 5_000), receivedAt: 5_200 },
      kline_4h: stamp([bar(0, 1, true), bar(H4, 1, false)], 5_000),
      kline_1w: stamp([bar(0, 1, false)], 5_000),
    };
    const d = viewDeadlines(feeds);
    // `Kurs per Abfrage` → `Verbinde …` exactly 15 s after the (device-clock) arrival of the shown price
    expect(PRICE_POLL_FRESH_MS).toBe(15_000);
    expect(d).toEqual([5_200 + PRICE_POLL_FRESH_MS + 1, 5_000 + STALE_PRICE_MS + 1, 2 * H4 - 60_000, 2 * H4, W1 - 60_000]);
    expect(nextDeadline(d, 0)).toBe(5_200 + PRICE_POLL_FRESH_MS + 1);
    expect(nextDeadline(d, 5_200 + PRICE_POLL_FRESH_MS + 1)).toBe(5_000 + STALE_PRICE_MS + 1);
    expect(nextDeadline(d, 2 * H4 - 60_000)).toBe(2 * H4);
    expect(nextDeadline(d, W1)).toBeNull();
    expect(viewDeadlines({})).toEqual([]);
  });
});

describe("price flash filter", () => {
  it("anchors the first price, ignores ping-pong below the threshold and resets on unknown prices", () => {
    let a = 0;
    const step = (p: number) => {
      const t = priceTick(a, p, 0.5);
      a = t.anchor;
      return t.dir;
    };
    expect(step(86_100)).toBe(0);
    expect(step(86_100.1)).toBe(0);
    expect(step(86_100)).toBe(0);
    expect(step(86_100.6)).toBe(1);
    expect(step(86_100.2)).toBe(0);
    expect(step(86_099.9)).toBe(-1);
    // symbol switch: reset, the next symbol's first price only anchors
    expect(step(0)).toBe(0);
    expect(step(3_000)).toBe(0);
    expect(step(3_001)).toBe(1);
  });
});
