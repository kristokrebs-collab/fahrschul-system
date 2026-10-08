/**
 * Einstiegs-Check v2 (decisions 5, 6, 9, 10, 11 — 2026-10-08): candle-close states, the graded Top-Trader-Kombi,
 * divergences, market structure + support / resistance, the falling-knife filter, their bias rows, snapshots and the
 * performance budget (< 5 ms per full check). Synthetic series per condition; real-engine invariants on the fixtures.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNAL_CFG,
  PROVISIONAL_PREFIX,
  bestVerdict,
  checkTf,
  computeSignals,
  confirmVerdict,
  divGrade,
  divPart,
  eventState,
  findDivergences,
  gradeSignals,
  knifeFilter,
  knifeStructure,
  lastInternalPivot,
  luxZone,
  marketStructure,
  mmss,
  parseSignalSnapshot,
  provisionalText,
  rungConf,
  sanitizeDivCfg,
  sanitizeSignalCfg,
  signalCfgKey,
  srPart,
  stateText,
  toSignalSnapshot,
  traderReading,
  tradersPart,
  verdict,
  waveTrend,
  type Bar,
  type Divergence,
  type DivCfg,
  type RatioSample,
  type SignalCfg,
  type Signals,
  type Structure,
  type SwingPoint,
  type TfCheck,
  type TraderReading,
  type TraderSeries,
  type ZoneInfo,
} from "@/domain/signals";
import { computeBias } from "@/domain/signals/bias";
import { ladderBars, synthBars } from "./signals.fixtures";

const CFG: SignalCfg = sanitizeSignalCfg({});
const DIV: DivCfg = sanitizeDivCfg(undefined);
const M5 = 300_000;

// ------------------------------------------------------------------ helpers

/** Flat bars (o = c = 110, h 111, l 109) with overrides per index. */
function flatBars(n: number, over: Record<number, Partial<Bar>> = {}, sec = 1800): Bar[] {
  return Array.from({ length: n }, (_, i) => ({ t: 1_760_000_000 + i * sec, o: 110, h: 111, l: 109, c: 110, ...over[i] }));
}

/** Price / oscillator pair with a REGULAR bullish divergence: lows 100 → 95 at bars 10 / 20, oscillator 20 → 30. */
function bullishSetup(kind: "regular" | "hidden" = "regular", n = 25): { bars: Bar[]; osc: number[] } {
  const lo2 = kind === "regular" ? 95 : 105;
  const o2 = kind === "regular" ? 30 : 15;
  const bars = flatBars(n, { 10: { l: 100, c: 101, o: 104 }, 20: { l: lo2, c: lo2 + 1, o: lo2 + 4 } });
  const osc = new Array<number>(n).fill(40);
  Object.assign(osc, { 8: 35, 9: 30, 10: 20, 11: 30, 12: 35, 18: 38, 19: 35, 20: o2, 21: 35, 22: 38 });
  return { bars, osc };
}

/** The mirror image (bearish): price → 220 − price (h ↔ l), oscillator → 100 − x. */
function mirrorSetup(s: { bars: Bar[]; osc: number[] }): { bars: Bar[]; osc: number[] } {
  return { bars: s.bars.map((b) => ({ t: b.t, o: 220 - b.o, h: 220 - b.l, l: 220 - b.h, c: 220 - b.c })), osc: s.osc.map((x) => 100 - x) };
}

function zoneInfo(pos: number): ZoneInfo {
  const z = pos > 0.525 ? "premium" : pos >= 0.475 ? "equilibrium" : "discount";
  return { hi: 90_000, lo: 80_000, pos, zone: z, deep: pos <= 0.05 || pos >= 0.95, eq: 85_000, bias: 0, brk: null, lux: true };
}

/** Minimal check for part / bias / knife tests. */
function check(tf: string, o: Partial<TfCheck> = {}): TfCheck {
  return {
    tf,
    ok: true,
    closeAt: 1_760_000_000,
    rsi: 50,
    rsiMa: 50,
    wt: { kind: null, barsAgo: null, long: null, short: null, wt1: 0, wt2: 0 },
    zone: zoneInfo(0.5),
    longSignal: false,
    shortSignal: false,
    rsiLong: false,
    rsiShort: false,
    ...o,
  };
}

function ratioSeries(end: number, values: number[], step = M5): RatioSample[] {
  return values.map((v, i) => ({ time: end - (values.length - 1 - i) * step, longPct: v }));
}

const reading = (o: Partial<TraderReading> = {}): TraderReading => ({ at: 1_760_000_000_000, position: 66, account: 65, retail: 46, retailPrev: 46.5, retailChg: -0.5, period: "5m", step: M5, ...o });

// ------------------------------------------------------------------ candle-close state

