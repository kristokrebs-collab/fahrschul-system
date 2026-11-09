// @vitest-environment node
/**
 * The chart scanner's kernel (F67, `src/domain/scanner`): the three setups on candles built by hand (every threshold
 * hit on both sides), the pre-filter, ranking, the parameter bounds and the run loop (batches, failures, stale cache,
 * time slices, progress, cancel). The flag and RSI rules are also compared with a literal port of the
 * trader-scanner skill's reference (`find_setups`) on seeded random series.
 */
import { describe, expect, it } from "vitest";
import { rsi as rsiSeries } from "@/domain/signals/indicators";
import { DEFAULT_PARAMS, flagSetup, HARD_CAP, orbSetup, prefilter, rankHits, rsiSetup, runScan, sanitizeParams, scanSymbol, type Hit, type LoadOutcome, type ScanCandle, type ScanParams, type ScanProgress, type ScanSource, type ScanTarget, type SessionCtx, type Stand } from "@/domain/scanner";

const MIN = 60_000;
const OPEN = Date.UTC(2026, 9, 23, 13, 30); // Fri 2026-10-23 9:30 New York (EDT)
const session: SessionCtx = { openMs: OPEN, closeMs: OPEN + 390 * MIN, timeZone: "America/New_York", zoneLabel: "NY", noun: "Handelssitzung" };
const stand: Stand = { source: "yahoo", lastBar: null, receivedAt: OPEN + 600 * MIN, fetchedAt: OPEN + 600 * MIN };
const ctx5 = { symbol: "TEST", name: "Test Corp.", barMs: 5 * MIN, interval: "5m", stand };

/** 5-minute bar k of the session: [open, high, low, close, volume]. */
const b5 = (k: number, o: number, h: number, l: number, c: number, v = 1000): ScanCandle => ({ time: OPEN + k * 5 * MIN, open: o, high: h, low: l, close: c, volume: v, closed: true });

/** Range 9:30–9:45: high 100.9, low 99.8. */
const RANGE = [b5(0, 100, 100.5, 99.8, 100.4), b5(1, 100.4, 100.9, 100.1, 100.6), b5(2, 100.6, 100.7, 100.2, 100.5)];
const at = (k: number) => OPEN + k * 5 * MIN; // the open time of bar k

