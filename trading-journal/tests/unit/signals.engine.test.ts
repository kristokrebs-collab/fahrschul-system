/**
 * Parity of the ported signal engine with a verbatim copy of the other journal's `signals.ts`
 * (`tests/unit/reference/otherSignals.js`): same synthetic inputs → bit-identical outputs. The only deliberate
 * differences are the back-dated check (`signalsAt` returns null instead of a fake "strength 0") and the exact 45m
 * from 15m (tested in signals.resample.test.ts). Our additive layers (candle-close states, graded parts, knife
 * filter — `signals.v2.test.ts`) add fields; the comparison here projects onto the reference's fields and checks that
 * `verdict()` / `bestVerdict()` (the raw 1:1 core) stay identical, and that the confirmation layer changes nothing
 * while every candle is closed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as ours from "@/domain/signals";
import * as ref from "./reference/otherSignals.js";
import type { Bar, SignalCfg, Signals, TfCheck } from "@/domain/signals";
import { ladderBars, lcg, sameArray, synthBars } from "./signals.fixtures";

const CFG = ours.DEFAULT_SIGNAL_CFG;
const SEEDS = [1, 7, 42, 99, 2024, 31337];

afterEach(() => vi.restoreAllMocks());

/** The reference evaluates with `Date.now()`; ours takes `now` explicitly. */
function refAt<T>(now: number, fn: () => T): T {
  const spy = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

/** Config variations (hlc3, other lengths, a 3-rung ladder, required 3) to exercise every branch. */
function cfgVariants(): SignalCfg[] {
  return [
    CFG,
    { ...CFG, wtSource: "hlc3" },
    { ...CFG, wtChannel: 10, wtAverage: 21, wtSignal: 4, signalLookback: 5, revRange: 20 },
    { ...CFG, ladder: ["30m", "1h", "4h"], required: 2, zoneTf: "4h", swingLookback: 30 },
    { ...CFG, required: 3, rsiNear: 15, wtOs: -40, wtOb: 40 },
    { ...CFG, zoneTf: "2h" },
    // long-lit events and a wide RSI band: every rung confirms at once → strength 4 is reachable
    { ...CFG, signalLookback: 40, rsiNear: 25 },
  ];
}

describe("default config and constants", () => {
  it("DEFAULT_SIGNAL_CFG, SIGNAL_TFS, STRENGTH_LABEL and tfSeconds match the other journal", () => {
    expect(ours.DEFAULT_SIGNAL_CFG).toEqual(ref.DEFAULT_SIGNAL_CFG);
    expect([...ours.SIGNAL_TFS]).toEqual(ref.SIGNAL_TFS);
    expect([...ours.STRENGTH_LABEL]).toEqual(ref.STRENGTH_LABEL);
    for (const tf of ["1m", "5m", "15m", "30m", "45m", "1h", "2h", "3h", "4h", "1D", "1W", "7m", ""]) expect(ours.tfSeconds(tf)).toBe(ref.tfSeconds(tf));
  });
});

describe("indicators are bit-identical", () => {
  it.each(SEEDS)("ema / sma / rma / rsi / waveTrend (seed %i)", (seed) => {
    const bars = synthBars(700, seed);
    const close = bars.map((b) => b.c);
    // NaNs and Infinity inside the input exercise the non-finite branches
    const holes = close.map((x, i) => (i % 97 === 5 ? NaN : i % 131 === 7 ? Infinity : x));
    for (const len of [1, 2, 9, 14, 21]) {
      expect(sameArray(ours.ema(close, len), ref.ema(close, len))).toBe(true);
      expect(sameArray(ours.ema(holes, len), ref.ema(holes, len))).toBe(true);
      expect(sameArray(ours.sma(close, len), ref.sma(close, len))).toBe(true);
      expect(sameArray(ours.sma(holes, len), ref.sma(holes, len))).toBe(true);
      expect(sameArray(ours.rma(close, len), ref.rma(close, len))).toBe(true);
      expect(sameArray(ours.rsi(close, len), ref.rsi(close, len))).toBe(true);
    }
    expect(sameArray(ours.rsi([], 14), ref.rsi([], 14))).toBe(true);
    expect(sameArray(ours.rsi([5], 14), ref.rsi([5], 14))).toBe(true);
    // flat series: d === 0 → 100, u === 0 → 0 branches
    const flat = [...new Array(40).fill(100), ...Array.from({ length: 20 }, (_, i) => 100 - i)];
    expect(sameArray(ours.rsi(flat, 14), ref.rsi(flat, 14))).toBe(true);
    for (const cfg of cfgVariants()) {
      const a = ours.waveTrend(bars, cfg);
      const b = ref.waveTrend(bars, cfg);
      expect(sameArray(a.wt1, b.wt1)).toBe(true);
      expect(sameArray(a.wt2, b.wt2)).toBe(true);
    }
  });
});

describe("MCB events", () => {
  it("wtSignal equals the reference on every prefix and covers every kind", () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const bars = synthBars(600, seed);
      for (const cfg of cfgVariants()) {
        const { wt1, wt2 } = ours.waveTrend(bars, cfg);
        const close = bars.map((b) => b.c);
        for (let n = 3; n <= bars.length; n += 1) {
          const w1 = wt1.slice(0, n);
          const w2 = wt2.slice(0, n);
          const c = close.slice(0, n);
          const a = ours.wtSignal(w1, w2, cfg, c);
          expect(a).toEqual(ref.wtSignal(w1, w2, cfg, c));
          if (n % 50 === 0) expect(ours.wtSignal(w1, w2, cfg)).toEqual(ref.wtSignal(w1, w2, cfg));
          if (a.long) seen.add(a.long.kind);
          if (a.short) seen.add(a.short.kind);
        }
      }
    }
    expect([...seen].sort()).toEqual(["bear", "bottom", "bull", "buy", "sell", "top"]);
  });

  it("mcbEvents per bar agree with wtSignal at every bar (lookback 1)", () => {
    const bars = synthBars(500, 42);
    const cfg = { ...CFG, signalLookback: 1 };
    const { wt1, wt2 } = ours.waveTrend(bars, cfg);
    const close = bars.map((b) => b.c);
    const events = ours.mcbEvents(wt1, wt2, cfg, close);
    const byIndex = new Map<number, string[]>();
    for (const e of events) byIndex.set(e.index, [...(byIndex.get(e.index) ?? []), e.kind]);
    for (let n = 3; n <= bars.length; n++) {
      const s = ref.wtSignal(wt1.slice(0, n), wt2.slice(0, n), cfg, close.slice(0, n));
      const kinds = byIndex.get(n - 1) ?? [];
      // the reference's display kind is the first event that passed the zero-line filter on the newest bar
      expect(s.kind ?? null).toBe(kinds[0] ?? null);
      if (s.long) expect(kinds).toContain(s.long.kind);
      if (s.short) expect(kinds).toContain(s.short.kind);
    }
    expect(ours.mcbSeries(bars, cfg).every((p) => ["bottom", "top", "buy", "sell"].includes(p.kind))).toBe(true);
    expect(ours.mcbSeries(bars, cfg, { minor: true }).length).toBe(events.length);
  });
});

