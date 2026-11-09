/**
 * The miner on synthetic data with KNOWN truth – fixed seeds, so every run sees the same numbers:
 *  - a planted relationship is found (a single feature, a combination that is more than its parts, a losing pattern);
 *  - pure noise: the correction lets almost nothing through (rate checked over many runs);
 *  - an effect that vanishes in the newer 40 % is never "bestätigt";
 *  - the count of tests is reported, the rejected ones are counted and shown, nothing is cleaned up;
 *  - the same input and seed give the same result, however the job is stepped.
 */
import { describe, expect, it } from "vitest";
import { createDiscoveryJob, runDiscoverySync } from "@/domain/discovery/job";
import { mineTable, overlapping } from "@/domain/discovery/mine";
import { findingToFilter, patternMask } from "@/domain/discovery/filter";
import { LIMITS, type DiscoveryResult, type DiscoveryTrade, type Finding } from "@/domain/discovery/types";
import { PASS } from "@/domain/lab/filters/masks";
import { makeTable, randomBars, tradesOnBars } from "./discovery.fixtures";

type Table = ReturnType<typeof makeTable>;
function mine(table: Table, seed = 1): DiscoveryResult {
  const g = mineTable(table, { seed, label: null, source: "journal" }, { value: 0 });
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}
const confirmed = (r: DiscoveryResult): Finding[] => r.findings.filter((f) => f.tier === "confirmed");
const features = (f: Finding): string[] => f.conds.map((c) => c.f).sort();

describe("a planted relationship is found", { timeout: 120_000 }, () => {
  it("a combination that is more than its parts (London AND high RSI): confirmed, marked non-obvious, with sample and rates", () => {
    const res = mine(makeTable(600, 21, { where: (r) => r.session === "London" && (r.rsi as number) > 5, pWin: 0.85, pBase: 0.3 }));
    expect(res.status).toBe("ok");
    const f = confirmed(res).find((x) => features(x).join() === "rsi,session")!;
    expect(f, "the pair is among the confirmed findings").toBeDefined();
    expect(f.side).toBe("win");
    expect(f.nonObvious).toBe(true);
    expect(f.all.n).toBeGreaterThan(60);
    expect(f.all.winRate!).toBeGreaterThan(0.75);
    expect(f.all.winRate! - f.all.baseWinRate!).toBeGreaterThan(0.3);
    expect(f.all.winCi!.lo).toBeGreaterThan(f.all.baseWinRate!); // the whole 80 % interval above the strategy as a whole
    expect(f.conf!.n).toBeGreaterThan(20); // judged on fresh data too
    expect(f.q).toBeLessThan(1e-6);
    expect(f.confQ!).toBeLessThanOrEqual(LIMITS.confirmAlpha);
    expect(f.blocks.filter((b) => b === 1).length).toBeGreaterThanOrEqual(3);
    expect(f.shareWinners!).toBeGreaterThan(f.shareLosers!);
  });

  it("a single feature (high RSI) is confirmed; a combination that adds nothing is counted but not listed", () => {
    const res = mine(makeTable(600, 22, { where: (r) => (r.rsi as number) > 6.7, pWin: 0.8, pBase: 0.35 }));
    const single = confirmed(res).find((x) => x.conds.length === 1 && x.conds[0]!.f === "rsi" && x.side === "win");
    expect(single).toBeDefined();
    expect(res.counts.redundant + res.counts.confirmed).toBeGreaterThan(res.counts.confirmed); // some combinations were explained by their parts
    // every confirmed combination is more than its best part
    for (const f of confirmed(res).filter((x) => x.conds.length > 1)) expect(f.nonObvious, f.id).toBe(true);
  });

  it("a losing pattern is found and kept apart from the winning ones (side = loss)", () => {
    const res = mine(makeTable(600, 23, { where: (r) => r.weekday === "Montag", pWin: 0.05, pBase: 0.5 }));
    const f = confirmed(res).find((x) => x.conds.length === 1 && x.conds[0]!.f === "weekday")!;
    expect(f).toBeDefined();
    expect(f.side).toBe("loss");
    expect(f.all.winRate!).toBeLessThan(0.15);
    expect(f.all.diffWinRate!).toBeLessThan(-0.2);
    expect(f.all.diffR!).toBeLessThan(-0.5);
  });

  it("the whole chain on candles: a relationship that sits in RSI and volatility is found, and the backtest filter picks exactly those trades", () => {
    const bars = randomBars(2600, 99);
    const trades = tradesOnBars(bars, 5, { gap: 5, effect: { where: (r) => (r.rsi as number) > 55 && (r.volRegime as number) < 1, pWin: 0.85, pBase: 0.35 } });
    const res = runDiscoverySync({ trades, markets: { "": { intervalSec: 3600, bars } }, source: "backtest", seed: 5 });
    expect(res.status).toBe("ok");
    const f = confirmed(res).find((x) => features(x).includes("rsi") && features(x).includes("volRegime") && x.conds.length === 2)!;
    expect(f, "RSI AND volatility regime").toBeDefined();
    expect(f.nonObvious).toBe(true);
    const conv = findingToFilter(f);
    expect(conv.ok).toBe(true);
    if (!conv.ok) return;
    // the filter, evaluated at the signal candle before each entry, lets exactly the trades of the finding through
    const mask = patternMask(bars, 3600, conv.spec);
    const idx = new Map(bars.map((b, i) => [b.t * 1000, i]));
    let pass = 0;
    for (const t of trades) {
      const i = idx.get(t.entryTime)! - 1;
      if ((t.side === "long" ? mask.long : mask.short)[i] === PASS) pass++;
    }
    expect(pass).toBe(f.all.n);
  });
});

