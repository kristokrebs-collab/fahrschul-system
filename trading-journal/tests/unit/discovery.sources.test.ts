/**
 * Sources and consumers of the search: the trades of a REAL lab run on the BTCUSDT fixtures and the journal's trades go in;
 * a confirmed finding goes out as a filter that the Labor's filter comparison runs next to the same strategy; the runner stops
 * on request. Nothing here starts by itself.
 */
import { describe, expect, it } from "vitest";
import { createLabJob, type BtTrade } from "@/domain/backtest/index";
import { fromBacktest, fromJournal } from "@/domain/discovery/adapters";
import { barFeatures, buildSeries } from "@/domain/discovery/features";
import { findingToFilter, patternMask } from "@/domain/discovery/filter";
import { isDiscoveryAbort, runDiscovery, runDiscoveryIdle } from "@/domain/discovery/runner";
import { buildTable } from "@/domain/discovery/table";
import { LIMITS, type Cond, type Finding } from "@/domain/discovery/types";
import { createExtraJob } from "@/domain/lab/extras/job";
import { activeFilters, filterInfos, sanitizeFilters, type FilterSelection } from "@/domain/lab/filters";
import { mkTrade } from "./domain.fixtures";
import { H4, realInput } from "./lab.extras.helpers";
import { randomBars, tradesOnBars } from "./discovery.fixtures";

const finding = (tier: Finding["tier"], conds: Cond[]): Finding => ({
  id: "x",
  conds,
  side: "win",
  tier,
  reasons: tier === "confirmed" ? [] : ["confirmWeak"],
  all: { n: 50, total: 200, wins: 30, winRate: 0.6, winCi: { lo: 0.5, hi: 0.7 }, avgR: 0.4, rCi: null, baseWinRate: 0.45, baseAvgR: 0.1, diffWinRate: 0.15, diffR: 0.3 },
  disc: { n: 30, total: 120, wins: 18, winRate: 0.6, winCi: null, avgR: 0.4, rCi: null, baseWinRate: 0.45, baseAvgR: 0.1, diffWinRate: 0.15, diffR: 0.3 },
  conf: null,
  z: 3,
  p: 0.001,
  q: 0.01,
  parentP: 0.01,
  confP: 0.01,
  confQ: 0.02,
  blocks: [1, 1, 1, 1],
  shareWinners: 0.6,
  shareLosers: 0.3,
  nonObvious: false,
  obscure: false,
  postEntry: false,
});
const rsiHi: Cond = { f: "rsi", k: "num", lo: 50, hi: null };

describe("a real backtest as the source", () => {
  const input = realInput();
  const res = createLabJob(input).result();
  const trades: BtTrade[] = res.trades;

  it("the run has trades and its entry times sit on the candles of the run (the index space of `entryIndex`)", () => {
    expect(trades.length).toBeGreaterThan(5);
    for (const t of trades) expect(t.entryTime).toBe(H4[t.entryIndex]!.t * 1000);
  });

  it("fromBacktest keeps what the search needs and nothing else; the table reads the features at the fill", () => {
    const d = fromBacktest(trades, H4, 14_400, { label: "BTCUSDT 4h", seed: 3 });
    expect(d.source).toBe("backtest");
    expect(d.seed).toBe(3);
    expect(d.trades).toHaveLength(trades.length);
    expect(d.trades[0]).toMatchObject({ id: trades[0]!.id, entryTime: trades[0]!.entryTime, exitTime: trades[0]!.exitTime, side: "long", r: trades[0]!.r });
    const table = buildTable(d);
    expect(table.trades).toHaveLength(trades.length);
    const series = buildSeries({ intervalSec: 14_400, bars: H4 });
    trades.forEach((t, i) => {
      const f = barFeatures(series, t.entryIndex, t.entryTime / 1000, t.side);
      expect(table.cols.emaDist20?.[i] ?? null).toEqual(f.emaDist20);
      expect(table.cols.rsi?.[i] ?? null).toEqual(f.rsi);
    });
    // the strategy's own signal tag is the "Setup" category
    expect(table.cols.setup).toBeDefined();
  });

  it("a pattern filter runs in the Labor's filter comparison: signals are rejected and counted, 'Ohne Filter' is the run above", () => {
    // the median RSI of the run's entries: about half of the signals sit below it
    const rsis = (buildTable(fromBacktest(trades, H4, 14_400)).cols.rsi as number[]).filter((v) => v != null).sort((x, y) => x - y);
    const lo = rsis[Math.floor(rsis.length / 2)]!;
    const spec = { v: 1 as const, label: `RSI(14) ab ${lo}`, conds: [{ f: "rsi", k: "num", lo, hi: null } as Cond] };
    const sel: FilterSelection = { v: 1, on: ["pattern"], rsiLimit: 70, trendLen: 20, pattern: spec };
    expect(activeFilters(sel, "custom", "4h")).toEqual(["pattern"]);
    const out = createExtraJob({ base: input, what: "filters", filters: sel }).result();
    if (out.what !== "filters") throw new Error("filters expected");
    expect(out.compare.rows.map((r) => r.id)).toEqual(["base", "only:pattern"]);
    const base = out.compare.rows[0]!;
    const only = out.compare.rows[1]!;
    expect(base.stats!.n).toBe(res.stats.n);
    expect(base.delta).toBeNull();
    expect(only.label).toBe("Nur Muster-Filter");
    expect(only.blocked).toBeGreaterThan(0);
    expect(only.stats!.n).toBeLessThanOrEqual(only.asked - only.blocked); // a passed signal becomes a trade (unless the engine skips it)
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  }, 60_000);

  it("a pattern that every signal satisfies changes nothing; one that none satisfies rejects all", () => {
    const run = (cond: Cond) => {
      const sel: FilterSelection = { v: 1, on: ["pattern"], rsiLimit: 70, trendLen: 20, pattern: { v: 1, label: "x", conds: [cond] } };
      const out = createExtraJob({ base: input, what: "filters", filters: sel }).result();
      if (out.what !== "filters") throw new Error("filters expected");
      return out.compare.rows.find((r) => r.id === "only:pattern")!;
    };
    const everything = run({ f: "rsi", k: "num", lo: 0, hi: 101 });
    expect(everything.blocked).toBe(0);
    const nothing = run({ f: "rsi", k: "num", lo: 200, hi: null });
    expect(nothing.stats!.n).toBe(0);
  }, 60_000);
});