describe("candle-close state (decisions 6 + 9)", () => {
  it("provisional on the forming candle, confirmed after its close, strong after N closes with the move held", () => {
    const cfg = { ...CFG, signalLookback: 3 };
    const bars = synthBars(400, 7, { sec: 1800 });
    const { wt1, wt2 } = waveTrend(bars, cfg);
    const seen = { provisional: 0, confirmed: 0, strong: 0 };
    for (let n = 60; n <= bars.length; n++) {
      const b = bars.slice(0, n);
      const forming = rungConf(b, wt1.slice(0, n), wt2.slice(0, n), cfg, true, 2);
      const closed = rungConf(b, wt1.slice(0, n), wt2.slice(0, n), cfg, false, 2);
      for (const side of ["long", "short"] as const) {
        const f = forming[side];
        const c = closed[side];
        if (f.state === "provisional") {
          seen.provisional++;
          expect(f.forming?.barsAgo).toBe(0);
          expect(f.closed).toBeNull();
          expect(f.closes).toBe(0);
        }
        if (f.state === "confirmed" || f.state === "strong") {
          seen[f.state]++;
          expect(f.closed).not.toBeNull();
          expect(f.closes).toBe(f.event!.barsAgo); // counted from the signal candle's own close
        }
        if (f.state === "strong") expect(f.held && f.closes >= 2).toBe(true);
        // all bars closed: the same event is one close further along
        if (c.state !== "none") expect(c.event).not.toBeNull();
      }
    }
    expect(seen.provisional).toBeGreaterThan(0);
    expect(seen.confirmed).toBeGreaterThan(0);
    expect(seen.strong).toBeGreaterThan(0);
  });

  it("eventState, countdown text", () => {
    const bars = flatBars(10);
    expect(eventState(bars, 9, true, true, 2)).toBe("provisional");
    expect(eventState(bars, 8, true, true, 2)).toBe("confirmed"); // 1 close
    expect(eventState(bars, 7, true, true, 2)).toBe("strong"); // 2 closes, held
    const broken = flatBars(10, { 8: { c: 100 } });
    expect(eventState(broken, 7, true, true, 2)).toBe("confirmed"); // a close below the signal candle's low
    expect(eventState(bars, 20, true, true, 2)).toBe("none");
    expect(mmss(754_000)).toBe("12:34");
    expect(mmss(3_725_000)).toBe("1:02:05");
    expect(mmss(-5)).toBe("0:00");
    expect(provisionalText(61_000)).toBe("vorläufig · schließt in 1:01");
    expect(stateText("strong")).toBe("stark bestätigt");
    expect(stateText("provisional", 1000)).toBe("vorläufig · schließt in 0:01");
  });

  it("checkTf: forming flag, close time and countdown from `now`; no `now` = closed", () => {
    const bars = synthBars(300, 3, { sec: 1800 });
    const last = bars[bars.length - 1]!;
    const now = (last.t + 600) * 1000;
    const c = checkTf("30m", bars, CFG, now)!;
    expect(c.forming).toBe(true);
    expect(c.closesAt).toBe((last.t + 1800) * 1000);
    expect(c.msToClose).toBe(1_200_000);
    const d = checkTf("30m", bars, CFG)!;
    expect(d.forming).toBe(false);
    expect(d.msToClose).toBe(0);
    expect(checkTf("30m", bars, CFG, (last.t + 1800) * 1000)!.forming).toBe(false);
  });

  it("confirmVerdict: a provisional base is shown, not counted; a closed base confirms; provisional rungs count ½", () => {
    const ev = { kind: "bottom" as const, barsAgo: 0 };
    const conf = (state: "provisional" | "confirmed" | "strong") => ({ state, event: ev, closes: state === "provisional" ? 0 : 2, held: true, closed: state === "provisional" ? null : ev, forming: state === "provisional" ? ev : null });
    const none = { state: "none" as const, event: null, closes: 0, held: false, closed: null, forming: null };
    const rung = (tf: string, state: "provisional" | "confirmed" | "strong", closesAt = 1_760_001_800_000) =>
      check(tf, { wt: { kind: "bottom", barsAgo: 0, long: ev, short: null, wt1: -60, wt2: -65 }, longSignal: true, rsiLong: true, rsi: 28, conf: { long: conf(state), short: none }, closesAt, forming: state === "provisional" });
    const cfg = sanitizeSignalCfg({ ladder: ["30m", "45m", "1h", "4h"] });
    // base forming → provisional entry
    const p = [rung("30m", "provisional"), rung("45m", "confirmed"), check("1h"), check("4h")];
    const raw = verdict("long", p, cfg, null);
    expect(raw.valid).toBe(true);
    const v = confirmVerdict(raw, p, cfg);
    expect(v).toMatchObject({ state: "provisional", valid: false, strength: 0, provStrength: raw.strength, confTiers: 0, closesAt: 1_760_001_800_000 });
    expect(v.label).toBe(`${PROVISIONAL_PREFIX}${raw.label}`);
    expect(v.rungStates).toEqual(["provisional", "confirmed", "none", "none"]);
    expect(v.score).toBe(Math.round(((2 - 0.5) / 4) * 55 + 20 + 10)); // the forming base counts ½
    // base closed, the required 45m still forming → still provisional (a higher rung counts at its own close), the
    // countdown runs to the 45m close; the 45m rung ½ in the score
    const q = [rung("30m", "confirmed"), rung("45m", "provisional", 1_760_002_700_000), check("1h"), check("4h")];
    const w = confirmVerdict(verdict("long", q, cfg, null), q, cfg);
    expect(w).toMatchObject({ state: "provisional", valid: false, strength: 0, confTiers: 1, closesAt: 1_760_002_700_000 });
    expect(w.provStrength).toBeGreaterThan(0);
    expect(w.score).toBe(Math.round((1.5 / 4) * 55 + 20 + 10));
    // base and 45m forming: the later of the two closes decides
    const both = [rung("30m", "provisional"), rung("45m", "provisional", 1_760_002_700_000), check("1h"), check("4h")];
    expect(confirmVerdict(verdict("long", both, cfg, null), both, cfg).closesAt).toBe(1_760_002_700_000);
    // one required rung: confirmed on the closed base; the forming 45m adds strength only at its own close
    const one = sanitizeSignalCfg({ ladder: ["30m", "45m", "1h", "4h"], required: 1 });
    const raw1 = verdict("long", q, one, null);
    expect(raw1.strength).toBe(2);
    const w1 = confirmVerdict(raw1, q, one);
    expect(w1).toMatchObject({ state: "confirmed", valid: true, strength: 1, provStrength: 1, label: "Long-Einstieg", closesAt: null });
    // RSI only near the extreme on the forming candle: provisional until that candle closes (it can still repaint)
    const live = [rung("30m", "confirmed"), check("45m", { ...rung("45m", "confirmed"), rsiLongClosed: false, forming: true, closesAt: 1_760_002_700_000 })];
    live[0] = { ...live[0]!, rsiLongClosed: false, forming: true, closesAt: 1_760_001_800_000 };
    const rv = verdict("long", [...live, check("1h"), check("4h")], cfg, null);
    expect(rv.valid).toBe(true);
    expect(confirmVerdict(rv, [...live, check("1h"), check("4h")], cfg)).toMatchObject({ state: "provisional", valid: false, closesAt: 1_760_001_800_000 });
    // the RSI held at the last close of either head rung → confirmed
    live[1] = { ...live[1]!, rsiLongClosed: true };
    expect(confirmVerdict(rv, [...live, check("1h"), check("4h")], cfg)).toMatchObject({ state: "confirmed", valid: true });
    // strong base
    const r = [rung("30m", "strong"), rung("45m", "confirmed"), check("1h"), check("4h")];
    expect(confirmVerdict(verdict("long", r, cfg, null), r, cfg)).toMatchObject({ state: "strong", valid: true });
    // nothing forming: the raw verdict's fields unchanged
    const raw2 = verdict("long", r, cfg, null);
    const c2 = confirmVerdict(raw2, r, cfg);
    for (const k of ["tiers", "strength", "label", "valid", "rsiOk", "zoneOk", "strongSignal", "score", "reasons"] as const) expect(c2[k]).toEqual(raw2[k]);
    // no entry rule → state none
    expect(confirmVerdict(verdict("short", r, cfg, null), r, cfg).state).toBe("none");
  });

  it("live engine: valid only on a closed base candle; a provisional entry is never valid", () => {
    let prov = 0;
    let conf = 0;
    for (const seed of [1, 7, 42]) {
      const b15 = synthBars(2600, seed);
      for (let end = 1200; end <= b15.length; end += 5) {
        const bars = ladderBars(b15.slice(0, end));
        const now = (b15[end - 1]!.t + 600) * 1000; // inside the newest 15m bar: every rung's last bar forms
        const s = computeSignals(bars, CFG, now)!;
        for (const v of [s.long, s.short]) {
          if (v.state === "provisional") {
            prov++;
            expect(v.valid).toBe(false);
            expect(v.strength).toBe(0);
            expect(v.provStrength).toBeGreaterThan(0);
            expect(v.label.startsWith(PROVISIONAL_PREFIX)).toBe(true);
            // the countdown runs to a close of the head rungs (the base or a required rung still forming)
            expect(s.checks.slice(0, Math.max(1, v.tiers)).map((c) => c!.closesAt)).toContain(v.closesAt);
            expect(v.closesAt!).toBeGreaterThan(now);
          }
          if (v.valid) {
            conf++;
            expect(["confirmed", "strong"]).toContain(v.state);
            // the base and every required rung on closed candles, the RSI condition on a closed candle
            for (const st of v.rungStates!.slice(0, CFG.required)) expect(["confirmed", "strong"]).toContain(st);
            expect(s.checks.slice(0, Math.max(1, v.tiers)).some((c) => (v.side === "long" ? c!.rsiLongClosed : c!.rsiShortClosed))).toBe(true);
          }
        }
      }
    }
    expect(prov).toBeGreaterThan(5);
    expect(conf).toBeGreaterThan(5);
  });
});