describe("opening-range breakout", () => {
  const p = { ...DEFAULT_PARAMS.orb };

  it("lists the first complete bar that CLOSES above the range high, with the numbers of the rule", () => {
    const bars = [...RANGE, b5(3, 100.5, 100.9, 100.4, 100.8), b5(4, 100.8, 101.4, 100.7, 101.2, 3000), b5(5, 101.2, 101.6, 101.0, 101.5)];
    const r = orbSetup(ctx5, bars, session, p, at(6));
    expect(r.hits).toHaveLength(1);
    const h = r.hits[0]!;
    expect(h).toMatchObject({ setup: "orb", side: "long", symbol: "TEST", price: 101.5, at: at(5) });
    expect(h.levels).toEqual([
      { label: "Spannenhoch", price: 100.9 },
      { label: "Spannentief", price: 99.8 },
    ]);
    expect(h.marks).toEqual([{ time: at(4), label: "Ausbruch" }]);
    expect(h.metric.value).toBeCloseTo(101.2 / 100.9 - 1, 10);
    expect(h.metric.text).toBe("+0,30 %");
    expect(h.reason).toBe("Schloss um 09:55 NY bei 101,20 über dem Spannenhoch 100,90 (+0,30 %) – Spanne 09:30–09:45 NY.");
    expect(h.checks[0]).toContain("Hoch 100,90, Tief 99,80 (3 Kerzen à 5m)");
    expect(h.checks[2]).toContain("liegt noch über der Spanne");
    expect(h.turnover).toBeCloseTo(101.5 * (3 * 1000 + 1000 + 3000 + 1000), 6);
    expect(h.stand.lastBar).toBe(at(5));
  });

  it("needs a close strictly beyond the range edge: a wick or an equal close is no breakout", () => {
    const bars = [...RANGE, b5(3, 100.5, 101.5, 100.4, 100.9), b5(4, 100.9, 101.0, 100.5, 100.6)];
    expect(orbSetup(ctx5, bars, session, p, at(5)).hits).toHaveLength(0);
  });

  it("does not count a bar that is still forming", () => {
    const bars = [...RANGE, b5(3, 100.5, 100.9, 100.4, 100.8), { ...b5(4, 100.8, 101.4, 100.7, 101.2), closed: false }];
    expect(orbSetup(ctx5, bars, session, p, at(5)).hits).toHaveLength(0);
    // the same candle without the flag but not yet over at `asOf` (4 + 1 bars = 9:55 > 9:52)
    expect(orbSetup(ctx5, [...RANGE, b5(3, 100.5, 100.9, 100.4, 100.8), b5(4, 100.8, 101.4, 100.7, 101.2)], session, p, OPEN + 22 * MIN).hits).toHaveLength(0);
  });

  it("says the range is not finished before the range bars are complete", () => {
    expect(orbSetup(ctx5, RANGE, session, p, OPEN + 14 * MIN)).toEqual({ hits: [], skip: "range-open" });
    expect(orbSetup(ctx5, RANGE, session, p, OPEN + 15 * MIN).skip).toBeUndefined();
  });

  it("leaves the chart out when a bar is missing instead of guessing", () => {
    const bars = [...RANGE, b5(4, 100.8, 101.4, 100.7, 101.2)]; // bar 3 missing
    const r = orbSetup(ctx5, bars, session, p, at(5));
    expect(r.skip).toBe("gaps");
    expect(r.detail).toBe("4 von 5 Kerzen vorhanden");
  });

  it("finds the short side below the range low when asked for both sides", () => {
    const bars = [...RANGE, b5(3, 100.4, 100.5, 99.5, 99.7), b5(4, 99.7, 99.9, 99.2, 99.3)];
    expect(orbSetup(ctx5, bars, session, p, at(5)).hits).toHaveLength(0); // long only by default
    const r = orbSetup(ctx5, bars, session, { ...p, sides: "both" }, at(5));
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]).toMatchObject({ side: "short", at: at(4) });
    expect(r.hits[0]!.metric.value).toBeCloseTo(1 - 99.7 / 99.8, 10);
    expect(r.hits[0]!.reason).toContain("unter dem Spannentief 99,80");
    expect(orbSetup(ctx5, bars, session, { ...p, sides: "short" }, at(5)).hits[0]!.side).toBe("short");
  });

  it("honours the minimum distance, the latest entry time, 'still beyond' and the volume check", () => {
    const base = [...RANGE, b5(3, 100.5, 101.1, 100.4, 101.0, 2000), b5(4, 101.0, 101.1, 100.5, 100.7, 500)];
    expect(orbSetup(ctx5, base, session, p, at(5)).hits).toHaveLength(1); // 101.00 > 100.90
    expect(orbSetup(ctx5, base, session, { ...p, minBreak: 0.002 }, at(5)).hits).toHaveLength(0); // 0.1 % < 0.2 %
    expect(orbSetup(ctx5, base, session, { ...p, minBreak: 0.0009 }, at(5)).hits).toHaveLength(1); // 101.00 > 100.90 × 1.0009
    // the last bar closed back inside the range
    expect(orbSetup(ctx5, base, session, { ...p, stillBeyond: true }, at(5)).hits).toHaveLength(0);
    expect(orbSetup(ctx5, base, session, p, at(5)).hits[0]!.checks[2]).toContain("nicht mehr über der Spanne");
    // the breakout bar (bar 3, closes at 9:50 = 20 min after the open) is too late for a 15-minute entry window
    expect(orbSetup(ctx5, base, session, { ...p, latestMinutes: 15 }, at(5)).hits).toHaveLength(0);
    expect(orbSetup(ctx5, base, session, { ...p, latestMinutes: 20 }, at(5)).hits).toHaveLength(1);
    // volume: 2000 vs mean 1000 of the range bars
    expect(orbSetup(ctx5, base, session, { ...p, minRelVolume: 1.5 }, at(5)).hits).toHaveLength(1);
    expect(orbSetup(ctx5, base, session, { ...p, minRelVolume: 2.5 }, at(5)).hits).toHaveLength(0);
  });

  it("refuses an opening range that is no multiple of the bar length", () => {
    expect(orbSetup(ctx5, RANGE, session, { ...p, orMinutes: 7 }, at(5)).skip).toBe("bad-params");
    expect(orbSetup(ctx5, RANGE, session, { ...p, orMinutes: 2 }, at(5)).skip).toBe("bad-params");
  });

  it("reads another range length (30 minutes = six 5-minute bars)", () => {
    const six = [...RANGE, b5(3, 100.5, 100.6, 100.2, 100.4), b5(4, 100.4, 100.7, 100.3, 100.5), b5(5, 100.5, 100.8, 100.3, 100.6), b5(6, 100.6, 101.3, 100.5, 101.2)];
    const r = orbSetup(ctx5, six, session, { ...p, orMinutes: 30 }, at(7));
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.levels[0]!.price).toBe(100.9);
    expect(r.hits[0]!.checks[0]).toContain("(6 Kerzen à 5m)");
  });
});

