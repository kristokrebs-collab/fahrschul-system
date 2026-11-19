/**
 * "Top-Trader netto (Binance)": the net of the big accounts, the dead band, the last sign change that stuck, prices joined
 * to the points, the German texts, the one explained row in "Warum handeln oder auslassen?" (it never moves the decision)
 * and the live derivation with its honest empty states. Pure – no network (fapi.binance.com answers 451 from the sandbox).
 */
import { describe, expect, it } from "vitest";
import { explainDecision, type WhyInput } from "@/domain/decision";
import {
  buildTraderNet,
  durationText,
  netDetail,
  netHeadline,
  netOf,
  netText,
  netWhy,
  priceAt,
  sinceText,
  TRADER_NET_MIN_POINTS,
  type NetPriceBar,
  type NetRatioPoint,
} from "@/domain/signals";
import { buildFeedSpecs, deriveLiveTraderNet, initialHealth, type Candle, type ProviderHealth, type RatioPoint, type Stamped } from "@/market";

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 1);

const pt = (i: number, net: number): NetRatioPoint => ({ time: T0 + i * H, longPct: 50 + net / 2, shortPct: 50 - net / 2 });
const series = (nets: number[]): NetRatioPoint[] => nets.map((n, i) => pt(i, n));
const bars = (n: number, price = (i: number) => 70_000 + i * 10): NetPriceBar[] => Array.from({ length: n }, (_, i) => ({ time: T0 + i * H, open: price(i), close: price(i) + 5 }));
const NOW = T0 + 40 * H;

describe("netOf", () => {
  it("is long % minus short % in percentage points", () => {
    expect(netOf({ time: 0, longPct: 54.1, shortPct: 45.9 })).toBeCloseTo(8.2, 10);
    expect(netOf({ time: 0, longPct: 40, shortPct: 60 })).toBeCloseTo(-20, 10);
  });
  it("falls back to 2 · long − 100 when the short share is missing or does not add up", () => {
    expect(netOf({ time: 0, longPct: 60 })).toBe(20);
    expect(netOf({ time: 0, longPct: 60, shortPct: 10 })).toBe(20);
  });
});

describe("priceAt", () => {
  const b = bars(5);
  it("returns the open of the covering candle and null outside the covered range", () => {
    expect(priceAt(b, T0 + 2 * H, H)).toBe(70_020);
    expect(priceAt(b, T0 + 2 * H + 30 * 60_000, H)).toBe(70_020);
    expect(priceAt(b, T0 - 1, H)).toBeNull();
    expect(priceAt(b, T0 + 5 * H, H)).toBeNull();
    expect(priceAt([], T0, H)).toBeNull();
  });
});

describe("buildTraderNet: empty and short histories", () => {
  it("no series -> status none, nothing invented", () => {
    for (const s of [null, undefined, []]) {
      const v = buildTraderNet(s, [], NOW, H);
      expect(v).toMatchObject({ status: "none", points: [], count: 0, last: null, side: null, flip: null });
      expect(netHeadline(v)).toBe("keine Daten");
      expect(netWhy(v)).toBeNull();
    }
  });
  it(`fewer than ${TRADER_NET_MIN_POINTS} points -> status short (zu wenig Verlauf), no curve, no flip`, () => {
    const v = buildTraderNet(series([5, 5, -5, -5]), bars(10), NOW, H);
    expect(v.status).toBe("short");
    expect(v.points).toEqual([]);
    expect(v.count).toBe(4);
    expect(v.flip).toBeNull();
    expect(netHeadline(v)).toBe("zu wenig Verlauf");
    expect(netDetail(v)).toContain("Erst 4 Punkte geladen");
    expect(netWhy(v)).toBeNull();
  });
  it("drops non-finite and out-of-range points and keeps the last of a duplicate time", () => {
    const good = series(Array.from({ length: 12 }, () => 10));
    const bad: NetRatioPoint[] = [{ time: NaN, longPct: 50 }, { time: T0, longPct: 120 }, { time: T0 + 99 * H, longPct: Number.NaN }, { time: T0, longPct: 70, shortPct: 30 }];
    const v = buildTraderNet([...good, ...bad], [], NOW, H);
    expect(v.status).toBe("ok");
    expect(v.count).toBe(12);
    expect(v.points[0]!.net).toBeCloseTo(40, 10); // the later duplicate of T0 wins
  });
});

