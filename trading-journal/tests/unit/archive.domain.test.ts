/**
 * Archive domain (F26): configuration parse (default OFF), symbol choice, ring capacities, gap finding and the reasons of a
 * gap, CSV / JSON export – numbers worked out by hand.
 */
import { describe, expect, it } from "vitest";
import {
  ARCHIVE_MAX_SYMBOLS,
  DEFAULT_ARCHIVE_CFG,
  archiveFilename,
  archiveToJson,
  effectiveSymbols,
  explainGap,
  findGaps,
  gapText,
  gapThreshold,
  ivAt,
  observedSymbols,
  parseArchiveCfg,
  pointsToCsv,
  ringCap,
  seriesDef,
  withArchiveCfg,
  type ArchivePoint,
  type TickRecord,
} from "@/domain/archive";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 26, 2, 0, 0);
const tick = (min: number, res: Record<string, string>, iv = 10, states = false): TickRecord => ({ t: T0 + min * MIN, iv, route: "direct", res, states });

describe("archive config", () => {
  it("is off by default and reads anything malformed as the default", () => {
    expect(DEFAULT_ARCHIVE_CFG.on).toBe(false);
    expect(parseArchiveCfg(null)).toEqual(DEFAULT_ARCHIVE_CFG);
    expect(parseArchiveCfg("x")).toEqual(DEFAULT_ARCHIVE_CFG);
    expect(parseArchiveCfg({ on: "true", everyMin: 7, maxMb: 3, picked: "BTC" })).toEqual(DEFAULT_ARCHIVE_CFG);
  });

  it("switches on only for exactly true and keeps valid choices", () => {
    const c = parseArchiveCfg({ on: true, everyMin: 5, maxMb: 50, states: false, picked: ["eth", "BTCUSDT", "ETHUSDT", "!!"] });
    expect(c).toMatchObject({ on: true, everyMin: 5, maxMb: 50, states: false, picked: ["ETHUSDT", "BTCUSDT"] });
  });

  it("withArchiveCfg returns the same object when nothing changes", () => {
    const c = parseArchiveCfg({ on: true });
    expect(withArchiveCfg(c, { on: true })).toBe(c);
    expect(withArchiveCfg(c, { everyMin: 15 })).not.toBe(c);
  });

  it("caps an explicit pick at 8 symbols", () => {
    const many = Array.from({ length: 12 }, (_, i) => `A${i}USDT`);
    expect(parseArchiveCfg({ picked: many }).picked).toHaveLength(ARCHIVE_MAX_SYMBOLS);
  });

  it("automatic choice = the live symbol plus the first of the watchlist, five at most, no duplicates", () => {
    const observed = observedSymbols("BINANCE:ETHUSDT", ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"]);
    expect(observed).toEqual(["ETHUSDT", "BTCUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"]);
    expect(effectiveSymbols(DEFAULT_ARCHIVE_CFG, observed)).toEqual(["ETHUSDT", "BTCUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]);
    expect(effectiveSymbols({ ...DEFAULT_ARCHIVE_CFG, picked: ["SOLUSDT"] }, observed)).toEqual(["SOLUSDT"]);
    expect(effectiveSymbols({ ...DEFAULT_ARCHIVE_CFG, picked: [] }, observed)).toEqual([]);
  });
});

describe("ring capacity", () => {
  it("is the series' own cap while the budget is large", () => {
    // 25 MB / 131,11 B = 190 678 points; over 72 rows = 2 648 → below the own cap of 8 640
    expect(ringCap("oi", 72, 25)).toBe(2648);
    expect(ringCap("oi", 5, 25)).toBe(8640);
  });

  it("takes an equal share of a small budget: 10 MB over 9 rows", () => {
    // 10 000 000 / 131,111 = 76 271,2 points; / 9 rows = 8 474,6 → 8 474
    expect(ringCap("oi", 9, 10)).toBe(8474);
    expect(ringCap("lage", 9, 10)).toBe(4320);
    expect(ringCap("oi", 0, 10)).toBe(8640);
  });
});

describe("gaps", () => {
  const premium = seriesDef("premium");
  const ratio = seriesDef("lsAcc");

  it("threshold = 2,5 × the interval (snapshot) or × max(interval, 5 min) (5-minute series)", () => {
    expect(gapThreshold(premium, 10)).toBe(25 * MIN);
    expect(gapThreshold(premium, 5)).toBe(12.5 * MIN);
    expect(gapThreshold(ratio, 5)).toBe(12.5 * MIN);
    expect(gapThreshold(ratio, 15)).toBe(37.5 * MIN);
  });

  it("the interval in force is that of the last tick at or before the time", () => {
    const ticks = [tick(0, {}, 5), tick(30, {}, 15)];
    expect(ivAt(ticks, T0 + 10 * MIN)).toBe(5);
    expect(ivAt(ticks, T0 + 30 * MIN)).toBe(15);
    expect(ivAt(ticks, T0 - 5 * MIN)).toBe(5);
    expect(ivAt([], T0)).toBe(15);
  });

  it("finds no gap at exactly the threshold and one just above it", () => {
    const ticks = [tick(0, { A: "ok" })];
    const t = (m: number) => T0 + m * MIN;
    expect(findGaps(premium, "A", [t(0), t(25)], ticks)).toEqual([]);
    expect(findGaps(premium, "A", [t(0), t(25) + 1], ticks)).toHaveLength(1);
  });

  it("no tick inside → the app was closed", () => {
    const g = findGaps(premium, "A", [T0, T0 + 3 * 3_600_000], [tick(0, { A: "ok" })]);
    expect(g).toEqual([{ from: T0, to: T0 + 180 * MIN, cause: "app", detail: null, ticks: 0 }]);
    expect(gapText(g[0]!)).toBe("App war zu oder pausiert – kein Abruf versucht");
  });

  it("ticks with failures → the most frequent reason (a partial failure counts for its reason)", () => {
    const ticks = [tick(0, { A: "ok" }), tick(10, { A: "network" }), tick(20, { A: "partial:network" }), tick(30, { A: "timeout" }), tick(40, { A: "ok" })];
    // points at 0 and 40 (the 30-minute-later tick 40 wrote the next one): 40 min > 25 min; inside (10, 20, 30): network ×2, timeout ×1
    const g = findGaps(premium, "A", [T0, T0 + 40 * MIN], ticks);
    expect(g).toEqual([{ from: T0, to: T0 + 40 * MIN, cause: "failed", detail: "network", ticks: 3 }]);
    expect(gapText(g[0]!)).toBe("Abruf fehlgeschlagen: Netzwerk- oder CORS-Fehler");
  });

  it("ticks without the symbol → it was not selected", () => {
    const ticks = [tick(0, { A: "ok" }), tick(10, { B: "ok" }), tick(20, { B: "ok" }), tick(30, { B: "ok" })];
    expect(explainGap(premium, "A", T0, T0 + 40 * MIN, ticks)).toEqual({ cause: "unwatched", detail: null, ticks: 3 });
  });

  it("ticks that were fine but no point → unknown, never a guess", () => {
    const ticks = [tick(0, { A: "ok" }), tick(10, { A: "ok" }), tick(20, { A: "ok" }), tick(30, { A: "ok" })];
    expect(explainGap(premium, "A", T0, T0 + 40 * MIN, ticks).cause).toBe("unknown");
  });

  it("state series: ticks ran without writing the state → the analysis was not there", () => {
    const lage = seriesDef("lage");
    const ticks = [tick(0, { A: "ok" }, 10, true), tick(10, { A: "network" }), tick(20, { A: "ok" }), tick(30, { A: "ok" }), tick(40, { A: "ok" }, 10, true)];
    expect(findGaps(lage, "A", [T0, T0 + 40 * MIN], ticks)).toEqual([{ from: T0, to: T0 + 40 * MIN, cause: "analysis", detail: null, ticks: 3 }]);
  });

  it("5-minute series: the tick that observed the point before the gap does not count as 'inside'", () => {
    // last point 02:00 was observed by the tick at 02:07 (published late); the app closed right after → still 'app'
    const ticks = [tick(7, { A: "ok" })];
    const g = findGaps(ratio, "A", [T0, T0 + 90 * MIN], ticks);
    expect(g[0]).toMatchObject({ cause: "app", ticks: 0 });
  });
});

describe("export", () => {
  const pts: ArchivePoint[] = [
    { series: "lsAcc", symbol: "ETHUSDT", t: T0 + 5 * MIN, d: { long: 61.5, short: 38.5, ratio: 1.5974 } },
    { series: "lsAcc", symbol: "BTCUSDT", t: T0 + 5 * MIN, d: { long: 60, short: 40, ratio: 1.5 } },
    { series: "lsAcc", symbol: "BTCUSDT", t: T0, d: { long: 59.9, short: null, ratio: 1.49 } },
  ];

  it("CSV: header from the series table, UTC ISO time + epoch, sorted by symbol and time, empty cell for 'no value'", () => {
    expect(pointsToCsv("lsAcc", pts)).toBe(
      [
        "zeit_utc,epoch_ms,symbol,long,short,ratio",
        `2026-10-26T02:00:00.000Z,${T0},BTCUSDT,59.9,,1.49`,
        `2026-10-26T02:05:00.000Z,${T0 + 5 * MIN},BTCUSDT,60,40,1.5`,
        `2026-10-26T02:05:00.000Z,${T0 + 5 * MIN},ETHUSDT,61.5,38.5,1.5974`,
        "",
      ].join("\n"),
    );
  });

  it("CSV quotes a word that holds a comma or a quote", () => {
    const csv = pointsToCsv("box4h", [{ series: "box4h", symbol: "BTCUSDT", t: T0, d: { phase: 'a,"b"', dir: 1, top: 2, bottom: 1, grade: "A", pos: 0.5, price: 1.5 } }]);
    expect(csv.split("\n")[1]).toContain(',"a,""b""",');
  });

  it("JSON: points, gaps and the honest note; nothing filled", () => {
    const json = JSON.parse(archiveToJson([{ series: "lsAcc", symbol: "BTCUSDT", points: [pts[2]!, pts[1]!], gaps: [{ from: T0, to: T0 + 50 * MIN, cause: "app", detail: null, ticks: 0 }] }], { exportedAt: T0 })) as {
      format: string;
      exportedAt: string;
      note: string;
      series: Array<{ count: number; points: Array<Record<string, unknown>>; gaps: Array<Record<string, unknown>>; fields: Array<{ key: string }> }>;
    };
    expect(json.format).toBe("tj-archive");
    expect(json.exportedAt).toBe("2026-10-26T02:00:00.000Z");
    expect(json.note).toContain("nie gefüllt oder geschätzt");
    expect(json.series[0]!.count).toBe(2);
    expect(json.series[0]!.points[0]).toEqual({ t: T0, time: "2026-10-26T02:00:00.000Z", long: 59.9, short: null, ratio: 1.49 });
    expect(json.series[0]!.gaps[0]).toEqual({ from: "2026-10-26T02:00:00.000Z", to: "2026-10-26T02:50:00.000Z", cause: "app", detail: null, ticks: 0 });
    expect(json.series[0]!.fields.map((f) => f.key)).toEqual(["long", "short", "ratio"]);
  });

  it("file names", () => {
    const d = new Date(T0);
    expect(archiveFilename("csv", "premium", "BTCUSDT", d)).toBe("tj-archiv-premium-BTCUSDT-2026-10-26.csv");
    expect(archiveFilename("json", null, null, d)).toBe("tj-archiv-alles-2026-10-26.json");
  });
});