/* ------------------------------------------------------------------ flag */

const DAY = 86_400_000;
const D0 = Date.UTC(2026, 6, 1, 13, 30);
/** Daily candles from closes (high / low a hair around the close, volume 2 Mio.). */
const daily = (closes: readonly number[], vol = 2_000_000): ScanCandle[] =>
  closes.map((c, i) => ({ time: D0 + i * DAY, open: c, high: c * 1.002, low: c * 0.998, close: c, volume: vol, closed: true }));
const ctx1d = { symbol: "TEST", name: null, barMs: DAY, interval: "1d", stand };

/** 20 closes: 4 flat at 80, a run to `peak` over the pole, then a flag of five closes. */
function flagCloses(peak: number, flag: number[]): number[] {
  const c = [80, 80, 80, 80, 80];
  for (let i = 1; i <= 9; i++) c.push(80 + ((peak - 80) * i) / 9); // c[5..13]; c[4] = pole start (80), c[14] = peak below
  c.push(peak);
  return [...c, ...flag];
}

describe("flag", () => {
  const p = DEFAULT_PARAMS.flag;
  const tight = [90.0, 90.5, 89.8, 90.2, 90.1];

  it("lists a run of more than 10 % followed by five closes inside a range under 5 %", () => {
    const closes = flagCloses(90, tight);
    expect(closes).toHaveLength(20);
    const r = flagSetup(ctx1d, daily(closes), p);
    expect(r.hits).toHaveLength(1);
    const h = r.hits[0]!;
    expect(h).toMatchObject({ setup: "flag", side: "long", price: 90.1 });
    expect(h.metric.value).toBeCloseTo(90 / 80 - 1, 10);
    expect(h.metric.text).toBe("+12,5 %");
    expect(h.reason).toBe("Erst +12,5 % in 10 Tagen (80,00 → 90,00), dann 5 Schlusskurse in einer Spanne von nur 0,8 %.");
    expect(h.checks[0]).toContain("Schwelle: mehr als 10,0 %");
    expect(h.checks[1]).toContain("zwischen 89,80 und 90,50");
    expect(h.levels).toEqual([
      { label: "Fahnen-Hoch (Schluss)", price: 90.5 },
      { label: "Fahnen-Tief (Schluss)", price: 89.8 },
    ]);
    expect(h.marks.map((m) => m.label)).toEqual(["Anstieg ab", "Fahne ab"]);
  });

  it("needs MORE than the run threshold and a range UNDER the flag threshold (both strict)", () => {
    const calm = (v: number): number[] => [v, v, v, v, v];
    expect(flagSetup(ctx1d, daily(flagCloses(87.9, calm(87.9))), p).hits).toHaveLength(0); // +9.9 % is not more than 10 %
    expect(flagSetup(ctx1d, daily(flagCloses(88.1, calm(88.1))), p).hits).toHaveLength(1); // +10.1 % is
    expect(flagSetup(ctx1d, daily(flagCloses(90, [90, 90, 90, 90, 94.6])), p).hits).toHaveLength(1); // 4.6 / 94.6 = 4.9 %
    expect(flagSetup(ctx1d, daily(flagCloses(90, [90, 90, 90, 90, 95])), p).hits).toHaveLength(0); // 5 / 95 = 5.3 %
  });

  it("is a different chart when the thresholds change", () => {
    const closes = flagCloses(90, [90, 90.5, 89.8, 90.2, 91.5]); // range 1.7 / 91.5 = 1.9 %
    expect(flagSetup(ctx1d, daily(closes), p).hits).toHaveLength(1);
    expect(flagSetup(ctx1d, daily(closes), { ...p, flagMaxRange: 0.015 }).hits).toHaveLength(0);
    expect(flagSetup(ctx1d, daily(closes), { ...p, poleMinGain: 0.15 }).hits).toHaveLength(0);
    expect(flagSetup(ctx1d, daily(closes), { ...p, poleBars: 5, flagBars: 3 }).hits.length).toBeLessThanOrEqual(1);
  });

  it("says how many candles are missing instead of a verdict", () => {
    const r = flagSetup(ctx1d, daily(flagCloses(90, tight).slice(5)), p);
    expect(r.skip).toBe("few-bars");
    expect(r.detail).toBe("15 von mindestens 16 Kerzen");
  });

  it("ignores the forming bar", () => {
    const bars = daily(flagCloses(90, tight));
    bars[bars.length - 1] = { ...bars[bars.length - 1]!, close: 120, closed: false };
    expect(flagSetup(ctx1d, bars, p).hits[0]!.price).toBe(90.2); // the 19th close, the open one dropped
  });

  it("agrees with the reference rule of the trader-scanner skill on seeded random series", () => {
    let seed = 7;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    let agreed = 0;
    let positives = 0;
    for (let round = 0; round < 600; round++) {
      const n = 30 + Math.floor(rand() * 30);
      const drift = (rand() - 0.35) * 0.02;
      const vol = 0.002 + rand() * 0.02;
      const c = [50];
      for (let i = 1; i < n; i++) c.push(Math.max(1, c[i - 1]! * (1 + drift + (rand() - 0.5) * vol * 2)));
      // reference (scan.py find_setups): run = c[-6] / c[-16] − 1 > 10 %, rng5 = (max − min of the last 5) / last < 5 %
      const run = c[n - 6]! / c[n - 16]! - 1;
      const last5 = c.slice(-5);
      const rng5 = (Math.max(...last5) - Math.min(...last5)) / c[n - 1]!;
      const expected = run > 0.1 && rng5 < 0.05;
      const got = flagSetup(ctx1d, daily(c), p).hits.length === 1;
      expect(got, `round ${round}`).toBe(expected);
      agreed++;
      if (expected) positives++;
    }
    expect(agreed).toBe(600);
    expect(positives).toBeGreaterThan(5); // the generator does produce flags, the comparison is not vacuous
  });
});