describe("pure noise", { timeout: 300_000 }, () => {
  it("the correction lets (almost) nothing through: over 120 runs of 300 trades, at most a few runs show anything, and almost none is 'bestätigt'", () => {
    let discovery = 0;
    let anyConfirmed = 0;
    for (let s = 0; s < 120; s++) {
      const res = mine(makeTable(300, 12_000 + s), 31 + s);
      expect(res.counts.tested).toBeGreaterThan(500);
      if (res.findings.some((f) => f.q <= LIMITS.fdr)) discovery++;
      if (res.counts.confirmed > 0) anyConfirmed++;
    }
    // Benjamini-Hochberg at 10 %: under pure noise at most ~10 % of the runs show a survivor at all (measured: 8 %)
    expect(discovery).toBeLessThanOrEqual(18);
    // …and the confirmation part, the correction over the candidates and the time blocks thin that out again (measured: ~1 %)
    expect(anyConfirmed).toBeLessThanOrEqual(3);
  });

  it("small samples stay honest too (150 trades) and large ones (900) – 60 runs each", () => {
    let confirmedRuns = 0;
    for (const n of [150, 900]) for (let s = 0; s < 60; s++) if (mine(makeTable(n, 20_000 + s), 7 + s).counts.confirmed > 0) confirmedRuns++;
    expect(confirmedRuns).toBeLessThanOrEqual(3);
  });

  it("on candles too: random walk, random outcomes – 12 runs, nothing confirmed", () => {
    let c = 0;
    for (let s = 0; s < 12; s++) {
      const bars = randomBars(1800, 300 + s);
      const trades = tradesOnBars(bars, 400 + s, { gap: 5 });
      c += runDiscoverySync({ trades, markets: { "": { intervalSec: 3600, bars } }, source: "backtest", seed: s + 1 }).counts.confirmed;
    }
    expect(c).toBe(0);
  });
});

describe("the split and the time blocks", { timeout: 120_000 }, () => {
  it("an effect that exists only in the older 55 % is never confirmed: the newer part does not repeat it", () => {
    const res = mine(makeTable(600, 24, { where: (r, i, n) => i < 0.55 * n && (r.rsi as number) > 6, pWin: 0.9, pBase: 0.35 }));
    expect(confirmed(res).filter((f) => features(f).includes("rsi"))).toHaveLength(0);
    // the discovery part saw it (very small q) and the confirmation part turned it down – and the card shows that
    const shown = res.findings.filter((f) => features(f).includes("rsi") && f.q < 1e-4);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((f) => f.tier === "rejected" && f.reasons.includes("flipped"))).toBe(true);
  });

  it("thresholds come from the discovery part, the 60 : 40 split is chronological and reported", () => {
    const res = mine(makeTable(250, 5));
    expect(res.nDisc).toBe(150);
    expect(res.nConf).toBe(100);
    expect(res.nDisc + res.nConf).toBe(res.n);
  });
});

