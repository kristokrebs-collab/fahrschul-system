/**
 * The statistics of the Muster-Entdecker: the permutation statistic (exact moments), the pooled null, Holm, time blocks,
 * classes and conditions, the words. Small hand-worked tables first; the search itself is in `discovery.mine.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { rng } from "@/domain/analytics/stats";
import { catBinning, classOf, condHolds, condOf, condsKey, hash32, numBinning, quantileCuts } from "@/domain/discovery/cond";
import { holmAdjusted } from "@/domain/discovery/mine";
import { blockSigns, momentsOf, PooledNull, shuffle, zScale } from "@/domain/discovery/perm";
import { sanitizePatternSpec } from "@/domain/discovery/spec";
import { breakdownText, condText, condsText, countsSentence, findingSentence, DISCLAIMER, TIER_LABEL } from "@/domain/discovery/text";
import type { CellStats, Cond, DiscoveryCounts, Finding } from "@/domain/discovery/types";

describe("permutation statistic", () => {
  it("z has mean 0 and variance 1 over ALL ways to pick n of N labels (exact, no assumption on the shape)", () => {
    const labels = [1, 2, 3, 4, 10, -1];
    const N = labels.length;
    const { mu, sigma } = momentsOf(labels);
    for (const n of [1, 2, 3, 4]) {
      const scale = zScale(N, n, sigma);
      const zs: number[] = [];
      const pick = (start: number, chosen: number[]): void => {
        if (chosen.length === n) {
          zs.push((chosen.reduce((s, x) => s + x, 0) / n - mu) * scale);
          return;
        }
        for (let i = start; i < N; i++) pick(i + 1, [...chosen, labels[i]!]);
      };
      pick(0, []);
      const m = zs.reduce((s, x) => s + x, 0) / zs.length;
      const v = zs.reduce((s, x) => s + x * x, 0) / zs.length;
      expect(m).toBeCloseTo(0, 10);
      expect(v).toBeCloseTo(1, 10);
    }
  });
  it("is undefined (0) without spread or when the pattern is everything", () => {
    expect(zScale(10, 3, 0)).toBe(0);
    expect(zScale(10, 10, 1)).toBe(0);
    expect(zScale(10, 0, 1)).toBe(0);
    expect(momentsOf([5, 5, 5]).sigma).toBe(0);
  });
  it("momentsOf uses the divisor N", () => {
    expect(momentsOf([1, 2, 3, 4])).toEqual({ mu: 2.5, sigma: Math.sqrt(1.25) });
  });
  it("shuffle: a permutation, reproducible for a seed, and every order of 3 occurs about equally often", () => {
    const a = Float64Array.from([1, 2, 3, 4, 5]);
    shuffle(a, rng(3));
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5]);
    const b = Float64Array.from([1, 2, 3, 4, 5]);
    shuffle(b, rng(3));
    expect([...b]).toEqual([...a]);
    const r = rng(9);
    const seen = new Map<string, number>();
    for (let i = 0; i < 6000; i++) {
      const x = Float64Array.from([1, 2, 3]);
      shuffle(x, r);
      seen.set(x.join(""), (seen.get(x.join("")) ?? 0) + 1);
    }
    expect(seen.size).toBe(6);
    for (const c of seen.values()) expect(Math.abs(c - 1000)).toBeLessThan(120);
  });
});

describe("pooled null", () => {
  // standard normal draws (Box-Muller) as the null of 40 000 pattern × shuffle pairs of one size class
  const r = rng(21);
  const gauss = (): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const pool = new PooledNull(Array.from({ length: 400 }, () => 60), 100);
  const s = pool.stratumOf(60);
  for (let i = 0; i < 40_000; i++) pool.add(s, Math.abs(gauss()));
  pool.finish();

  it("reads |z| against the pooled null: p(0) = 1, p(1,96) ≈ 0,05, p(3) ≈ 0,0027", () => {
    expect(pool.p(s, 0)).toBeCloseTo(1, 3);
    expect(pool.p(s, 1.96)).toBeGreaterThan(0.04);
    expect(pool.p(s, 1.96)).toBeLessThan(0.06);
    expect(pool.p(s, 3)).toBeGreaterThan(0.0015);
    expect(pool.p(s, 3)).toBeLessThan(0.0045);
  });
  it("beyond the pool's range the normal tail takes over (never 0, never larger than the plain normal p)", () => {
    const p6 = pool.p(s, 6);
    expect(p6).toBeGreaterThan(0);
    expect(p6).toBeLessThan(1e-6);
    expect(p6).toBeGreaterThan(1e-10); // 2·(1 − Φ(6)) ≈ 2e-9; widened by the pool's own tail (≥ 1)
  });
  it("p never decreases when |z| decreases", () => {
    let prev = 0;
    for (const z of [6, 5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0]) {
      const p = pool.p(s, z);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
  it("merges size classes that would be too thin and keeps big and small apart when both are large", () => {
    const few = new PooledNull([16, 18, 20], 100);
    expect(few.stratumOf(16)).toBe(few.stratumOf(200)); // too little null for separate pools → one pool
    const many = new PooledNull([...Array.from({ length: 100 }, () => 16), ...Array.from({ length: 100 }, () => 600)], 400);
    expect(many.stratumOf(16)).not.toBe(many.stratumOf(600));
  });
});

describe("Holm", () => {
  it("adjusts step-down and monotone; untestable entries stay out of the family", () => {
    // sorted: 0,01 ×3 = 0,03 · 0,03 ×2 = 0,06 · 0,04 ×1 = 0,04 → monotone: 0,06
    expect(holmAdjusted([0.01, 0.04, 0.03])).toEqual([0.03, 0.06, 0.06].map((x) => expect.closeTo(x, 12)));
    expect(holmAdjusted([null, 0.02, null])).toEqual([null, expect.closeTo(0.02, 12), null]);
    expect(holmAdjusted([0.5, 0.9])[1]).toBe(1);
  });
});

describe("stability over time", () => {
  // 40 trades, 4 blocks of 10: block 0 and 1 – the pattern (first 5) wins 2 against −1; block 2 – the pattern loses; block 3 – only 2 inside
  const r: number[] = [];
  const inside = new Set<number>();
  for (let b = 0; b < 4; b++)
    for (let k = 0; k < 10; k++) {
      const i = b * 10 + k;
      if (b === 3) r.push(k < 2 ? 2 : -1);
      else if (b === 2) r.push(k < 5 ? -1 : 2);
      else r.push(k < 5 ? 2 : -1);
      if (b === 3 ? k < 2 : k < 5) inside.add(i);
    }
  it("+1 where the block has the pattern's sign, −1 where it has the other, 0 where the block is too thin", () => {
    expect(blockSigns(r, (i) => inside.has(i), 1)).toEqual([1, 1, -1, 0]);
    expect(blockSigns(r, (i) => inside.has(i), -1)).toEqual([-1, -1, 1, 0]);
  });
  it("a pattern that never occurs is 0 everywhere", () => {
    expect(blockSigns(r, () => false, 1)).toEqual([0, 0, 0, 0]);
  });
});

describe("classes and conditions", () => {
  it("quantile cuts at the tercile / half / quintile probabilities, de-duplicated", () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(quantileCuts(v, "half")).toEqual([5]);
    const t = quantileCuts(v, "tercile");
    expect(t[0]).toBeCloseTo(1 + 8 / 3, 10);
    expect(t[1]).toBeCloseTo(1 + 16 / 3, 10);
    expect(quantileCuts(v, "quintile")).toHaveLength(4);
    expect(quantileCuts([5, 5, 5, 5, 5, 5], "tercile")).toEqual([5]); // ties collapse
    expect(quantileCuts([], "half")).toEqual([]);
  });
  it("a value belongs to the class from its lower cut (inclusive) up to the next cut (exclusive); missing = −1", () => {
    const b = numBinning("rsi", [1, 2, 3, 4, 5, 6, 7, 8, 9], "tercile");
    expect([1, 3.5, 3.67, 5, 6.34, 9].map((x) => classOf(b, x))).toEqual([0, 0, 1, 1, 2, 2]);
    expect(classOf(b, null)).toBe(-1);
    expect(classOf(b, Number.NaN)).toBe(-1);
    expect(condOf(b, 0)).toEqual({ f: "rsi", k: "num", lo: null, hi: b.cuts[0] });
    expect(condOf(b, 1)).toEqual({ f: "rsi", k: "num", lo: b.cuts[0], hi: b.cuts[1] });
    expect(condOf(b, 2)).toEqual({ f: "rsi", k: "num", lo: b.cuts[1], hi: null });
  });
  it("categories: values with enough trades, most frequent first; the others are no class", () => {
    const b = catBinning("setup", ["A", "B", "B", "C", "B", "A", null, "D"], 2);
    expect(b.levels).toEqual(["B", "A"]);
    expect(classOf(b, "A")).toBe(1);
    expect(classOf(b, "D")).toBe(-1);
    expect(condOf(b, 0)).toEqual({ f: "setup", k: "cat", v: "B" });
  });
  it("condHolds: ranges are [lo, hi); a missing value never holds", () => {
    const c: Cond = { f: "rsi", k: "num", lo: 50, hi: 60 };
    expect([49.99, 50, 59.99, 60].map((v) => condHolds(c, v))).toEqual([false, true, true, false]);
    expect(condHolds(c, null)).toBe(false);
    expect(condHolds({ f: "side", k: "cat", v: "Long" }, "Long")).toBe(true);
    expect(condHolds({ f: "side", k: "cat", v: "Long" }, 3)).toBe(false);
  });
  it("the key of a set of conditions does not depend on their order", () => {
    const a: Cond = { f: "rsi", k: "num", lo: 50, hi: null };
    const b: Cond = { f: "side", k: "cat", v: "Long" };
    expect(condsKey([a, b])).toBe(condsKey([b, a]));
    expect(hash32("a")).not.toBe(hash32("b"));
    expect(hash32("abc")).toBe(hash32("abc"));
  });
});

describe("words", () => {
  const cell = (n: number, winRate: number, base: number, avgR = 0.5, baseR = 0.1): CellStats => ({ n, total: 200, wins: Math.round(n * winRate), winRate, winCi: { lo: winRate - 0.1, hi: winRate + 0.1 }, avgR, rCi: null, baseWinRate: base, baseAvgR: baseR, diffWinRate: winRate - base, diffR: avgR - baseR });
  const finding = (side: "win" | "loss", tier: Finding["tier"], conds: Cond[]): Finding => ({
    id: condsKey(conds),
    conds,
    side,
    tier,
    reasons: [],
    all: cell(64, side === "win" ? 0.71 : 0.31, 0.48),
    disc: cell(40, 0.7, 0.48),
    conf: cell(24, 0.7, 0.5),
    z: side === "win" ? 4 : -4,
    p: 1e-4,
    q: 0.01,
    parentP: 0.01,
    confP: 0.01,
    confQ: 0.02,
    blocks: [1, 1, 1, 1],
    shareWinners: 0.7,
    shareLosers: 0.3,
    nonObvious: true,
    obscure: false,
    postEntry: false,
  });
  const rsiHi: Cond = { f: "rsi", k: "num", lo: 55, hi: null };
  const volLo: Cond = { f: "volRegime", k: "num", lo: null, hi: 1 };

  it("a condition reads like the trader would say it (German decimals, unit behind the number)", () => {
    expect(condText(rsiHi)).toBe("RSI(14) ab 55");
    expect(condText(volLo)).toBe("Volatilität im Verhältnis zu ihrem 50er-Schnitt unter 1,00×");
    expect(condText({ f: "emaDist50", k: "num", lo: 0.5, hi: 1.25 })).toBe("Abstand zum EMA 50 (in Handelsrichtung) zwischen 0,50 und 1,25 ATR");
    expect(condText({ f: "bodyRatio", k: "num", lo: 60, hi: null })).toBe("Körper-Anteil der Signalkerze ab 60 %");
    expect(condText({ f: "session", k: "cat", v: "London" })).toBe("Session London");
    expect(condText({ f: "lossStreak", k: "cat", v: "3 oder mehr" })).toBe("3 oder mehr Verluste in Folge davor");
    expect(condText({ f: "setup", k: "cat", v: "Retest" })).toBe("Setup „Retest“");
    expect(condsText([rsiHi, volLo])).toContain(" UND ");
  });
  it("the sentence of a finding carries the rates, the sample and the stage", () => {
    expect(findingSentence(finding("win", "confirmed", [rsiHi, volLo]))).toBe("Wenn RSI(14) ab 55 UND Volatilität im Verhältnis zu ihrem 50er-Schnitt unter 1,00×: 71 % Treffer statt 48 % (n=64, bestätigt)");
    expect(findingSentence(finding("loss", "hint", [rsiHi]))).toBe("Wenn RSI(14) ab 55: nur 31 % Treffer statt 48 % (n=64, Hinweis)");
    expect(findingSentence(finding("loss", "rejected", [rsiHi]))).toContain("verworfen (Zufall)");
    expect(TIER_LABEL).toEqual({ confirmed: "bestätigt", hint: "Hinweis", rejected: "verworfen (Zufall)" });
  });
  it("the count line says how many were checked and how many held up – the rejected ones count too", () => {
    const c = (o: Partial<DiscoveryCounts>): DiscoveryCounts => ({ tested: 412, singles: 60, pairs: 352, triples: 0, confirmed: 3, hint: 5, rejected: 404, redundant: 0, skippedSmall: 0, ...o });
    expect(countsSentence(c({}))).toBe("Ich habe 412 Zusammenhänge geprüft, 3 halten stand.");
    expect(countsSentence(c({ confirmed: 1 }))).toBe("Ich habe 412 Zusammenhänge geprüft, 1 hält stand.");
    expect(countsSentence(c({ confirmed: 0 }))).toBe("Ich habe 412 Zusammenhänge geprüft, keiner hält stand.");
    expect(countsSentence(c({ tested: 1, confirmed: 0 }))).toBe("Ich habe 1 Zusammenhang geprüft, keiner hält stand.");
    expect(breakdownText(c({}))).toBe("3 bestätigt · 5 Hinweise · 404 verworfen (Zufall)");
    expect(breakdownText(c({ hint: 1, redundant: 2 }))).toBe("3 bestätigt · 1 Hinweis · 404 verworfen (Zufall) · 2 schon durch ein einfacheres oder stärkeres Muster abgedeckt");
  });
  it("the disclaimer is the required sentence", () => {
    expect(DISCLAIMER).toBe("Beobachtung, keine Ursache; kein Versprechen für die Zukunft. Keine professionelle Finanzberatung.");
  });
});

describe("stored pattern filters are read defensively", () => {
  const ok = { v: 1, label: "x", conds: [{ f: "rsi", k: "num", lo: 50, hi: null }] };
  it("accepts a valid spec, normalises it, and builds a label when it is missing", () => {
    expect(sanitizePatternSpec(ok)).toEqual({ v: 1, label: "x", conds: [{ f: "rsi", k: "num", lo: 50, hi: null }] });
    expect(sanitizePatternSpec({ ...ok, label: "" })!.label).toBe("RSI(14) ab 50");
  });
  it("refuses wrong versions, shapes, unknown / inherited feature names, features a filter cannot evaluate, and too many conditions", () => {
    for (const bad of [null, 3, "x", { v: 2, conds: ok.conds }, { v: 1 }, { v: 1, conds: [] }, { v: 1, conds: [{ f: "rsi", k: "num", lo: null, hi: null }] }, { v: 1, conds: [{ f: "rsi", k: "num", lo: "a", hi: null }] }, { v: 1, conds: [{ f: "nope", k: "cat", v: "x" }] }, { v: 1, conds: [{ f: "constructor", k: "cat", v: "x" }] }, { v: 1, conds: [{ f: "__proto__", k: "cat", v: "x" }] }, { v: 1, conds: [{ f: "setup", k: "cat", v: "A" }] }, { v: 1, conds: [{ f: "hold", k: "num", lo: 1, hi: null }] }, { v: 1, conds: Array.from({ length: 4 }, () => ok.conds[0]) }]) {
      expect(sanitizePatternSpec(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
