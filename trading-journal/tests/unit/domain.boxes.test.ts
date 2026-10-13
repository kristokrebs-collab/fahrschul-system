import { describe, expect, it } from "vitest";
import btc4h from "./fixtures/binance-btcusdt-4h.json";
import btc1d from "./fixtures/binance-btcusdt-1d.json";
import { analyzeBoxes, boxSetups, boxState, findBoxes, findPivots, rsiLines, rsiLineText, srLevels, DEFAULT_BOX_CFG, type BoxState, type RsiLineState } from "@/domain/boxes";
import type { Bar } from "@/domain/signals";

const FIX = { "binance-btcusdt-4h": btc4h, "binance-btcusdt-1d": btc1d } as const;
const load = (name: keyof typeof FIX): Bar[] => (FIX[name] as { bars: number[][] }).bars.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));

describe("box engine on real BTCUSDT 4h (Binance perp, Feb–Oct 2026)", () => {
  const bars = load("binance-btcusdt-4h");
  const boxes = findBoxes(bars);

  it("draws few, wide boxes anchored on swing points", () => {
    expect(boxes.length).toBeGreaterThanOrEqual(4);
    expect(boxes.length).toBeLessThanOrEqual(10);
    for (const b of boxes) {
      expect(b.touchesTop).toBeGreaterThanOrEqual(2);
      expect(b.touchesBottom).toBeGreaterThanOrEqual(2);
      expect(b.top).toBeGreaterThan(b.bottom);
      // edges are real wicks: the box top is the high of some bar inside the box
      expect(bars.slice(b.i0, b.i1 + 1).some((x) => x.h === b.top)).toBe(true);
      expect(bars.slice(b.i0, b.i1 + 1).some((x) => x.l === b.bottom)).toBe(true);
    }
  });

  it("merges the 62–66k sub-ranges into one strong range that broke out upward", () => {
    const range = boxes.find((b) => b.bottom > 61_500 && b.bottom < 62_800 && b.top > 65_300 && b.top < 66_300);
    expect(range).toBeDefined();
    expect(range!.grade).toBe("stark");
    expect(range!.brk).toBe(1);
    expect(range!.i1 - range!.i0).toBeGreaterThan(80);
  });

  it("no close of a box lies beyond its edges by more than the breakout buffer", () => {
    for (const b of boxes) {
      const buf = DEFAULT_BOX_CFG.breakAtr * b.atr;
      for (let i = b.i0; i <= b.i1; i++) {
        expect(bars[i]!.c).toBeLessThanOrEqual(b.top + buf + 1e-9);
        expect(bars[i]!.c).toBeGreaterThanOrEqual(b.bottom - buf - 1e-9);
      }
    }
  });

  it("the breakout bar closes beyond the edge", () => {
    for (const b of boxes.filter((x) => x.brk)) {
      const c = bars[b.brkI!]!.c;
      if (b.brk > 0) expect(c).toBeGreaterThan(b.top);
      else expect(c).toBeLessThan(b.bottom);
    }
  });

  it("state: the market is inside the newest box with targets for both directions", () => {
    const st = boxState(bars);
    expect(st.box).not.toBeNull();
    expect(st.phase).toBe("inside");
    expect(st.up.length).toBeGreaterThan(0);
    expect(st.down.length).toBeGreaterThan(0);
    expect(st.up[0]!.price).toBeGreaterThan(st.box!.top);
    expect(st.down[0]!.price).toBeLessThan(st.box!.bottom);
  });

  it("support / resistance levels have at least two touches", () => {
    const lv = srLevels(bars);
    expect(lv.length).toBeGreaterThan(3);
    for (const l of lv) expect(l.touches).toBeGreaterThanOrEqual(2);
  });

  it("is fast enough for live use (1500 bars)", () => {
    const t0 = performance.now();
    for (let k = 0; k < 5; k++) findBoxes(bars);
    expect((performance.now() - t0) / 5).toBeLessThan(150);
  });

  it("breakout state counts from the close beyond the edge", () => {
    const range = boxes.find((b) => b.bottom > 61_500 && b.bottom < 62_800 && b.top > 65_300)!;
    const cut = bars.slice(0, range.brkI! + 2);
    const st = boxState(cut);
    expect(st.dir).toBe(1);
    expect(["breakout", "retest", "target"]).toContain(st.phase);
    expect(st.targets.length).toBeGreaterThan(0);
    expect(st.targets[0]!.price).toBeGreaterThan(range.top);
  });
});

describe("box engine on real BTCUSDT 1D", () => {
  it("finds daily boxes with ≥ 2 touches per edge", () => {
    const boxes = findBoxes(load("binance-btcusdt-1d"));
    expect(boxes.length).toBeGreaterThanOrEqual(3);
    for (const b of boxes) expect(Math.min(b.touchesTop, b.touchesBottom)).toBeGreaterThanOrEqual(2);
  });
});