describe("nothing is hidden or rounded up", { timeout: 120_000 }, () => {
  const res = mine(makeTable(500, 21, { where: (r) => r.session === "London" && (r.rsi as number) > 5, pWin: 0.85, pBase: 0.3 }));

  it("the number of tests is reported and the stages add up to it; the rejected ones are counted", () => {
    const c = res.counts;
    expect(c.tested).toBeGreaterThan(900);
    expect(c.singles + c.pairs + c.triples).toBe(c.tested);
    expect(c.confirmed + c.hint + c.rejected + c.redundant).toBe(c.tested);
    expect(c.rejected).toBeGreaterThan(c.tested * 0.9); // the vast majority is chance – and says so
    expect(c.triples).toBeGreaterThan(0); // 500 trades ≥ the limit for triples
    expect(res.permutations).toBeGreaterThanOrEqual(LIMITS.minPerms);
  });

  it("every finding obeys its stage", () => {
    for (const f of res.findings) {
      expect(f.blocks).toHaveLength(LIMITS.blocks);
      expect(f.all.n).toBeGreaterThanOrEqual(LIMITS.minCell);
      expect(f.q).toBeGreaterThanOrEqual(0);
      expect(f.q).toBeLessThanOrEqual(1);
      if (f.tier === "confirmed") {
        expect(f.q).toBeLessThanOrEqual(LIMITS.fdr);
        expect(f.parentP).toBeLessThanOrEqual(LIMITS.parentGate);
        expect(f.confQ!).toBeLessThanOrEqual(LIMITS.confirmAlpha);
        expect(f.blocks.filter((b) => b === 1).length).toBeGreaterThanOrEqual(LIMITS.blocksAgree);
        expect(f.conf!.n).toBeGreaterThanOrEqual(LIMITS.minConfCell);
        expect(f.reasons).toEqual([]);
      } else expect(f.reasons.length, f.id).toBeGreaterThan(0);
      if (f.tier === "hint" && !f.reasons.includes("untested")) expect(f.q).toBeLessThanOrEqual(LIMITS.fdr);
    }
  });

  it("the closest rejected patterns are shown with their numbers (a handful, never more)", () => {
    const rej = res.findings.filter((f) => f.tier === "rejected");
    expect(rej.length).toBeGreaterThan(0);
    expect(rej.length).toBeLessThanOrEqual(LIMITS.maxRejectedShown);
    for (const f of rej) expect(f.all.winRate).not.toBeNull();
  });

  it("the base is the whole strategy, in the same units as every finding", () => {
    expect(res.base.n).toBe(500);
    for (const f of res.findings) expect(f.all.baseWinRate).toBeCloseTo(res.base.winRate!, 12);
  });

  it("near copies are not listed twice", () => {
    const list = confirmed(res);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) if (list[i]!.side === list[j]!.side) expect(overlapping(list[i]!.conds, list[j]!.conds), `${list[i]!.id} / ${list[j]!.id}`).toBe(false);
  });
});

describe("overlap of two patterns", () => {
  const num = (f: string, lo: number | null, hi: number | null) => ({ f, k: "num" as const, lo, hi }) as never;
  it("overlapping ranges on the same features are near copies; disjoint ranges, other features and other categories are not", () => {
    expect(overlapping([num("rsi", 55, null)], [num("rsi", 59, null)])).toBe(true);
    expect(overlapping([num("rsi", 55, 60)], [num("rsi", 60, null)])).toBe(false);
    expect(overlapping([num("rsi", 55, null)], [num("emaDist20", 55, null)])).toBe(false);
    expect(overlapping([num("rsi", 55, null)], [num("rsi", 55, null), num("volRegime", null, 1)])).toBe(false);
    expect(overlapping([{ f: "side", k: "cat", v: "Long" }], [{ f: "side", k: "cat", v: "Short" }])).toBe(false);
    expect(overlapping([{ f: "side", k: "cat", v: "Long" }], [{ f: "side", k: "cat", v: "Long" }])).toBe(true);
  });
});

