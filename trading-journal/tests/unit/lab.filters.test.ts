/**
 * F17 – Varianten- und Filtervergleich: which filters the data can support (the rest are locked WITH a reason), the
 * per-bar yes / no series (no look-ahead), the wrapper that lets a signal through only when every chosen filter agrees, the
 * variant plan, and one pass on a real BTCUSDT run through the extra job.
 */
import { describe, expect, it } from "vitest";
import { createLabJob, runBacktest, runExtra, type Bar, type BtStrategy, type EntrySignal } from "@/domain/backtest/index";
import { createExtraJob } from "@/domain/lab/extras/job";
import {
  activeFilters,
  applyFilters,
  DEFAULT_FILTERS,
  FAIL,
  filterInfos,
  PASS,
  rsiMask,
  sanitizeFilters,
  trendBars,
  trendMask,
  trendTimeframe,
  UNKNOWN_MASK,
  variantPlan,
  type FilterSelection,
} from "@/domain/lab/filters";
import { ENGINE, realInput } from "./lab.extras.helpers";

const bars = (closes: readonly number[], sec: number, t0 = 1_700_000_000): Bar[] => closes.map((c, i) => ({ t: t0 + i * sec, o: c, h: c + 0.5, l: c - 0.5, c }));
const rising = (n: number, sec: number): Bar[] => bars(Array.from({ length: n }, (_, i) => 100 + i * 0.7), sec);

describe("welche Filter die Daten tragen", () => {
  it("Retest nur bei Box-zu-Box, Top-Trader nie – beides mit Grund", () => {
    const box = filterInfos("box", "4h");
    const mcb = filterInfos("mcb", "4h");
    expect(box.find((f) => f.id === "retest")).toMatchObject({ available: true, reason: null });
    const noRetest = mcb.find((f) => f.id === "retest")!;
    expect(noRetest.available).toBe(false);
    expect(noRetest.reason).toMatch(/Ausbruchsniveau/);
    for (const s of ["box", "mcb", "rules", "custom"] as const) {
      const top = filterInfos(s, "1h").find((f) => f.id === "topTrader")!;
      expect(top.available).toBe(false);
      expect(top.reason).toMatch(/30 Tage/);
    }
    expect(filterInfos("custom", "1h").filter((f) => f.available).map((f) => f.id)).toEqual(["rsi", "trend"]);
  });

  it("gewählt, aber gesperrt zählt nicht", () => {
    const sel: FilterSelection = { ...DEFAULT_FILTERS, on: ["rsi", "retest", "topTrader"] };
    expect(activeFilters(sel, "mcb", "4h")).toEqual(["rsi"]);
    expect(activeFilters(sel, "box", "4h")).toEqual(["rsi", "retest"]);
  });

  it("gespeicherte Auswahl: versioniert, begrenzt, kaputtes fällt auf den Standard", () => {
    expect(sanitizeFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(sanitizeFilters({ v: 2, on: ["rsi"] })).toEqual(DEFAULT_FILTERS);
    expect(sanitizeFilters({ v: 1, on: ["trend", "nope", "rsi"], rsiLimit: 200, trendLen: 1 })).toEqual({ v: 1, on: ["rsi", "trend"], rsiLimit: 90, trendLen: 5 });
    expect(sanitizeFilters({ rsiLimit: "x" }).rsiLimit).toBe(70);
  });

  it("höherer Trend: die erste Ebene, die mindestens vier Ausführungskerzen lang ist", () => {
    expect(trendTimeframe("15m")).toEqual({ sec: 3600, label: "1h" });
    expect(trendTimeframe("1h")).toEqual({ sec: 14_400, label: "4h" });
    expect(trendTimeframe("4h")).toEqual({ sec: 86_400, label: "1D" });
    expect(trendTimeframe("1d")).toEqual({ sec: 604_800, label: "1W" });
  });
});

describe("RSI-Zone", () => {
  it("steigender Markt (RSI 100): Long fällt durch, Short passt; die ersten Kerzen sind unbekannt", () => {
    const m = rsiMask(rising(60, 3600), 70);
    expect(m.long[5]).toBe(UNKNOWN_MASK);
    expect(m.long[40]).toBe(FAIL);
    expect(m.short[40]).toBe(PASS);
  });
  it("fallender Markt (RSI 0): Long passt, Short fällt durch", () => {
    const m = rsiMask(bars(Array.from({ length: 60 }, (_, i) => 200 - i), 3600), 70);
    expect(m.long[40]).toBe(PASS);
    expect(m.short[40]).toBe(FAIL);
  });
  it("kein Blick nach vorn: gleicher Wert, wenn der Verlauf nach der Kerze fehlt", () => {
    const all = bars(Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1), 3600);
    const full = rsiMask(all, 60);
    for (const i of [20, 33, 51, 79]) {
      const cut = rsiMask(all.slice(0, i + 1), 60);
      expect([cut.long[i], cut.short[i]]).toEqual([full.long[i], full.short[i]]);
    }
  });
});

