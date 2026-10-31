/**
 * P03 breakdowns (`dimensions.ts`, `breakdowns.ts`, `heatmap.ts`): bucket keys of every dimension (Journal-v3 fields
 * read defensively → "ohne" bucket), rows through aggregate(), Wilson / t intervals, the Welch test vs. the rest with
 * Benjamini-Hochberg, the robust best / worst pick, ordinal order, and the weekday × time heatmap.
 */
import { describe, expect, it } from "vitest";
import { aggregate } from "@/domain/agg";
import { breakdown, breakdownUnit, DIMENSION_ORDER, DIMENSIONS, groupByDimension, heatGrid, HEAT_MIN_N, NONE_KEY, riskPctOf } from "@/domain/analytics";
import type { EnrichedTrade } from "@/domain/types";
import { enrich, qt, theirSnap, utc } from "./insights.fixtures";
import { CTX, fixtureView, SETTINGS } from "./analytics.fixtures";

const one = (over: Parameters<typeof qt>[1] = {}, date = utc(2026, 3, 2, 10)): EnrichedTrade => enrich([qt(date, { p: 50, risk: 100, ...over })], SETTINGS)[0]!;

describe("dimensions", () => {
  it("every dimension has a label, an ohne-label and gives at least one key", () => {
    const t = one();
    for (const k of DIMENSION_ORDER) {
      const d = DIMENSIONS[k];
      expect(d.label.length).toBeGreaterThan(1);
      expect(d.none.length).toBeGreaterThan(0);
      expect(d.keys(t, CTX).length).toBeGreaterThan(0);
    }
  });

  it("reads the trade fields (and the v3 fields defensively)", () => {
    const k = (dim: keyof typeof DIMENSIONS, t: EnrichedTrade) => DIMENSIONS[dim].keys(t, CTX);
    const plain = one({ setups: [] });
    expect(k("setup", plain)).toEqual([NONE_KEY]);
    expect(k("setup", one({ setups: ["s_good", "s_bad", "s_good", "gone"] }))).toEqual(["s_good", "s_bad"]);
    expect(k("hold", plain)).toEqual([NONE_KEY]);
    expect(k("hold", one({ exitDate: utc(2026, 3, 2, 12) }))).toEqual(["h2"]);
    expect(k("volatility", one({ atrPct: 2.5 }))).toEqual(["v2"]);
    expect(k("volatility", plain)).toEqual([NONE_KEY]);
    expect(k("exchange", one({ exchange: "Bitunix" }))).toEqual(["bitunix"]);
    // review F15: sub-accounts side by side
    expect(k("exchangeAccount", one({ exchangeAccount: " Sub-Konto 2 " }))).toEqual(["sub-konto 2"]);
    expect(k("exchangeAccount", plain)).toEqual([NONE_KEY]);
    expect(DIMENSIONS.exchangeAccount.labelOf("haupt", CTX)).toBe("Haupt");
    expect(k("tag", one({ tags: ["a", "b", "a"] }))).toEqual(["a", "b"]);
    expect(k("origin", plain)).toEqual(["manual"]);
    expect(k("origin", one({ origin: { kind: "bot", botId: "grid1" } }))).toEqual(["bot:grid1"]);
    expect(DIMENSIONS.origin.labelOf("bot:grid1", CTX)).toBe("Bot · grid1");
    expect(k("leverage", one({ leverage: 7 }))).toEqual(["l2"]);
    expect(k("asset", one({ pair: "BINANCE:ETHUSDT.P" }))).toEqual(["ETHUSDT"]);
    expect(k("regime", one({ signal: theirSnap("long", 3, { lage: { state: "amber", signs: [], ema21_1d: null, dist: null } }) }))).toEqual(["amber"]);
    expect(k("regime", plain)).toEqual([NONE_KEY]);
    expect(k("strength", one({ signal: theirSnap("long", 3) }))).toEqual(["3"]);
    expect(k("box", one({ boxSnap: { v: 1, symbol: "BTCUSDT", tf: "4h", at: 1, phase: "inside", setup: { grade: "A+" } } }))).toEqual(["A+"]);
    expect(k("box", one({ boxSnap: { v: 1, setup: { grade: "A+" } } }))).toEqual([NONE_KEY]);
    expect(k("setupSession", one({ setups: ["s_good"] }, utc(2026, 3, 2, 14)))).toEqual(["s_good|ny"]);
    expect(DIMENSIONS.setupSession.labelOf("s_good|ny", CTX)).toBe("Breakout · NY");
  });

  it("risk % of the account capital", () => {
    // risk 100 on 10 000 → 1 %
    const t = one();
    expect(riskPctOf(t, CTX)).toBeCloseTo(0.01, 10);
    expect(DIMENSIONS.riskPct.keys(t, CTX)).toEqual(["r1"]);
    expect(DIMENSIONS.riskPct.keys(one({ risk: undefined, stop: null }), CTX)).toEqual([NONE_KEY]);
  });

  it("multi-bucket trades appear in each of their buckets", () => {
    const list = [one({ setups: ["s_good", "s_bad"] }), one({ setups: ["s_good"] })];
    const m = groupByDimension(list, DIMENSIONS.setup, CTX);
    expect(m.get("s_good")).toHaveLength(2);
    expect(m.get("s_bad")).toHaveLength(1);
  });
});

