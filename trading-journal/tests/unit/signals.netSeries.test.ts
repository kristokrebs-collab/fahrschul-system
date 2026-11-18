/**
 * Top-Trader card (C3): the series, the stored history and the gaps – pure. The grid of what is stored, the join of the stored
 * history with the live series (the live one wins where it reaches), the gaps (never filled), the newest run, the net view of
 * already-built points, the CSV, and the two feeds of the live series (`deriveLiveTraderNet` with the account feed).
 */
import { describe, expect, it } from "vitest";
import { buildTraderNetFromPoints, netTitle, type NetPoint } from "@/domain/signals";
import {
  ARCHIVE_GRID_MS,
  ARCHIVE_KEEP_MS,
  NET_GAP_FACTOR,
  NET_SERIES,
  archiveStepOf,
  archivedOf,
  archivedToNet,
  findNetGaps,
  gapText,
  gapsIn,
  isNetSeriesId,
  latestRun,
  mergeNetPoints,
  netPointsToCsv,
  netStampText,
  pointsForArchive,
  runsOf,
} from "@/domain/signals/netSeries";
import { buildFeedSpecs, deriveLiveTraderNet, initialHealth, type RatioPoint, type Stamped } from "@/market";

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 1);

const np = (i: number, long: number, step = H, price: number | null = 70_000 + i, s?: number): NetPoint => ({ t: T0 + i * step, net: 2 * long - 100, longPct: long, price, ...(s ? { s } : {}) });

describe("series table", () => {
  it("two series of the same cohort, never called Wale", () => {
    expect(Object.keys(NET_SERIES)).toEqual(["position", "account"]);
    expect(NET_SERIES.position.who).toBe("Top-Trader (Binance)");
    expect(NET_SERIES.account.who).toBe("Top-Trader (Binance, nach Konten)");
    expect(NET_SERIES.position.endpoint).toBe("topLongShortPositionRatio");
    expect(NET_SERIES.account.endpoint).toBe("topLongShortAccountRatio");
    expect(JSON.stringify(NET_SERIES)).not.toMatch(/Wal(e|s)|Glassnode/);
    expect(isNetSeriesId("account")).toBe(true);
    expect(isNetSeriesId("retail")).toBe(false);
  });

  it("the headline names the series it is about", () => {
    const v = buildTraderNetFromPoints(Array.from({ length: 30 }, (_, i) => np(i, i < 15 ? 55 : 45)), T0 + 30 * H, 70_030);
    expect(netTitle(v, NET_SERIES.account.who).text).toMatch(/^Top-Trader \(Binance, nach Konten\) sind seit \d\d\.\d\d\. netto Short/);
    expect(netTitle(v).text).toMatch(/^Top-Trader \(Binance\) sind seit/);
  });
});

describe("what is stored", () => {
  it("keeps one point per hour: on a 5-minute or 15-minute period only the points on the hour", () => {
    const quarter: NetPoint[] = Array.from({ length: 12 }, (_, i) => ({ t: T0 + i * 15 * 60_000, net: 10, longPct: 55, price: 70_000 }));
    const got = pointsForArchive(quarter, 15 * 60_000);
    expect(got.map((p) => p.t)).toEqual([T0, T0 + H, T0 + 2 * H]);
    expect(got.every((p) => p.s === H)).toBe(true);
  });

  it("a longer period keeps its own spacing", () => {
    const four: NetPoint[] = Array.from({ length: 5 }, (_, i) => ({ t: T0 + i * 4 * H, net: 0, longPct: 50, price: null }));
    const got = pointsForArchive(four, 4 * H);
    expect(got).toHaveLength(5);
    expect(got.every((p) => p.s === 4 * H && p.price === null)).toBe(true);
    expect(archiveStepOf(5 * 60_000)).toBe(ARCHIVE_GRID_MS);
    expect(archiveStepOf(4 * H)).toBe(4 * H);
    expect(archiveStepOf(NaN)).toBe(ARCHIVE_GRID_MS);
  });

  it("drops points that are not numbers or not percentages", () => {
    const bad: NetPoint[] = [np(0, 55), { ...np(1, 55), longPct: NaN }, { ...np(2, 55), longPct: 120 }, np(3, 40)];
    expect(pointsForArchive(bad, H).map((p) => p.long)).toEqual([55, 40]);
  });

  it("reads a stored row tolerantly", () => {
    expect(archivedOf({ t: 1, l: 55, p: 70_000, s: H })).toEqual({ t: 1, long: 55, price: 70_000, s: H });
    expect(archivedOf({ t: 1, l: 55 })).toEqual({ t: 1, long: 55, price: null, s: H });
    expect(archivedOf({ t: 1, l: 155 })).toBeNull();
    expect(archivedOf({ t: "x", l: 5 })).toBeNull();
    expect(archivedOf(null)).toBeNull();
    expect(archivedToNet({ t: 5, long: 60, price: null, s: H })).toEqual({ t: 5, net: 20, longPct: 60, price: null, s: H });
  });

  it("keeps up to 180 days", () => {
    expect(ARCHIVE_KEEP_MS).toBe(180 * 24 * H);
  });
});