describe("Premium / Discount", () => {
  it("luxZone and pdZone equal the reference on prefixes, incl. BOS and CHoCH", () => {
    const kinds = new Set<string>();
    let fallback = 0;
    for (const seed of SEEDS) {
      const bars = synthBars(500, seed, { sec: 3600 });
      for (const size of [20, 50]) {
        for (let n = 1; n <= bars.length; n += 7) {
          const b = bars.slice(0, n);
          const a = ours.luxZone(b, size);
          expect(a).toEqual(ref.luxZone(b, size));
          if (a?.brk) kinds.add(a.brk.kind);
          if (!a) fallback++;
          expect(ours.pdZone(b, 120)).toEqual(ref.pdZone(b, 120));
        }
      }
    }
    expect([...kinds].sort()).toEqual(["BOS", "CHoCH"]);
    expect(fallback).toBeGreaterThan(0);
    // degenerate ranges
    const flat: Bar[] = Array.from({ length: 60 }, (_, i) => ({ t: i * 60, o: 1, h: 1, l: 1, c: 1 }));
    expect(ours.luxZone(flat)).toEqual(ref.luxZone(flat));
    expect(ours.pdZone(flat, 120)).toEqual(ref.pdZone(flat, 120));
  });
});

/** The reference's fields of a check / verdict / evaluation (ours adds conf, div, structure, state, parts, …). */
const CHECK_KEYS = ["tf", "ok", "closeAt", "rsi", "rsiMa", "wt", "zone", "longSignal", "shortSignal", "rsiLong", "rsiShort"] as const;
const VERDICT_KEYS = ["side", "tiers", "strength", "label", "valid", "rsiOk", "zoneOk", "strongSignal", "score", "reasons"] as const;
function pick<T extends object>(o: T, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in o) out[k] = (o as Record<string, unknown>)[k];
  return out;
}
const refCheck = (c: TfCheck | null | undefined) => (c ? pick(c, CHECK_KEYS) : c);
const refVerdict = (v: ours.Verdict) => pick(v, VERDICT_KEYS);
function refSignals(s: Signals | null) {
  if (!s) return null;
  return { checks: s.checks.map(refCheck), zone: refCheck(s.zone), long: refVerdict(s.long), short: refVerdict(s.short), best: refVerdict(s.best) };
}
/** Parts off: the evaluation is the reference's plus the candle-close layer only. */
const noParts = (cfg: SignalCfg): SignalCfg => ({ ...cfg, whale: { ...ours.DEFAULT_WHALE_CFG, on: false }, div: { ...ours.DEFAULT_DIV_CFG, on: false }, sr: { ...ours.DEFAULT_SR_CFG, on: false } });
/** Far after every bar: nothing forms, every signal is on a closed candle. */
const CLOSED = 4_102_444_800_000;