// ------------------------------------------------------------------ divergences

describe("divergences (decision 10)", () => {
  it("regular bullish: price lower low, oscillator higher low — pivots for the chart line", () => {
    const { bars, osc } = bullishSetup("regular");
    const ds = findDivergences(bars, osc, "rsi", DIV, false, 2);
    expect(ds).toHaveLength(1);
    const d = ds[0]!;
    expect(d).toMatchObject({ osc: "rsi", kind: "regular", dir: 1, at: 22, barsAgo: 2, state: "strong", held: true, active: true });
    expect(d.from).toEqual({ index: 10, t: bars[10]!.t, price: 100, osc: 20 });
    expect(d.to).toEqual({ index: 20, t: bars[20]!.t, price: 95, osc: 30 });
  });

  it("hidden bullish; bearish mirrored; hidden can be switched off", () => {
    const h = bullishSetup("hidden");
    expect(findDivergences(h.bars, h.osc, "rsi", DIV, false, 2)).toMatchObject([{ kind: "hidden", dir: 1 }]);
    expect(findDivergences(h.bars, h.osc, "rsi", { ...DIV, hidden: false }, false, 2)).toEqual([]);
    const m = mirrorSetup(bullishSetup("regular"));
    expect(findDivergences(m.bars, m.osc, "rsi", DIV, false, 2)).toMatchObject([{ kind: "regular", dir: -1, from: { price: 120, osc: 80 }, to: { price: 125, osc: 70 } }]);
    const mh = mirrorSetup(h);
    expect(findDivergences(mh.bars, mh.osc, "rsi", DIV, false, 2)).toMatchObject([{ kind: "hidden", dir: -1 }]);
  });

  it("state: provisional while the confirmation bar forms, confirmed after one close, strong after N; inactive when old or broken", () => {
    const s = bullishSetup("regular", 23); // confirmation bar 22 = the newest bar
    expect(findDivergences(s.bars, s.osc, "rsi", DIV, true, 2)[0]).toMatchObject({ state: "provisional", barsAgo: 0, active: true });
    expect(findDivergences(s.bars, s.osc, "rsi", DIV, false, 2)[0]).toMatchObject({ state: "confirmed", barsAgo: 0 });
    const s24 = bullishSetup("regular", 24);
    expect(findDivergences(s24.bars, s24.osc, "rsi", DIV, false, 2)[0]!.state).toBe("strong");
    expect(findDivergences(s24.bars, s24.osc, "rsi", DIV, false, 3)[0]!.state).toBe("confirmed");
    const old = bullishSetup("regular", 30);
    expect(findDivergences(old.bars, old.osc, "rsi", DIV, false, 2)[0]).toMatchObject({ barsAgo: 7, active: false });
    const broken = bullishSetup("regular", 25);
    broken.bars[23] = { ...broken.bars[23]!, c: 94 };
    expect(findDivergences(broken.bars, broken.osc, "rsi", DIV, false, 2)[0]).toMatchObject({ held: false, active: false });
  });

  it("filters: midline, pivot range, lookbacks", () => {
    const s = bullishSetup("regular");
    const high = s.osc.map((x) => x + 40); // pivots above the RSI midline → no bullish divergence
    expect(findDivergences(s.bars, high, "rsi", DIV, false, 2)).toEqual([]);
    expect(findDivergences(s.bars, high, "rsi", { ...DIV, midline: false }, false, 2)).toHaveLength(1);
    expect(findDivergences(s.bars, s.osc, "rsi", { ...DIV, rangeMax: 9 }, false, 2)).toEqual([]);
    expect(findDivergences(s.bars, s.osc, "rsi", { ...DIV, rangeMin: 11 }, false, 2)).toEqual([]);
    // wider pivot lookbacks still find this one (the neighbours rise on both sides), the confirmation moves right
    expect(findDivergences(s.bars, s.osc, "rsi", { ...DIV, left: 3, right: 3 }, false, 2)).toMatchObject([{ at: 23 }]);
  });

  it("grade: regular 0.8, hidden 0.5, both oscillators +0.2, provisional ½", () => {
    const d = (o: Partial<Divergence>): Divergence => ({ osc: "rsi", kind: "regular", dir: 1, from: { index: 0, t: 0, price: 1, osc: 1 }, to: { index: 1, t: 1, price: 1, osc: 1 }, at: 3, barsAgo: 0, state: "confirmed", held: true, active: true, ...o });
    expect(divGrade([])).toBe(0);
    expect(divGrade([d({})])).toBe(0.8);
    expect(divGrade([d({ kind: "hidden" })])).toBe(0.5);
    expect(divGrade([d({}), d({ osc: "wt", kind: "hidden" })])).toBe(1);
    expect(divGrade([d({ state: "provisional" })])).toBe(0.4);
  });

  it("real series: every reported divergence satisfies its definition", () => {
    const bars = synthBars(500, 99, { sec: 1800 });
    const c = checkTf("30m", bars, CFG, (bars[bars.length - 1]!.t + 100) * 1000)!;
    expect(c.div!.all.length).toBeGreaterThan(5);
    for (const d of c.div!.all) {
      const lowerPrice = d.to.price < d.from.price;
      const lowerOsc = d.to.osc < d.from.osc;
      if (d.dir === 1) expect(d.kind === "regular" ? lowerPrice && !lowerOsc : !lowerPrice && lowerOsc).toBe(true);
      else expect(d.kind === "regular" ? !lowerPrice && lowerOsc : lowerPrice && !lowerOsc).toBe(true);
      expect(d.to.index - d.from.index).toBeGreaterThanOrEqual(DIV.rangeMin);
      expect(d.at).toBe(d.to.index + DIV.right);
    }
    for (const d of [...c.div!.long, ...c.div!.short]) expect(d.active).toBe(true);
  });
});