describe("the stored history joins the live series", () => {
  const stored = (i: number, long: number) => ({ t: T0 + i * H, long, price: 70_000, s: H });

  it("stored points count only where the live series does not reach; the live ones win", () => {
    const live = [np(10, 40), np(11, 41), np(12, 42)];
    const got = mergeNetPoints([stored(0, 60), stored(5, 61), stored(10, 99), stored(11, 99)], live, H);
    expect(got.map((p) => p.t)).toEqual([T0, T0 + 5 * H, T0 + 10 * H, T0 + 11 * H, T0 + 12 * H]);
    expect(got.map((p) => p.longPct)).toEqual([60, 61, 40, 41, 42]);
    expect(got.every((p) => typeof p.s === "number")).toBe(true);
  });

  it("without a live series the stored history stands alone", () => {
    expect(mergeNetPoints([stored(1, 55), stored(0, 54)], [], H).map((p) => p.longPct)).toEqual([54, 55]);
    expect(mergeNetPoints([], [], H)).toEqual([]);
  });
});

describe("gaps are never filled", () => {
  it("a distance of more than 2,5 spacings is a gap, one missing point is not", () => {
    expect(NET_GAP_FACTOR).toBe(2.5);
    const regular = Array.from({ length: 10 }, (_, i) => np(i, 55));
    expect(findNetGaps(regular, H)).toEqual([]);
    // one point missing: two spacings between the neighbours – still no gap
    const one = regular.filter((p) => p.t !== T0 + 4 * H);
    expect(findNetGaps(one, H)).toEqual([]);
    // two missing: three spacings – a gap, and nothing is put inside it
    const two = regular.filter((p) => ![4, 5].includes((p.t - T0) / H));
    expect(findNetGaps(two, H)).toEqual([{ from: T0 + 3 * H, to: T0 + 6 * H, index: 3 }]);
    const four = regular.filter((p) => ![4, 5, 6].includes((p.t - T0) / H));
    expect(findNetGaps(four, H)).toEqual([{ from: T0 + 3 * H, to: T0 + 7 * H, index: 3 }]);
  });

  it("uses the larger spacing of the two neighbours (hourly stored points next to quarter-hour live ones)", () => {
    const pts: NetPoint[] = [np(0, 55, H, 1, H), np(1, 55, H, 1, H), { t: T0 + 3 * H + 15 * 60_000, net: 0, longPct: 50, price: null, s: 15 * 60_000 }];
    // 2 h 15 min between the hourly point and the quarter-hour one: at most 2,5 hours – no gap
    expect(findNetGaps(pts, 15 * 60_000)).toEqual([]);
    const far: NetPoint[] = [np(0, 55, H, 1, H), { t: T0 + 4 * H, net: 0, longPct: 50, price: null, s: 15 * 60_000 }];
    expect(findNetGaps(far, 15 * 60_000)).toHaveLength(1);
  });

  it("the newest run is the part after the last gap; the runs split at every gap", () => {
    const pts = [np(0, 55), np(1, 55), np(10, 45), np(11, 45), np(20, 60)];
    const gaps = findNetGaps(pts, H);
    expect(gaps.map((g) => [g.from, g.to])).toEqual([
      [T0 + H, T0 + 10 * H],
      [T0 + 11 * H, T0 + 20 * H],
    ]);
    expect(latestRun(pts, gaps).map((p) => p.t)).toEqual([T0 + 20 * H]);
    expect(runsOf(pts, gaps).map((r) => r.length)).toEqual([2, 2, 1]);
    expect(latestRun(pts, [])).toHaveLength(5);
    expect(runsOf(pts, [])).toHaveLength(1);
    expect(gapsIn(gaps, T0 + 12 * H, T0 + 30 * H)).toHaveLength(1);
  });

  it("says a gap in words, with both ends in UTC and no value", () => {
    const text = gapText({ from: Date.UTC(2026, 9, 28, 14), to: Date.UTC(2026, 9, 30, 2) });
    expect(text).toBe("Lücke 28.10. 14:00 – 30.10. 02:00 UTC · 36 Std. ohne Messwerte");
    expect(gapText({ from: T0, to: T0 + 5 * 24 * H })).toContain("5 Tage ohne Messwerte");
    expect(netStampText(Date.UTC(2026, 9, 28, 9, 5))).toBe("28.10. 09:05");
  });
});