describe("höherer Trend", () => {
  const sec = 3600;
  const n = 24 * 40;
  const t0 = Date.UTC(2026, 0, 1) / 1000;

  it("baut die 4h-Kerzen nur aus vollständigen Behältern", () => {
    const b = bars(Array.from({ length: 24 }, (_, i) => 100 + i), sec, t0);
    expect(trendBars(b, "1h", sec)!.bars).toHaveLength(6);
    // a hole inside the second bucket drops that bucket
    const holey = b.filter((_, i) => i !== 5);
    expect(trendBars(holey, "1h", sec)!.bars).toHaveLength(5);
  });

  it("steigender Markt: Long passt, Short fällt durch; vor genug Verlauf unbekannt", () => {
    const m = trendMask(bars(Array.from({ length: n }, (_, i) => 100 + i * 0.1), sec, t0), "1h", sec, 20);
    expect(m.long[10]).toBe(UNKNOWN_MASK);
    expect(m.long[n - 1]).toBe(PASS);
    expect(m.short[n - 1]).toBe(FAIL);
  });

  it("nur geschlossene höhere Kerzen: gleicher Wert ohne den Verlauf nach der Kerze", () => {
    const all = bars(Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 40) * 8 + i * 0.02), sec, t0);
    const full = trendMask(all, "1h", sec, 20);
    for (const i of [200, 333, 500, 777, n - 1]) {
      const cut = trendMask(all.slice(0, i + 1), "1h", sec, 20);
      expect([cut.long[i], cut.short[i]]).toEqual([full.long[i], full.short[i]]);
    }
  });
});

describe("der Filter-Wrapper", () => {
  const sig = (side: "long" | "short", tag = "T"): EntrySignal => ({ side, stop: side === "long" ? 95 : 105, target: null, maxBars: 2, tag });
  const mask = (long: number[], short: number[]) => ({ long: Uint8Array.from(long), short: Uint8Array.from(short) });

  it("lässt nur durch, was alle gewählten Filter bejahen, und zählt Ablehnungen, Unbekanntes und Überlappung", () => {
    const sigs: Record<number, EntrySignal> = { 1: sig("long"), 2: sig("long"), 3: sig("short"), 4: sig("long") };
    const inner: BtStrategy = { start: 0, signalAt: (i) => sigs[i] ?? null };
    const masks = {
      rsi: mask([0, 1, 0, 1, 0], [0, 0, 0, 1, 0]),
      trend: mask([0, 1, 1, 2, 0], [0, 1, 0, 1, 0]),
    };
    const { strategy, counts } = applyFilters(inner, ["rsi", "trend"], masks);
    expect(strategy.signalAt(0)).toBeNull(); // nothing to judge
    expect(strategy.signalAt(1)).not.toBeNull(); // rsi 1, trend 1
    expect(strategy.signalAt(2)).toBeNull(); // rsi 0, trend 1
    expect(strategy.signalAt(3)).not.toBeNull(); // short: rsi 1, trend 1
    expect(strategy.signalAt(4)).toBeNull(); // rsi 0 and trend 0 → both say no
    const c = counts();
    expect(c).toMatchObject({ asked: 4, passed: 2, blocked: 2, blockedMulti: 1 });
    expect(c.by.rsi).toEqual({ fail: 2, unknown: 0 });
    expect(c.by.trend).toEqual({ fail: 1, unknown: 0 });
  });

  it("unbekannt lässt kein Signal durch, wird aber getrennt gezählt", () => {
    const inner: BtStrategy = { start: 0, signalAt: () => sig("long") };
    const { strategy, counts } = applyFilters(inner, ["trend"], { trend: mask([2], [2]) });
    expect(strategy.signalAt(0)).toBeNull();
    expect(counts().by.trend).toEqual({ fail: 0, unknown: 1 });
  });

  it("Retest: nur Einstiege, deren Setup „Retest“ heißt", () => {
    const inner: BtStrategy = { start: 0, signalAt: (i) => sig("long", i === 0 ? "Retest Long" : "Ausbruch Long") };
    const { strategy } = applyFilters(inner, ["retest"], {});
    expect(strategy.signalAt(0)).not.toBeNull();
    expect(strategy.signalAt(1)).toBeNull();
  });

  it("ohne Filter ändert sich nichts – auch nicht im Engine-Lauf", () => {
    const flat: Bar[] = Array.from({ length: 40 }, (_, i) => ({ t: 1_700_000_000 + i * 3600, o: 100, h: 101, l: 99, c: 100 }));
    const inner: BtStrategy = { start: 3, signalAt: (i) => (i === 10 ? sig("long") : null) };
    const a = runBacktest(flat, inner, ENGINE, { secLen: 3600 });
    const b = runBacktest(flat, applyFilters(inner, [], {}).strategy, ENGINE, { secLen: 3600 });
    expect(b).toEqual(a);
  });
});

