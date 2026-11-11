/**
 * „Börsenhistorie nachladen“ (F26/F07), the pure part: the range and the request windows, the preview numbers, how answers
 * become points (own series, invalid rows dropped, nothing filled), the gap rule of a backfilled series, the ring that leaves
 * it alone, the run log, and the funding step function of the squeeze data – numbers worked out by hand.
 */
import { describe, expect, it } from "vitest";
import {
  BACKFILL_LOG_CAP,
  BACKFILL_SERIES_ORDER,
  EXCHANGE_HISTORY_MS,
  HISTORY_EDGE_MARGIN_MS,
  appendBackfillRun,
  backfillRange,
  cutWindows,
  findGaps,
  fundingHistPoints,
  gapText,
  isBackfillSeries,
  markHistPoints,
  oiHistPoints,
  parseBackfillLog,
  planBackfill,
  pointsToCsv,
  ratioHistPoints,
  ringCap,
  seriesDef,
  seriesResult,
  windowsOf,
  archiveToJson,
  type BackfillRun,
} from "@/domain/archive";
import { FUNDING_MAX_AGE_MS, historyCoverage, squeezeDataFromHistory } from "@/domain/squeeze";

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
/** 2026-10-26 12:03:00 UTC – three minutes into a 5-minute step */
const NOW = Date.UTC(2026, 9, 26, 12, 3, 0);

describe("range and windows", () => {
  it("30 days stay 6 hours inside Binance's window, on whole 5-minute steps", () => {
    expect(EXCHANGE_HISTORY_MS).toBe(30 * DAY);
    expect(HISTORY_EDGE_MARGIN_MS).toBe(6 * H);
    const r = backfillRange(30, NOW);
    // to = 12:00 (the 12:03 is cut back to the step); from = 30 d − 6 h before 12:03 = 09-26 18:03 → up to 18:05
    expect(r.to).toBe(Date.UTC(2026, 9, 26, 12, 0, 0));
    expect(r.from).toBe(Date.UTC(2026, 8, 26, 18, 5, 0));
  });

  it("7 days: from = 12:03 − 7 d = 10-19 12:03 → 12:05", () => {
    const r = backfillRange(7, NOW);
    expect(r.from).toBe(Date.UTC(2026, 9, 19, 12, 5, 0));
    expect(r.to).toBe(Date.UTC(2026, 9, 26, 12, 0, 0));
  });

  it("asking for more than the exchange holds is cut back to the window", () => {
    expect(backfillRange(90, NOW)).toEqual(backfillRange(30, NOW));
  });

  it("cutWindows: pieces of at most `steps` steps, no overlap, the last one ends at `to`", () => {
    const step = 5 * MIN;
    const w = cutWindows(0, 10 * step, step, 4); // grid points 0 … 10 (11 points)
    expect(w).toEqual([
      { from: 0, to: 4 * step - 1 },
      { from: 4 * step, to: 8 * step - 1 },
      { from: 8 * step, to: 10 * step },
    ]);
    expect(cutWindows(10, 5, step, 4)).toEqual([]);
    expect(cutWindows(0, 100, 0, 4)).toEqual([]);
  });

  it("every window holds at most the documented limit (500 ratios, 1500 klines), whichever way the exchange orders its rows", () => {
    const { from, to } = backfillRange(30, NOW);
    for (const s of ["oiHist", "lsAccHist", "lsTopPosHist", "lsTopAccHist"] as const) {
      const w = windowsOf(s, from, to);
      expect(w).toHaveLength(18); // 8 568 steps + 1 = 8 568 points / 480 = 17,85
      for (const x of w) expect(Math.floor((x.to - x.from) / (5 * MIN)) + 1).toBeLessThanOrEqual(480);
      expect(w[0]!.from).toBe(from);
      expect(w[w.length - 1]!.to).toBe(to);
    }
    const k = windowsOf("markHist", from, to);
    expect(k).toHaveLength(6); // 8 568 / 1 440 = 5,95
    for (const x of k) expect(Math.floor((x.to - x.from) / (5 * MIN)) + 1).toBeLessThanOrEqual(1440);
    expect(windowsOf("fundingHist", from, to)).toEqual([{ from, to }]);
  });
});