describe("the net view of already-built points", () => {
  it("finds the same flip as the view of the raw series", () => {
    const pts = Array.from({ length: 40 }, (_, i) => np(i, i < 25 ? 56 : 44));
    const v = buildTraderNetFromPoints(pts, T0 + 40 * H, 70_040);
    expect(v.status).toBe("ok");
    expect(v.flip).toMatchObject({ from: "long", to: "short" });
    expect(v.flip!.at).toBeGreaterThan(T0 + 24 * H);
    expect(v.flip!.at).toBeLessThan(T0 + 25 * H);
    // the price at the crossing is the price of the newest point at or before it
    expect(v.flip!.priceAt).toBe(70_024);
    expect(v.flip!.priceChangePct).toBeCloseTo(((70_040 - 70_024) / 70_024) * 100, 6);
  });

  it("too few points are 'short', none is 'none', bad points are dropped", () => {
    expect(buildTraderNetFromPoints([np(0, 55), np(1, 55)], T0, null).status).toBe("short");
    expect(buildTraderNetFromPoints([], T0, null).status).toBe("none");
    const v = buildTraderNetFromPoints([...Array.from({ length: 12 }, (_, i) => np(i, 55)), { t: NaN, net: 1, longPct: 51, price: null }], T0 + 12 * H, null);
    expect(v.count).toBe(12);
    expect(v.priceNow).toBeNull();
  });
});

describe("CSV", () => {
  it("lists every point with where it came from, and the gaps as comments (no row inside a gap)", () => {
    const pts = [np(0, 55), np(1, 56), np(10, 44)];
    const gaps = findNetGaps(pts, H);
    const csv = netPointsToCsv(pts, gaps, T0 + 10 * H);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("zeit_utc,long_prozent,netto_punkte,preis,herkunft");
    expect(lines[1]).toBe(`${new Date(T0).toISOString()},55.00,10.00,70000,gespeichert`);
    expect(lines[3]).toContain(",geladen");
    expect(lines[4]).toBe(`# Lücke ohne Messwerte: ${new Date(T0 + H).toISOString()} bis ${new Date(T0 + 10 * H).toISOString()}`);
    expect(lines).toHaveLength(5);
  });

  it("an unknown price is an empty cell", () => {
    expect(netPointsToCsv([np(0, 50, H, null)], [], null).split("\n")[1]).toBe(`${new Date(T0).toISOString()},50.00,0.00,,gespeichert`);
  });
});

describe("the two live feeds (positions / accounts)", () => {
  const specs = buildFeedSpecs("1h");
  const NOW = T0 + 29 * H + 60_000;
  const ratio = (n: number, long: number): RatioPoint[] => Array.from({ length: n }, (_, i) => ({ time: T0 + i * H, longPct: long, shortPct: 100 - long, ratio: 1 }));
  const stamp = <T,>(data: T): Stamped<T> => ({ data, asOf: NOW, receivedAt: NOW, source: "binance", comparable: true });
  const health = (feed: "topPositionRatio" | "topAccountRatio") => {
    const h = initialHealth(specs);
    h.online = true;
    h.feeds[feed] = { ...h.feeds[feed]!, state: "live", source: "binance", lastDataAt: NOW };
    return h;
  };

  it("reads the feed it is told to read (the account feed is live while the position feed is not)", () => {
    const acc = deriveLiveTraderNet(stamp(ratio(30, 60)), undefined, health("topAccountRatio"), NOW, undefined, "topAccountRatio");
    expect(acc.view?.status).toBe("ok");
    expect(acc.status).toBe("live");
    expect(acc.view?.side).toBe("long");
    // the same series read as the POSITION feed: its health is not live here, so it is not taken as Binance data
    const pos = deriveLiveTraderNet(stamp(ratio(30, 60)), undefined, health("topAccountRatio"), NOW);
    expect(pos.view).toBeNull();
    const none = deriveLiveTraderNet(undefined, undefined, health("topAccountRatio"), NOW, undefined, "topAccountRatio");
    expect(none.view).toBeNull();
  });
});