describe("buildTraderNet: the last sign change that stuck", () => {
  // 8 points net long (+12), the crossing between hour 7 (+4) and hour 8 (-4), then 12 points net short (-10)
  const nets = [12, 12, 12, 12, 12, 12, 12, 4, -4, -10, -10, -10, -10, -10, -10, -10, -10, -10, -10, -10];
  const v = buildTraderNet(series(nets), bars(30), NOW, H);

  it("finds the flip to Short at the interpolated zero crossing", () => {
    expect(v.status).toBe("ok");
    expect(v.side).toBe("short");
    expect(v.flip).not.toBeNull();
    expect(v.flip!.from).toBe("long");
    expect(v.flip!.to).toBe("short");
    // between hour 7 (+4) and hour 8 (-4): exactly half way
    expect(v.flip!.at).toBe(T0 + 7.5 * H);
    expect(v.flip!.index).toBe(8);
    expect(v.flip!.ageMs).toBe(NOW - (T0 + 7.5 * H));
    expect(v.changes).toBe(1);
  });
  it("reads the price at the crossing (covering candle's open) and the change to the newest close", () => {
    // 07:30 is covered by the candle of hour 7 (open 70 070); the newest close is 70 295 (candle 29 + 5)
    expect(v.flip!.priceAt).toBe(70_070);
    expect(v.priceNow).toBe(70_295);
    expect(v.flip!.priceChangePct).toBeCloseTo(((70_295 - 70_070) / 70_070) * 100, 10);
  });
  it("attaches the candle price to each point and leaves null where no candle covers it", () => {
    const short = buildTraderNet(series(nets), bars(10), NOW, H);
    expect(short.points[3]!.price).toBe(70_030);
    expect(short.points[15]!.price).toBeNull();
    expect(short.flip!.priceAt).toBe(70_070);
    // no candles at all: no price anywhere, no price change
    const none = buildTraderNet(series(nets), [], NOW, H);
    expect(none.points.every((p) => p.price === null)).toBe(true);
    expect(none.priceNow).toBeNull();
    expect(none.flip!.priceChangePct).toBeNull();
  });
  it("mirrors for a flip to Long", () => {
    const up = buildTraderNet(series(nets.map((n) => -n)), [], NOW, H);
    expect(up.side).toBe("long");
    expect(up.flip).toMatchObject({ from: "short", to: "long" });
    expect(up.flip!.at).toBe(T0 + 7.5 * H);
  });
  it("no sign change in the loaded history -> flip null and holdMs = the span", () => {
    const calm = buildTraderNet(series(Array.from({ length: 20 }, (_, i) => 8 + (i % 3))), [], NOW, H);
    expect(calm.flip).toBeNull();
    expect(calm.side).toBe("long");
    expect(calm.holdMs).toBe(19 * H);
    expect(calm.changes).toBe(0);
    expect(netHeadline(calm)).toBe("netto Long, im geladenen Verlauf (19 Std.) unverändert");
  });
  it("a dip into the dead band (|net| < 1 pp) is not a flip, a dip across it is", () => {
    const wobble = [10, 10, 10, 10, 10, 10, 0.6, -0.6, 0.4, 10, 10, 10, 10, 10];
    const a = buildTraderNet(series(wobble), [], NOW, H);
    expect(a.flip).toBeNull();
    expect(a.changes).toBe(0);
    const across = [10, 10, 10, 10, 10, 10, 3, -3, -3, 10, 10, 10, 10, 10];
    const b = buildTraderNet(series(across), [], NOW, H);
    expect(b.side).toBe("long");
    // short for two points, then back: the last flip is the one back to Long at the 8th/9th point
    expect(b.flip).toMatchObject({ from: "short", to: "long", index: 9 });
    expect(b.changes).toBe(2);
  });
  it("when the newest point sits in the dead band the side is ausgeglichen (the flip stays the last firm one)", () => {
    const calm = [12, 12, 12, 12, 12, -5, -5, -5, -5, -5, -5, -0.4];
    const v2 = buildTraderNet(series(calm), [], NOW, H);
    expect(v2.side).toBe("neutral");
    expect(v2.flip).toMatchObject({ to: "short" });
    expect(netHeadline(v2)).toBe("ausgeglichen (−0,4 Pkt.)");
    expect(netWhy(v2)).toMatchObject({ status: "unmet" });
  });
  it("a history that never leaves the dead band has no firm side and no flip", () => {
    const v3 = buildTraderNet(series(Array.from({ length: 14 }, (_, i) => (i % 2 ? 0.5 : -0.5))), [], NOW, H);
    expect(v3.status).toBe("ok");
    expect(v3.side).toBe("neutral");
    expect(v3.flip).toBeNull();
  });
  it("sorts unordered input", () => {
    const shuffled = [...series(nets)].reverse();
    expect(buildTraderNet(shuffled, [], NOW, H).flip!.at).toBe(v.flip!.at);
  });
});

