/**
 * Live structure store (F05): the candles of each timeframe come from the provider's real feeds (nothing substituted), a
 * timeframe the feed cannot serve is listed with its reason and not analysed, the forming candle is not read, and the
 * store publishes only a changed view. Plus the settings key (versioned passthrough).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "@/domain/defaults";
import { DEFAULT_TREND_TFS, trendlinesCfgOf, trendlinesOfSettings, withTrendlines } from "@/domain/trendlines";
import type { Candle } from "@/market/types";
import { candlesOf, DOWN_THEN_BREAK, H4, zigzag } from "./trendFixtures";

const fake = vi.hoisted(() => ({ p: null as unknown }));
vi.mock("@/market/marketStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market/marketStore")>();
  return { ...actual, getProvider: () => fake.p };
});

import { __resetTrendlines, buildTrendView, computeTrendlines, getTrendlines } from "@/market/trendlines/store";
import { toggledTfs, writeTrendlines } from "@/market/trendlines/write";
import { useJournal } from "@/store/journalStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const H1 = 3_600_000;
/** `n` closed candles of `ms` from `t0` along the fixture path (flat at its end beyond it). */
const asCandles = (ms: number, n: number, t0: number, forming = false): Candle[] => {
  const path = zigzag(DOWN_THEN_BREAK);
  const closes = Array.from({ length: n }, (_, i) => path[Math.min(i, path.length - 1)]!);
  return candlesOf(closes, ms, 0.3, t0).map((c, i, all) => ({ ...c, volume: 1, closed: !(forming && i === all.length - 1) }));
};

/** A fake provider: `now` is just after the last 4h candle closed. */
const T4 = Date.UTC(2026, 9, 1);
function install(feeds: Record<string, Candle[]>, now: number): void {
  const stamped = (data: unknown) => ({ data, asOf: now, receivedAt: now, source: "binance", comparable: true });
  const sf = Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, stamped(v)]));
  fake.p = { symbolInfo: { binance: "BTCUSDT" }, serverNow: () => now, get: (f: string) => sf[f], snapshot: () => ({}), getHealth: () => ({ feeds: {} }) };
}

beforeEach(() => {
  fake.p = null;
  __resetTrendlines();
  useJournal.setState({ settings: defaultSettings() });
});
afterEach(() => __resetTrendlines());

describe("settings.trendlines", () => {
  it("absent: 1h, 4h, 1D, 1W and the chart switch on; junk is read leniently", () => {
    expect(trendlinesCfgOf(undefined)).toEqual({ tfs: [...DEFAULT_TREND_TFS], chart: true });
    expect(trendlinesCfgOf("x")).toEqual({ tfs: [...DEFAULT_TREND_TFS], chart: true });
    expect(trendlinesCfgOf({ tfs: ["4h", "9h", 3, "1W", "4h"], chart: "yes" })).toEqual({ tfs: ["4h", "1W"], chart: true });
    expect(trendlinesCfgOf({ tfs: [], chart: false })).toEqual({ tfs: [], chart: false });
    expect(trendlinesOfSettings(null).tfs).toEqual([...DEFAULT_TREND_TFS]);
  });

  it("writing keeps unknown keys, sorts the timeframes, and returns the same object when nothing changed", () => {
    const raw = { v: 1, tfs: ["1h", "4h"], chart: true, future: { a: 1 } };
    expect(withTrendlines(raw, {})).toBe(raw);
    expect(withTrendlines(raw, { tfs: ["4h", "1h"] })).toBe(raw);
    const next = withTrendlines(raw, { tfs: ["1W", "30m", "30m"], chart: false });
    expect(next).toEqual({ v: 1, tfs: ["30m", "1W"], chart: false, future: { a: 1 } });
    expect(withTrendlines(undefined, { chart: false })).toEqual({ v: 1, tfs: [...DEFAULT_TREND_TFS], chart: false });
  });

  it("toggledTfs adds in natural order and removes", () => {
    expect(toggledTfs(["4h", "1W"], "1h", true)).toEqual(["1h", "4h", "1W"]);
    expect(toggledTfs(["1h", "4h"], "1h", false)).toEqual(["4h"]);
    expect(toggledTfs(["1h"], "1h", true)).toEqual(["1h"]);
  });

  it("writeTrendlines saves into the journal settings and leaves the rest alone", async () => {
    installDomPolyfills();
    await bootFixtureJournal();
    expect(await writeTrendlines({ tfs: ["4h"] })).toBe(true);
    const s = useJournal.getState().settings;
    expect(trendlinesOfSettings(s)).toEqual({ tfs: ["4h"], chart: true });
    expect(await writeTrendlines({ tfs: ["4h"] })).toBe(true);
    expect(s.trendlines).toBe(useJournal.getState().settings.trendlines);
  });
});