describe("breakdown", () => {
  const view = fixtureView();
  const b = breakdown(view.closed, "setup", CTX);

  it("rows are aggregate() of their trades with intervals", () => {
    expect(b.unit).toBe("R");
    expect(b.total).toBe(60);
    expect(b.rows.map((r) => r.key)).toEqual(["s_good", "s_bad"]);
    for (const r of b.rows) {
      expect(r.g).toEqual(aggregate(r.trades));
      expect(r.wrCI!.lo).toBeLessThanOrEqual(r.g.winRate!);
      expect(r.wrCI!.hi).toBeGreaterThanOrEqual(r.g.winRate!);
      expect(r.expR.mean).toBeCloseTo(r.g.avgR!, 10);
      expect(r.expR.ci!.lo).toBeLessThan(r.expR.mean!);
      expect(r.share).toBeCloseTo(0.5, 10);
    }
  });

  it("the strong setup is clearly better than the rest (FDR), and it is the robust best", () => {
    const good = b.rows[0]!;
    const bad = b.rows[1]!;
    expect(good.test.diff).toBeGreaterThan(0);
    expect(good.test.verdict).toBe("klar");
    expect(good.test.q).toBeGreaterThanOrEqual(good.test.p!);
    expect(bad.test.diff).toBeLessThan(0);
    expect(good.test.dWin).toBeGreaterThan(0.2);
    expect(b.best?.key).toBe("s_good");
    expect(b.worst?.key).toBe("s_bad");
  });

  it("ordinal dimensions keep their order; the ohne bucket comes last", () => {
    const wd = breakdown(view.closed, "weekday", CTX);
    const keys = wd.rows.map((r) => Number(r.key));
    expect([...keys].sort((x, y) => x - y)).toEqual(keys);
    const hold = breakdown(view.closed, "hold", CTX);
    expect(hold.rows[hold.rows.length - 1]!.none).toBe(true);
    expect(hold.rows[hold.rows.length - 1]!.label).toBe("Ohne Ausstiegszeit");
  });

  it("small buckets get no interval, no test and no pick; money unit without stops", () => {
    const few = enrich([qt(utc(2026, 1, 5), { p: 10, setups: ["s_good"] }), qt(utc(2026, 1, 6), { p: -5, setups: ["s_bad"] })], SETTINGS);
    expect(breakdownUnit(few)).toBe("money");
    const fb = breakdown(few, "setup", CTX);
    expect(fb.unit).toBe("money");
    for (const r of fb.rows) {
      expect(r.wrCI).toBeNull();
      expect(r.test.verdict).toBe("wenig");
    }
    expect(fb.best).toBeNull();
    expect(breakdown([], "session", CTX).rows).toEqual([]);
  });
});

describe("heatmap", () => {
  it("7 × 12 cells of aggregate(), best / worst only from cells with enough trades", () => {
    const view = fixtureView();
    const h = heatGrid(view.closed);
    expect(h.cells).toHaveLength(84);
    expect(h.cells.reduce((s, c) => s + c.trades.length, 0)).toBe(60);
    for (const c of h.cells) expect(c.g).toEqual(aggregate(c.trades));
    if (h.best) {
      expect(h.best.trades.length).toBeGreaterThanOrEqual(HEAT_MIN_N);
      expect(h.best.value!).toBeGreaterThan(0);
      expect(h.maxAbs).toBeGreaterThanOrEqual(h.best.value!);
    }
    const empty = heatGrid([]);
    expect(empty.best).toBeNull();
    expect(empty.maxAbs).toBe(0);
  });
});
