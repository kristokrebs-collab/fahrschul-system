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
    boxes: [], levels: [], phase: "inside", dir: 0, price: 100, pos: 0.1, zone: "bottom", pending: 0, targets: [], up: [], down: [], barsSince: null, progress: null, atr: 1,
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