describe("buildTrendView", () => {
  const cfg = { tfs: ["1h", "4h", "1D"] as const, chart: true };
  const ok = (tf: string) => ({ tf, ok: true, reason: null }) as never;
  const no = (tf: string, reason: string) => ({ tf, ok: false, reason }) as never;
  const avail = [ok("30m"), ok("1h"), ok("2h"), ok("3h"), ok("4h"), no("1D", "1D-Kerzen werden geladen …"), ok("1W")];

  it("analyses the selected, available timeframes only; a locked one keeps its reason and gets no analysis", () => {
    const four = asCandles(H4, 120, T4);
    const now = T4 + 120 * H4;
    const v = buildTrendView({ ...cfg, tfs: [...cfg.tfs] }, "BTCUSDT", avail, (tf) => (tf === "4h" ? four : null), now, true);
    expect(v.state).toBe("ok");
    expect(v.items.map((i) => i.tf)).toEqual(["30m", "1h", "2h", "3h", "4h", "1D", "1W"]);
    const by = Object.fromEntries(v.items.map((i) => [i.tf, i]));
    expect(by["4h"]!.analysis?.status).toBe("ok");
    expect(by["4h"]!.analysis?.tf).toBe("4h");
    // selected + available but the feed has no candles: said so, not silently empty
    expect(by["1h"]!.analysis).toBeNull();
    expect(by["1h"]!.avail.ok).toBe(false);
    expect(by["1h"]!.avail.reason).toBe("Die 1h-Kerzen für 1h sind nicht geladen.");
    // locked by the feed: the feed's own reason
    expect(by["1D"]!.selected).toBe(true);
    expect(by["1D"]!.analysis).toBeNull();
    expect(by["1D"]!.avail.reason).toBe("1D-Kerzen werden geladen …");
    // not selected: not computed
    expect(by["2h"]!.selected).toBe(false);
    expect(by["2h"]!.analysis).toBeNull();
  });

  it("the live market not running: nothing is analysed", () => {
    const v = buildTrendView({ ...cfg, tfs: [...cfg.tfs] }, null, avail, () => asCandles(H4, 120, T4), T4 + 120 * H4, false);
    expect(v.state).toBe("idle");
    expect(v.items.every((i) => i.analysis === null)).toBe(true);
  });
});

describe("computeTrendlines (fake provider)", () => {
  it("reads the real feeds: 4h from kline_4h, 1h from kline_1h, 2h resampled from 1h – never another timeframe", () => {
    const h1 = asCandles(H1, 200, T4);
    const four = asCandles(H4, 120, T4);
    install({ kline_1h: h1, kline_4h: four }, T4 + 200 * H1);
    useJournal.setState({ settings: { ...defaultSettings(), trendlines: { v: 1, tfs: ["1h", "2h", "4h", "1D"], chart: true } } });
    computeTrendlines(true);
    const v = getTrendlines();
    expect(v.state).toBe("ok");
    expect(v.symbol).toBe("BTCUSDT");
    const by = Object.fromEntries(v.items.map((i) => [i.tf, i]));
    expect(by["1h"]!.analysis!.bars).toBe(200);
    expect(by["2h"]!.analysis!.bars).toBe(100);
    expect(by["2h"]!.analysis!.tf).toBe("2h");
    // 4h: 120 candles, the last closed at T4 + 480 h; the clock is 200 h after T4, so only the ones closed by then count
    expect(by["4h"]!.analysis!.bars).toBe(Math.floor(200 / 4));
    // 1D: no feed at all → locked with the reason, no analysis
    expect(by["1D"]!.analysis).toBeNull();
    expect(by["1D"]!.avail.ok).toBe(false);
    expect(by["1D"]!.avail.reason).toMatch(/1D-Kerzen/);
  });

  it("the forming candle is not read", () => {
    const four = asCandles(H4, 120, T4, true);
    install({ kline_4h: four }, T4 + 120 * H4 - 1);
    useJournal.setState({ settings: { ...defaultSettings(), trendlines: { v: 1, tfs: ["4h"], chart: true } } });
    computeTrendlines(true);
    expect(getTrendlines().items.find((i) => i.tf === "4h")!.analysis!.bars).toBe(119);
  });

  it("publishes only a changed view: the same inputs keep the same object", () => {
    install({ kline_4h: asCandles(H4, 120, T4) }, T4 + 120 * H4);
    useJournal.setState({ settings: { ...defaultSettings(), trendlines: { v: 1, tfs: ["4h"], chart: true } } });
    computeTrendlines(true);
    const a = getTrendlines();
    computeTrendlines(true);
    expect(getTrendlines()).toBe(a);
    useJournal.setState({ settings: { ...useJournal.getState().settings, trendlines: { v: 1, tfs: ["4h", "1h"], chart: true } } });
    computeTrendlines();
    expect(getTrendlines()).not.toBe(a);
    expect(getTrendlines().items.find((i) => i.tf === "1h")!.selected).toBe(true);
  });

  it("without a provider the view is idle", () => {
    computeTrendlines(true);
    expect(getTrendlines().state).toBe("idle");
    expect(getTrendlines().items.every((i) => i.analysis === null)).toBe(true);
  });
});