describe("German texts", () => {
  it("durations are rounded down and never longer than they were", () => {
    expect(durationText(4 * 60_000)).toBeNull();
    expect(durationText(40 * 60_000)).toBe("40 Min.");
    expect(durationText(5 * H + 59 * 60_000)).toBe("5 Std.");
    expect(durationText(47.9 * H)).toBe("47 Std.");
    expect(durationText(3.9 * 24 * H)).toBe("3 Tage");
    expect(sinceText(3.9 * 24 * H)).toBe("seit 3 Tagen");
    expect(sinceText(60_000)).toBe("seit gerade eben");
  });
  it("net values use the minus sign, a plus and German decimals", () => {
    expect(netText(8.24)).toBe("+8,2 Pkt.");
    expect(netText(-4.6)).toBe("−4,6 Pkt.");
  });
  it("headline and detail name the series, the side and the flip; the detail adds the price change since the flip", () => {
    const v = buildTraderNet(series([12, 12, 12, 12, 12, 12, 12, 4, -4, -10, -10, -10, -10, -10]), bars(30), T0 + 3.5 * 24 * H, H);
    expect(netHeadline(v)).toBe("netto Short, seit 3 Tagen umgeschlagen");
    expect(netDetail(v)).toMatch(/^Netto −10,0 Pkt\. \(Long 45,0 %\) · Preis seit dem Umschlag [+−]\d+,\d %$/);
    for (const s of [netHeadline(v), netDetail(v), netWhy(v)!.reason]) expect(s).not.toMatch(/Wal|Glassnode|On-Chain/i);
  });
  it("the Why sentence is a Long support or a non-support, and says it does not score", () => {
    const up = buildTraderNet(series(Array.from({ length: 14 }, () => 9)), [], NOW, H);
    expect(netWhy(up)).toMatchObject({ status: "met" });
    expect(netWhy(up)!.reason).toContain("netto Long (+9,0 Pkt.)");
    expect(netWhy(up)!.reason).toContain("zählt aber nicht in die Bewertung");
    const down = buildTraderNet(series(Array.from({ length: 14 }, () => -9)), [], NOW, H);
    expect(netWhy(down)).toMatchObject({ status: "unmet" });
    expect(netWhy(down)!.reason).toContain("ändert die Bewertung aber nicht");
  });
});

describe("the Warum-Begründung: one row, never a decision change", () => {
  const verdict = { valid: true, rsiOk: true, zoneOk: true, tiers: 2, strength: 2, score: 80, strongSignal: true, label: "Long-Einstieg" } as const;
  const input = (over: Partial<WhyInput> = {}): WhyInput => ({
    side: "long",
    verdict,
    checks: [null, null],
    cfg: { ladder: ["30m", "45m"], required: 2, rsiOs: 30, rsiOb: 70, rsiNear: 10 },
    ...over,
  });
  const flipped = buildTraderNet(series([12, 12, 12, 12, 12, 12, 12, 4, -4, -10, -10, -10, -10, -10]), [], NOW, H);
  const long = buildTraderNet(series(Array.from({ length: 14 }, () => 9)), [], NOW, H);

  it("adds exactly one optional row for the Long side, with the sentence", () => {
    const base = explainDecision(input());
    const withNet = explainDecision(input({ traderNet: flipped }));
    expect(withNet.optional.length).toBe(base.optional.length + 1);
    const row = withNet.optional.find((r) => r.id === "trader-net")!;
    expect(row.label).toBe("Top-Trader (Binance): netto");
    expect(row.status).toBe("unmet");
    expect(row.reason).toContain("netto Short");
    expect(explainDecision(input({ traderNet: long })).optional.find((r) => r.id === "trader-net")!.status).toBe("met");
  });
  it("never changes decision, headline, summary, score note, contradictions or missing data (only the optional group grows)", () => {
    const base = explainDecision(input());
    for (const net of [flipped, long, null, undefined]) {
      const w = explainDecision(input({ traderNet: net }));
      expect({ ...w, optional: [] }).toEqual({ ...base, optional: [] });
    }
  });
  it("adds nothing for the Short side, for no data and for a short history", () => {
    expect(explainDecision(input({ side: "short", traderNet: flipped })).optional.some((r) => r.id === "trader-net")).toBe(false);
    expect(explainDecision(input({ traderNet: buildTraderNet([], [], NOW, H) })).optional.some((r) => r.id === "trader-net")).toBe(false);
    expect(explainDecision(input({ traderNet: buildTraderNet(series([1, 2, 3]), [], NOW, H) })).optional.some((r) => r.id === "trader-net")).toBe(false);
  });
});

