/** Aggregation (45m = 3 × 15m etc.), config sanitising and snapshot parsing of the signal domain. */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNAL_CFG,
  bucketOpen,
  computeSignals,
  parseSignalSnapshot,
  resampleBars,
  sanitizeSignalCfg,
  signalCfgKey,
  snapshot,
  snapshotLadderLength,
  toSignalSnapshot,
  type Bar,
} from "@/domain/signals";
import { benchAgg, ladderBars, synthBars } from "./signals.fixtures";

const DAY = 86_400;

describe("bucketOpen: TradingView alignment for 24/7 crypto (session 00:00 UTC)", () => {
  it("45m: 32 bars per UTC day, the first at 00:00 UTC, equal to epoch alignment", () => {
    const day = Math.floor(1_790_000_000 / DAY) * DAY;
    const opens = new Set<number>();
    for (let t = day; t < day + DAY; t += 900) opens.add(bucketOpen(t, 2700));
    expect(opens.size).toBe(32);
    expect([...opens][0]).toBe(day);
    expect([...opens].every((o) => (o - day) % 2700 === 0)).toBe(true);
    // the day's last bar 23:15–24:00 never crosses midnight
    expect(bucketOpen(day + DAY - 900, 2700)).toBe(day + DAY - 2700);
    expect(bucketOpen(day + DAY, 2700)).toBe(day + DAY);
    for (const sec of [1800, 2700, 3600, 7200, 10_800, 14_400, 86_400]) for (let t = day; t < day + 2 * DAY; t += 900) expect(bucketOpen(t, sec)).toBe(Math.floor(t / sec) * sec);
  });

  it("a length that does not divide the day restarts at midnight (session anchored)", () => {
    const day = Math.floor(1_790_000_000 / DAY) * DAY;
    // 7m: 1440 / 7 = 205.7 → the last bar of the day is short, the next day starts again at 00:00
    expect(bucketOpen(day + DAY + 60, 420)).toBe(day + DAY);
    expect(bucketOpen(day + DAY - 60, 420)).toBe(day + 205 * 420);
  });
});

describe("resampleBars", () => {
  it("equals the research bench aggregation for 30m / 45m / 1h / 2h / 3h / 4h", () => {
    for (const seed of [1, 2, 3]) {
      // start 5 × 15m after a 4h boundary: mid-bucket for 30m…4h, so the leading partial bucket must be dropped
      const b15 = synthBars(1600, seed, { t0: Math.floor(1_790_000_000 / 14_400) * 14_400 + 900 * 5 });
      for (const sec of [1800, 2700, 3600, 7200, 10_800, 14_400]) {
        const ours = resampleBars(b15, 900, sec).map(({ v: _v, ...b }) => b);
        expect(ours).toEqual(benchAgg(b15, sec));
      }
    }
  });

  it("OHLCV of a 45m bar = first open, max high, min low, last close, volume sum; leading partial dropped", () => {
    const t0 = 2700 * 1000; // a 45m boundary
    const b: Bar[] = [
      { t: t0 - 900, o: 9, h: 9, l: 9, c: 9, v: 1 }, // belongs to the previous (partial) bucket → dropped
      { t: t0, o: 10, h: 12, l: 9, c: 11, v: 2 },
      { t: t0 + 900, o: 11, h: 15, l: 10, c: 14, v: 3 },
      { t: t0 + 1800, o: 14, h: 14, l: 7, c: 8, v: 4 },
      { t: t0 + 2700, o: 8, h: 8.5, l: 8, c: 8.2, v: 5 }, // running 45m bar (partial at the end is kept)
    ];
    expect(resampleBars(b, 900, 2700)).toEqual([
      { t: t0, o: 10, h: 15, l: 7, c: 8, v: 9 },
      { t: t0 + 2700, o: 8, h: 8.5, l: 8, c: 8.2, v: 5 },
    ]);
    // a hole inside a bucket still yields the bar (exchange without trades)
    expect(resampleBars([b[1]!, b[3]!], 900, 2700)).toEqual([{ t: t0, o: 10, h: 14, l: 7, c: 8, v: 6 }]);
    expect(resampleBars([], 900, 2700)).toEqual([]);
    expect(resampleBars(b, 900, 900)).toEqual(b);
  });

  it("derived 45m from 15m feeds the engine exactly like native-looking 45m bars", () => {
    const b15 = synthBars(1500, 4);
    const a = ladderBars(b15);
    const viaResample = { ...a, "30m": resampleBars(b15, 900, 1800), "45m": resampleBars(b15, 900, 2700) };
    const now = (b15[b15.length - 1]!.t + 900) * 1000;
    const strip = (x: ReturnType<typeof computeSignals>) => x && { ...x, checks: x.checks.map((c) => c && { ...c }) };
    expect(strip(computeSignals(viaResample, DEFAULT_SIGNAL_CFG, now))).toEqual(strip(computeSignals(a, DEFAULT_SIGNAL_CFG, now)));
  });
});