describe("der Variantenplan", () => {
  it("ein Filter: ohne und nur dieser; zwei: dazu alle; drei und mehr: dazu jeweils alle ohne einen", () => {
    expect(variantPlan([]).map((v) => v.id)).toEqual(["base"]);
    expect(variantPlan(["rsi"]).map((v) => v.id)).toEqual(["base", "only:rsi"]);
    expect(variantPlan(["rsi", "trend"]).map((v) => v.id)).toEqual(["base", "only:rsi", "only:trend", "all"]);
    expect(variantPlan(["rsi", "trend", "retest"]).map((v) => v.id)).toEqual(["base", "only:rsi", "only:trend", "only:retest", "all", "without:rsi", "without:trend", "without:retest"]);
  });
});

describe("Filtervergleich auf echten BTCUSDT-Kerzen", () => {
  const input = realInput();
  const sel: FilterSelection = { v: 1, on: ["rsi", "trend"], rsiLimit: 55, trendLen: 20 };
  const job = () => createExtraJob({ base: input, what: "filters", filters: sel });
  const out = job().result();
  const cmp = out.what === "filters" ? out.compare : null;

  it("die Zeile „Ohne Filter“ ist der Lauf oben", () => {
    const main = createLabJob(input).result();
    const base = cmp!.rows.find((r) => r.id === "base")!;
    expect(base.stats!.n).toBe(main.stats.n);
    expect(base.stats!.sumR).toBeCloseTo(main.stats.sumR, 9);
    expect(base.delta).toBeNull();
    expect(base.blocked).toBe(0);
  });

  it("Zeilen, Differenzen und Beiträge passen zusammen", () => {
    expect(cmp!.active).toEqual(["rsi", "trend"]);
    expect(cmp!.rows.map((r) => r.id)).toEqual(["base", "only:rsi", "only:trend", "all"]);
    const base = cmp!.rows[0]!.stats!;
    for (const r of cmp!.rows.slice(1)) {
      expect(r.delta!.dN).toBe(r.stats!.n - base.n);
      expect(r.delta!.dSumR).toBeCloseTo(r.stats!.sumR - base.sumR, 12);
      expect(r.blocked).toBeLessThanOrEqual(r.asked);
    }
    for (const c of cmp!.contributions) expect(c.alone).toEqual(cmp!.rows.find((r) => r.id === `only:${c.id}`)!.delta);
    // two filters: the marginal contribution of one is "all" against "only the other"
    const all = cmp!.rows.find((r) => r.id === "all")!.stats!;
    const onlyTrend = cmp!.rows.find((r) => r.id === "only:trend")!.stats!;
    expect(cmp!.contributions.find((c) => c.id === "rsi")!.marginal!.dSumR).toBeCloseTo(all.sumR - onlyTrend.sumR, 12);
    expect(cmp!.overlap).not.toBeNull();
    expect(cmp!.overlap!.multi).toBeLessThanOrEqual(cmp!.overlap!.blocked);
  });

  it("der Trend-Filter lehnt hier Signale ab; die RSI-Grenze 55 greift bei „RSI unter 45“ nie – und das steht in den Zahlen", () => {
    expect(cmp!.rows.find((r) => r.id === "only:trend")!.blocked).toBeGreaterThan(0);
    expect(cmp!.rows.find((r) => r.id === "only:rsi")!.blocked).toBe(0);
    expect(cmp!.rows.find((r) => r.id === "only:rsi")!.delta).toMatchObject({ dN: 0, dSumR: 0 });
  });

  it("deterministisch, JSON-sicher, im Leerlauf-Runner derselbe", async () => {
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    expect(job().result()).toEqual(out);
    expect(await runExtra({ base: input, what: "filters", filters: sel }, { mode: "idle" })).toEqual(out);
  }, 60_000);

  it("nur gesperrte Filter gewählt: es bleibt der Lauf ohne Filter, kein Vergleich", () => {
    const r = createExtraJob({ base: input, what: "filters", filters: { ...sel, on: ["topTrader", "retest"] } }).result();
    expect(r.what === "filters" && r.compare.active).toEqual([]);
    expect(r.what === "filters" && r.compare.rows.map((x) => x.id)).toEqual(["base"]);
  });
});