/** Checks + raw verdicts of `a` equal the reference evaluation `b` (the 1:1 core). */
function expectCore(a: Signals | null, b: Signals | null, cfg: SignalCfg): void {
  expect(a === null).toBe(b === null);
  if (!a || !b) return;
  expect(a.checks.map(refCheck)).toEqual(b.checks);
  expect(refCheck(a.zone)).toEqual(b.zone);
  expect(ours.bestVerdict(a.checks, cfg, a.zone)).toEqual({ long: b.long, short: b.short, best: b.best });
}

describe("checkTf, verdict, computeSignals and snapshot", () => {
  it("are identical for every config variant and many evaluation ends", () => {
    const strengths = new Set<number>();
    const labels = new Set<string>();
    for (const seed of SEEDS) {
      // 2600 × 15m → 162 × 4h: all four rungs have enough bars at the end of the series
      const b15 = synthBars(2600, seed);
      for (const cfg of cfgVariants()) {
        // slide the evaluation end through the series (each end = a different "now")
        for (let end = 400; end <= b15.length; end += end < 2350 ? 97 : 9) {
          const bars = ladderBars(b15.slice(0, end));
          const now = (b15[end - 1]!.t + 900) * 1000;
          const a = ours.computeSignals(bars, cfg, now);
          const b = refAt(now, () => ref.computeSignals(bars, cfg));
          expectCore(a, b, cfg);
          if (!a || !b) continue;
          // every candle closed and the parts off: the graded evaluation keeps the reference's fields exactly
          expect(refSignals(ours.computeSignals(bars, noParts(cfg), CLOSED))).toEqual(refSignals(b));
          const raw = { ...a, ...ours.bestVerdict(a.checks, cfg, a.zone) };
          strengths.add(raw.long.strength).add(raw.short.strength);
          labels.add(raw.long.label).add(raw.short.label);
          for (const side of ["long", "short"] as const) expect(ours.snapshot(raw, side)).toEqual(ref.snapshot(b, side));
          // verdict without an explicit zone check (zoneRef from the ladder)
          expect(ours.verdict("long", a.checks, cfg)).toEqual(ref.verdict("long", b.checks, cfg));
          expect(ours.bestVerdict(a.checks, cfg, null)).toEqual(ref.bestVerdict(b.checks, cfg, null));
        }
      }
    }
    // the inputs reach every strength grade and the label branches
    expect([...strengths].sort()).toEqual([0, 1, 2, 3, 4]);
    expect([...labels].some((l) => l.includes("RSI noch nicht"))).toBe(true);
    expect([...labels].some((l) => l.includes(": nur 30m bestätigt"))).toBe(true);
    expect([...labels].some((l) => l.startsWith("Kein "))).toBe(true);
  }, 180_000);

  it("checkTf: < 150 bars → null, like the reference", () => {
    const b = synthBars(149, 3);
    expect(ours.checkTf("1h", b, CFG)).toBeNull();
    expect(ref.checkTf("1h", b, CFG)).toBeNull();
    const c = synthBars(150, 3);
    expect(refCheck(ours.checkTf("1h", c, CFG))).toEqual(ref.checkTf("1h", c, CFG));
    expect(ours.computeSignals({}, CFG)).toBeNull();
    expect(ours.computeSignals(undefined, CFG)).toBeNull();
  });

  it("verdict with null rungs (missing timeframes) matches", () => {
    const b15 = synthBars(1500, 11);
    const bars = ladderBars(b15);
    const now = (b15[b15.length - 1]!.t + 900) * 1000;
    const a = ours.computeSignals(bars, CFG, now)!;
    const holes: (TfCheck | null)[][] = [
      [null, a.checks[1]!, a.checks[2]!, a.checks[3]!],
      [a.checks[0]!, null, a.checks[2]!, a.checks[3]!],
      [a.checks[0]!, a.checks[1]!, null, null],
    ];
    for (const checks of holes) for (const side of ["long", "short"] as const) expect(ours.verdict(side, checks, CFG, null)).toEqual(ref.verdict(side, checks, CFG, null));
  });

  it("withLivePrice is identical (replace, append, gap)", () => {
    const bars = synthBars(10, 5, { sec: 1800 });
    const last = bars[bars.length - 1]!;
    for (const dt of [-10, 0, 100, 1799, 1800, 3599, 3600, 9000]) {
      const at = (last.t + dt) * 1000;
      for (const price of [last.c, last.h * 1.01, last.l * 0.99, NaN]) expect(ours.withLivePrice(bars, 1800, price, at)).toEqual(ref.withLivePrice(bars, 1800, price, at));
    }
    expect(ours.withLivePrice([], 1800, 1, 0)).toEqual(ref.withLivePrice([], 1800, 1, 0));
  });
});

