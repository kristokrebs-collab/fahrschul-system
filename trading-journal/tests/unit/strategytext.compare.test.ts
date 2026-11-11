/**
 * Strategie-Studio · `compareStrategies`: several strategies on the same real BTCUSDT candles, window and costs; one row each
 * with the figures of the whole window and of the common train / test split, a rank, and the multiple-testing honesty.
 * The figures must equal a direct lab run of the same rules (same engine, nothing re-implemented).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLabJob, DEFAULT_FEES, type Bar, type LabJobInput } from "@/domain/backtest/index";
import { defaultCustom } from "@/domain/lab";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";
import { compareIntervals, compareStrategies, compareWarmupMs, createComparison, multipleTestingNote, sampleLevel, MIN_TEST_TRADES, parseStrategyText, type CompareInput } from "@/domain/strategytext";

const read = (n: string): Bar[] => (JSON.parse(readFileSync(`tests/unit/fixtures/${n}`, "utf8")) as { bars: number[][] }).bars.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));
const H4 = read("binance-btcusdt-4h.json");
const D1 = read("binance-btcusdt-1d.json");

const engine: LabJobInput["engine"] = { capital: 10_000, riskPct: 0.01, maxLeverage: 5, compounding: true, costs: { fees: DEFAULT_FEES, slippage: { kind: "fixed", bps: 2 }, funding: { kind: "flat", ratePer8h: 0.0001 } } };
const fromMs = H4[400]!.t * 1000;
const toMs = (H4[H4.length - 1]!.t + 14_400) * 1000;
const data = { "4h": H4, "1d": D1 };
const opts = { fromMs, toMs, engine, trainShare: 0.7 };

const from = (id: string, text: string): CompareInput => ({ id, name: id, config: parseStrategyText(text, { answers: { interval: "4h" } }).rules });
const A = from("dip", "Long wenn RSI unter 35, Stop 1,5 ATR, Ziel 2R");
const B = from("trend", "Long wenn Kurs über EMA 50 und RSI über 50, Stop 2 ATR, Ziel 3R");
const C = from("breakout", "Long wenn Kurs über dem Hoch der letzten 20 Kerzen, Stop 2 ATR, Ziel 2R");
const D = from("short", "Short wenn RSI über 65, Stop 1,5 ATR, Ziel 2R");

describe("compareStrategies", () => {
  const res = compareStrategies([A, B, C, D], data, opts);

  it("runs every strategy once, on one window and one train / test cut", () => {
    expect(res.rows.map((r) => r.id)).toEqual(["dip", "trend", "breakout", "short"]);
    expect(res.rows.every((r) => r.status === "ok")).toBe(true);
    expect(res.window.fromMs).toBe(fromMs);
    expect(res.window.cutMs).toBe(fromMs + (toMs - fromMs) * 0.7);
    for (const r of res.rows) {
      expect(r.all!.n).toBeGreaterThan(0);
      expect(r.train).not.toBeNull();
      expect(r.test).not.toBeNull();
      // trades are split between the two windows, a trade cannot be in both
      expect(r.train!.n + r.test!.n).toBeLessThanOrEqual(r.all!.n + 2);
      expect(r.curve.length).toBeGreaterThan(2);
    }
  });

  it("gives the same figures as a direct lab run of the same rules", () => {
    for (const c of [A, B]) {
      const row = res.rows.find((r) => r.id === c.id)!;
      const job = createLabJob({
        strategy: "custom",
        symbol: "BTCUSDT",
        box: { tf: "4h" },
        mcb: { signal: DEFAULT_SIGNAL_CFG, step: "4h" },
        rules: { interval: "4h", side: "long", conds: [] },
        custom: { config: c.config, signal: DEFAULT_SIGNAL_CFG },
        params: {},
        fromMs,
        toMs,
        engine,
        data,
      }).result();
      expect(row.all!.n).toBe(job.stats.n);
      expect(row.all!.avgR).toBeCloseTo(job.stats.avgR ?? 0, 10);
      expect(row.all!.netPct).toBeCloseTo(job.stats.netPct, 10);
      expect(row.all!.maxDD).toBeCloseTo(job.stats.maxDD, 10);
    }
  });

  it("does not let one strategy influence another", () => {
    const alone = compareStrategies([B], data, opts);
    expect(alone.rows[0]!.all).toEqual(res.rows.find((r) => r.id === "trend")!.all);
    expect(alone.rows[0]!.test).toEqual(res.rows.find((r) => r.id === "trend")!.test);
    const swapped = compareStrategies([D, C, B, A], data, opts);
    for (const r of res.rows) expect(swapped.rows.find((x) => x.id === r.id)!.all).toEqual(r.all);
  });

  it("ranks by the test window's Ø R when every strategy has enough trades there, else by the whole window – and says which", () => {
    const ranked = res.rows.filter((r) => r.rank != null).sort((a, b) => a.rank! - b.rank!);
    expect(ranked.map((r) => r.rank)).toEqual(ranked.map((_, i) => i + 1));
    const useTest = res.rows.every((r) => r.test && r.test.n >= MIN_TEST_TRADES);
    expect(res.rankBasis).toBe(useTest ? "test" : "all");
    const key = (r: (typeof res.rows)[number]): number => (res.rankBasis === "test" ? r.test!.avgR! : r.all!.avgR!);
    for (let i = 1; i < ranked.length; i++) expect(key(ranked[i - 1]!)).toBeGreaterThanOrEqual(key(ranked[i]!));
    expect(res.warnings.join(" ")).toMatch(useTest ? /Ø R im Testfenster/ : /ganzen Zeitraum/);
  });

  it("names the number of strategies compared and adjusts p for it", () => {
    expect(res.multiple.count).toBe(4);
    expect(res.multiple.trials).toBe(4);
    expect(res.multiple.luckyChance).toBeCloseTo(1 - 0.95 ** 4, 12);
    expect(res.multiple.text).toContain("4 Strategien");
    for (const r of res.rows) if (r.pEdge != null) expect(r.pAdj).toBeCloseTo(Math.min(1, r.pEdge * 4), 12);
    const more = compareStrategies([A, B], data, { ...opts, extraTrials: 18 });
    expect(more.multiple.trials).toBe(20);
    expect(more.multiple.count).toBe(2);
    expect(more.multiple.text).toContain("20 Strategien");
    for (const r of more.rows) if (r.pEdge != null) expect(r.pAdj).toBeCloseTo(Math.min(1, r.pEdge * 20), 12);
  });

  it("warns about thin samples and says what the test window is not", () => {
    const text = res.warnings.join("\n");
    expect(text).toMatch(/nicht an den Daten angepasst/);
    for (const r of res.rows) if (r.sample === "tiny" || r.sample === "small" || r.sample === "none") expect(text).toContain(r.name);
  });

  it("mixes execution intervals on the same instant: a daily strategy is cut where the 4h ones are", () => {
    const daily = from("daily", "Long wenn Kurs über EMA 20, Zeitrahmen 1D, Stop 2 ATR, Ziel 2R");
    expect(daily.config.interval).toBe("1d");
    const r = compareStrategies([A, daily], data, opts);
    expect(r.rows.every((x) => x.status === "ok")).toBe(true);
    expect(r.rows[1]!.interval).toBe("1d");
    expect(r.window.cutMs).toBe(res.window.cutMs);
  });

  it("reports a strategy it cannot run, with the reason, and still runs the others", () => {
    const empty: CompareInput = { id: "empty", name: "leer", config: defaultCustom() };
    empty.config = { ...empty.config, long: { ...empty.config.long, children: [] } };
    const noData = from("d1", "Long wenn Kurs über EMA 20, Zeitrahmen 1D, Stop 2 ATR");
    const r = compareStrategies([A, empty, noData], { "4h": H4 }, opts);
    expect(r.rows[0]!.status).toBe("ok");
    expect(r.rows[1]!.status).toBe("invalid");
    expect(r.rows[1]!.reason).toMatch(/Bedingung/);
    expect(r.rows[2]!.status).toBe("nodata");
    expect(r.rows[1]!.rank).toBeNull();
    expect(r.multiple.count).toBe(1);
    expect(r.warnings.join(" ")).toContain("Nicht gerechnet");
  });

  it("the stepped run gives the same result in slices as at once", () => {
    const stepper = createComparison([A, B], { ...opts, data });
    let calls = 0;
    while (!stepper.step(0)) calls++;
    expect(calls).toBeGreaterThan(0);
    expect(stepper.progress()).toBe(1);
    expect(stepper.result()).toEqual(compareStrategies([A, B], data, opts));
  });

  it("tells which candles to load", () => {
    expect(compareIntervals([A, B])).toEqual(["4h"]);
    expect(new Set(compareIntervals([A, from("t", "Long wenn Kurs über EMA 200 im Tageschart und RSI unter 40")]))).toEqual(new Set(["4h", "1d"]));
    expect(compareWarmupMs([A, B])).toBeGreaterThan(0);
  });
});

describe("compare helpers", () => {
  it("sample levels and the multiple-testing note", () => {
    expect([0, 5, 20, 60, 300].map(sampleLevel)).toEqual(["none", "tiny", "small", "ok", "good"]);
    expect(multipleTestingNote(1).luckyChance).toBeCloseTo(0.05, 12);
    expect(multipleTestingNote(1).text).toContain("einzelne Strategie");
    expect(multipleTestingNote(10).text).toMatch(/40 %/);
    expect(multipleTestingNote(0).luckyChance).toBe(0);
  });
});