describe("limits and empty states, with the reason", () => {
  const journalLike = (n: number, spread = true): DiscoveryTrade[] =>
    Array.from({ length: n }, (_, i) => ({ id: `t${i}`, entryTime: 1_700_000_000_000 + (spread ? i * 3_600_000 : 0), exitTime: null, side: "long" as const, r: i % 3 === 0 ? 1 : -1 }));

  it("too few trades: no analysis, the minimum and the actual number are named", () => {
    const r = runDiscoverySync({ trades: journalLike(50), source: "journal" });
    expect(r.status).toBe("tooFew");
    expect(r.note).toContain(String(LIMITS.minTrades));
    expect(r.note).toContain("50");
    expect(r.findings).toEqual([]);
    expect(r.counts.tested).toBe(0);
  });
  it("trades without a known R are left out and counted", () => {
    const trades = [...journalLike(100), ...journalLike(7).map((t, i) => ({ ...t, id: `n${i}`, r: null }))];
    const r = runDiscoverySync({ trades, source: "journal" });
    expect(r.droppedNoR).toBe(7);
    expect(r.n).toBe(100);
  });
  it("features with no spread are named with the reason; nothing to test says so", () => {
    const r = runDiscoverySync({ trades: journalLike(120, false), source: "journal" });
    expect(r.status).toBe("noFeatures");
    expect(r.note).toBeTruthy();
    expect(r.featuresEmpty.length).toBeGreaterThan(0);
  });
  it("above the upper limit the most recent trades are kept and the rest is counted", () => {
    const r = runDiscoverySync({ trades: journalLike(LIMITS.maxTrades + 150).map((t, i) => ({ ...t, side: i % 2 ? ("short" as const) : ("long" as const) })), source: "journal" });
    expect(r.n).toBe(LIMITS.maxTrades);
    expect(r.droppedCap).toBe(150);
  });
});

describe("what is only known afterwards is not used – unless asked, and then it is marked", () => {
  // the result depends on how long the trade was held: a description of the outcome, not a reason to enter
  const trades: DiscoveryTrade[] = Array.from({ length: 300 }, (_, i) => {
    const hold = 1 + ((i * 7) % 10); // hours
    return { id: `t${i}`, entryTime: 1_700_000_000_000 + i * 86_400_000, exitTime: 1_700_000_000_000 + i * 86_400_000 + hold * 3_600_000, side: i % 2 ? ("short" as const) : ("long" as const), r: hold > 5 ? 2 : -1 };
  });
  it("by default the hold time is not a feature and no finding uses it", () => {
    const r = runDiscoverySync({ trades, source: "journal" });
    expect(r.featuresUsed).not.toContain("hold");
    expect(r.findings.some((f) => f.conds.some((c) => c.f === "hold"))).toBe(false);
  });
  it("when asked for, a finding on it carries the flag and can never become a filter", () => {
    const r = runDiscoverySync({ trades, source: "journal", includePostEntry: true });
    const f = r.findings.find((x) => x.tier === "confirmed" && x.conds.some((c) => c.f === "hold"))!;
    expect(f).toBeDefined();
    expect(f.postEntry).toBe(true);
    const conv = findingToFilter(f);
    expect(conv.ok).toBe(false);
    if (!conv.ok) expect(conv.reason).toMatch(/erst nach dem Trade bekannt/);
  });
});

describe("the job: reproducible, steppable, with progress", { timeout: 120_000 }, () => {
  const bars = randomBars(2600, 8);
  const trades = tradesOnBars(bars, 9, { gap: 5, effect: { where: (r) => (r.rsi as number) > 55, pWin: 0.9, pBase: 0.3 } });
  const input = { trades, markets: { "": { intervalSec: 3600, bars } }, source: "backtest" as const, seed: 42, label: "Test" };
  const strip = (r: DiscoveryResult): unknown => ({ ...r, ms: 0 });

  it("the same input and seed give the same result", () => {
    const a = runDiscoverySync(input);
    const b = runDiscoverySync({ ...input });
    expect(strip(a)).toEqual(strip(b));
    expect(a.seed).toBe(42);
    expect(a.label).toBe("Test");
  });
  it("however it is stepped (tiny slices) the result is identical, progress only grows and stays below 1 until the end", () => {
    const whole = runDiscoverySync(input);
    const job = createDiscoveryJob(input);
    let last = 0;
    let steps = 0;
    while (!job.step(performance.now() + 0.2)) {
      const p = job.progress();
      expect(p).toBeGreaterThanOrEqual(last);
      expect(p).toBeLessThan(1);
      last = p;
      steps++;
    }
    expect(steps).toBeGreaterThan(5);
    expect(job.progress()).toBe(1);
    expect(strip(job.result())).toEqual(strip(whole));
  });
  it("another seed shuffles differently (other p-values) but finds the same strong pattern", () => {
    const a = runDiscoverySync(input);
    const b = runDiscoverySync({ ...input, seed: 43 });
    expect(b.seed).toBe(43);
    expect(a.findings.map((f) => f.p)).not.toEqual(b.findings.map((f) => f.p));
    const key = (r: DiscoveryResult): string[] => r.findings.filter((f) => f.tier === "confirmed" && f.conds.some((c) => c.f === "rsi")).map((f) => f.id);
    expect(key(a).length).toBeGreaterThan(0);
    expect(key(b).length).toBeGreaterThan(0);
  });
});