describe("the journal as the source", () => {
  const trades = [
    mkTrade({ id: "a", date: "2026-03-02T08:30", exitDate: "2026-03-02T11:00", side: "long", r: 1.5, emotion: "Ruhig", setups: ["s1"], pair: "BTC/USDT" }),
    mkTrade({ id: "b", date: "2026-03-03T14:00", side: "short", r: -1, emotion: " FOMO ", setups: [], pair: "ETH/USDT" }),
    mkTrade({ id: "c", date: "2026-03-04T09:00", status: "open", r: null }),
    mkTrade({ id: "d", date: "2026-03-05T09:00", exitDate: "2026-03-05T08:00", r: 2 }), // exit before entry: unknown, not negative
    mkTrade({ id: "e", date: "2026-03-06T09:00", r: null }),
  ];
  const d = fromJournal(trades, { setupName: (id) => (id === "s1" ? "Breakout" : null), label: "Journal" });

  it("only closed trades; R and exit time stay unknown where they are; labels are trimmed", () => {
    expect(d.source).toBe("journal");
    expect(d.trades.map((t) => t.id)).toEqual(["a", "b", "d", "e"]);
    const [a, b, dd, e] = d.trades;
    expect(a).toMatchObject({ side: "long", r: 1.5, setup: "Breakout", emotion: "Ruhig", market: "BTC/USDT" });
    expect(a!.entryTime).toBe(new Date("2026-03-02T08:30").getTime());
    expect(a!.exitTime).toBe(new Date("2026-03-02T11:00").getTime());
    expect(b).toMatchObject({ side: "short", r: -1, setup: null, emotion: "FOMO", exitTime: null });
    expect(dd!.exitTime).toBeNull();
    expect(e!.r).toBeNull();
  });
  it("without candles only the clock, the history and the journal fields are available – and the table says why the rest is empty", () => {
    const t = buildTable(d);
    expect(t.trades).toHaveLength(3); // the trade without R is left out
    expect(t.droppedNoR).toBe(1);
    expect(t.cols.emotion).toEqual(["Ruhig", "FOMO", null]);
    expect(t.cols.session).toBeDefined();
    expect(t.cols.emaDist20).toBeUndefined();
    expect(t.empty.find((x) => x.id === "emaDist20")!.reason).toMatch(/keine Kerzen/i);
  });
  it("candles of the trade's pair can be handed in per market key", () => {
    const bars = randomBars(400, 2, { t0: new Date("2026-03-01T00:00:00Z").getTime() / 1000 });
    const withBars = fromJournal([mkTrade({ id: "x", date: "2026-03-02T00:00", r: 1, pair: "BTC/USDT" })], { markets: { "BTC/USDT": { intervalSec: 3600, bars } } });
    const t = buildTable(withBars);
    // local-time trade date: the candle features exist when the entry falls inside the candle range
    expect(t.trades).toHaveLength(1);
  });
});

describe("findingToFilter: only confirmed findings, only what a backtest can evaluate", () => {
  it("a confirmed finding on candle features becomes a plain description with the pattern in words", () => {
    const f = finding("confirmed", [rsiHi, { f: "side", k: "cat", v: "Long" }]);
    const c = findingToFilter(f);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.spec).toEqual({ v: 1, label: "RSI(14) ab 50 UND Richtung Long", conds: f.conds });
    expect(c.spec.conds).not.toBe(f.conds); // a copy
    expect(JSON.parse(JSON.stringify(c.spec))).toEqual(c.spec);
  });
  it("hints and rejected patterns are refused with the reason", () => {
    for (const tier of ["hint", "rejected"] as const) {
      const c = findingToFilter(finding(tier, [rsiHi]));
      expect(c.ok).toBe(false);
      if (!c.ok) expect(c.reason).toMatch(/Nur bestätigte Befunde/);
    }
  });
  it.each([
    [{ f: "lossStreak", k: "cat", v: "2" } as Cond, /Verlustserie/],
    [{ f: "setup", k: "cat", v: "A" } as Cond, /Journal/],
    [{ f: "emotion", k: "cat", v: "FOMO" } as Cond, /Journal/],
    [{ f: "keyLevelDist", k: "num", lo: 1, hi: null } as Cond, /Schlüsselmarken/],
    [{ f: "hold", k: "num", lo: 1, hi: null } as Cond, /nach dem Trade/],
  ])("%j cannot be a filter: %s", (cond, why) => {
    const c = findingToFilter(finding("confirmed", [rsiHi, cond]));
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toMatch(why);
  });
});