/* ------------------------------------------------------------------ RSI */

/** The reference of the skill: Wilder's RSI from the first n changes, then smoothed. */
function refRsi(closes: readonly number[], n = 14): number | null {
  if (closes.length < n + 1) return null;
  const g: number[] = [];
  const l: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    g.push(Math.max(0, closes[i]! - closes[i - 1]!));
    l.push(Math.max(0, closes[i - 1]! - closes[i]!));
  }
  let ag = g.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let al = l.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < g.length; i++) {
    ag = (ag * (n - 1) + g[i]!) / n;
    al = (al * (n - 1) + l[i]!) / n;
  }
  return al ? 100 - 100 / (1 + ag / al) : 100;
}

describe("oversold recovery (RSI)", () => {
  const p = DEFAULT_PARAMS.rsi;
  /** A fall with small bounces for 25 bars (RSI around 15–20, never 0), then `tail`. */
  const fall = (tail: number[]): number[] => [...Array.from({ length: 25 }, (_, i) => 100 - i * 1.5 + (i % 4 === 0 ? 2.5 : 0)), ...tail];
  const lastFall = 100 - 24 * 1.5 + 2.5; // 66.5: the close before the tail

  it("lists an RSI that was under 30 on the bar before when the last bar closed higher", () => {
    const closes = fall([lastFall + 0.5]); // an up-close
    const r = rsiSetup(ctx1d, daily(closes), p);
    expect(r.hits).toHaveLength(1);
    const h = r.hits[0]!;
    expect(h).toMatchObject({ setup: "rsi", side: "long", price: lastFall + 0.5 });
    const prev = refRsi(closes.slice(0, -1))!;
    expect(prev).toBeLessThan(30);
    expect(h.metric.value).toBeCloseTo(prev, 8);
    expect(h.reason).toContain("RSI(14) lag zuvor bei");
    expect(h.reason).toContain("(66,50 → 67,00)");
    expect(h.checks).toHaveLength(3);
  });

  it("needs the up-close: RSI under 30 and another fall is no bounce", () => {
    expect(rsiSetup(ctx1d, daily(fall([lastFall - 1])), p).hits).toHaveLength(0);
    // without the bounce requirement it is listed as oversold
    const r = rsiSetup(ctx1d, daily(fall([lastFall - 1])), { ...p, requireBounce: false });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.reason).toMatch(/^RSI\(14\) steht bei \d+,\d, unter der Schwelle 30\.$/);
  });

  it("does not list a chart whose RSI was not under the level the bar before", () => {
    const up = Array.from({ length: 40 }, (_, i) => 50 + i * 0.5);
    expect(rsiSetup(ctx1d, daily(up), p).hits).toHaveLength(0);
    expect(rsiSetup(ctx1d, daily(up), { ...p, requireBounce: false }).hits).toHaveLength(0);
  });

  it("takes the level and the length from the parameters", () => {
    const closes = fall([lastFall + 0.5]);
    expect(refRsi(closes.slice(0, -1))!).toBeGreaterThan(5);
    expect(rsiSetup(ctx1d, daily(closes), { ...p, level: 5 }).hits).toHaveLength(0);
    expect(rsiSetup(ctx1d, daily(closes), { ...p, length: 5 }).hits).toHaveLength(1);
  });

  it("says when there are too few candles", () => {
    expect(rsiSetup(ctx1d, daily([10, 9, 8]), p).skip).toBe("few-bars");
  });

  it("agrees with the reference RSI and bounce rule of the skill on seeded random series", () => {
    let seed = 99;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    let hits = 0;
    for (let round = 0; round < 800; round++) {
      const n = 20 + Math.floor(rand() * 40);
      const drift = (rand() - 0.65) * 0.03;
      const c = [40];
      for (let i = 1; i < n; i++) c.push(Math.max(1, c[i - 1]! * (1 + drift + (rand() - 0.5) * 0.04)));
      const series = rsiSeries(c, 14);
      const ref = refRsi(c)!;
      expect(series[n - 1]!, `rsi ${round}`).toBeCloseTo(ref, 8);
      const prev = refRsi(c.slice(0, -1));
      const expected = prev != null && prev < 30 && c[n - 1]! > c[n - 2]!;
      const got = rsiSetup(ctx1d, daily(c), p).hits.length === 1;
      expect(got, `bounce ${round}`).toBe(expected);
      if (expected) hits++;
    }
    expect(hits).toBeGreaterThan(5);
  });
});