// ------------------------------------------------------------------ structure / S-R

/** Naive LuxAlgo `swings(len)` (the reference the O(n) version must match). */
function naivePivots(bars: readonly Bar[], len: number): Array<{ index: number; high: boolean; price: number }> {
  const out: Array<{ index: number; high: boolean; price: number }> = [];
  let leg = 0;
  let prev = -1;
  for (let i = 0; i < bars.length; i++) {
    if (i >= len) {
      let hh = -Infinity;
      let ll = Infinity;
      for (let k = i - len + 1; k <= i; k++) {
        hh = Math.max(hh, bars[k]!.h);
        ll = Math.min(ll, bars[k]!.l);
      }
      const p = bars[i - len]!;
      if (p.h > hh) leg = 0;
      else if (p.l < ll) leg = 1;
    }
    if (prev !== -1 && leg !== prev) out.push(leg === 1 ? { index: i - len, high: false, price: bars[i - len]!.l } : { index: i - len, high: true, price: bars[i - len]!.h });
    prev = leg;
  }
  return out;
}

describe("market structure + support / resistance (decision 10)", () => {
  const SCFG = { swing: 50, internal: 5, eqLen: 3, eqThreshold: 0.1 };

  it("swings equal the LuxAlgo leg logic; swing breaks and trend equal the zone code's (luxZone)", () => {
    for (const seed of [1, 2, 3, 42, 99]) {
      const bars = synthBars(500, seed, { sec: 3600 });
      const s = marketStructure(bars, SCFG)!;
      for (const [len, internal] of [
        [50, false],
        [5, true],
      ] as const) {
        const want = naivePivots(bars, len).slice(-8);
        const got = s.swings.filter((p) => p.internal === internal).map((p) => ({ index: p.index, high: p.high, price: p.price }));
        expect(got).toEqual(want);
      }
      const z = luxZone(bars, 50);
      const lastSwingBreak = [...s.breaks].reverse().find((b) => !b.internal);
      if (z?.brk && lastSwingBreak) expect({ kind: lastSwingBreak.kind, dir: lastSwingBreak.dir }).toEqual(z.brk);
      if (z) expect(s.trend).toBe(z.bias);
    }
  });

  it("order blocks, EQH / EQL and levels keep their invariants", () => {
    let obs = 0;
    let eqs = 0;
    for (const seed of [5, 6, 7, 8]) {
      const bars = synthBars(500, seed, { sec: 1800 });
      const s = marketStructure(bars, { ...SCFG, range: { hi: Math.max(...bars.map((b) => b.h)), lo: Math.min(...bars.map((b) => b.l)) } })!;
      expect(s.last).toBe(bars.length - 1);
      for (const o of s.obs) {
        obs++;
        expect(o.top).toBeGreaterThanOrEqual(o.btm);
        expect(o.index).toBeLessThan(o.brk);
        // unmitigated ("High/Low"): no later low below a demand block / high above a supply block
        for (let j = o.brk; j < bars.length; j++) expect(o.dir === 1 ? bars[j]!.l >= o.btm : bars[j]!.h <= o.top).toBe(true);
      }
      for (const q of s.eqs) {
        eqs++;
        expect(q.kind === "EQH" ? q.price === Math.max(q.from.price, q.to.price) : q.price === Math.min(q.from.price, q.to.price)).toBe(true);
      }
      const close = bars[bars.length - 1]!.c;
      for (const l of s.supports) expect(l.btm).toBeLessThanOrEqual(close);
      for (const l of s.resistances) expect(l.top).toBeGreaterThanOrEqual(close);
      for (const xs of [s.supports, s.resistances]) {
        expect(xs.length).toBeLessThanOrEqual(4);
        for (let i = 1; i < xs.length; i++) expect(xs[i]!.dist).toBeGreaterThanOrEqual(xs[i - 1]!.dist);
        for (const l of xs) expect(l.distAtr).toBeCloseTo(l.dist / s.atr, 9);
      }
      expect(s.support).toBe(s.supports[0] ?? null);
      // swing points flagged broken once a later close crossed them
      for (const p of s.swings) {
        const after = bars.slice(p.index + 1).map((b) => b.c);
        expect(p.broken).toBe(p.high ? after.some((c) => c > p.price) : after.some((c) => c < p.price));
      }
    }
    expect(obs).toBeGreaterThan(3);
    expect(eqs).toBeGreaterThan(0);
  });

  it("EQH from two equal highs; a constructed bullish BOS", () => {
    // highs 120 at bars 10 and 20 (pivot length 3), everything else ≤ 112
    const bars = flatBars(40, { 5: { l: 100 }, 10: { h: 120, c: 115 }, 15: { l: 100 }, 20: { h: 120.05, c: 115 } });
    const s = marketStructure(bars, SCFG)!;
    expect(s.eqs.find((q) => q.kind === "EQH")).toMatchObject({ price: 120.05, from: { index: 10 }, to: { index: 20 }, broken: false });
    // the nearest resistance is the 120 high; the EQH 0.05 above it is the same level (within 0.1 ATR) and merged
    expect(s.resistances[0]).toMatchObject({ price: 120, dir: -1 });
    expect(s.resistances.filter((l) => Math.abs(l.price - 120) < 0.2)).toHaveLength(1);
    // a close above the internal high → bullish internal break
    const up = flatBars(40, { 5: { l: 100 }, 10: { h: 120, c: 115 }, 15: { l: 100 }, 30: { h: 126, c: 125, o: 111 } });
    const t = marketStructure(up, SCFG)!;
    expect(t.breaks.at(-1)).toMatchObject({ index: 30, dir: 1, internal: true, level: 120, pivot: 10 });
  });

  it("first higher low / lower high", () => {
    const sp = (index: number, high: boolean, label: SwingPoint["label"], broken = false): SwingPoint => ({ index, t: index, price: 100, high, internal: true, label, broken });
    const s = { swings: [sp(10, false, "LL"), sp(15, true, "LH"), sp(20, false, "HL")] };
    expect(lastInternalPivot(s)).toMatchObject({ first: true, pivot: { index: 20 } });
    expect(lastInternalPivot({ swings: [sp(10, false, "HL"), sp(20, false, "HL")] })!.first).toBe(false);
    expect(lastInternalPivot({ swings: [sp(10, true, "HH"), sp(20, true, "LH")] }, true)!.first).toBe(true);
    expect(lastInternalPivot({ swings: [] })).toBeNull();
  });
});

