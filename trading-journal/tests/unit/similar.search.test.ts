/**
 * F19 – the search: outcomes, hit selection, the numbers over the hits, and the proofs that the forming candle and the
 * future do not leak into the match.
 */
import { describe, expect, it } from "vitest";
import { baselineOf, fewText, findSimilar, headline, outcomeAt, pickHits, sanitizeCfg, summarize, MIN_HITS } from "@/domain/similar";
import type { Outcome, SimCandle, SimilarHit } from "@/domain/similar";
import { H, T0, walk } from "./similar.helpers";

const mk = (i: number, h: number, l: number, c: number): SimCandle => ({ time: T0 + i * H, open: c, high: h, low: l, close: c, volume: 1, closed: true, closeTime: T0 + (i + 1) * H - 1 });

describe("outcomeAt – hand-computed", () => {
  // candle 0 closes at 100 (ATR 2 → 1 R = 2); then three candles
  const bars = [mk(0, 101, 99, 100), mk(1, 101, 99, 100.5), mk(2, 103, 98.5, 102), mk(3, 102, 97, 99)];

  it("R: max up 3 = 1,5 R · max down 3 = 1,5 R · change −1 = −0,5 R · +1 R reached first in candle 2", () => {
    const o = outcomeAt(bars, 0, 3, "r", 2)!;
    expect(o.up).toBeCloseTo(1.5, 12);
    expect(o.down).toBeCloseTo(1.5, 12);
    expect(o.change).toBeCloseTo(-0.5, 12);
    expect(o.dir).toBe("down");
    // candle 1: up 1, down 1 (< 2); candle 2: up 3 ≥ 2, down 1,5 < 2 → up first, after 2 candles
    expect(o.first).toBe("up");
    expect(o.firstBars).toBe(2);
    expect(o.ref).toBe(100);
    expect(o.last).toBe(99);
  });

  it("% : 1 % = 1 price unit here → candle 1 touches +1 and −1 in the same candle → order unknown", () => {
    const o = outcomeAt(bars, 0, 3, "pct", null)!;
    expect(o.up).toBeCloseTo(3, 12); // (103 − 100) / 100 · 100
    expect(o.change).toBeCloseTo(-1, 12);
    expect(o.first).toBe("both");
    expect(o.firstBars).toBeNull();
  });

  it("a course that needs candles that are not there, or a unit that cannot be formed, is no outcome", () => {
    expect(outcomeAt(bars, 1, 3, "r", 2)).toBeNull();
    expect(outcomeAt(bars, 0, 3, "r", null)).toBeNull();
    expect(outcomeAt(bars, 0, 3, "r", 0)).toBeNull();
  });

  it("excursions are never negative; a flat close is flat", () => {
    const down = [mk(0, 101, 99, 100), mk(1, 99, 97, 98), mk(2, 98, 96, 100)];
    const o = outcomeAt(down, 0, 2, "r", 1)!;
    expect(o.up).toBe(0);
    expect(o.down).toBeCloseTo(4, 12);
    expect(o.dir).toBe("flat");
  });
});

describe("pickHits – hand-computed", () => {
  const c = (j: number, d: number) => ({ j, d });
  it("nearest first, no two within minGap, nothing beyond maxDistance, at most maxHits", () => {
    const cands = [c(10, 0.1), c(12, 0.2), c(30, 0.3), c(21, 1.5), c(14, 0.35), c(40, 0.9)];
    // minGap 5: 10 (0,1) → 12 is 2 away (skip) → 30 (0,3) → 14 is 4 from 10 (skip) → 40 (0,9) → 21 beyond 1,2 → end
    expect(pickHits(cands, { maxHits: 10, maxDistance: 1.2, minGap: 5 }).map((x) => x.j)).toEqual([10, 30, 40]);
    expect(pickHits(cands, { maxHits: 2, maxDistance: 1.2, minGap: 5 }).map((x) => x.j)).toEqual([10, 30]);
    expect(pickHits(cands, { maxHits: 10, maxDistance: 0.25, minGap: 5 }).map((x) => x.j)).toEqual([10]);
  });
  it("a tie goes to the more recent candle", () => {
    expect(pickHits([c(3, 0.5), c(50, 0.5)], { maxHits: 1, maxDistance: 1, minGap: 1 }).map((x) => x.j)).toEqual([50]);
  });
});

const out = (change: number, o: Partial<Outcome> = {}): Outcome => ({ up: Math.max(0, change), down: Math.max(0, -change), change, dir: change > 0 ? "up" : change < 0 ? "down" : "flat", first: "none", firstBars: null, ref: 100, last: 100, ...o });
const hit = (index: number, change: number, o: Partial<Outcome> = {}): SimilarHit => ({ index, time: T0 + index * H, distance: 0.1 * index, values: {}, outcome: out(change, o) });

