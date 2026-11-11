import { describe, expect, it } from "vitest";
import btc4h from "./fixtures/binance-btcusdt-4h.json";
import btc1d from "./fixtures/binance-btcusdt-1d.json";
import { atrSeries, type EvalCandle } from "@/domain/keylevels";
import { rsi as wilderRsi } from "@/domain/signals/indicators";
import {
  analyzeTrendlines,
  closedCandles,
  DEFAULT_TRENDLINE_CFG,
  describeLine,
  distText,
  emptyText,
  engineCfg,
  findLines,
  lineAt,
  pickActive,
  pivotsOf,
  priceSeries,
  retestOf,
  rsiSeries,
  sideOf,
  type SeriesInput,
  type TrendLine,
  type TrendLineView,
  type TrendSlot,
} from "@/domain/trendlines";
import { candlesOf, DOWN_THEN_BREAK, H4, mirrored, nowAfter, zigzag } from "./trendFixtures";

const analyze = (c: readonly EvalCandle[], n = c.length) => {
  const cs = c.slice(0, n);
  return analyzeTrendlines(cs, "4h", nowAfter(cs, H4));
};
const falling = candlesOf(zigzag(DOWN_THEN_BREAK));

describe("pivotsOf", () => {
  it("a swing needs R bars to its right: it exists only once it is confirmed", () => {
    const x = [1, 2, 3, 10, 3, 2, 1, 0];
    expect(pivotsOf(x, 3, 3, true, 0)).toEqual([{ i: 3, v: 10 }]);
    // the same peak with only two bars after it is not a pivot yet
    expect(pivotsOf(x.slice(0, 6), 3, 3, true, 0)).toEqual([]);
  });

  it("is strict on the left, tolerant on the right: of two equal highs the first is the pivot; lows mirror highs", () => {
    expect(pivotsOf([1, 5, 5, 1, 0], 1, 2, true, 0)).toEqual([{ i: 1, v: 5 }]);
    expect(pivotsOf([5, 1, 1, 5, 6], 1, 2, false, 0)).toEqual([{ i: 1, v: 1 }]);
    // a higher bar within R to the right takes the pivot away
    expect(pivotsOf([1, 5, 4, 6, 0, 0], 1, 2, true, 0).map((p) => p.i)).toEqual([3]);
  });

  it("skips non-finite values", () => {
    const x = [1, Number.NaN, 5, 1, 1, 1];
    expect(pivotsOf(x, 1, 2, true, 0)).toEqual([{ i: 2, v: 5 }]);
    expect(pivotsOf([1, 2, Number.NaN, 9, 2, 1, 0], 2, 2, true, 0).map((p) => p.i)).toEqual([3]);
  });
});