describe("pivots", () => {
  it("fractal highs and lows", () => {
    const mk = (h: number[]): Bar[] => h.map((x, i) => ({ t: i, o: x, h: x, l: x - 1, c: x }));
    const p = findPivots(mk([1, 2, 3, 9, 3, 2, 1, 2, 3]), 2);
    expect(p.find((x) => x.high)?.i).toBe(3);
    expect(p.find((x) => !x.high)?.i).toBe(6);
  });
});

/** RSI series → bars whose closes produce roughly that shape. */
function barsFromCloses(c: number[]): Bar[] {
  return c.map((x, i) => ({ t: i * 3600, o: c[i - 1] ?? x, h: Math.max(x, c[i - 1] ?? x) + 0.2, l: Math.min(x, c[i - 1] ?? x) - 0.2, c: x }));
}

describe("diagonal RSI lines", () => {
  it("detects a falling RSI resistance and its upward break", () => {
    // waves with falling highs, then a strong rally
    const c: number[] = [];
    let p = 100;
    for (let i = 0; i < 160; i++) {
      p += Math.sin(i / 5) * (1.6 - i / 160) - 0.12;
      c.push(p);
    }
    for (let i = 0; i < 8; i++) { p += 1.4; c.push(p); }
    const s = rsiLines(barsFromCloses(c)) as RsiLineState;
    expect(s).not.toBeNull();
    expect(s.breakUp).not.toBeNull();
    expect(s.breakUp!.slope).toBeLessThan(0);
    expect(rsiLineText(s).tone).toBe("win");
  });

  it("ignores flat lines (no horizontal RSI levels)", () => {
    const c: number[] = [];
    for (let i = 0; i < 200; i++) c.push(100 + Math.sin(i / 4) * 2);
    const s = rsiLines(barsFromCloses(c))!;
    for (const l of [s.res, s.sup, s.breakUp, s.breakDown]) if (l) expect(Math.abs(l.slope)).toBeGreaterThanOrEqual(0.02);
  });
});

describe("setups – trade the best", () => {
  const base = (over: Partial<BoxState>): BoxState => ({
    boxes: [], levels: [], phase: "inside", dir: 0, price: 100, pos: 0.1, zone: "bottom", pending: 0, pendingBack: false, targets: [], up: [], down: [], barsSince: null, progress: null, atr: 1,
    box: { i0: 0, i1: 50, formedAt: 20, t0: 0, t1: 50, top: 110, topIn: 109, bottom: 100, bottomIn: 101, mid: 105, height: 10, atr: 1, touchesTop: 3, touchesBottom: 3, sweeps: 1, brk: 0, brkI: null, quality: 80, grade: "stark" },
    ...over,
  });
  const rsiUp = { rsi: [], last: 45, res: null, sup: null, breakUp: { kind: "res", a: { i: 1, v: 60 }, b: { i: 9, v: 50 }, slope: -1.2, touches: 3, brokeAt: 10 }, breakDown: null, ageUp: 1, ageDown: null, distRes: null, distSup: null } as RsiLineState;

  it("range long at support with RSI break, top traders and HTF aligned is A+", () => {
    const s = boxSetups(base({ price: 100.5 }), rsiUp, 1, null);
    expect(s[0]!.side).toBe("long");
    expect(s[0]!.grade).toBe("A+");
    expect(s[0]!.best).toBe(true);
    expect(s[0]!.targets[1]!.price).toBe(110);
  });

  it("without RSI break and against top traders it is not 'best'", () => {
    const s = boxSetups(base({ price: 100.5 }), null, -1, null);
    expect(s[0]!.best).toBe(false);
  });

  it("a breakout without any target (no CRV) is never 'best' (box fix: no measured move below zero)", () => {
    const s = boxSetups(base({ phase: "breakout", dir: -1, price: 98, pos: -0.2, zone: "bottom", targets: [], barsSince: 1 }), { ...rsiUp, breakUp: null, breakDown: rsiUp.breakUp, ageDown: 1 } as RsiLineState, -1, null);
    expect(s[0]!.kind).toBe("breakout");
    expect(s[0]!.rr).toBeNull();
    expect(s[0]!.best).toBe(false);
    expect(s[0]!.grade).not.toMatch(/^A/);
  });

  it("a mid-box price yields no range setup", () => {
    expect(boxSetups(base({ price: 105, pos: 0.5, zone: "mid" }), null, null, null).filter((x) => x.kind === "range")).toHaveLength(0);
  });

  it("analyzeBoxes works end to end on real data", () => {
    const a = analyzeBoxes({ tf: "4h", bars: load("binance-btcusdt-4h"), bias: 1 })!;
    expect(a.box.box).not.toBeNull();
    expect(a.rsi).not.toBeNull();
    for (const s of a.setups) expect(["A+", "A", "B", "C"]).toContain(s.grade);
  });
});