describe("summarize – hand-computed", () => {
  // changes +2, +1, −3, −1, +0,5 → 3 up, 2 down
  const hits = [hit(1, 2), hit(2, 1), hit(3, -3, { first: "down", firstBars: 2 }), hit(4, -1), hit(5, 0.5)];
  const s = summarize(hits);

  it("counts, expectation and the spread of the change", () => {
    expect([s.n, s.up.k, s.down.k, s.flat.k]).toEqual([5, 3, 2, 0]);
    expect(s.up.share).toBeCloseTo(0.6, 12);
    expect(s.expectation).toBe("up");
    // sorted −3 −1 0,5 1 2: median 0,5 · q25 −1 · q75 1 · mean −0,1
    expect(s.change.median).toBeCloseTo(0.5, 12);
    expect(s.change.q25).toBeCloseTo(-1, 12);
    expect(s.change.q75).toBeCloseTo(1, 12);
    expect(s.change.mean).toBeCloseTo(-0.1, 12);
    // deviations from −0,1: 2,1 · 1,1 · −2,9 · −0,9 · 0,6 → squares 15,2 → sd = √(15,2 / 4)
    expect(s.change.sd).toBeCloseTo(Math.sqrt(3.8), 12);
  });

  it("the counter-examples are every hit that went the other way, the largest move first – none hidden", () => {
    expect(s.counters.map((h) => h.index)).toEqual([3, 4]);
    expect(s.counters.length).toBe(s.down.k);
  });

  it("the setback is the median excursion against the majority; the first touch is counted", () => {
    // downs against an up majority: 0, 0, 3, 1, 0 → median 0
    expect(s.medianSetback).toBe(0);
    expect(s.touch.down).toBeCloseTo(0.2, 12);
    expect(s.touch.medianBarsDown).toBe(2);
    expect(s.touch.medianBarsUp).toBeNull();
  });

  it("a tie has no expectation and no counter-examples", () => {
    const t = summarize([hit(1, 1), hit(2, -1)]);
    expect(t.expectation).toBeNull();
    expect(t.counters).toEqual([]);
    expect(t.medianSetback).toBeNull();
    expect(headline(t, 12)).toMatch(/gleich oft/);
  });

  it("a Wilson interval accompanies each share and contains it", () => {
    expect(s.up.lo).toBeLessThan(s.up.share);
    expect(s.up.hi).toBeGreaterThan(s.up.share);
  });

  it("baselineOf is the same share over all comparable candles", () => {
    const b = baselineOf([out(1), out(-1), out(2), out(3)])!;
    expect(b.n).toBe(4);
    expect(b.up.share).toBe(0.75);
    expect(b.medianChange).toBeCloseTo(1.5, 12);
    expect(baselineOf([])).toBeNull();
  });
});

describe("sanitizeCfg", () => {
  it("clamps, orders features, and keeps minGap ≥ horizon", () => {
    const c = sanitizeCfg({ horizon: 24, minGap: 3, features: ["trend", "rsi", "nonsense" as never], maxDistance: -1, maxHits: 9999 });
    expect(c.features).toEqual(["rsi", "trend"]);
    expect(c.minGap).toBe(24);
    expect(c.maxDistance).toBe(1.2);
    expect(c.maxHits).toBe(200);
    expect(sanitizeCfg(null).horizon).toBe(12);
  });
});