/* ------------------------------------------------------------------ pre-filter, ranking, parameters */

describe("pre-filter", () => {
  const input = (candles: ScanCandle[], extra: Partial<Parameters<typeof prefilter>[0]> = {}) => ({ symbol: "T", interval: "1d", barMs: DAY, candles, asOf: D0 + 40 * DAY, stand, ...extra });
  const closes = Array.from({ length: 40 }, (_, i) => 20 + i * 0.1);
  const pre = { ...DEFAULT_PARAMS };

  it("lets a liquid, recent, normal chart through", () => {
    expect(prefilter(input(daily(closes), { asOf: D0 + 40 * DAY }), pre, false)).toBeNull();
  });

  it("skips by price, volume, status, bar count and age – each with its reason", () => {
    expect(prefilter(input(daily(closes.map((c) => c / 10))), pre, false)?.skip).toBe("price");
    expect(prefilter(input(daily(closes, 900_000)), pre, false)?.skip).toBe("volume");
    expect(prefilter(input(daily(closes), { fin: "D" }), pre, false)).toMatchObject({ skip: "status", detail: "Finanzstatus D" });
    expect(prefilter(input(daily(closes), { fin: "N" }), pre, false)).toBeNull();
    expect(prefilter(input(daily(closes), { fin: "D" }), { ...pre, pre: { ...pre.pre, normalStatusOnly: false } }, false)).toBeNull();
    expect(prefilter(input(daily(closes.slice(0, 20))), pre, false)?.skip).toBe("few-bars");
    expect(prefilter(input(daily(closes), { asOf: D0 + 60 * DAY }), pre, false)?.skip).toBe("stale");
    expect(prefilter(input([]), pre, false)?.skip).toBe("few-bars");
  });

  it("with the thresholds at 0 the price and volume rules are off", () => {
    const off = { ...pre, pre: { ...pre.pre, minPrice: 0, minVolume: 0 } };
    expect(prefilter(input(daily(closes.map((c) => c / 100), 10)), off, false)).toBeNull();
  });

  it("reads the volume of the session so far for an intraday scan", () => {
    const bars = [...RANGE, b5(3, 100.5, 100.9, 100.4, 100.8)]; // 4 × 1000
    const s = { symbol: "T", interval: "5m", barMs: 5 * MIN, candles: bars, asOf: at(4), stand, session };
    expect(prefilter(s, { ...pre, pre: { ...pre.pre, minVolume: 4000 } }, true)).toBeNull();
    expect(prefilter(s, { ...pre, pre: { ...pre.pre, minVolume: 4001 } }, true)?.skip).toBe("volume");
  });
});