// ------------------------------------------------------------------ top traders

describe("Top-Trader-Kombi (decision 5)", () => {
  const END = 1_760_000_100_000 - (1_760_000_100_000 % M5);

  it("reading from the 5-min series: newest points, retail vs one period earlier, stale = no value", () => {
    const series: TraderSeries = { position: ratioSeries(END, [60, 62, 66]), account: ratioSeries(END, [61, 63, 65.5]), retail: ratioSeries(END, [47, 46.6, 46.2]) };
    const r = traderReading(series, CFG, END + 60_000)!;
    expect(r).toMatchObject({ at: END, position: 66, account: 65.5, retail: 46.2, retailPrev: 46.6, period: "5m", step: M5 });
    expect(r.retailChg).toBeCloseTo(-0.4, 9);
    // only points at or before the evaluation time
    expect(traderReading(series, CFG, END - 1)!.position).toBe(62);
    // 15m comparison: three steps back
    const r15 = traderReading({ ...series, retail: ratioSeries(END, [48, 47.5, 47, 46.2]) }, sanitizeSignalCfg({ whale: { retailPeriod: "15m" } }), END)!;
    expect(r15).toMatchObject({ retailPrev: 48, period: "15m" });
    // stale (older than 2 steps + 5 min) → no value; nothing fresh → null
    expect(traderReading(series, CFG, END + 3 * M5 + 1)).toBeNull();
    expect(traderReading(series, sanitizeSignalCfg({ whale: { on: false } }), END)).toBeNull();
    expect(traderReading(null, CFG, END)).toBeNull();
    // a coarser fallback series (chosen period 1h) sets its step
    const hourly: TraderSeries = { position: ratioSeries(END, [60, 66], 3_600_000), account: [], retail: ratioSeries(END, [48, 47], 3_600_000), step: 3_600_000 };
    expect(traderReading(hourly, CFG, END + 2 * 3_600_000)).toMatchObject({ position: 66, account: null, retailChg: -1, period: "1h" });
  });

  it("four parts with values and lit flags; partial credit; short mirrored; thresholds configurable", () => {
    const zone = check("1h", { zone: zoneInfo(0.2) });
    const p = tradersPart("long", reading(), zone, CFG)!;
    expect(p.items.map((i) => [i.id, i.met])).toEqual([
      ["pos", true],
      ["acc", true],
      ["retail", true],
      ["zone", true],
    ]);
    expect(p.items.map((i) => i.value)).toEqual(["66,0 % Long", "65,0 % Long", "−0,5 pp", "Discount · 20 %"]);
    expect(p.items[0]!.label).toBe("Top-Trader Positionen > 64 % Long");
    expect(p).toMatchObject({ grade: 1, points: 10, ok: true, bonus: true, met: 4, data: true, label: "Top-Trader long · Retail rot", detail: "4 von 4 · +10,0 Punkte" });
    // two of four → half the points, no bonus
    const half = tradersPart("long", reading({ account: 60, retailChg: 0.2 }), zone, CFG)!;
    expect(half).toMatchObject({ met: 2, grade: 0.5, points: 5, ok: false, bonus: false });
    // short: long share < 36 % (> 64 % short) on both ratios, retail green, premium
    const s = tradersPart("short", reading({ position: 35, account: 35.9, retailChg: 0.3 }), check("1h", { zone: zoneInfo(0.8) }), CFG)!;
    expect(s.items.map((i) => i.met)).toEqual([true, true, true, true]);
    expect(s.items[0]!.value).toBe("65,0 % Short");
    expect(s.label).toBe("Top-Trader short · Retail grün");
    expect(tradersPart("short", reading(), zone, CFG)!.met).toBe(0);
    // exact mirror at the threshold: 64,0 % long and 64,0 % short are both not "over 64 %"
    const atLong = tradersPart("long", reading({ position: 64, account: 64 }), zone, CFG)!;
    const atShort = tradersPart("short", reading({ position: 36, account: 36 }), zone, CFG)!;
    expect([atLong.items[0]!.met, atLong.items[1]!.met, atShort.items[0]!.met, atShort.items[1]!.met]).toEqual([false, false, false, false]);
    // threshold 70 %: 66 / 65 no longer lit
    expect(tradersPart("long", reading(), zone, sanitizeSignalCfg({ whale: { topPct: 70 } }))!.met).toBe(2);
    // weight 0: shown, never counted
    expect(tradersPart("long", reading(), zone, sanitizeSignalCfg({ whale: { weight: 0 } }))).toMatchObject({ points: 0, bonus: false, ok: true });
    // no data: excluded, never a fail
    const nd = tradersPart("long", null, zone, CFG)!;
    expect(nd).toMatchObject({ data: false, points: 0, bonus: false, ok: false, detail: "keine Daten" });
    expect(nd.items[0]).toMatchObject({ value: "keine Daten", met: null });
    expect(tradersPart("long", reading(), zone, sanitizeSignalCfg({ whale: { on: false } }))).toBeNull();
  });
});

// ------------------------------------------------------------------ parts, grading