describe("deriveLiveTraderNet: honest states", () => {
  const specs = buildFeedSpecs("1h");
  const stamp = <T,>(data: T, source: Stamped<T>["source"] = "binance"): Stamped<T> => ({ data, asOf: NOW, receivedAt: NOW, source, comparable: true });
  const ratio = (nets: number[], t0 = T0): RatioPoint[] => nets.map((n, i) => ({ time: t0 + i * H, longPct: 50 + n / 2, shortPct: 50 - n / 2, ratio: 1 }));
  const candles = (n: number): Candle[] => Array.from({ length: n }, (_, i) => ({ time: T0 + i * H, open: 70_000 + i, high: 70_100, low: 69_900, close: 70_001 + i, volume: 1, closed: true }));
  const health = (over: Partial<ProviderHealth["feeds"]["topPositionRatio"]> = {}, top: Partial<ProviderHealth> = {}): ProviderHealth => {
    const h = initialHealth(specs);
    h.online = true;
    h.feeds.topPositionRatio = { ...h.feeds.topPositionRatio!, state: "live", source: "binance", lastDataAt: NOW, ...over };
    return { ...h, ...top };
  };
  const nets = Array.from({ length: 20 }, (_, i) => (i < 10 ? 8 : -8));

  it("live Binance series -> a view with the flip, status live, source binance", () => {
    const r = deriveLiveTraderNet(stamp(ratio(nets)), stamp(candles(30)), health(), T0 + 19 * H + 5 * 60_000);
    expect(r.status).toBe("live");
    expect(r.source).toBe("binance");
    expect(r.stepMs).toBe(H);
    expect(r.view!.flip).toMatchObject({ from: "long", to: "short" });
    expect(r.view!.points[0]!.price).toBe(70_000);
  });
  it("through the EU proxy it is still Binance data, marked proxy", () => {
    const r = deriveLiveTraderNet(stamp(ratio(nets), "proxy"), undefined, health({ source: "proxy" }), T0 + 19 * H);
    expect(r.status).toBe("live");
    expect(r.source).toBe("proxy");
    expect(r.view!.priceNow).toBeNull();
  });
  it("a series whose newest point is older than two periods is stale, with the view still there", () => {
    const r = deriveLiveTraderNet(stamp(ratio(nets)), undefined, health(), T0 + 19 * H + 3 * H);
    expect(r.status).toBe("stale");
    expect(r.detail).toBe("Top-Trader-Daten veraltet");
    expect(r.view).not.toBeNull();
  });
  it("a Bybit/OKX fallback has no top-trader cohort -> no view, 'Nur mit Binance' wording", () => {
    const r = deriveLiveTraderNet(stamp(ratio(nets), "bybit"), undefined, health({ source: "bybit", state: "fallback" }), NOW);
    expect(r.view).toBeNull();
    expect(r.status).toBe("none");
    expect(r.source).toBeNull();
    expect(r.detail).toMatch(/Binance/);
  });
  it("Binance blocked here (451) without a proxy -> no view and the region reason", () => {
    const h = health({ state: "offline", reason: "blocked_451" }, {});
    h.primary = { ...h.primary, blocked: true };
    const r = deriveLiveTraderNet(undefined, undefined, h, NOW);
    expect(r).toMatchObject({ view: null, status: "none", detail: "Binance blockiert (Region)" });
  });
  it("offline -> none with the offline wording; no provider -> none, not an eternal loading", () => {
    const off = health();
    off.online = false;
    expect(deriveLiveTraderNet(undefined, undefined, off, NOW)).toMatchObject({ view: null, status: "none" });
    expect(deriveLiveTraderNet(undefined, undefined, null, NOW)).toMatchObject({ view: null, status: "none", detail: "Kein Marktanschluss – keine Top-Trader-Daten." });
  });
  it("online, no point yet and no failure -> loading; a short history stays a view with status short", () => {
    const h = health({ state: "connecting" });
    expect(deriveLiveTraderNet(undefined, undefined, h, NOW).status).toBe("loading");
    const r = deriveLiveTraderNet(stamp(ratio([3, 4, 5])), undefined, health(), T0 + 2 * H);
    expect(r.view!.status).toBe("short");
    expect(r.status).toBe("live");
  });
  it("5-minute spacing uses 15-minute candles for the price", () => {
    const five = Array.from({ length: 30 }, (_, i) => ({ time: T0 + i * 300_000, longPct: 55, shortPct: 45, ratio: 1.2 }));
    const q = Array.from({ length: 10 }, (_, i) => ({ time: T0 + i * 900_000, open: 70_000 + i, high: 1, low: 1, close: 70_000 + i, volume: 1, closed: true }));
    const r = deriveLiveTraderNet(stamp(five), stamp(q), health(), T0 + 29 * 300_000);
    expect(r.stepMs).toBe(300_000);
    expect(r.view!.points[4]!.price).toBe(70_001); // 20 min -> the 15-minute candle that opened at 15 min
  });
});