describe("one chart, several setups", () => {
  const closes = flagCloses(90, [90, 90.5, 89.8, 90.2, 90.1]);
  const input = { symbol: "T", name: "T Corp", interval: "1d", barMs: DAY, candles: daily(closes), asOf: D0 + 25 * DAY, stand };
  const loose = { ...DEFAULT_PARAMS, pre: { ...DEFAULT_PARAMS.pre, minBars: 20 } };

  it("collects the hits of every chosen setup", () => {
    const r = scanSymbol(input, loose, ["flag", "rsi"]);
    expect(r.skipped).toBeNull();
    expect(r.hits.map((h) => h.setup)).toEqual(["flag"]);
  });

  it("counts a chart as scanned when at least one setup could run, and as skipped only when none could", () => {
    const few = { ...loose, pre: { ...loose.pre, minBars: 10 } };
    const short = { ...input, candles: daily(closes.slice(0, 18)), asOf: D0 + 19 * DAY }; // 18 bars: RSI(14) needs 16, the flag needs 16 → both run
    expect(scanSymbol(short, few, ["flag", "rsi"]).skipped).toBeNull();
    const tiny = { ...input, candles: daily(closes.slice(0, 15)), asOf: D0 + 16 * DAY }; // 15 bars: the flag needs 16
    expect(scanSymbol(tiny, few, ["flag"])).toMatchObject({ skipped: "few-bars", hits: [] });
    // one setup that cannot run does not hide the one that can
    const longPole = { ...few, flag: { ...few.flag, poleBars: 20 } }; // the flag now needs 26 bars, the RSI still only 16
    expect(scanSymbol(short, longPole, ["flag"]).skipped).toBe("few-bars");
    expect(scanSymbol(short, longPole, ["flag", "rsi"]).skipped).toBeNull();
    expect(scanSymbol(input, loose, ["orb"]).skipped).toBe("no-session");
  });
});

describe("ranking", () => {
  const hit = (symbol: string, setup: Hit["setup"], value: number, turnover: number | null): Hit => ({
    id: `${symbol}:${setup}`, symbol, name: null, setup, side: "long", price: 1, at: 0, metric: { label: "", value, text: "" }, reason: "", checks: [], levels: [], marks: [], turnover, preview: [], interval: "1d", stand,
  });
  const hits = [hit("B", "flag", 0.2, 5), hit("A", "flag", 0.3, null), hit("C", "rsi", 20, 9), hit("D", "rsi", 25, 7), hit("E", "orb", 0.01, 1)];

  it("puts the most traded first by default, charts without volume last", () => {
    expect(rankHits(hits, "turnover").map((h) => h.symbol)).toEqual(["C", "D", "B", "E", "A"]);
  });
  it("orders by the setup's own number within a setup (RSI: the lowest first), setups apart", () => {
    expect(rankHits(hits, "metric").map((h) => h.symbol)).toEqual(["E", "A", "B", "C", "D"]);
  });
  it("sorts by symbol", () => {
    expect(rankHits(hits, "symbol").map((h) => h.symbol)).toEqual(["A", "B", "C", "D", "E"]);
  });
});