describe("graded parts and the verdict", () => {
  it("support / resistance: near the level, room to the next one in R", () => {
    const level = (price: number, dir: 1 | -1, kind: "ob" | "swing" = "swing", top = price, btm = price) => ({ price, top, btm, kind, dir, index: 1, t: 1, dist: Math.abs(100 - price), distAtr: Math.abs(100 - price) / 2, label: dir === 1 ? "Swing-Tief" : "Swing-Hoch" });
    const structure = (sup: number | null, res: number | null): Structure => {
      const s = sup == null ? null : level(sup, 1);
      const r = res == null ? null : level(res, -1);
      return { swings: [], breaks: [], obs: [], eqs: [], trend: 0, itrend: 0, supports: s ? [s] : [], resistances: r ? [r] : [], support: s, resistance: r, atr: 2, close: 100, last: 10 } as Structure;
    };
    const p = srPart("long", check("1h", { structure: structure(99, 110) }), CFG)!;
    // stop 99 − 0.2 = 98.8 → risk 1.2, reward 10 → 8.33 R; near: 0.5 ATR ≤ 1
    expect(p.levels!.stop).toBeCloseTo(98.8, 9);
    expect(p.levels!.r).toBeCloseTo(10 / 1.2, 9);
    expect(p).toMatchObject({ grade: 1, points: 10, ok: true, bonus: true });
    expect(p.items.map((i) => i.met)).toEqual([true, true]);
    // far from support (3 ATR) and little room
    const far = srPart("long", check("1h", { structure: structure(94, 101) }), CFG)!;
    expect(far.items.map((i) => i.met)).toEqual([false, false]);
    expect(far.grade).toBeLessThan(0.2);
    // no resistance above: room free
    expect(srPart("long", check("1h", { structure: structure(99, null) }), CFG)!.levels!.r).toBe(Infinity);
    // short mirrored
    expect(srPart("short", check("1h", { structure: structure(90, 101) }), CFG)).toMatchObject({ ok: true });
    expect(srPart("long", check("1h"), CFG)).toMatchObject({ data: false, detail: "keine Daten" });
  });

  it("gradeSignals: score + part points (max 100), +1 strength per part that holds, reasons appended, knife attached", () => {
    const b15 = synthBars(2600, 42);
    const bars = ladderBars(b15);
    const now = (b15[b15.length - 1]!.t + 900) * 1000;
    const off = sanitizeSignalCfg({ whale: { on: false }, div: { on: false }, sr: { on: false } });
    const checks = off.ladder.map((tf) => checkTf(tf, bars[tf]!, CFG, now));
    const zone = checks.find((c) => c?.tf === "1h")!;
    const raw: Signals = { checks, zone, at: now, ...bestVerdict(checks, CFG, zone) };
    const g = gradeSignals(raw, CFG, reading({ at: now }));
    for (const side of ["long", "short"] as const) {
      const v = g[side];
      const c = confirmVerdict(raw[side], checks, CFG);
      const pts = v.parts!.reduce((a, p) => a + (p.data ? p.points : 0), 0);
      expect(v.score).toBe(Math.round(Math.min(100, c.score + pts)));
      expect(v.parts!.map((p) => p.id)).toEqual(["traders", "div", "sr"]);
      const bonus = v.parts!.filter((p) => p.bonus).length;
      expect(v.strength).toBe(c.valid ? Math.min(4, c.strength + bonus) : 0);
      expect(v.reasons.slice(-3).map((r) => r.ok)).toEqual(v.parts!.map((p) => p.ok));
      expect(g.knife![side].items.map((i) => i.id)).toEqual(["structure", "divergence", "whale"]);
    }
    expect(g.traders).toMatchObject({ position: 66 });
    // parts off: the confirmed verdict only
    const plain = gradeSignals(raw, off, null);
    expect(plain.long.parts).toEqual([]);
    expect(plain.long.score).toBe(confirmVerdict(raw.long, checks, off).score);
  });

  it("divergence part: one row per rung, best rung counts", () => {
    const hit = (tf: string, kind: "regular" | "hidden", state: "confirmed" | "provisional" = "confirmed"): Divergence & { tf: string } => ({ tf, osc: "rsi", kind, dir: 1, from: { index: 0, t: 0, price: 1, osc: 1 }, to: { index: 5, t: 5, price: 1, osc: 1 }, at: 7, barsAgo: 1, state, held: true, active: true });
    const c30 = check("30m", { div: { all: [], long: [hit("30m", "hidden")], short: [] } });
    const c1h = check("1h", { div: { all: [], long: [hit("1h", "regular")], short: [] } });
    const p = divPart("long", [c30, null, c1h, check("4h", { div: { all: [], long: [], short: [] } })], CFG)!;
    expect(p.items.map((i) => [i.id, i.value, i.met])).toEqual([
      ["30m", "RSI versteckt", true],
      ["45m", "Zu wenig Kerzen", null],
      ["1h", "RSI regulär", true],
      ["4h", "keine", false],
    ]);
    expect(p).toMatchObject({ grade: 0.8, ok: true, tf: "1h", label: "Bullische Divergenz", state: "confirmed" });
    const prov = divPart("long", [check("30m", { div: { all: [], long: [hit("30m", "regular", "provisional")], short: [] } })], CFG)!;
    expect(prov).toMatchObject({ grade: 0.4, ok: false, state: "provisional" });
    expect(prov.items[0]!.value).toBe("RSI regulär · vorläufig");
  });
});

// ------------------------------------------------------------------ falling knife