describe("the preview", () => {
  it("7 days, one symbol: 1 funding + 2 mark + 5 × 4 five-minute requests = 23", () => {
    const p = planBackfill(["BTCUSDT"], 7, NOW);
    expect(p.perSymbol).toBe(23);
    expect(p.requests).toBe(23);
    // 7 d − 5 min = 2 015 steps → 2 016 points for each of the five 5-minute datasets, 21 funding settlements
    expect(p.points).toBe(5 * 2016 + 21);
    expect(p.bytes).toBe(2016 * (80 + 110 + 120 + 120 + 120) + 21 * 80);
    expect(p.seconds).toBe(Math.ceil(23 * 0.6));
  });

  it("30 days, five symbols: 79 requests each; duplicates and the 9th symbol are dropped", () => {
    const p = planBackfill(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"], 30, NOW);
    expect(p.perSymbol).toBe(79);
    expect(p.requests).toBe(5 * 79);
    const many = planBackfill(["A", "B", "C", "D", "E", "F", "G", "H", "I", "A"].map((s) => `${s}USDT`), 7, NOW);
    expect(many.symbols).toHaveLength(8);
    expect(planBackfill([], 7, NOW)).toMatchObject({ requests: 0, points: 0, bytes: 0 });
  });
});

describe("answers → points", () => {
  const W = { from: 1000 * MIN, to: 1100 * MIN };

  it("open interest: its own series, the value kept, a negative or non-finite row dropped, a repeated time counted once", () => {
    const pts = oiHistPoints(
      "BTCUSDT",
      [
        { time: 1010 * MIN, openInterest: 100, openInterestValue: 8_000_000 },
        { time: 1005 * MIN, openInterest: 99, openInterestValue: Number.NaN },
        { time: 1015 * MIN, openInterest: -1, openInterestValue: 1 },
        { time: 1020 * MIN, openInterest: Number.NaN, openInterestValue: 1 },
        { time: 1010 * MIN, openInterest: 101, openInterestValue: 8_100_000 },
        { time: 900 * MIN, openInterest: 50, openInterestValue: 1 },
      ],
      W,
    );
    expect(pts).toEqual([
      { series: "oiHist", symbol: "BTCUSDT", t: 1005 * MIN, d: { oi: 99, value: null } },
      { series: "oiHist", symbol: "BTCUSDT", t: 1010 * MIN, d: { oi: 101, value: 8_100_000 } },
    ]);
  });

  it("ratios: kept as the exchange gave them (percent), out-of-range shares dropped", () => {
    const pts = ratioHistPoints("lsAccHist", "BTCUSDT", [
      { time: 1000 * MIN, longPct: 66.22, shortPct: 33.78, ratio: 1.96 },
      { time: 1005 * MIN, longPct: 120, shortPct: -20, ratio: 1 },
      { time: 1010 * MIN, longPct: 50, shortPct: 50, ratio: Number.NaN },
    ], W);
    expect(pts.map((p) => p.t)).toEqual([1000 * MIN, 1010 * MIN]);
    expect(pts[0]).toEqual({ series: "lsAccHist", symbol: "BTCUSDT", t: 1000 * MIN, d: { long: 66.22, short: 33.78, ratio: 1.96 } });
    expect(pts[1]!.d.ratio).toBeNull();
  });

  it("funding: the settlement time and the rate; a row outside the window is not taken", () => {
    const pts = fundingHistPoints("BTCUSDT", [{ time: 1000 * MIN, fundingRate: 0.0001 }, { time: 5000 * MIN, fundingRate: 0.5 }, { time: 1050 * MIN, fundingRate: Number.NaN }], W);
    expect(pts).toEqual([{ series: "fundingHist", symbol: "BTCUSDT", t: 1000 * MIN, d: { rate: 0.0001 } }]);
  });

  it("mark price: the CLOSE of a closed candle, stamped with the end of the candle; the forming candle and a zero price are dropped", () => {
    const pts = markHistPoints("BTCUSDT", [
      { time: 1000 * MIN, close: 80_000.5, closed: true },
      { time: 1005 * MIN, close: 80_010, closed: false },
      { time: 1010 * MIN, close: 0, closed: true },
    ], W);
    expect(pts).toEqual([{ series: "markHist", symbol: "BTCUSDT", t: 1005 * MIN, d: { mark: 80_000.5 } }]);
  });
});

describe("series table and gaps", () => {
  it("the six backfilled series are their own ids with kind backfill; the collected ones are not", () => {
    expect(BACKFILL_SERIES_ORDER.map((s) => seriesDef(s).kind)).toEqual(Array(6).fill("backfill"));
    expect(BACKFILL_SERIES_ORDER.every(isBackfillSeries)).toBe(true);
    expect(isBackfillSeries("oi")).toBe(false);
    expect(isBackfillSeries("premium")).toBe(false);
    for (const s of BACKFILL_SERIES_ORDER) expect(seriesDef(s).label).toContain("nachgeladen");
  });

  it("a gap in a backfilled row is > 2,5 × the exchange's step (12,5 min for 5-minute rows) and says the history had no value", () => {
    const def = seriesDef("oiHist");
    const t = (m: number) => 1000 * MIN + m * MIN;
    expect(findGaps(def, "A", [t(0), t(5), t(10), t(22)], [])).toEqual([]); // 12 min between 10 and 22 is no gap
    const gaps = findGaps(def, "A", [t(0), t(5), t(10), t(23)], []);
    expect(gaps).toEqual([{ from: t(10), to: t(23), cause: "history", detail: null, ticks: 0 }]);
    expect(gapText(gaps[0]!)).toContain("Börsenhistorie");
    // the collector's tick interval does not stretch the threshold of a backfilled row
    expect(findGaps(def, "A", [t(0), t(30)], [{ t: t(0), iv: 15, route: "direct", res: {}, states: false }])).toHaveLength(1);
  });

  it("funding rows use the 8 h rhythm: 19 h between settlements is no gap, 21 h is", () => {
    const def = seriesDef("fundingHist");
    expect(findGaps(def, "A", [0, 19 * H], [])).toEqual([]);
    expect(findGaps(def, "A", [0, 21 * H], [])).toHaveLength(1);
  });

  it("the ring leaves backfilled rows alone: unbounded capacity, and they are not counted into the share of the others", () => {
    expect(ringCap("oiHist", 100, 10)).toBe(Number.POSITIVE_INFINITY);
    expect(ringCap("markHist", 1, 10)).toBe(Number.POSITIVE_INFINITY);
    expect(ringCap("oi", 1, 100)).toBe(seriesDef("oi").cap);
  });

  it("CSV and JSON carry the header of the backfilled series, the JSON marks it as kind backfill", () => {
    const pts = ratioHistPoints("lsTopPosHist", "BTCUSDT", [{ time: 60 * MIN, longPct: 45, shortPct: 55, ratio: 0.82 }], { from: 0, to: 120 * MIN });
    const csv = pointsToCsv("lsTopPosHist", pts).split("\n");
    expect(csv[0]).toBe("zeit_utc,epoch_ms,symbol,long,short,ratio");
    expect(csv[1]).toBe(`1970-01-01T01:00:00.000Z,${60 * MIN},BTCUSDT,45,55,0.82`);
    const json = JSON.parse(archiveToJson([{ series: "lsTopPosHist", symbol: "BTCUSDT", points: pts, gaps: [] }], { exportedAt: 0 })) as { note: string; series: Array<{ kind: string; label: string }> };
    expect(json.series[0]).toMatchObject({ kind: "backfill", label: "Long/Short · Top-Trader-Positionen (nachgeladen)" });
    expect(json.note).toContain("nachgeladen");
  });
});

describe("results and the run log", () => {
  it("seriesResult: all windows → ok · some → partial:<first reason> · none → the reason or skipped", () => {
    expect(seriesResult(6, 6, [])).toBe("ok");
    expect(seriesResult(6, 4, ["network"])).toBe("partial:network");
    expect(seriesResult(6, 4, [])).toBe("partial:skipped");
    expect(seriesResult(6, 0, ["blocked_451", "blocked_451"])).toBe("blocked_451");
    expect(seriesResult(6, 0, [])).toBe("skipped");
  });

  const run = (t: number, over: Partial<BackfillRun> = {}): BackfillRun => ({ t, end: "done", days: 7, from: 1, to: 2, route: "direct", symbols: ["BTCUSDT"], points: 5, res: { BTCUSDT: { oiHist: "ok" } }, ...over });

  it("the log keeps the newest 10 runs, newest first", () => {
    let log: BackfillRun[] = [];
    for (let i = 0; i < 12; i++) log = appendBackfillRun(log, run(1000 + i));
    expect(log).toHaveLength(BACKFILL_LOG_CAP);
    expect(log[0]!.t).toBe(1011);
    expect(log[9]!.t).toBe(1002);
  });

  it("parses a stored log leniently: wrong version, junk rows and non-string results are left out", () => {
    expect(parseBackfillLog(null)).toEqual([]);
    expect(parseBackfillLog({ v: 2, runs: [run(1)] })).toEqual([]);
    const good = run(5);
    const parsed = parseBackfillLog({ v: 1, runs: [good, { t: "x" }, null, { ...run(6), end: "weird" }, { ...run(7), res: { BTCUSDT: { oiHist: 4, markHist: "ok" } } }] });
    expect(parsed.map((r) => r.t)).toEqual([7, 5]);
    expect(parsed[0]!.res).toEqual({ BTCUSDT: { markHist: "ok" } });
  });
});

describe("squeeze data from the loaded history", () => {
  it("the funding rate at a price sample is the last settlement at or before it – while it is at most 9 h old, else null", () => {
    expect(FUNDING_MAX_AGE_MS).toBe(9 * H);
    const data = squeezeDataFromHistory({
      mark: [0, 1, 7, 9, 9.5, 17, 18].map((h) => ({ t: h * H, mark: 100 + h })),
      funding: [{ t: 0.5 * H, rate: 0.0001 }, { t: 8.5 * H, rate: -0.0002 }],
      oi: [],
      ls: [],
      top: [],
    });
    // 0 h: before the first settlement → null · 1 h, 7 h: the 0,5 h settlement (0,5 h and 6,5 h old)
    // 9 h: the 8,5 h settlement · 9,5 h: same · 17 h: 8,5 h old → still · 18 h: 9,5 h old → null
    expect(data.premium.map((p) => p.rate)).toEqual([null, 0.0001, 0.0001, -0.0002, -0.0002, -0.0002, null]);
    expect(data.premium.map((p) => p.mark)).toEqual([100, 101, 107, 109, 109.5, 117, 118]);
  });

  it("a settlement older than 9 h is not dressed as the current rate (7 h silence is fine, 9,1 h is not)", () => {
    const d = squeezeDataFromHistory({ mark: [{ t: 9.1 * H, mark: 1 }, { t: 9 * H, mark: 1 }].sort((a, b) => a.t - b.t), funding: [{ t: 0, rate: 0.001 }], oi: [], ls: [], top: [] });
    expect(d.premium.map((p) => p.rate)).toEqual([0.001, null]);
  });

  it("without a funding series every rate is unknown; coverage is first to last price sample", () => {
    const rows = { mark: [{ t: 0, mark: 1 }, { t: 6 * H, mark: 2 }], funding: [], oi: [], ls: [], top: [] };
    expect(squeezeDataFromHistory(rows).premium.every((p) => p.rate === null)).toBe(true);
    expect(historyCoverage(rows)).toEqual({ first: 0, last: 6 * H, hours: 6 });
    expect(historyCoverage({ mark: [] })).toBeNull();
  });
});
