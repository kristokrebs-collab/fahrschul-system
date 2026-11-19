/**
 * No look-ahead: a feature of an entry may use only what was known at the entry. Proved three ways, each on real feature code:
 *  1. CUT: the features at candle k computed on a series that ENDS at k equal the ones computed on the full series.
 *  2. REWRITE: replacing every candle from k on (and the outcome of every trade that closes after the entry) by garbage changes nothing.
 *  3. SENSITIVITY: the same harness DOES see a difference when one more candle is allowed in – so it can catch a leak.
 * Plus: the miner's table and the backtest filter read the same values for the same entry.
 */
import { describe, expect, it } from "vitest";
import { condHolds } from "@/domain/discovery/cond";
import { barFeatures, BAR_FEATURES, buildSeries, FEATURE_IDS, FEATURES } from "@/domain/discovery/features";
import { patternMask } from "@/domain/discovery/filter";
import { buildTable } from "@/domain/discovery/table";
import type { Cond, DiscoveryTrade } from "@/domain/discovery/types";
import { rng } from "@/domain/analytics/stats";
import { randomBars, tradesOnBars } from "./discovery.fixtures";

const H = 3600;
const bars = randomBars(900, 11);
const full = buildSeries({ intervalSec: H, bars });
const KS = Array.from({ length: 140 }, (_, i) => 3 + i * 3);

function garbage(src: typeof bars, from: number, seed: number): typeof bars {
  const r = rng(seed);
  return src.map((b, i) => (i < from ? b : { t: b.t, o: 1 + r() * 900, h: 1000 + r() * 900, l: 0.5, c: 1 + r() * 900, v: 1e9 * r() }));
}

describe("candle features never read the future", () => {
  it("CUT: a series that ends at k gives the same features at k as the full series (both sides, all features)", () => {
    for (const k of KS) {
      const atS = bars[k]!.t; // the entry at the open of candle k
      const cut = buildSeries({ intervalSec: H, bars: bars.slice(0, k) });
      for (const side of ["long", "short"] as const) expect(barFeatures(cut, k, atS, side), `k=${k} ${side}`).toEqual(barFeatures(full, k, atS, side));
    }
  });

  it("REWRITE: garbage from candle k on does not change a single feature at k", () => {
    for (const k of KS.filter((_, i) => i % 4 === 0)) {
      const atS = bars[k]!.t;
      const mut = buildSeries({ intervalSec: H, bars: garbage(bars, k, k) });
      for (const side of ["long", "short"] as const) expect(barFeatures(mut, k, atS, side), `k=${k} ${side}`).toEqual(barFeatures(full, k, atS, side));
    }
  });

  it("SENSITIVITY: letting one more candle in changes (almost) every candle feature – the harness would catch a leak", () => {
    let differs = 0;
    let total = 0;
    for (const k of KS) {
      const a = barFeatures(full, k, bars[k]!.t, "long");
      const b = barFeatures(full, k + 1, bars[k + 1]!.t, "long");
      for (const id of BAR_FEATURES) {
        if (a[id] == null && b[id] == null) continue;
        total++;
        if (a[id] !== b[id]) differs++;
      }
    }
    expect(differs / total).toBeGreaterThan(0.9);
  });

  it("a candle that is still forming at the entry is not used (entry inside candle k → signal candle k − 1)", () => {
    const t: DiscoveryTrade = { id: "m", entryTime: (bars[200]!.t + 1234) * 1000, exitTime: null, side: "long", r: 1 };
    const table = buildTable({ trades: [t], markets: { "": { intervalSec: H, bars } }, source: "journal" });
    const expected = barFeatures(full, 200, bars[200]!.t + 1234, "long"); // candles 0…199 closed; candle 200 is forming
    for (const id of BAR_FEATURES) expect(table.cols[id]?.[0] ?? null, id).toEqual(expected[id]);
    const rewritten = buildTable({ trades: [t], markets: { "": { intervalSec: H, bars: garbage(bars, 200, 3) } }, source: "journal" });
    for (const id of BAR_FEATURES) expect(rewritten.cols[id]?.[0] ?? null, id).toEqual(expected[id]);
  });
});