describe("falling-knife filter (decision 11)", () => {
  const sp = (index: number, high: boolean, label: SwingPoint["label"], price = 100, broken = false): SwingPoint => ({ index, t: index, price, high, internal: true, label, broken });
  const struct = (o: Partial<Structure>): Structure => ({ swings: [], breaks: [], obs: [], eqs: [], trend: 0, itrend: 0, supports: [], resistances: [], support: null, resistance: null, atr: 1, close: 100, last: 100, ...o }) as Structure;

  it("structure point: first higher low (unbroken) or a recent bullish BOS on 1H/4H; short mirrored", () => {
    expect(knifeStructure(struct({ swings: [sp(80, false, "LL", 90), sp(95, false, "HL", 95)] }), "long")).toMatchObject({ met: true, text: "erstes Higher Low 95 · vor 5 Kerzen" });
    expect(knifeStructure(struct({ swings: [sp(80, false, "LL"), sp(95, false, "HL", 95, true)] }), "long").met).toBe(false); // broken
    const bos = { index: 90, t: 90, level: 104, pivot: 70, kind: "BOS" as const, dir: 1 as const, internal: true };
    expect(knifeStructure(struct({ breaks: [bos] }), "long")).toMatchObject({ met: true, text: "BOS ↑ über 104 · vor 10 Kerzen" });
    expect(knifeStructure(struct({ breaks: [{ ...bos, index: 70 }] }), "long").met).toBe(false); // 30 bars old
    expect(knifeStructure(struct({ breaks: [bos, { ...bos, index: 95, dir: -1 }] }), "long").met).toBe(false); // a later bearish break
    expect(knifeStructure(struct({ swings: [sp(80, true, "HH"), sp(95, true, "LH")] }), "short").met).toBe(true);
  });

  it("structure point on closed bars: a break on the running 1h candle is shown as vorläufig, never met", () => {
    const now = { index: 100, t: 100, level: 104, pivot: 70, kind: "CHoCH" as const, dir: 1 as const, internal: true };
    const closed = struct({ swings: [sp(90, true, "HH")], last: 99 });
    const checks = [check("30m"), check("45m"), check("1h", { structure: struct({ swings: [sp(90, true, "HH")], breaks: [now] }), structureClosed: closed, forming: true }), check("4h")];
    const k = knifeFilter({ checks, zone: checks[2]!, ...bestVerdict(checks, CFG, checks[2]!) }, CFG);
    expect(k.items[0]).toMatchObject({ met: false, tfs: [] });
    expect(k.items[0]!.detail).toBe("1h: CHoCH ↑ über 104 · jetzt (vorläufig)");
    // the candle closed with it: the closed structure has the break → met
    const done = [check("30m"), check("45m"), check("1h", { structure: struct({ breaks: [now] }) }), check("4h")];
    expect(knifeFilter({ checks: done, zone: done[2]!, ...bestVerdict(done, CFG, done[2]!) }, CFG).items[0]).toMatchObject({ met: true, tfs: ["1h"] });
    // real bars: the closed structure leaves the forming bar out
    const b15 = synthBars(2600, 7);
    const bars = ladderBars(b15);
    const c1h = checkTf("1h", bars["1h"]!, CFG, (b15[b15.length - 1]!.t + 600) * 1000)!;
    expect(c1h.forming).toBe(true);
    expect(c1h.structureClosed!.last).toBe(c1h.structure!.last - 1);
    expect(checkTf("30m", bars["30m"]!, CFG, (b15[b15.length - 1]!.t + 600) * 1000)!.structureClosed).toBeUndefined();
  });

  it("three automatic points from the same evaluation; no support-zone item; keine Daten = null", () => {
    const hit = { osc: "rsi" as const, kind: "regular" as const, dir: 1 as const, from: { index: 0, t: 0, price: 1, osc: 1 }, to: { index: 5, t: 5, price: 1, osc: 1 }, at: 7, barsAgo: 1, state: "confirmed" as const, held: true, active: true };
    const checks = [
      check("30m", { div: { all: [], long: [], short: [] } }),
      check("45m", { div: { all: [], long: [], short: [] } }),
      check("1h", { structure: struct({ swings: [sp(80, false, "LL"), sp(95, false, "HL")] }), div: { all: [hit], long: [hit], short: [] }, zone: zoneInfo(0.2) }),
      check("4h", { structure: struct({}), div: { all: [], long: [], short: [] } }),
    ];
    const raw = { checks, zone: checks[2]!, at: 0, ...bestVerdict(checks, CFG, checks[2]!) };
    const g = gradeSignals(raw, CFG, reading());
    const k = g.knife!.long;
    expect(k.items.map((i) => i.id)).toEqual(["structure", "divergence", "whale"]);
    expect(k.items.some((i) => /Support|Liquidit/.test(i.label))).toBe(false);
    expect(k.items.map((i) => i.met)).toEqual([true, true, true]);
    expect(k).toMatchObject({ n: 3, all: true, data: true, label: "3 von 3 erfüllt" });
    expect(k.items[0]!.tfs).toEqual(["1h"]);
    expect(k.items[1]).toMatchObject({ tfs: ["1h"], detail: "1h: RSI regulär" });
    expect(k.items[2]!.detail).toBe("4 von 4 · Positionen 66,0 % Long · Konten 65,0 % Long · Retail −0,5 pp");
    // the same data never contradicts the check: the whale point = the Kombi's own items
    expect(g.long.parts!.find((p) => p.id === "traders")!.items.find((i) => i.id === "retail")!.met).toBe(true);
    // retail green → whale point fails; no reading → null
    expect(knifeFilter(gradeSignals(raw, CFG, reading({ retailChg: 0.3 })), CFG).items[2]!.met).toBe(false);
    expect(knifeFilter(gradeSignals(raw, CFG, null), CFG).items[2]).toMatchObject({ met: null, detail: "keine Daten" });
    // divergence off → null
    const noDiv = sanitizeSignalCfg({ div: { on: false } });
    expect(knifeFilter(gradeSignals({ ...raw, checks: checks.map((c) => ({ ...c, div: undefined })) }, noDiv, null), noDiv).items[1]!.met).toBeNull();
    // short side mirrored labels
    expect(g.knife!.short.items.map((i) => i.label)).toEqual(["Erstes Lower High oder BOS auf 1H/4H", "RSI bärische Divergenz", "Whale-vs-Retail-Delta (Top-Trader short · Retail grün)"]);
  });
});

// ------------------------------------------------------------------ bias rows

describe("bias: new rows vote, provisional counts ½, never against a confirmed entry", () => {
  it("traders / div / sr rows: long grade − short grade with their weights", () => {
    const hit = { osc: "rsi" as const, kind: "regular" as const, dir: 1 as const, from: { index: 0, t: 0, price: 1, osc: 1 }, to: { index: 5, t: 5, price: 1, osc: 1 }, at: 7, barsAgo: 1, state: "confirmed" as const, held: true, active: true };
    const checks = [check("30m", { div: { all: [hit], long: [hit], short: [] }, zone: zoneInfo(0.2) }), check("45m"), check("1h", { zone: zoneInfo(0.2) }), check("4h")];
    const s = gradeSignals({ checks, zone: checks[2]!, at: 0, ...bestVerdict(checks, CFG, checks[2]!) }, CFG, reading());
    const b = computeBias(s, CFG)!;
    expect(b.contributions.map((c) => c.id)).toEqual(["mcb-30m", "mcb-45m", "mcb-1h", "mcb-4h", "rsi", "zone", "traders", "div", "sr"]);
    expect(b.contributions.find((c) => c.id === "traders")).toMatchObject({ vote: 1, weight: 10, label: "Top-Trader long · Retail rot" });
    expect(b.contributions.find((c) => c.id === "div")).toMatchObject({ vote: 0.8, weight: 10, label: "Bullische Divergenz" });
    expect(b.contributions.find((c) => c.id === "sr")).toMatchObject({ vote: null, detail: "keine Daten", share: 0 });
    // weights overridable
    const w = computeBias(s, sanitizeSignalCfg({ bias: { div: 30 } }))!;
    expect(w.contributions.find((c) => c.id === "div")!.weight).toBe(30);
  });

  it("an MCB event on the forming candle votes ½ and flags the row; bias state follows the leaning side", () => {
    const ev = { kind: "bottom" as const, barsAgo: 0 };
    const none = { state: "none" as const, event: null, closes: 0, held: false, closed: null, forming: null };
    const prov = check("30m", { wt: { kind: "bottom", barsAgo: 0, long: ev, short: null, wt1: 0, wt2: 0 }, longSignal: true, conf: { long: { state: "provisional", event: ev, closes: 0, held: true, closed: null, forming: ev }, short: none } });
    const closed = check("30m", { wt: { kind: "bottom", barsAgo: 0, long: ev, short: null, wt1: 0, wt2: 0 }, longSignal: true, conf: { long: { state: "confirmed", event: ev, closes: 1, held: true, closed: ev, forming: null }, short: none } });
    const off = sanitizeSignalCfg({ whale: { on: false }, div: { on: false }, sr: { on: false } });
    const bp = computeBias({ checks: [prov], zone: null }, off)!;
    const bc = computeBias({ checks: [closed], zone: null }, off)!;
    const rp = bp.contributions.find((c) => c.id === "mcb-30m")!;
    const rc = bc.contributions.find((c) => c.id === "mcb-30m")!;
    expect(rp.vote).toBeCloseTo(rc.vote! / 2, 9);
    expect(rp.provisional).toBe(true);
    expect(rp.detail).toContain("vorläufig");
    expect(rc.provisional).toBe(false);
  });

  it("random markets (live, forming candles): a valid entry is never shown opposite, \"Stark\" never without one", () => {
    let evals = 0;
    for (const seed of [11, 12]) {
      const b15 = synthBars(2600, seed);
      for (let end = 1300; end <= b15.length; end += 13) {
        const now = (b15[end - 1]!.t + 450) * 1000;
        const s = computeSignals(ladderBars(b15.slice(0, end)), CFG, now, { traders: reading({ at: now, position: 40 + (end % 40), account: 50, retailChg: (end % 3) - 1 }) })!;
        const b = computeBias(s, CFG);
        if (!b) continue;
        evals++;
        if (Math.abs(b.level) === 2) expect(s[b.level > 0 ? "long" : "short"].valid).toBe(true);
        if (s.long.valid !== s.short.valid) {
          const want = s.long.valid ? 1 : -1;
          expect(Math.sign(b.score) * want).toBeGreaterThanOrEqual(0);
        }
        if (b.state === "confirmed" || b.state === "strong") expect(s[b.score > 0 ? "long" : "short"].valid).toBe(true);
      }
    }
    expect(evals).toBeGreaterThan(150);
  });
});