describe("back-dated check (deliberate fix)", () => {
  it("equals the reference where history covers the time, and is null where the reference fakes strength 0", () => {
    const b15 = synthBars(3400, 42);
    const bars = ladderBars(b15);
    const now = (b15[b15.length - 1]!.t + 900) * 1000;
    let equal = 0;
    let fixed = 0;
    for (let i = 300; i < 3390; i += 37) {
      const at = (b15[i]!.t + 900) * 1000 + 60_000;
      const a = ours.signalsAt(bars, noParts(CFG), at, now);
      const b = refAt(now, () => ref.signalsAt(bars, CFG, at));
      if (a) {
        // a back-dated check sees closed bars only: with the parts off it is the reference's evaluation
        expect(refSignals(a)).toEqual(refSignals(b));
        expect(a.checks.every((c) => c?.forming === false)).toBe(true);
        expect(a.at).toBe(at);
        equal++;
      } else if (b) {
        // the reference returns a result although a rung lacks history → its verdict is unreliable
        expect(b.checks.some((c) => !c) || !b.zone).toBe(true);
        fixed++;
      }
    }
    expect(equal).toBeGreaterThan(5);
    expect(fixed).toBeGreaterThan(5);
    // "retro 500 bars back" from the research bench: the reference stores strength 0, tiers 0
    const at500 = (b15[0]!.t + 1000 * 900) * 1000;
    const r = refAt(now, () => ref.signalsAt(bars, CFG, at500));
    expect(r && ref.snapshot(r, "long").strength).toBe(0);
    expect(ours.signalsAt(bars, CFG, at500, now)).toBeNull();
  });

  it("live window and uncovered times", () => {
    const b15 = synthBars(1500, 8);
    const bars = ladderBars(b15);
    const now = (b15[b15.length - 1]!.t + 600) * 1000;
    expect(ours.signalsAt(bars, CFG, now - 60_000, now)).toEqual(ours.computeSignals(bars, CFG, now));
    expect(ours.signalsAt(bars, CFG, NaN, now)).toBeNull();
    expect(ours.signalsAt(undefined, CFG, now, now)).toBeNull();
    // after the data ends (gap > one base bar) → not covered
    expect(ours.signalsAt(bars, CFG, now + 86_400_000, now + 90_000_000)).toBeNull();
  });
});

describe("random configs (fuzz)", () => {
  it("stays identical for random numeric settings", () => {
    const rnd = lcg(77);
    const b15 = synthBars(1500, 5);
    const bars = ladderBars(b15);
    const now = (b15[b15.length - 1]!.t + 900) * 1000;
    for (let k = 0; k < 25; k++) {
      const cfg: SignalCfg = {
        ...CFG,
        wtChannel: 2 + Math.floor(rnd() * 15),
        wtAverage: 2 + Math.floor(rnd() * 30),
        wtSignal: 1 + Math.floor(rnd() * 5),
        signalLookback: 1 + Math.floor(rnd() * 6),
        revRange: 5 + Math.floor(rnd() * 40),
        rsiLen: 5 + Math.floor(rnd() * 20),
        rsiMaLen: 1 + Math.floor(rnd() * 20),
        rsiNear: Math.floor(rnd() * 25),
        swingLookback: 20 + Math.floor(rnd() * 60),
        required: 1 + Math.floor(rnd() * 4),
      };
      expectCore(ours.computeSignals(bars, cfg, now), refAt(now, () => ref.computeSignals(bars, cfg)), cfg);
      expect(refSignals(ours.computeSignals(bars, noParts(cfg), CLOSED))).toEqual(refSignals(refAt(now, () => ref.computeSignals(bars, cfg))));
    }
  });
});