describe("the table of a backtest reads the same values whatever happens afterwards", () => {
  const trades = tradesOnBars(bars, 5, { gap: 7 });
  const input = { trades, markets: { "": { intervalSec: H, bars } }, source: "backtest" as const };
  const base = buildTable(input);

  it("every column of every trade is unchanged when the candles after its entry are rewritten", () => {
    // rewrite from the entry of trade j on; trades before j keep all their values (their entry is earlier)
    for (const j of [10, 20, 30]) {
      const cut = trades[j]!.entryTime / 1000;
      const idx = bars.findIndex((b) => b.t >= cut);
      const mut = buildTable({ ...input, markets: { "": { intervalSec: H, bars: garbage(bars, idx, j) } } });
      for (let i = 0; i < j; i++) for (const id of Object.keys(base.cols) as (keyof typeof base.cols)[]) expect(mut.cols[id]?.[i], `trade ${i} ${id}`).toEqual(base.cols[id]![i]);
      // …and the trade at the rewrite point itself still sees only the candles before it
      for (const id of BAR_FEATURES) expect(mut.cols[id]?.[j] ?? null, `trade ${j} ${id}`).toEqual(base.cols[id]?.[j] ?? null);
    }
  });

  it("losses in a row: the outcome of trades that close after an entry changes nothing at that entry", () => {
    const flipped = trades.map((t, i): DiscoveryTrade => (i > 25 ? { ...t, r: -(t.r ?? 0) - 1 } : t));
    const alt = buildTable({ ...input, trades: flipped });
    // trades 0…25 close before trade 26 enters (one position at a time), so their streak labels cannot depend on anything later
    for (let i = 0; i <= 26; i++) expect(alt.cols.lossStreak?.[i], `trade ${i}`).toEqual(base.cols.lossStreak?.[i]);
    // while the later ones DO change – the column is not constant
    expect(alt.cols.lossStreak!.slice(27)).not.toEqual(base.cols.lossStreak!.slice(27));
  });

  it("the hold time is not a feature unless asked for; no entry-phase feature is marked as known after the trade", () => {
    expect(base.cols.hold).toBeUndefined();
    for (const id of Object.keys(base.cols) as (keyof typeof base.cols)[]) expect(FEATURES[id].phase, id).toBe("entry");
    const post = buildTable({ ...input, includePostEntry: true });
    expect(post.cols.hold).toBeDefined();
    expect(FEATURE_IDS.filter((id) => FEATURES[id].phase === "after")).toEqual(["hold"]);
  });
});

describe("the backtest filter reads what the miner read", () => {
  it("pattern mask at signal candle i = the condition on the table row of an entry at candle i + 1", () => {
    const conds: Cond[] = [
      { f: "rsi", k: "num", lo: 50, hi: null },
      { f: "volRegime", k: "num", lo: null, hi: 1.05 },
    ];
    const spec = { v: 1 as const, label: "x", conds };
    const mask = patternMask(bars, H, spec);
    let checked = 0;
    for (const i of KS) {
      for (const side of ["long", "short"] as const) {
        const t: DiscoveryTrade = { id: `t${i}`, entryTime: bars[i + 1]!.t * 1000, exitTime: null, side, r: 1 };
        const table = buildTable({ trades: [t], markets: { "": { intervalSec: H, bars } }, source: "backtest" });
        const vals = conds.map((c) => table.cols[c.f]?.[0] ?? null);
        const expected = vals.some((v) => v == null) && conds.every((c, n) => vals[n] == null || condHolds(c, vals[n]!)) ? 2 : conds.every((c, n) => condHolds(c, vals[n]!)) ? 1 : 0;
        expect((side === "long" ? mask.long : mask.short)[i], `candle ${i} ${side}`).toBe(expected);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("the mask is causal too: rewriting everything after candle i leaves mask[i] as it was", () => {
    const spec = { v: 1 as const, label: "x", conds: [{ f: "emaDist20", k: "num", lo: 0, hi: null } as Cond, { f: "htfTrend", k: "num", lo: null, hi: 0 } as Cond] };
    const a = patternMask(bars, H, spec);
    for (const i of [60, 150, 240, 330]) {
      const b = patternMask(garbage(bars, i + 1, i), H, spec);
      for (let j = 0; j <= i; j++) {
        expect(b.long[j]).toBe(a.long[j]);
        expect(b.short[j]).toBe(a.short[j]);
      }
    }
  });
});