describe("parameters", () => {
  it("falls back to the defaults for anything broken and holds numbers inside their bounds", () => {
    expect(sanitizeParams(undefined)).toEqual(DEFAULT_PARAMS);
    expect(sanitizeParams("x")).toEqual(DEFAULT_PARAMS);
    const p = sanitizeParams({ orb: { orMinutes: 17, sides: "diagonal", minBreak: 9, latestMinutes: null }, flag: { poleBars: 1000, poleMinGain: "x", flagMaxRange: -1 }, rsi: { length: 1, level: 99 }, pre: { minPrice: -5, minBars: 3, normalStatusOnly: "yes" } });
    expect(p.orb).toMatchObject({ orMinutes: 15, sides: "long", minBreak: 0.05, latestMinutes: null });
    expect(p.flag).toMatchObject({ poleBars: 40, poleMinGain: 0.1, flagMaxRange: 0.005 });
    expect(p.rsi).toMatchObject({ length: 2, level: 50 });
    expect(p.pre).toMatchObject({ minPrice: 0, minBars: 20, normalStatusOnly: true });
    expect(sanitizeParams({ orb: { orMinutes: 33 } }).orb.orMinutes).toBe(35);
  });
});

/* ------------------------------------------------------------------ the run loop */

const targets = (n: number): ScanTarget[] => Array.from({ length: n }, (_, i) => ({ symbol: `S${i}`, name: `Stock ${i}` }));
const okFor = (closes: number[]): LoadOutcome => ({ ok: true, candles: daily(closes), stand });
const flagChart = flagCloses(90, [90, 90.5, 89.8, 90.2, 90.1]);
const params: ScanParams = { ...DEFAULT_PARAMS, pre: { ...DEFAULT_PARAMS.pre, minBars: 20, maxAgeDays: 100000 } };

function source(answers: (symbol: string) => LoadOutcome, batchSize = 3): ScanSource & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    kind: "stock",
    interval: "1d",
    barMs: DAY,
    batchSize,
    calls,
    async load(batch) {
      calls.push(batch.map((t) => t.symbol));
      return Object.fromEntries(batch.map((t) => [t.symbol, answers(t.symbol)]));
    },
  };
}