describe("close-only rule after a breakout (Review MM-5)", () => {
  /** A clean 'stark' range 99.9 … 110.1 (16-bar swings) after a lead-in, then one close 1 ATR above the top. */
  function rangeThenBreakout(): { bars: Bar[]; top: number; atr: number } {
    const bars: Bar[] = [];
    let t = 1_700_000_000;
    for (let i = 0; i < 30; i++) {
      const c = 80 + i * 0.7;
      bars.push({ t: (t += 14_400), o: c - 0.3, h: c + 0.6, l: c - 0.8, c });
    }
    for (let i = 0; i < 96; i++) {
      const m = 105 + 4.2 * Math.sin((i / 16) * 2 * Math.PI);
      bars.push({ t: (t += 14_400), o: m - 0.2, h: m + 0.9, l: m - 0.9, c: m + 0.2 });
    }
    const B = findBoxes(bars).at(-1)!;
    expect(B.grade).toBe("stark");
    expect(B.brk).toBe(0);
    const c = B.top + B.atr;
    bars.push({ t: t + 14_400, o: B.top - 0.2, h: c + 0.3, l: B.top - 0.4, c });
    return { bars, top: B.top, atr: B.atr };
  }

  it("a wick back into the box keeps the close-confirmed breakout (pending re-entry), no fakeout setup before a close", () => {
    const { bars, top, atr } = rangeThenBreakout();
    expect(boxState(bars).phase).toBe("breakout");
    const wick = top - 0.5 * atr;
    const st = boxState(bars, DEFAULT_BOX_CFG, wick);
    expect(st.phase).toBe("breakout");
    expect(st.dir).toBe(1);
    expect(st.pendingBack).toBe(true);
    expect(st.pending).toBe(0);
    const a = analyzeBoxes({ tf: "4h", bars, live: wick, bias: -1 })!;
    expect(a.setups.some((s) => s.kind === "fakeout")).toBe(false);
    expect(a.setups.some((s) => s.kind === "breakout" && s.side === "long")).toBe(true);
    // the live price beyond the top again: nothing pending
    expect(boxState(bars, DEFAULT_BOX_CFG, top + atr).pendingBack).toBe(false);
  });

  it("a CLOSE back inside makes it a failed breakout with a fakeout setup", () => {
    const { bars, top, atr } = rangeThenBreakout();
    const last = bars.at(-1)!;
    const back = top - 0.5 * atr;
    bars.push({ t: last.t + 14_400, o: last.c, h: last.c + 0.2, l: back - 0.3, c: back });
    const st = boxState(bars);
    expect(st.phase).toBe("failed");
    expect(st.pendingBack).toBe(false);
    const a = analyzeBoxes({ tf: "4h", bars, bias: -1 })!;
    expect(a.setups.some((s) => s.kind === "fakeout" && s.side === "short")).toBe(true);
  });
});

describe("merge keeps real breakouts apart (Review F1)", () => {
  const D1 = load("binance-btcusdt-1d");
  const DAY = 86_400;
  const WEEK = 7 * DAY;
  const W1: Bar[] = [];
  for (const d of D1) {
    const open = Math.floor((d.t - 4 * DAY) / WEEK) * WEEK + 4 * DAY;
    const last = W1[W1.length - 1];
    if (last && last.t === open) Object.assign(last, { h: Math.max(last.h, d.h), l: Math.min(last.l, d.l), c: d.c });
    else W1.push({ ...d, t: open });
  }
  const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

  it("1W: the 2024 53–74k range, the 74–112k range and the 101–126k range are three boxes, each left by a close – not one 53–126k box", () => {
    const boxes = findBoxes(W1);
    const r2024 = boxes.find((b) => Math.round(b.bottom) === 53_330 && Math.round(b.top) === 73_881);
    expect(r2024, "the 2024 range").toBeDefined();
    expect(r2024!.brk).toBe(1);
    expect(day(r2024!.t0)).toBe("2024-02-26");
    expect(boxes.some((b) => b.bottom < 60_000 && b.top > 120_000)).toBe(false);
    expect(boxes.some((b) => Math.round(b.bottom) === 74_457 && Math.round(b.top) === 111_960 && b.brk === 1)).toBe(true);
    expect(boxes.some((b) => Math.round(b.bottom) === 101_517 && Math.round(b.top) === 126_209 && b.brk === -1)).toBe(true);
  });

  it("1D: the Mar–Apr 2026 range (65.6–76.0k, broke up) and the box above it (73.7–79.5k) stay two boxes – Box zu Box", () => {
    const boxes = findBoxes(D1);
    const range = boxes.find((b) => Math.round(b.bottom) === 65_569 && Math.round(b.top) === 75_999);
    expect(range, "Mar–Apr range").toBeDefined();
    expect(range!.brk).toBe(1);
    const above = boxes.find((b) => Math.round(b.bottom) === 73_669 && Math.round(b.top) === 79_455);
    expect(above, "box above").toBeDefined();
    expect(above!.i0).toBeGreaterThan(range!.i1);
    // no box mixes the range and its breakout leg (top above 79k with a bottom below 70k)
    expect(boxes.some((b) => b.top > 79_000 && b.bottom < 70_000)).toBe(false);
  });
});