describe("sanitizeSignalCfg", () => {
  it("keeps a valid config (incl. unknown keys) and fills defaults", () => {
    expect(sanitizeSignalCfg(undefined)).toEqual({
      ...DEFAULT_SIGNAL_CFG,
      notify: false,
      whale: { on: true, periods: ["30m", "1h"], minRun: 2, weight: 10, topPct: 64, retailPeriod: "5m", bonusParts: 3 },
      strongCloses: 2,
      div: { on: true, rsi: true, wt: true, hidden: true, left: 2, right: 2, rangeMin: 3, rangeMax: 60, maxAge: 5, midline: true, weight: 10 },
      sr: { on: true, internal: 5, eqLen: 3, eqThreshold: 0.1, nearAtr: 1, minR: 2, weight: 10 },
    });
    const cfg = sanitizeSignalCfg({ ...DEFAULT_SIGNAL_CFG, extra: 1, notify: true });
    expect(cfg).toMatchObject({ ...DEFAULT_SIGNAL_CFG, notify: true });
    expect((cfg as unknown as { extra: number }).extra).toBe(1);
  });

  it("fixes the other journal's ladder defects: order, duplicates, < 30m, required > rungs", () => {
    expect(sanitizeSignalCfg({ ladder: ["4h", "30m", "30m", "15m", "1h", "bogus"], required: 9 })).toMatchObject({ ladder: ["30m", "1h", "4h"], required: 3 });
    expect(sanitizeSignalCfg({ ladder: [], required: 0 })).toMatchObject({ ladder: DEFAULT_SIGNAL_CFG.ladder, required: 1 });
    expect(sanitizeSignalCfg({ ladder: "30m" }).ladder).toEqual(DEFAULT_SIGNAL_CFG.ladder);
  });

  it("numbers: strings parsed, non-finite → default, lengths rounded and bounded", () => {
    const c = sanitizeSignalCfg({ wtChannel: "10", wtSignal: 0, rsiNear: "x", swingLookback: 3, zoneTf: "7m", wtSource: "hlc3", rsiOs: NaN });
    expect(c).toMatchObject({ wtChannel: 10, wtSignal: 1, rsiNear: 10, swingLookback: 20, zoneTf: "1h", wtSource: "hlc3", rsiOs: 30 });
    expect(signalCfgKey(c)).not.toBe(signalCfgKey(DEFAULT_SIGNAL_CFG));
    expect(signalCfgKey(sanitizeSignalCfg({}))).toBe(signalCfgKey(DEFAULT_SIGNAL_CFG));
  });
});

describe("snapshots", () => {
  const b15 = synthBars(2600, 42);
  const now = (b15[b15.length - 1]!.t + 900) * 1000;
  const sig = computeSignals(ladderBars(b15), DEFAULT_SIGNAL_CFG, now)!;

  it("toSignalSnapshot = the other journal's snapshot + optional extras", () => {
    const theirs = snapshot(sig, "long");
    const ours = toSignalSnapshot(sig, "long", DEFAULT_SIGNAL_CFG, { mode: "live", symbol: "BTCUSDT", source: "binance" });
    expect(ours).toMatchObject({ ...theirs, tfs: theirs.tfs.map((t) => expect.objectContaining(t)) });
    expect(ours).toMatchObject({ v: 2, mode: "live", ladder: ["30m", "45m", "1h", "4h"], required: 2, zoneTf: "1h", symbol: "BTCUSDT", source: "binance" });
    expect(ours.tfs.every((t) => typeof t.ok === "boolean" && typeof t.rsiNear === "boolean")).toBe(true);
    expect(ours.tfs.filter((t) => t.ok).length).toBe(ours.tiers);
    expect(snapshotLadderLength(ours)).toBe(4);
  });

  it("parses the other journal's stored SignalSnap unchanged", () => {
    const stored = { at: "2026-09-30T10:15:00.000Z", side: "short", score: 75, strength: 2, tiers: 3, label: "Starker Short-Einstieg", valid: true, rsiOk: true, zoneOk: false, zone: "equilibrium", deep: false, tfs: [{ tf: "30m", kind: "top", wt: 61.3, rsi: 66.2 }, { tf: "45m", kind: "sell", wt: 55, rsi: 63.1 }, { tf: "1h", kind: "bear", wt: 12.4, rsi: 61 }] };
    const raw = JSON.parse(JSON.stringify(stored));
    expect(parseSignalSnapshot(raw)).toEqual(stored);
    expect(raw).toEqual(stored); // never mutates
    expect(snapshotLadderLength(parseSignalSnapshot(raw)!)).toBe(4);
  });

  it("round-trips ours through JSON and keeps unknown keys", () => {
    const ours = toSignalSnapshot(sig, "short", DEFAULT_SIGNAL_CFG, { mode: "retro" });
    const back = parseSignalSnapshot(JSON.parse(JSON.stringify({ ...ours, future: { x: 1 } })));
    expect(back).toEqual({ ...JSON.parse(JSON.stringify(ours)), future: { x: 1 } });
  });

  it("lenient: numeric strings, missing label/valid/tfs, invalid entries dropped", () => {
    const p = parseSignalSnapshot({ at: "2026-01-02T03:04:05Z", side: "long", score: "88.4", strength: "7", tiers: 2, tfs: [{ tf: "30m", kind: "nope", wt: "1.5", rsi: null }, null, { kind: "buy" }] });
    expect(p).toMatchObject({ score: 88, strength: 4, tiers: 2, label: "Maximal", valid: true, rsiOk: false, zoneOk: false, zone: null });
    expect(p!.tfs).toHaveLength(1);
    expect(p!.tfs[0]).toMatchObject({ tf: "30m", kind: null, wt: 1.5 });
    expect(Number.isNaN(p!.tfs[0]!.rsi)).toBe(true);
    expect(parseSignalSnapshot({ at: 1_790_000_000_000, side: "short", score: 0, strength: 0 })).toMatchObject({ at: new Date(1_790_000_000_000).toISOString(), valid: false, label: "Kein Signal", tfs: [] });
  });

  it("rejects non-snapshots", () => {
    for (const bad of [null, undefined, 1, "x", [], {}, { side: "up", score: 1, strength: 1, at: "2026-01-01" }, { side: "long", score: "x", strength: 1, at: "2026-01-01" }, { side: "long", score: 1, strength: 1, at: "nope" }, { side: "long", score: 1, strength: 1 }]) {
      expect(parseSignalSnapshot(bad)).toBeNull();
    }
  });
});