describe("scan run", () => {
  it("loads in batches and counts what happened: scanned, skipped by reason, failed by reason, stale", async () => {
    const src = source((s) => {
      if (s === "S1") return { ok: false, reason: "bad-symbol", message: "Kennt die Quelle nicht." };
      if (s === "S2") return { ok: false, reason: "rate-limited", message: "Zu viele Abrufe." };
      if (s === "S3") return okFor(flagChart.map((c) => c / 100)); // price 0.9 → skipped
      if (s === "S4") return { ok: true, candles: daily(flagChart), stand: { ...stand, stale: { reason: "network", message: "Server nicht erreichbar." } } };
      if (s === "S6") return okFor(flagChart.slice(10)); // 10 bars → skipped
      return okFor(flagChart);
    });
    const progress: ScanProgress[] = [];
    const out = await runScan({ source: src, targets: targets(8), params, setups: ["flag"], onProgress: (p) => progress.push(p), now: () => 1000 });
    expect(src.calls).toEqual([["S0", "S1", "S2"], ["S3", "S4", "S5"], ["S6", "S7"]]);
    expect(out).toMatchObject({ status: "done", requested: 8, scanned: 4, skipped: 2, failed: 2, stale: 1, skippedBy: { price: 1, "few-bars": 1 }, failedBy: { "bad-symbol": 1, "rate-limited": 1 } });
    expect(out.errorRate).toBeCloseTo(0.25, 10);
    expect(out.hits.map((h) => h.symbol)).toEqual(["S0", "S4", "S5", "S7"]);
    expect(out.hits.find((h) => h.symbol === "S4")!.stand.stale).toEqual({ reason: "network", message: "Server nicht erreichbar." });
    expect(out.failures).toEqual([
      { symbol: "S1", reason: "bad-symbol", message: "Kennt die Quelle nicht." },
      { symbol: "S2", reason: "rate-limited", message: "Zu viele Abrufe." },
    ]);
    // progress only ever grows, ends on `done` with the same totals
    for (let i = 1; i < progress.length; i++) expect(progress[i]!.processed).toBeGreaterThanOrEqual(progress[i - 1]!.processed);
    expect(progress.at(-1)).toMatchObject({ phase: "done", requested: 8, processed: 8, scanned: 4, skipped: 2, failed: 2, hits: 4, batchesDone: 3, batchesTotal: 3 });
  });

  it("treats a source that throws as 'network' for the whole batch and goes on", async () => {
    let n = 0;
    const src = source(() => okFor(flagChart));
    const load = src.load.bind(src);
    src.load = async (batch, signal) => {
      if (n++ === 0) throw new Error("boom");
      return load(batch, signal);
    };
    const out = await runScan({ source: src, targets: targets(6), params, setups: ["flag"] });
    expect(out).toMatchObject({ failed: 3, scanned: 3, failedBy: { network: 3 } });
  });

  it("marks a chart the source did not answer at all", async () => {
    const src = source(() => okFor(flagChart));
    src.load = async () => ({});
    const out = await runScan({ source: src, targets: targets(2), params, setups: ["flag"] });
    expect(out.failedBy).toEqual({ "bad-response": 2 });
  });

  it("never reads more than the hard cap and says how many were requested", async () => {
    const src = source(() => okFor(flagChart), 50);
    const out = await runScan({ source: src, targets: targets(HARD_CAP + 120), params, setups: ["flag"] });
    expect(out.requested).toBe(HARD_CAP);
    expect(src.calls.flat()).toHaveLength(HARD_CAP);
  });

  it("works in time slices: it yields to the browser when a slice is used up", async () => {
    const src = source(() => okFor(flagChart), 10);
    let t = 0;
    let yields = 0;
    const out = await runScan({ source: src, targets: targets(10), params, setups: ["flag"], sliceMs: 12, clock: () => (t += 5), yieldToMain: async () => void yields++ });
    expect(out.scanned).toBe(10);
    expect(yields).toBeGreaterThanOrEqual(3);
  });

  it("stops at once on cancel and keeps what it found", async () => {
    const ctrl = new AbortController();
    const src = source(() => okFor(flagChart), 2);
    const out = await runScan({
      source: src,
      targets: targets(10),
      params,
      setups: ["flag"],
      signal: ctrl.signal,
      parallel: 1,
      onProgress: (p) => {
        if (p.processed >= 3) ctrl.abort();
      },
    });
    expect(out.status).toBe("aborted");
    expect(out.scanned).toBeGreaterThanOrEqual(3);
    expect(out.scanned).toBeLessThan(10);
    expect(out.hits.length).toBe(out.scanned);
    expect(out.requested).toBe(10);
  });

  it("does not start when the signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const src = source(() => okFor(flagChart));
    const out = await runScan({ source: src, targets: targets(5), params, setups: ["flag"], signal: ctrl.signal });
    expect(out.status).toBe("aborted");
    expect(out.scanned).toBe(0);
  });

  it("hands the opening range its session and runs the intraday rule", async () => {
    const intra: ScanSource = {
      kind: "stock",
      interval: "5m",
      barMs: 5 * MIN,
      batchSize: 5,
      load: async (batch) => Object.fromEntries(batch.map((t) => [t.symbol, { ok: true, candles: [...RANGE, b5(3, 100.5, 100.9, 100.4, 100.8), b5(4, 100.8, 101.4, 100.7, 101.2)], stand: { ...stand, fetchedAt: at(5) } } as LoadOutcome])),
      sessionFor: () => session,
    };
    const p: ScanParams = { ...DEFAULT_PARAMS, pre: { ...DEFAULT_PARAMS.pre, minVolume: 0, minPrice: 0 } };
    const out = await runScan({ source: intra, targets: [{ symbol: "AAA" }], params: p, setups: ["orb"] });
    expect(out.hits).toHaveLength(1);
    expect(out.hits[0]).toMatchObject({ symbol: "AAA", setup: "orb", at: at(5) });
    // the same source without a session: the chart is skipped for it
    const none = await runScan({ source: { ...intra, sessionFor: () => undefined }, targets: [{ symbol: "AAA" }], params: p, setups: ["orb"] });
    expect(none).toMatchObject({ scanned: 0, skipped: 1, skippedBy: { "no-session": 1 } });
  });
});
