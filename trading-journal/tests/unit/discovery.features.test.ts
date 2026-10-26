/**
 * The features of an entry, one table per function with numbers worked out by hand on a "ladder" of candles:
 *   c(i) = 100 + i, o = c − 1, h = c + 0.5, l = c − 1.5   →   every range is 2, every true range is 2, ATR(14) = 2 from candle 13 on,
 *   RSI = 100 (only rises), the closes are a straight line (slope 1, efficiency 1).
 * Candle 0 opens at 00:00 UTC of Tuesday 2023-11-14, one candle = one hour.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { barFeatures, buildSeries, calendarFeatures, emaSeeded, htfOf, rollingMean, streakLabel, FEATURES, FEATURE_IDS, type FeatureSeries } from "@/domain/discovery/features";
import { buildTable, lossStreaks } from "@/domain/discovery/table";
import type { DiscoveryTrade } from "@/domain/discovery/types";
import type { Bar } from "@/domain/signals/indicators";

const T0 = 1_699_920_000; // 2023-11-14 00:00:00 UTC (Tuesday)
const H = 3600;

function ladder(n: number, vol?: (i: number) => number | undefined): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + i;
    const b: Bar = { t: T0 + i * H, o: c - 1, h: c + 0.5, l: c - 1.5, c };
    const v = vol?.(i);
    if (v !== undefined) b.v = v;
    return b;
  });
}

const at = (s: FeatureSeries, k: number, side: "long" | "short" = "long") => barFeatures(s, k, T0 + k * H, side);

describe("causal series", () => {
  it("EMA seeded with the SMA of the first len closes, null before", () => {
    // closes 1..5, len 3: seed = (1+2+3)/3 = 2 at index 2; a = 0,5 → 0,5·4 + 0,5·2 = 3 → 0,5·5 + 0,5·3 = 4
    expect(emaSeeded([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(emaSeeded([1, 2], 3)).toEqual([null, null]);
  });
  it("rolling mean needs a full window of finite values", () => {
    expect(rollingMean([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    expect(rollingMean([1, null, 3, 4, 5], 2)).toEqual([null, null, null, 3.5, 4.5]);
  });
  it("the higher timeframe is the first of 1h / 4h / 1D / 1W at least four candles long", () => {
    const bars = ladder(100);
    const h = htfOf(bars, H)!;
    expect(h.label).toBe("4h");
    expect(h.bars).toHaveLength(25);
    expect(h.bars[0]).toMatchObject({ t: T0, o: 99, c: 103, h: 103.5, l: 98.5 });
    expect(htfOf(bars, 604_800)).toBeNull(); // nothing above weekly candles
  });
});

describe("candle features on the ladder (hand-worked)", () => {
  const bars = ladder(100, (i) => (i === 30 ? 30 : 10));
  const s = buildSeries({ intervalSec: H, bars });

  it("distance to the EMAs in ATR, in the direction of the trade", () => {
    // k = 20 → candle 19: EMA20 = mean(100…119) = 109,5; (119 − 109,5) ÷ 2 = 4,75; a short sees the mirror
    expect(at(s, 20).emaDist20).toBeCloseTo(4.75, 10);
    expect(at(s, 20, "short").emaDist20).toBeCloseTo(-4.75, 10);
    // EMA50 / EMA200 are not defined yet → null, never a guess
    expect(at(s, 20).emaDist50).toBeNull();
    expect(at(s, 99).emaDist200).toBeNull();
    // EMA50 at candle 49 = mean(100…149) = 124,5 → (149 − 124,5) ÷ 2 = 12,25
    expect(at(s, 50).emaDist50).toBeCloseTo(12.25, 10);
  });
  it("RSI is 100 on a market that only rises; the slope over 3 candles is 0", () => {
    const f = at(s, 40);
    expect(f.rsi).toBe(100);
    expect(f.rsiSlope).toBe(0);
  });
  it("volatility regime = ATR ÷ its 50-candle mean (1 on a constant ATR); needs 50 ATR values", () => {
    expect(at(s, 70).volRegime).toBeCloseTo(1, 10);
    expect(at(s, 50).volRegime).toBeNull();
  });
  it("signal candle: size in ATR, body share, wick against the trade", () => {
    const f = at(s, 40);
    expect(f.candleSize).toBeCloseTo(1, 10); // range 2 ÷ ATR 2
    expect(f.bodyRatio).toBeCloseTo(50, 10); // |c − o| = 1 of 2
    expect(f.wickAgainst).toBeCloseTo(25, 10); // long: upper wick 0,5 of 2
    expect(at(s, 40, "short").wickAgainst).toBeCloseTo(25, 10); // short: lower wick 0,5 of 2
  });
  it("the wick against the trade differs by side on a candle with a long upper wick", () => {
    const b = ladder(60);
    b[40] = { t: b[40]!.t, o: 139, h: 145, l: 138, c: 140 }; // range 7, body 1, upper wick 5, lower wick 1
    const ss = buildSeries({ intervalSec: H, bars: b });
    expect(at(ss, 41).wickAgainst).toBeCloseTo((5 / 7) * 100, 8);
    expect(at(ss, 41, "short").wickAgainst).toBeCloseTo((1 / 7) * 100, 8);
  });
  it("gap before the signal candle: its open against the previous close, in ATR", () => {
    expect(at(s, 40).gap).toBeCloseTo(0, 10); // o(39) = 138 = c(38)
    const b = ladder(60);
    b[40] = { ...b[40]!, o: 144 }; // the previous close is c(39) = 139 → the candle opens 5 above it → 2,5 ATR
    const ss = buildSeries({ intervalSec: H, bars: b });
    expect(at(ss, 41).gap).toBeCloseTo((144 - 139) / 2, 8);
    expect(at(ss, 41, "short").gap).toBeCloseTo(-(144 - 139) / 2, 8);
  });
  it("relative volume: volume ÷ mean of the 20 candles before (3 here); null without volume", () => {
    expect(at(s, 31).relVolume).toBeCloseTo(3, 10); // candle 30: 30 ÷ 10
    expect(at(s, 60).relVolume).toBeCloseTo(1, 10); // candles 39…58 all 10
    expect(at(s, 40).relVolume).toBeCloseTo(10 / 11, 10); // the window still holds the 30 of candle 30: mean 11
    expect(at(buildSeries({ intervalSec: H, bars: ladder(60) }), 40).relVolume).toBeNull();
  });
  it("distance to the last 20-candle high / low in ATR (long: room up, room down; short: mirrored)", () => {
    // window = candles j−19…j, c(j) = 140 at j = 40: high = 140,5, low = l(21) = 119,5 − … = 121 − 1,5 = 119,5
    const f = at(s, 41);
    expect(f.roomAhead).toBeCloseTo((140.5 - 140) / 2, 10); // 0,25
    expect(f.roomBehind).toBeCloseTo((140 - 119.5) / 2, 10); // 10,25
    const sh = at(s, 41, "short");
    expect(sh.roomAhead).toBeCloseTo((140 - 119.5) / 2, 10);
    expect(sh.roomBehind).toBeCloseTo(0.25, 10);
  });
  it("trend slope (least squares over 20 closes ÷ ATR) and efficiency ratio", () => {
    expect(at(s, 41).trendSlope).toBeCloseTo(0.5, 10); // slope 1 ÷ ATR 2
    expect(at(s, 41, "short").trendSlope).toBeCloseTo(-0.5, 10);
    expect(at(s, 41).efficiency).toBeCloseTo(1, 10); // a straight line: 20 net over 20 path
    // zig-zag: closes alternate 100, 101 → net over 20 changes is 0 → efficiency 0
    const z = Array.from({ length: 60 }, (_, i): Bar => ({ t: T0 + i * H, o: 100, h: 102, l: 99, c: 100 + (i % 2) }));
    expect(at(buildSeries({ intervalSec: H, bars: z }), 41).efficiency).toBeCloseTo(0, 10);
  });
  it("Bollinger position (%B in %) and width (in % of the middle), population standard deviation", () => {
    // closes 121…140: mean 130,5, σ = √(33,25) = 5,76628; %B = (140 − (130,5 − 2σ)) ÷ 4σ
    const sd = Math.sqrt(33.25);
    const f = at(s, 41);
    expect(f.bbPos).toBeCloseTo(((140 - (130.5 - 2 * sd)) / (4 * sd)) * 100, 8);
    expect(f.bbWidth).toBeCloseTo(((4 * sd) / 130.5) * 100, 8);
  });
  it("distance to the start of the UTC day (candle 24 opens day 2 at 123): (130 − 123) ÷ 2", () => {
    expect(at(s, 31).dayStartDist).toBeCloseTo(3.5, 10); // signal candle 30
    expect(at(s, 31, "short").dayStartDist).toBeCloseTo(-3.5, 10);
  });
  it("a day that does not start at 00:00 in the data gives null", () => {
    const b = ladder(60).slice(5); // the first day starts at candle 5 (05:00) → unknown day open
    const ss = buildSeries({ intervalSec: H, bars: b });
    expect(barFeatures(ss, 10, b[9]!.t + H, "long").dayStartDist).toBeNull();
    expect(barFeatures(ss, 30, b[29]!.t + H, "long").dayStartDist).not.toBeNull();
  });
  it("distance to the nearest key level counts only levels that existed at the entry", () => {
    const ss = buildSeries({
      intervalSec: H,
      bars,
      levels: [
        { price: 127, sinceMs: (T0 + 20 * H) * 1000 }, // exists: |130 − 127| ÷ 2 = 1,5
        { price: 131, sinceMs: (T0 + 35 * H) * 1000 }, // created later: hindsight, ignored
        { price: 130.5, sinceMs: null }, // creation time unknown: ignored
      ],
    });
    expect(at(ss, 31).keyLevelDist).toBeCloseTo(1.5, 10);
    expect(at(s, 31).keyLevelDist).toBeNull(); // no levels at all
  });
  it("higher-timeframe trend: the 4h candle counts only once it has CLOSED", () => {
    // 4h candles: close 103 + 4b; EMA20 of the first 20 = 141 at b = 19; ATR(14) of 4h = 5; (179 − 141) ÷ 5 = 7,6
    const f80 = barFeatures(s, 80, T0 + 80 * H, "long");
    expect(f80.htfTrend).toBeCloseTo(7.6, 10);
    expect(barFeatures(s, 80, T0 + 80 * H, "short").htfTrend).toBeCloseTo(-7.6, 10);
    // one candle earlier the 20th 4h candle is still open → only 19 closed → EMA20 undefined → null
    expect(barFeatures(s, 79, T0 + 79 * H, "long").htfTrend).toBeNull();
  });
  it("k = 0 (nothing closed yet) gives only nulls", () => {
    expect(Object.values(barFeatures(s, 0, T0, "long")).every((v) => v === null)).toBe(true);
  });
});

describe("calendar", () => {
  it.each([
    ["Tue 08:00 UTC", T0 + 8 * H, "London", "Dienstag", "Vormittag (6–12 Uhr)"],
    ["Tue 03:00 UTC", T0 + 3 * H, "Asien", "Dienstag", "Nacht (0–6 Uhr)"],
    ["Tue 15:00 UTC", T0 + 15 * H, "New York", "Dienstag", "Nachmittag (12–18 Uhr)"],
    ["Tue 22:00 UTC", T0 + 22 * H, "Spät", "Dienstag", "Abend (18–24 Uhr)"],
    ["Sat 10:00 UTC", T0 + 4 * 86_400 + 10 * H, "Wochenende", "Samstag", "Vormittag (6–12 Uhr)"],
  ])("%s", (_n, t, session, weekday, dayPart) => {
    expect(calendarFeatures(t * 1000)).toEqual({ session, weekday, dayPart });
  });
});

describe("losses in a row", () => {
  const mk = (id: string, entry: number, exit: number | null, r: number): DiscoveryTrade => ({ id, entryTime: entry, exitTime: exit, side: "long", r });
  it("counts only trades already closed at the entry, newest first, capped at 3", () => {
    const trades = [mk("a", 0, 10, -1), mk("b", 20, 30, -1), mk("c", 40, 50, 2), mk("d", 60, 70, -1), mk("e", 80, 90, -1), mk("f", 100, 110, -1), mk("g", 120, 130, -1), mk("h", 140, 150, 1)];
    // before a: none; before b: a lost → 1; before c: a, b → 2; before d: c won → 0; e: d → 1; f: d, e → 2; g: d, e, f → 3; h: 4 losses but capped → 3
    expect(lossStreaks(trades)).toEqual([0, 1, 2, 0, 1, 2, 3, 3]);
  });
  it("a trade that is still open at the entry does not count yet", () => {
    const trades = [mk("a", 0, 100, -1), mk("b", 20, 30, -1), mk("c", 40, 50, 1)];
    // c enters at 40: b closed at 30 (loss), a closes only at 100 → streak = 1 (b), and b was a loss, then a is not yet closed
    expect(lossStreaks(trades)).toEqual([0, 0, 1]);
  });
  it("is off when the exit time is missing for too many trades", () => {
    const trades = [mk("a", 0, null, -1), mk("b", 20, null, -1), mk("c", 40, 50, 1)];
    expect(lossStreaks(trades)).toBeNull();
  });
  it("labels", () => {
    expect([0, 1, 2, 3, 9].map(streakLabel)).toEqual(["0", "1", "2", "3 oder mehr", "3 oder mehr"]);
  });
});

describe("feature table", () => {
  it("one definition per feature id with a German label; entry features are filterable only without journal / history", () => {
    expect(FEATURE_IDS.length).toBeGreaterThanOrEqual(25);
    for (const id of FEATURE_IDS) {
      const d = FEATURES[id];
      expect(d.id).toBe(id);
      expect(d.label.length).toBeGreaterThan(3);
      if (d.phase === "after") expect(d.filterable).toBe(false);
    }
    expect(FEATURES.lossStreak.filterable).toBe(false);
    expect(FEATURES.rsi.filterable).toBe(true);
  });

  it("builds a backtest-like table: entry at the open of candle k sees candles 0…k−1 only", () => {
    const bars = ladder(120);
    const trades: DiscoveryTrade[] = [
      { id: "x", entryTime: (T0 + 40 * H) * 1000, exitTime: (T0 + 44 * H) * 1000, side: "long", r: 1.5, setup: "Ausbruch" },
      { id: "y", entryTime: (T0 + 60 * H) * 1000, exitTime: (T0 + 63 * H) * 1000, side: "short", r: -1, emotion: "FOMO" },
      { id: "z", entryTime: (T0 + 70 * H) * 1000, exitTime: null, side: "long", r: null },
    ];
    const t = buildTable({ trades, markets: { "": { intervalSec: H, bars } }, source: "backtest" });
    expect(t.trades.map((x) => x.id)).toEqual(["x", "y"]);
    expect(t.droppedNoR).toBe(1);
    expect(Array.from(t.r)).toEqual([1.5, -1]);
    // the EMA 20 of a straight line lags by 9,5 → (c − EMA) ÷ ATR = 9,5 ÷ 2 for a long, mirrored for the short
    expect(t.cols.emaDist20![0]).toBeCloseTo(4.75, 10);
    expect(t.cols.emaDist20![1]).toBeCloseTo(-4.75, 10);
    expect(t.cols.setup).toEqual(["Ausbruch", null]);
    expect(t.cols.emotion).toEqual([null, "FOMO"]);
    expect(t.cols.side).toEqual(["Long", "Short"]);
    expect(t.cols.session![0]).toBe("New York"); // 2023-11-15 16:00 UTC
  });

  it("an entry the candles do not reach gets no candle features (never the stale last candle)", () => {
    const bars = ladder(60);
    const trades: DiscoveryTrade[] = [{ id: "late", entryTime: (T0 + 500 * H) * 1000, exitTime: null, side: "long", r: 1 }];
    const t = buildTable({ trades, markets: { "": { intervalSec: H, bars } }, source: "backtest" });
    expect(t.cols.emaDist20).toBeUndefined();
    expect(t.empty.find((e) => e.id === "emaDist20")?.reason).toMatch(/Kerzen/);
    expect(t.cols.session![0]).toBeDefined(); // the clock still works
  });

  it("a journal trade in the middle of a candle sees only the candles closed before it", () => {
    const bars = ladder(120);
    // 10:30 on day 2 → candle 34 (10:00–11:00) is still forming; the signal candle is 33
    const trades: DiscoveryTrade[] = [{ id: "mid", entryTime: (T0 + 34 * H + 1800) * 1000, exitTime: null, side: "long", r: 1 }];
    const t = buildTable({ trades, markets: { "": { intervalSec: H, bars } }, source: "journal" });
    expect(t.cols.emaDist20![0]).toBeCloseTo(4.75, 10);
    expect(t.cols.candleSize![0]).toBeCloseTo(1, 10);
  });

  it("the hold time (known only after the exit) is a feature only when asked for", () => {
    const trades: DiscoveryTrade[] = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, entryTime: (T0 + i * 10 * H) * 1000, exitTime: (T0 + (i * 10 + 2) * H) * 1000, side: "long" as const, r: i - 2 }));
    expect(buildTable({ trades, source: "journal" }).cols.hold).toBeUndefined();
    expect(buildTable({ trades, source: "journal", includePostEntry: true }).cols.hold).toEqual([2, 2, 2, 2, 2]);
  });

  it("keeps the most recent trades above the limit and counts the rest", () => {
    const trades: DiscoveryTrade[] = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, entryTime: (T0 + i * H) * 1000, exitTime: null, side: "long" as const, r: 1 }));
    const t = buildTable({ trades, source: "journal" }, 20);
    expect(t.trades).toHaveLength(20);
    expect(t.droppedCap).toBe(10);
    expect(t.trades[0]!.id).toBe("t10");
  });
});

describe("Abgleich mit TradingView", () => {
  // BINANCE:BTCUSDT 1D, fetched 2026-10-19 ~09:30 UTC with the TradingView connector (see the fixture's `source`): the screener's
  // daily bar differs from `get-ohlcv` by about 0,1 % (close 82 888,84 vs 82 989,99), so the values agree only within these tolerances –
  // the source's difference, not the formula's. The last bar is the forming one: TradingView's numbers belong to it.
  const fx = JSON.parse(readFileSync("tests/unit/fixtures/tv-binance-btcusdt-1d-indicators.json", "utf8")) as { bars: number[][]; tv: Record<string, number> };
  const bars: Bar[] = fx.bars.map(([t, o, h, l, c, v]) => ({ t: t!, o: o!, h: h!, l: l!, c: c!, v: v! }));
  const n = bars.length;
  const f = barFeatures(buildSeries({ intervalSec: 86_400, bars }), n, bars[n - 1]!.t + 86_400, "long");
  const { tv } = fx;
  const tvClose = 82_888.84; // the screener's close at the same minute (stated in the fixture)

  it("RSI(14)", () => {
    expect(Math.abs(f.rsi! - tv.RSI!)).toBeLessThan(0.5);
  });
  it("Bollinger position and width (20, 2σ, population σ like ta.bb)", () => {
    const pos = ((tvClose - tv["BB.lower"]!) / (tv["BB.upper"]! - tv["BB.lower"]!)) * 100;
    const width = ((tv["BB.upper"]! - tv["BB.lower"]!) / tv.SMA20!) * 100;
    expect(Math.abs(f.bbPos! - pos)).toBeLessThan(1.5);
    expect(Math.abs(f.bbWidth! - width)).toBeLessThan(0.15);
  });
});