// ------------------------------------------------------------------ snapshots

describe("snapshots record the state, the parts and the knife filter; old snapshots parse unchanged", () => {
  const b15 = synthBars(2600, 42);
  const now = (b15[b15.length - 1]!.t + 450) * 1000;
  const sig = computeSignals(ladderBars(b15), CFG, now, { traders: reading({ at: now }) })!;

  it("stores and parses back", () => {
    for (const side of ["long", "short"] as const) {
      const snap = toSignalSnapshot(sig, side, CFG, { mode: "live" });
      const v = sig[side];
      expect(snap.state).toBe(v.state);
      expect(snap.confTiers).toBe(v.confTiers);
      expect(snap.provStrength).toBe(v.provStrength);
      expect(snap.parts!.map((p) => p.id)).toEqual(["traders", "div", "sr"]);
      expect(snap.parts![0]).toMatchObject({ met: v.parts![0]!.met, period: "5m", ok: v.parts![0]!.ok });
      expect(snap.knife!.items.map((i) => i.id)).toEqual(["structure", "divergence", "whale"]);
      expect(snap.tfs.every((t) => typeof t.state === "string" && typeof t.closes === "number")).toBe(true);
      expect(snap.whale).toBeUndefined(); // the legacy run rule is not stored by the graded engine
      const json = JSON.parse(JSON.stringify(snap));
      expect(parseSignalSnapshot(json)).toEqual(json);
    }
  });

  it("old snapshots (theirs and our v1) stay valid without a state; bad new fields are dropped, unknown keys kept", () => {
    const old = { at: "2026-09-01T10:00:00.000Z", side: "long", score: 70, strength: 2, tiers: 2, label: "Starker Long-Einstieg", valid: true, rsiOk: true, zoneOk: false, zone: "discount", tfs: [{ tf: "30m", kind: "bottom", wt: -55, rsi: 31 }], whale: null, extra: 1 };
    const p = parseSignalSnapshot(old)!;
    expect(p).toEqual(old);
    expect(p.state).toBeUndefined();
    const bad = parseSignalSnapshot({ ...old, state: "maybe", parts: [{ id: "nope" }, { id: "div", grade: "0.5", items: [{ id: "30m", met: "x", raw: "1.5" }] }], knife: { items: [{ id: "structure", met: true }, { id: "zone", met: true }] }, confTiers: "x" })!;
    expect(bad.state).toBeUndefined();
    expect(bad.confTiers).toBeUndefined();
    expect(bad.parts).toEqual([{ id: "div", grade: 0.5, points: 0, weight: 0, ok: false, data: true, state: "none", items: [{ id: "30m", met: null, raw: 1.5 }] }]);
    expect(bad.knife).toEqual({ n: 1, items: [{ id: "structure", met: true }] });
  });
});

// ------------------------------------------------------------------ config, determinism, performance

describe("config, determinism, performance", () => {
  it("every new setting is part of the evaluation key; sanitised and clamped", () => {
    const base = signalCfgKey(sanitizeSignalCfg({}));
    expect(base).toBe(signalCfgKey(DEFAULT_SIGNAL_CFG));
    for (const raw of [{ strongCloses: 1 }, { strongCloses: 3, signalLookback: 4 }, { whale: { topPct: 70 } }, { whale: { retailPeriod: "1h" } }, { whale: { bonusParts: 2 } }, { div: { left: 3 } }, { div: { hidden: false } }, { sr: { nearAtr: 2 } }, { sr: { minR: 3 } }]) {
      expect(signalCfgKey(sanitizeSignalCfg(raw)), JSON.stringify(raw)).not.toBe(base);
    }
    // the closes until "stark bestätigt" never exceed what the signal window can hold (window − the running candle)
    expect(sanitizeSignalCfg({ strongCloses: 3 }).strongCloses).toBe(2);
    expect(sanitizeSignalCfg({ strongCloses: 6, signalLookback: 5 }).strongCloses).toBe(4);
    expect(sanitizeSignalCfg({ strongCloses: 2, signalLookback: 1 }).strongCloses).toBe(1);
    expect(sanitizeSignalCfg({ strongCloses: 99, signalLookback: 20, div: { left: 0, rangeMin: 50, rangeMax: 10 }, sr: { nearAtr: -1, minR: "x", extra: 1 } })).toMatchObject({
      strongCloses: 6,
      div: { left: 1, rangeMin: 50, rangeMax: 50 },
      sr: { nearAtr: 0.1, minR: 2, extra: 1 },
    });
  });

  it("pure and deterministic: the same inputs give the same evaluation", () => {
    const b15 = synthBars(2600, 3);
    const bars = ladderBars(b15);
    const now = (b15[b15.length - 1]!.t + 450) * 1000;
    expect(computeSignals(bars, CFG, now, { traders: reading() })).toEqual(computeSignals(bars, CFG, now, { traders: reading() }));
  });

  it("a full check (4 rungs × 500 bars, every part on) takes < 5 ms", () => {
    const b15 = synthBars(2600, 42);
    const bars = ladderBars(b15);
    for (const tf of Object.keys(bars)) bars[tf] = bars[tf]!.slice(-500);
    const now = (b15[b15.length - 1]!.t + 450) * 1000;
    const r = reading({ at: now });
    for (let k = 0; k < 5; k++) computeSignals(bars, CFG, now, { traders: r });
    const times: number[] = [];
    for (let k = 0; k < 25; k++) {
      const t0 = performance.now();
      computeSignals(bars, CFG, now, { traders: r });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    expect(median).toBeLessThan(5);
  });
});