describe("pattern mask", () => {
  const bars = randomBars(500, 31);
  it("calendar and side conditions need no candles' indicators; unknown (warm-up) never passes and a failing condition wins over an unknown one", () => {
    const m = patternMask(bars, 3600, { v: 1, label: "x", conds: [{ f: "emaDist200", k: "num", lo: -1000, hi: null }, { f: "side", k: "cat", v: "Long" }] });
    expect(m.long[50]).toBe(2); // EMA 200 is not defined yet
    expect(m.short[50]).toBe(0); // …but the side condition already fails
    expect(m.long[300]).toBe(1);
    expect(m.short[300]).toBe(0);
  });
  it("an empty market gives an empty mask", () => {
    expect(patternMask([], 3600, { v: 1, label: "x", conds: [rsiHi] })).toEqual({ long: new Uint8Array(0), short: new Uint8Array(0) });
  });
});

describe("the Labor's stored filter choice carries the pattern defensively", () => {
  const spec = { v: 1, label: "RSI(14) ab 50", conds: [rsiHi] };
  it("survives the sanitiser; a broken or unsupported pattern is dropped, the rest of the choice stays", () => {
    const ok = sanitizeFilters({ v: 1, on: ["rsi", "pattern"], rsiLimit: 70, trendLen: 20, pattern: spec });
    expect(ok.pattern).toEqual(spec);
    expect(ok.on).toEqual(["rsi", "pattern"]);
    const bad = sanitizeFilters({ v: 1, on: ["rsi", "pattern"], rsiLimit: 70, trendLen: 20, pattern: { v: 1, conds: [{ f: "setup", k: "cat", v: "A" }] } });
    expect(bad.pattern).toBeUndefined();
    expect(activeFilters(bad, "custom", "4h")).toEqual(["rsi"]); // "pattern" is chosen but there is none: it does not count
  });
  it("is listed among the filters only once the user has chosen one", () => {
    expect(filterInfos("custom", "4h").map((f) => f.id)).toEqual(["rsi", "trend", "retest", "topTrader"]);
    const withPattern = filterInfos("custom", "4h", sanitizeFilters({ v: 1, on: ["pattern"], pattern: spec }));
    const p = withPattern.find((f) => f.id === "pattern")!;
    expect(p).toMatchObject({ available: true, reason: null, label: "Muster aus dem Muster-Entdecker" });
    expect(p.sub).toContain("RSI(14) ab 50");
  });
});

describe("the runner", () => {
  const bars = randomBars(2200, 17);
  const trades = tradesOnBars(bars, 18, { gap: 5 });
  const input = { trades, markets: { "": { intervalSec: 3600, bars } }, source: "backtest" as const, seed: 1 };

  it("idle chunks: progress is reported, the result is the job's result", async () => {
    const seen: number[] = [];
    const res = await runDiscoveryIdle(input, { onProgress: (p) => seen.push(p) });
    expect(res.status).toBe("ok");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((p, i) => p >= (seen[i - 1] ?? 0) && p < 1)).toBe(true);
  }, 60_000);

  it("stops on request: the promise rejects with an abort error", async () => {
    const ctl = new AbortController();
    const p = runDiscoveryIdle(input, { signal: ctl.signal, onProgress: () => ctl.abort() });
    await expect(p).rejects.toSatisfy(isDiscoveryAbort);
    const already = new AbortController();
    already.abort();
    await expect(runDiscovery(input, { signal: already.signal })).rejects.toSatisfy(isDiscoveryAbort);
  }, 60_000);

  it("without a Worker (jsdom, single file) the same result comes from the idle path", async () => {
    const a = await runDiscovery(input, { mode: "idle" });
    const b = await runDiscovery(input);
    expect({ ...a, ms: 0 }).toEqual({ ...b, ms: 0 });
  }, 60_000);

  it("a failure of the input itself is reported, not swallowed", async () => {
    await expect(runDiscoveryIdle({ ...input, trades: null as never })).rejects.toBeInstanceOf(Error);
  });

  it("the limits are the documented ones", () => {
    expect(LIMITS.minTrades).toBe(80);
    expect(LIMITS.discoveryShare).toBe(0.6);
    expect(LIMITS.fdr).toBe(0.1);
    expect(LIMITS.blocks).toBe(4);
    expect(LIMITS.blocksAgree).toBe(3);
  });
});