describe("closedCandles", () => {
  it("drops the forming candle, a candle whose close time has not passed and non-finite candles", () => {
    const c = candlesOf([1, 2, 3, 4]);
    const forming = { ...c[3]!, closed: false };
    expect(closedCandles([...c.slice(0, 3), forming], "4h", nowAfter(c, H4))).toHaveLength(3);
    // flagged closed, but the clock is before its close time
    expect(closedCandles(c, "4h", c[3]!.time + H4 - 2)).toHaveLength(3);
    expect(closedCandles(c, "4h", c[3]!.time + H4 - 1)).toHaveLength(4);
    expect(closedCandles([{ ...c[0]!, high: Number.NaN }, c[1]!], "4h", nowAfter(c, H4))).toHaveLength(1);
  });

  it("sorts an unsorted input and keeps one candle per open time", () => {
    const c = candlesOf([1, 2, 3, 4, 5]);
    const out = closedCandles([c[3]!, c[0]!, c[1]!, c[1]!, c[4]!, c[2]!], "4h", nowAfter(c, H4));
    expect(out.map((x) => x.close)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("price trendlines – a falling resistance (Abwärtstrendlinie)", () => {
  it("through the peaks 30 / 54 / 78 with three touches, and only once the third peak is confirmed", () => {
    // the peak at 78 is confirmed by the candle at 81 (pivotR = 3): with candles 0 … 80 the line still ends at 54
    const before = analyze(falling, 81).price.down.active!;
    expect([before.a.i, before.b.i]).toEqual([30, 54]);
    const after = analyze(falling, 82).price.down.active!;
    expect([after.a.i, after.b.i, after.touches]).toEqual([30, 78, 3]);
    expect(after.confirmedTime).toBe(falling[81]!.time);
    expect(after.slope).toBeCloseTo(-0.25, 6);
    expect(after.kind).toBe("down");
    expect(after.series).toBe("price");
  });

  it("a line is not known before the candle that confirms its second point", () => {
    const v = analyze(falling, 99).price.down.active!;
    expect(v.b.i + DEFAULT_TRENDLINE_CFG.pivotR).toBe(81);
    const confirmedIndex = falling.findIndex((c) => c.time === v.confirmedTime);
    expect(confirmedIndex).toBe(81);
    expect(analyze(falling, confirmedIndex).price.down.active!.b.i).not.toBe(78);
    expect(analyze(falling, confirmedIndex + 1).price.down.active!.b.i).toBe(78);
  });

  it("approach: the distance in % and in ATR is given; far from the line there is no approach", () => {
    const far = analyze(falling, 62).price.down.active!;
    expect(far.approach).toBe(false);
    expect(far.dist).toBeGreaterThan(5);
    const near = analyze(falling, 100).price.down.active!;
    expect(near.approach).toBe(true);
    expect(near.distAtr!).toBeLessThanOrEqual(DEFAULT_TRENDLINE_CFG.price.approach);
    expect(near.distAtr!).toBeGreaterThan(0);
    expect(near.distPct!).toBeCloseTo((near.dist / near.last) * 100, 9);
    expect(near.dist).toBeCloseTo(near.value - near.last, 9);
    expect(near.brk).toBeNull();
    expect(near.retest).toBeNull();
  });

  it("break: a CLOSE beyond the line, on its own candle; a wick through the line is no break", () => {
    expect(analyze(falling, 100).price.down.broken).toBeNull();
    expect(analyze(falling, 100).price.down.active).not.toBeNull();
    const broke = analyze(falling, 101).price.down;
    expect(broke.active).toBeNull();
    expect(broke.broken!.brk).toEqual({ at: 100, age: 0, fresh: true });
    expect(broke.broken!.brokeTime).toBe(falling[100]!.time);
    expect(broke.broken!.retest!.state).toBe("none");
    // the same candle 98 with a long upper wick through the line: still unbroken
    const wick = falling.slice(0, 99);
    const k = wick.length - 1;
    const line = lineAt({ a: { i: 30, v: 130.3 }, slope: -0.25 }, k);
    wick[k] = { ...wick[k]!, high: line + 5 };
    const w = analyze(wick).price.down;
    expect(w.active).not.toBeNull();
    expect(w.broken).toBeNull();
  });

  it("the break is fresh for maxAge candles, then only old news; the broken line is kept for keepBars", () => {
    expect(analyze(falling, 101 + DEFAULT_TRENDLINE_CFG.maxAge).price.down.broken!.brk!.fresh).toBe(true);
    expect(analyze(falling, 102 + DEFAULT_TRENDLINE_CFG.maxAge).price.down.broken!.brk).toMatchObject({ age: DEFAULT_TRENDLINE_CFG.maxAge + 1, fresh: false });
    expect(analyze(falling, 101 + DEFAULT_TRENDLINE_CFG.keepBars).price.down.broken).not.toBeNull();
    expect(analyze(falling, 102 + DEFAULT_TRENDLINE_CFG.keepBars).price.down.broken?.brk?.at).not.toBe(100);
  });

  it("retest: none until the price comes back; after the pull-back to the line it is touched and held", () => {
    expect(analyze(falling, 118).price.down.broken!.retest).toMatchObject({ state: "none", touchedAt: null });
    const r = analyze(falling, 119).price.down.broken!.retest!;
    expect(r).toEqual({ state: "held", touchedAt: 118, heldAt: 118, failedAt: null });
    // break and retest are different facts: the retest reports its own candle, the break keeps its own
    expect(analyze(falling, 119).price.down.broken!.brk!.at).toBe(100);
  });

  it("a retest candle right after a hesitant break (never clear of the line) is no retest", () => {
    // a slow grind through the line: the candle after the break stays within the retest tolerance of the line
    const closes = zigzag([...DOWN_THEN_BREAK.slice(0, 7), [90, 96], [98, 112.4], [99, 113.6], [100, 113.8], [101, 113.8], [102, 118]]);
    const slow = candlesOf(closes);
    const v = analyze(slow, 103).price.down.broken!;
    expect(v.brk!.at).toBe(99);
    expect(v.retest!.touchedAt).toBeNull();
  });

  it("an up-trend line is the exact mirror: same points, same break, same retest", () => {
    const mir = mirrored(falling);
    for (const n of [99, 101, 119]) {
      const d = analyze(falling, n).price.down;
      const u = analyze(mir, n).price.up;
      expect(u.active?.a.i).toBe(d.active?.a.i);
      expect(u.active?.b.i).toBe(d.active?.b.i);
      expect(u.active?.touches).toBe(d.active?.touches);
      expect(u.broken?.brk).toEqual(d.broken?.brk);
      expect(u.broken?.retest).toEqual(d.broken?.retest);
      if (d.active) expect(u.active!.dist).toBeCloseTo(d.active.dist, 6);
    }
    const up = analyze(mir, 101).price.up.broken!;
    expect(up.kind).toBe("up");
    expect(analyze(mir, 101).price.down.active).toBeNull();
  });
});

describe("price trendlines – edge cases", () => {
  it("too few closed candles: no lines, with the numbers", () => {
    const c = candlesOf(zigzag(DOWN_THEN_BREAK)).slice(0, 30);
    const a = analyze(c);
    expect(a.status).toBe("few");
    expect(a.bars).toBe(30);
    expect(a.need).toBe(DEFAULT_TRENDLINE_CFG.minBars);
    expect(a.price.down.active).toBeNull();
    expect(a.price.up.broken).toBeNull();
    expect(a.rsi.down.active).toBeNull();
    expect(a.atr).toBeNull();
    expect(emptyText(a, "price")).toBe("Zu wenig Kerzen (30 von 44).");
    const none = analyzeTrendlines([], "1h", 0);
    expect(none.status).toBe("few");
    expect(none.asOf).toBeNull();
    expect(none.close).toBeNull();
  });

  it("the forming candle is not read at all", () => {
    const base = falling.slice(0, 99);
    const forming: EvalCandle = { time: base[98]!.time + H4, open: 1, high: 500, low: 0.5, close: 3, closed: false };
    const now = nowAfter(base, H4) + 60_000;
    const without = analyzeTrendlines(base, "4h", now);
    const withForming = analyzeTrendlines([...base, forming], "4h", now);
    expect(withForming).toEqual(without);
    // a candle flagged closed whose close time lies after the clock is the forming one as well
    const early: EvalCandle = { ...forming, closed: true, closeTime: now + 1 };
    expect(analyzeTrendlines([...base, early], "4h", now)).toEqual(without);
  });

  it("unsorted candles give the same result as sorted ones", () => {
    const c = falling.slice(0, 119);
    const shuffled = [...c].sort((a, b) => ((a.time / H4) % 7) - ((b.time / H4) % 7) || a.time - b.time);
    expect(analyzeTrendlines(shuffled, "4h", nowAfter(c, H4))).toEqual(analyzeTrendlines(c, "4h", nowAfter(c, H4)));
  });

  it("equal highs (a flat range) are a level, not a trendline", () => {
    const range = candlesOf(zigzag([[0, 100], [20, 100], [30, 120], [42, 100], [54, 120], [66, 100], [78, 120], [90, 100], [102, 120], [114, 100], [120, 105]]));
    const a = analyze(range);
    expect(a.price.down.active).toBeNull();
    expect(a.price.down.broken).toBeNull();
    expect(a.price.up.active).toBeNull();
  });

  it("a nearly flat falling pair (below the minimum slope) is no line", () => {
    const flat = candlesOf(zigzag([[0, 100], [20, 100], [30, 120], [42, 100], [54, 119.9], [66, 100], [78, 119.8], [90, 100], [96, 104]]));
    expect(analyze(flat).price.down.active).toBeNull();
    // with a clearly falling third peak the same shape does give a line
    const clear = candlesOf(zigzag([[0, 100], [20, 100], [30, 120], [42, 100], [54, 116], [66, 100], [78, 112], [90, 100], [96, 104]]));
    expect(analyze(clear).price.down.active).not.toBeNull();
  });

  it("a rising pair of highs never makes a resistance", () => {
    const rising = candlesOf(zigzag([[0, 100], [20, 100], [30, 110], [42, 100], [54, 118], [66, 100], [78, 126], [90, 100], [96, 104]]));
    expect(analyze(rising).price.down.active).toBeNull();
    expect(analyze(rising).price.up.active).toBeNull();
  });

  it("a candle that closes through the line between its two points voids the pair", () => {
    const closes = zigzag(DOWN_THEN_BREAK.slice(0, 7));
    // lift the close of candle 42 (between the peaks 30 and 54) above the 30–54 line
    const lifted = [...closes];
    lifted[42] = 131;
    const a = analyze(candlesOf(lifted), 80);
    const act = a.price.down.active;
    expect(act === null || !(act.a.i === 30 && act.b.i === 54)).toBe(true);
  });

  it("parallel lines on one side: a lower parallel is no resistance (the upper peaks cut through it); pairs never mix the two", () => {
    // A: peaks 30 / 54 / 78 (130, 124, 118)   B: peaks 42 / 66 / 90 (121, 115, 109) – both −0.25 per bar
    const two = candlesOf(zigzag([[0, 100], [20, 100], [30, 130], [36, 105], [42, 121], [48, 105], [54, 124], [60, 105], [66, 115], [72, 105], [78, 118], [84, 100], [90, 109], [102, 98]]));
    const closed = closedCandles(two, "4h", nowAfter(two, H4));
    const inp = priceSeries(closed, atrSeries(closed, 14), DEFAULT_TRENDLINE_CFG);
    const lines = findLines(inp, "down", engineCfg(DEFAULT_TRENDLINE_CFG));
    const sameSlope = lines.filter((l) => Math.abs(l.slope + 0.25) < 1e-6);
    expect(sameSlope.length).toBeGreaterThanOrEqual(3);
    for (const l of sameSlope) {
      expect([30, 54, 78]).toContain(l.a.i);
      expect([30, 54, 78]).toContain(l.b.i);
    }
    // all three pairs of the upper line are candidates; the chosen line is the one with the newest second point, stably
    const act = analyze(two).price.down.active!;
    expect([act.a.i, act.b.i]).toEqual([78, 90]);
    expect(analyze(two).price.down.active).toEqual(act);
    expect(pickActive(sameSlope, inp)).toMatchObject({ a: { i: 30 }, b: { i: 78 }, touches: 3 });
  });

  it("a rising channel (parallel highs and lows) gives the Aufwärtstrendlinie only, a falling one the Abwärtstrendlinie only", () => {
    const rise = candlesOf(zigzag([[0, 100], [20, 100], [30, 112], [36, 100], [42, 124], [48, 112], [54, 118], [60, 106], [66, 136], [72, 118], [78, 130], [84, 118], [90, 148], [96, 130], [102, 140]]));
    const r = analyze(rise);
    expect(r.price.down.active).toBeNull();
    expect(r.price.up.active).not.toBeNull();
    expect(r.price.up.active!.kind).toBe("up");
    expect(r.price.up.active!.slope).toBeGreaterThan(0);
    const fall = analyze(mirrored(rise));
    expect(fall.price.up.active).toBeNull();
    expect(fall.price.down.active).not.toBeNull();
    expect(fall.price.down.active!.slope).toBeLessThan(0);
  });

  it("the pick between candidates of the same age is by score, then by the longer line – never by array order", () => {
    const mk = (a: number, touches: number): TrendLine => ({ kind: "down", a: { i: a, v: 130 - 0.25 * a }, b: { i: 90, v: 100 }, slope: -0.25, touches, confirmedAt: 93, brokeAt: null });
    const inp = priceSeries(closedCandles(falling, "4h", nowAfter(falling, H4)), atrSeries(falling, 14), DEFAULT_TRENDLINE_CFG);
    const x = mk(30, 3);
    const y = mk(60, 3);
    expect(pickActive([y, x], inp)).toBe(x);
    expect(pickActive([x, y], inp)).toBe(x);
    expect(pickActive([], inp)).toBeNull();
  });
});

describe("retestOf – break, touch, hold, failure (hand-made series)", () => {
  const cfg = { retestBars: 20 };
  const line: TrendLine = { kind: "down", a: { i: 0, v: 100 }, b: { i: 10, v: 90 }, slope: -1, touches: 2, confirmedAt: 13, brokeAt: 20 };
  /** line(k) = 100 − k. Tolerances: break 0.5, retest 2. */
  const build = (closes: Record<number, number>, lows: Record<number, number> = {}, n = 50, kind: "down" | "up" = "down"): { inp: SeriesInput; line: TrendLine } => {
    const close: number[] = [];
    const lo: number[] = [];
    const hi: number[] = [];
    for (let k = 0; k < n; k++) {
      const c = closes[k] ?? 100 - k + 10;
      close.push(c);
      lo.push(lows[k] ?? c - 0.3);
      hi.push(c + 0.3);
    }
    const inp: SeriesInput = { hi, lo, close, first: 0, inner: () => 1, brk: () => 0.5, touch: () => 1, retest: () => 2, minSlope: () => 0.1, scale: () => 10, plausible: () => true };
    if (kind === "down") return { inp, line };
    // the mirror image: an up-trend line broken downward
    const flip: SeriesInput = { ...inp, hi: lo.map((x) => -x), lo: hi.map((x) => -x), close: close.map((x) => -x) };
    return { inp: flip, line: { ...line, kind: "up", a: { i: 0, v: -100 }, b: { i: 10, v: -90 }, slope: 1 } };
  };

  it("held: clear of the line, back to it within the tolerance, closed beyond it again", () => {
    // 20 breaks (close 100 − 20 + 10 = 90 > 80 + 0.5), the price stays 10 above, at 30 it dips to the line and closes above
    const { inp, line: l } = build({ 30: 70 + 1.5 }, { 30: 70 + 0.2 });
    const r = retestOf(inp, l, cfg);
    expect(r).toEqual({ state: "held", touchedAt: 30, heldAt: 30, failedAt: null });
  });

  it("pending: it touched, the close is back on the line but not beyond it", () => {
    const { inp, line: l } = build({ 30: 70 - 0.2 }, { 30: 70 - 0.5 });
    // 30 is on the old side by 0.2 (inside the 0.5 break tolerance): touched, not held, not failed; later candles end the series
    const short = { ...inp, hi: inp.hi.slice(0, 31), lo: inp.lo.slice(0, 31), close: inp.close.slice(0, 31) };
    expect(retestOf(short, l, cfg)).toEqual({ state: "pending", touchedAt: 30, heldAt: null, failedAt: null });
  });

  it("failed: a close back on the old side by more than the break tolerance", () => {
    const { inp, line: l } = build({ 30: 70 - 1 }, { 30: 70 - 1.3 });
    expect(retestOf(inp, l, cfg)).toMatchObject({ state: "failed", failedAt: 30, heldAt: null });
  });

  it("failed after a held retest keeps both facts", () => {
    const { inp, line: l } = build({ 30: 71.5, 40: 55 }, { 30: 70.2 });
    expect(retestOf(inp, l, cfg)).toEqual({ state: "failed", touchedAt: 30, heldAt: 30, failedAt: 40 });
  });

  it("expired: the price left and never came back within the window; none while the window is still open", () => {
    const { inp, line: l } = build({}, {}, 50);
    expect(retestOf(inp, l, cfg).state).toBe("expired");
    const early = build({}, {}, 35);
    expect(retestOf(early.inp, early.line, cfg).state).toBe("none");
    // a touch after the window does not count as a retest
    const late = build({ 45: 55 + 1.5 }, { 45: 55 + 0.2 }, 50);
    expect(retestOf(late.inp, late.line, cfg)).toMatchObject({ state: "expired", touchedAt: null });
  });

  it("an unbroken line has no retest", () => {
    const { inp } = build({});
    expect(retestOf(inp, { ...line, brokeAt: null }, cfg).state).toBe("none");
  });

  it("the mirrored (up-trend, broken downward) series gives the same answers", () => {
    for (const [closes, lows] of [
      [{ 30: 71.5 }, { 30: 70.2 }],
      [{ 30: 69 }, { 30: 68.7 }],
      [{ 30: 71.5, 40: 55 }, { 30: 70.2 }],
      [{}, {}],
    ] as const) {
      const a = build({ ...closes }, { ...lows });
      const b = build({ ...closes }, { ...lows }, 50, "up");
      expect(retestOf(b.inp, b.line, cfg)).toEqual(retestOf(a.inp, a.line, cfg));
    }
  });
});

describe("RSI trendlines (same engine, tolerances in points)", () => {
  /** a falling RSI resistance 80 → 70 → 60 through the peaks 20 / 44 / 68, RSI breaking up at 90 */
  const rsiPath = zigzag([[0, 50], [8, 50], [20, 80], [32, 40], [44, 70], [56, 35], [68, 60], [80, 35], [92, 66], [100, 55], [110, 62]]);
  const inp = (r: number[]): SeriesInput => rsiSeries(r, DEFAULT_TRENDLINE_CFG);

  it("finds the falling line through the RSI highs and its break", () => {
    const lines = findLines(inp(rsiPath), "down", engineCfg(DEFAULT_TRENDLINE_CFG));
    expect(lines.length).toBeGreaterThan(0);
    const best = lines.find((l) => l.a.i === 20 && l.b.i === 68)!;
    expect(best.slope).toBeCloseTo(-20 / 48, 6);
    expect(best.touches).toBe(3);
    expect(best.confirmedAt).toBe(71);
    expect(best.brokeAt).not.toBeNull();
    const k = best.brokeAt!;
    expect(rsiPath[k]!).toBeGreaterThan(lineAt(best, k) + DEFAULT_TRENDLINE_CFG.rsi.brk);
    expect(rsiPath[k - 1]!).toBeLessThanOrEqual(lineAt(best, k - 1) + DEFAULT_TRENDLINE_CFG.rsi.brk);
  });

  it("RSI values outside 3 … 97 on the line are not plausible", () => {
    const low = zigzag([[0, 50], [8, 50], [20, 35], [32, 10], [44, 25], [56, 5], [68, 15], [80, 3], [92, 8], [100, 12]]);
    for (const l of findLines(inp(low), "down", engineCfg(DEFAULT_TRENDLINE_CFG))) {
      const v = lineAt(l, low.length - 1);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(97);
    }
  });

  it("the analysis of real candles reports RSI lines with points as distance and no ATR", () => {
    const a = analyze(falling, 119);
    const v = [a.rsi.down.active, a.rsi.down.broken, a.rsi.up.active, a.rsi.up.broken].find((x) => x != null);
    expect(a.rsiLast).not.toBeNull();
    if (v) {
      expect(v.series).toBe("rsi");
      expect(v.distAtr).toBeNull();
      expect(v.distPct).toBeNull();
    }
  });
});

// ------------------------------------------------------------------------------------------------ real BTC candles

type Bars = { bars: number[][] };
const toCandles = (f: unknown, ms: number): EvalCandle[] =>
  (f as Bars).bars.map(([t, o, h, l, c]) => ({ time: t! * 1000, open: o!, high: h!, low: l!, close: c!, closed: true, closeTime: t! * 1000 + ms - 1 }));
const MS_1D = 86_400_000;
const REAL = [
  { name: "BTCUSDT 4h", tf: "4h" as const, ms: H4, candles: toCandles(btc4h, H4) },
  { name: "BTCUSDT 1D", tf: "1D" as const, ms: MS_1D, candles: toCandles(btc1d, MS_1D) },
];

const views = (a: ReturnType<typeof analyzeTrendlines>): TrendLineView[] => {
  const out: TrendLineView[] = [];
  for (const s of [a.price, a.rsi]) for (const slot of [s.down, s.up] as TrendSlot[]) for (const v of [slot.active, slot.broken]) if (v) out.push(v);
  return out;
};

describe.each(REAL)("real $name candles", ({ tf, ms, candles }) => {
  const cfg = DEFAULT_TRENDLINE_CFG;
  const STEP = 37;
  const ends = Array.from({ length: Math.floor((candles.length - 60) / STEP) }, (_, k) => 60 + k * STEP);

  it("every reported line obeys the rules, at every sampled history length", () => {
    let seen = 0;
    for (const n of ends) {
      const cs = candles.slice(0, n);
      const a = analyzeTrendlines(cs, tf, cs[n - 1]!.time + ms);
      expect(a.status).toBe("ok");
      const closes = cs.map((c) => c.close);
      const atr = atrSeries(cs, cfg.atrLen);
      const r = wilderRsi(closes, cfg.rsi.len);
      for (const v of views(a)) {
        seen++;
        const sgn = sideOf(v.kind);
        const line = { a: v.a, slope: v.slope };
        const series = v.series === "price" ? closes : r;
        const brk = (k: number): number => (v.series === "price" ? cfg.price.brk * (atr[k] ?? 0) : cfg.rsi.brk);
        expect(v.a.i).toBeLessThan(v.b.i);
        expect(v.b.i - v.a.i).toBeGreaterThanOrEqual(cfg.minGap);
        expect(v.slope * sgn).toBeLessThan(0);
        const confirmedAt = v.b.i + cfg.pivotR;
        expect(cs[confirmedAt]!.time).toBe(v.confirmedTime);
        expect(confirmedAt).toBeLessThanOrEqual(n - 1);
        expect(v.touches).toBeGreaterThanOrEqual(2);
        // after the line is known, no close is beyond it – except the one that breaks it
        const stop = v.brk ? v.brk.at : n;
        for (let k = confirmedAt + 1; k < stop; k++) expect(sgn * (series[k]! - lineAt(line, k))).toBeLessThanOrEqual(brk(k) + 1e-9);
        if (v.brk) {
          expect(sgn * (series[v.brk.at]! - lineAt(line, v.brk.at))).toBeGreaterThan(brk(v.brk.at));
          expect(v.brk.age).toBe(n - 1 - v.brk.at);
          expect(v.brk.fresh).toBe(v.brk.age <= cfg.maxAge);
          expect(v.retest).not.toBeNull();
          expect(v.approach).toBe(false);
        } else {
          expect(v.retest).toBeNull();
          expect(v.brokeTime).toBeNull();
        }
        // distance bookkeeping
        expect(v.dist).toBeCloseTo(sgn * (v.value - v.last), 6);
        if (v.series === "price") {
          expect(v.distPct).toBeCloseTo((v.dist / v.last) * 100, 6);
          expect(v.distAtr).toBeCloseTo(v.dist / atr[n - 1]!, 6);
        }
      }
    }
    // the fixtures must actually contain lines, or this test proves nothing
    expect(seen).toBeGreaterThan(10);
  });

  it("no lookahead: appending candles never changes a line that was already known", () => {
    const priceLines = (n: number) => {
      const cs = candles.slice(0, n);
      return findLines(priceSeries(cs, atrSeries(cs, cfg.atrLen), cfg), "down", engineCfg(cfg)).concat(findLines(priceSeries(cs, atrSeries(cs, cfg.atrLen), cfg), "up", engineCfg(cfg)));
    };
    let compared = 0;
    for (const n1 of ends.filter((_, k) => k % 2 === 0)) {
      const early = priceLines(n1);
      for (const extra of [1, 3, 11, 29]) {
        const n2 = n1 + extra;
        if (n2 > candles.length) continue;
        for (const l of priceLines(n2)) {
          if (l.confirmedAt > n1 - 1 || l.a.i < n1 - cfg.lookback) continue;
          const same = early.find((e) => e.kind === l.kind && e.a.i === l.a.i && e.b.i === l.b.i);
          expect(same, `line ${l.kind} ${l.a.i}-${l.b.i} known at ${n1}`).toBeDefined();
          compared++;
          expect(same!.slope).toBe(l.slope);
          expect(same!.confirmedAt).toBe(l.confirmedAt);
          // a break before the earlier cut is the same; otherwise it was unbroken then
          if (l.brokeAt != null && l.brokeAt <= n1 - 1) expect(same!.brokeAt).toBe(l.brokeAt);
          else expect(same!.brokeAt).toBeNull();
        }
      }
    }
    expect(compared).toBeGreaterThan(20);
  });

  it("the analysis is deterministic", () => {
    const cs = candles.slice(0, 400);
    const now = cs[399]!.time + ms;
    expect(analyzeTrendlines(cs, tf, now)).toEqual(analyzeTrendlines(cs, tf, now));
  });
});

describe("texts", () => {
  const base: TrendLineView = {
    series: "price",
    kind: "down",
    tf: "4h",
    a: { i: 10, v: 100 },
    b: { i: 40, v: 90 },
    aTime: 0,
    bTime: 0,
    confirmedTime: 0,
    brokeTime: null,
    slope: -0.3,
    touches: 3,
    value: 85,
    last: 83,
    dist: 2,
    distPct: 2.4096,
    distAtr: 0.62,
    approach: false,
    brk: null,
    retest: null,
    lastIndex: 100,
  };

  it("distances: price in % and ATR, RSI in points, German decimal comma", () => {
    expect(distText(base)).toBe("2,41 % (0,6 ATR)");
    expect(distText({ series: "rsi", dist: 2.14, distPct: null, distAtr: null })).toBe("2,1 Punkte");
    expect(distText({ ...base, distPct: null })).toBe("–");
  });

  it("intact, approach", () => {
    expect(describeLine(base)).toMatchObject({ phase: "intact", tone: "mute", title: "Abwärtstrendlinie intakt" });
    const near = describeLine({ ...base, approach: true });
    expect(near).toMatchObject({ phase: "approach", tone: "warn", title: "Annäherung an die Abwärtstrendlinie" });
    expect(near.detail).toContain("2,41 % (0,6 ATR) unter der Linie");
    expect(describeLine({ ...base, kind: "up", approach: true }).detail).toContain("über der Linie");
  });

  it("break up / down, retest open / held / failed / none", () => {
    const broken = { ...base, dist: -1.2, brk: { at: 98, age: 2, fresh: true }, retest: { state: "none", touchedAt: null, heldAt: null, failedAt: null } } as const;
    expect(describeLine(broken)).toMatchObject({ phase: "break", tone: "win", title: "Abwärtstrendlinie nach oben gebrochen" });
    expect(describeLine(broken).detail).toContain("vor 2 Kerzen");
    expect(describeLine({ ...broken, kind: "up" })).toMatchObject({ phase: "break", tone: "loss", title: "Aufwärtstrendlinie nach unten gebrochen" });
    expect(describeLine({ ...broken, brk: { at: 100, age: 0, fresh: true } }).detail).toContain("auf der letzten Kerze");
    expect(describeLine({ ...broken, brk: { at: 99, age: 1, fresh: true } }).detail).toContain("vor 1 Kerze ");
    expect(describeLine({ ...broken, retest: { state: "pending", touchedAt: 99, heldAt: null, failedAt: null } })).toMatchObject({ phase: "retest-open", title: "Retest läuft" });
    expect(describeLine({ ...broken, retest: { state: "held", touchedAt: 99, heldAt: 99, failedAt: null } })).toMatchObject({ phase: "retest-held", tone: "win", title: "Retest bestätigt" });
    expect(describeLine({ ...broken, retest: { state: "failed", touchedAt: null, heldAt: null, failedAt: 99 } })).toMatchObject({ phase: "retest-failed", tone: "warn", title: "Bruch zurückgenommen" });
    expect(describeLine({ ...broken, retest: { state: "expired", touchedAt: null, heldAt: null, failedAt: null } })).toMatchObject({ phase: "no-retest", tone: "mute", title: "Bruch ohne Retest" });
  });

  it("empty texts say why", () => {
    const ok = analyze(candlesOf(zigzag([[0, 100], [60, 100]])));
    expect(emptyText(ok, "price")).toBe("Keine diagonale Preislinie.");
    expect(emptyText(ok, "rsi")).toBe("Keine diagonale RSI-Linie.");
  });
});