describe("findSimilar", () => {
  const NOW = (n: number) => T0 + n * H;
  const candles = walk(1200, 11);
  const loose = { maxDistance: 3, horizon: 6, minGap: 6 };

  it("finds hits whose course is complete, that do not overlap, nearest first", () => {
    const r = findSimilar(candles, "1h", NOW(1200), loose);
    expect(r.status).toBe("ok");
    expect(r.hits.length).toBeGreaterThanOrEqual(MIN_HITS);
    const q = r.query!.index;
    expect(q).toBe(1199);
    for (const h of r.hits) {
      expect(h.index).toBeLessThanOrEqual(q - r.cfg.horizon);
      expect(h.outcome.last).toBe(candles[h.index + r.cfg.horizon]!.close);
      expect(h.outcome.ref).toBe(candles[h.index]!.close);
    }
    const idx = r.hits.map((h) => h.index).sort((a, b) => a - b);
    for (let i = 1; i < idx.length; i++) expect(idx[i]! - idx[i - 1]!).toBeGreaterThanOrEqual(r.cfg.minGap);
    for (let i = 1; i < r.hits.length; i++) expect(r.hits[i]!.distance).toBeGreaterThanOrEqual(r.hits[i - 1]!.distance);
    expect(r.summary!.n).toBe(r.hits.length);
    expect(r.baseline!.n).toBe(r.candidates);
  });

  it("is deterministic", () => {
    expect(findSimilar(candles, "1h", NOW(1200), loose)).toEqual(findSimilar(candles, "1h", NOW(1200), loose));
  });

  it("the FORMING candle is not read: an absurd open candle appended changes nothing", () => {
    const base = findSimilar(candles, "1h", NOW(1200), loose);
    const forming: SimCandle = { time: NOW(1200), open: 100, high: 9000, low: 1, close: 5000, volume: 9e9, closed: false };
    expect(findSimilar([...candles, forming], "1h", NOW(1200) + 60_000, loose)).toEqual(base);
    // a candle flagged closed whose time has not come yet is not closed either
    const early: SimCandle = { ...forming, closed: true, closeTime: NOW(1201) - 1 };
    expect(findSimilar([...candles, early], "1h", NOW(1200) + 60_000, loose)).toEqual(base);
  });

  it("the future of a hit is only measured: changing candles after a hit's course leaves its distance and values alone", () => {
    const base = findSimilar(candles, "1h", NOW(1200), loose);
    const h = base.hits[0]!;
    const after = h.index + base.cfg.horizon + 1; // first candle after the course
    if (after < candles.length - 1) {
      const changed = candles.map((c, k) => (k === after ? { ...c, close: c.close * 1.3, high: c.high * 1.4, low: c.low } : c));
      const r = findSimilar(changed, "1h", NOW(1200), loose);
      const same = r.hits.find((x) => x.index === h.index);
      // the candle at `after` is part of later candles' history, so the match may shift – but THIS hit's own description cannot
      if (same) {
        expect(same.values).toEqual(h.values);
        expect(same.outcome).toEqual(h.outcome);
      }
    }
  });

  it("the query's own description uses nothing beyond it: the same situation found from a series cut right there", () => {
    const cut = 900;
    const a = findSimilar(candles.slice(0, cut), "1h", NOW(cut), loose);
    const b = findSimilar([...candles.slice(0, cut), ...candles.slice(cut).map((c) => ({ ...c, closed: false }))], "1h", NOW(cut), loose);
    expect(b).toEqual(a);
  });

  it("fewer than 20 hits: no judgement, no summary, a reason – the hits stay visible", () => {
    const r = findSimilar(candles, "1h", NOW(1200), { maxDistance: 0.05, horizon: 6, minGap: 6 });
    expect(r.status).toBe("few");
    expect(r.summary).toBeNull();
    expect(fewText(r)).toMatch(/Zu wenig Daten/);
    expect(r.hits.length).toBeLessThan(MIN_HITS);
  });

  it("too few candles: says how many were there and how many are needed", () => {
    const r = findSimilar(candles.slice(0, 30), "1h", NOW(30), {});
    expect(r.status).not.toBe("ok");
    expect(fewText(r)).toBeTruthy();
    expect(r.hits).toEqual([]);
  });

  it("a feature the current candle cannot be described by is dropped and named", () => {
    const r = findSimilar(candles.slice(0, 120), "1h", NOW(120), { features: ["rsi", "emaSlow"], horizon: 6, minGap: 6 });
    expect(r.features).toEqual(["rsi"]);
    expect(r.dropped.map((d) => d.id)).toEqual(["emaSlow"]);
    expect(r.dropped[0]!.reason).toMatch(/Vorlauf/);
  });

  it("features that make no sense on the timeframe are dropped with a reason; none left → noFeatures", () => {
    const r = findSimilar(candles, "1W", NOW(1200), { features: ["weekday"] });
    expect(r.status).toBe("noFeatures");
    expect(r.dropped[0]!.reason).toMatch(/Wochen/);
    expect(findSimilar(candles, "1h", NOW(1200), { features: [] }).status).toBe("noFeatures");
  });

  it("the unit changes the numbers, not the hits", () => {
    const a = findSimilar(candles, "1h", NOW(1200), { ...loose, unit: "r" });
    const b = findSimilar(candles, "1h", NOW(1200), { ...loose, unit: "pct" });
    expect(b.hits.map((h) => h.index)).toEqual(a.hits.map((h) => h.index));
    expect(b.hits[0]!.outcome.change).not.toBe(a.hits[0]!.outcome.change);
    expect(b.hits[0]!.outcome.dir).toBe(a.hits[0]!.outcome.dir);
  });

  it("headline names counts and the uncertainty range", () => {
    const r = findSimilar(candles, "1h", NOW(1200), loose);
    expect(headline(r.summary!, 6)).toMatch(/In \d+ von \d+ ähnlichen Situationen/);
    expect(headline(r.summary!, 6)).toMatch(/Spanne \d+–\d+ %/);
  });
});
