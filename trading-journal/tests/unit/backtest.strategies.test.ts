/**
 * Lab strategies and the whole job on REAL Binance BTCUSDT.P bars (`tests/unit/fixtures/binance-btcusdt-{4h,1d}.json`).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  boxToBox,
  condText,
  createLabJob,
  evalConds,
  mcbLadder,
  paramGrid,
  referenceLabel,
  ruleBuilder,
  runLabIdle,
  sanitizeCond,
  toBacktestReference,
  DEFAULT_FEES,
  type Bar,
  type LabJobInput,
} from "@/domain/backtest/index";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";

const read = (n: string): Bar[] => (JSON.parse(readFileSync(`tests/unit/fixtures/${n}`, "utf8")) as { bars: number[][] }).bars.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));
const H4 = read("binance-btcusdt-4h.json");
const D1 = read("binance-btcusdt-1d.json");

const engine: LabJobInput["engine"] = { capital: 10_000, riskPct: 0.01, maxLeverage: 5, compounding: true, costs: { fees: DEFAULT_FEES, slippage: { kind: "fixed", bps: 2 }, funding: { kind: "flat", ratePer8h: 0.0001 } } };

const input = (over: Partial<LabJobInput>): LabJobInput => ({
  strategy: "box",
  symbol: "BTCUSDT",
  box: { tf: "4h" },
  mcb: { signal: { ...DEFAULT_SIGNAL_CFG, ladder: ["4h", "1D"], zoneTf: "4h" }, step: "4h" },
  rules: { interval: "4h", side: "long", conds: [{ kind: "rsiBelow", a: 35 }] },
  params: {},
  fromMs: H4[400]!.t * 1000,
  toMs: (H4[H4.length - 1]!.t + 14_400) * 1000,
  engine,
  data: { "4h": H4 },
  ...over,
});

describe("Box-zu-Box auf echter Historie", () => {
  it("sieht in Kerze i nur Kerzen bis i (gleiche Fakten mit abgeschnittener Historie)", () => {
    const full = boxToBox.prepare({ "4h": H4 }, { tf: "4h" }, H4[1300]!.t * 1000).result();
    for (const i of [1310, 1400, 1480]) {
      const cut = boxToBox.prepare({ "4h": H4.slice(0, i + 1) }, { tf: "4h" }, H4[i]!.t * 1000).result();
      expect(cut.facts[i]).toEqual(full.facts[i]);
    }
  });

  it("handelt nur A+/A-Setups, einmal pro Box-Idee, mit Stop und Ziel aus der Engine", () => {
    const prep = boxToBox.prepare({ "4h": H4 }, { tf: "4h" }, H4[300]!.t * 1000).result();
    const seen = new Set<string>();
    for (const tag of ["A+", "A"] as const) {
      const s = boxToBox.build(prep, { minGrade: tag, target: 1, maxBars: 42, kinds: "alle" });
      for (let i = prep.start; i < prep.bars.length; i++) {
        const sig = s.signalAt(i);
        if (!sig) continue;
        expect(tag === "A+" ? sig.grade === "A+" : sig.grade === "A+" || sig.grade === "A").toBe(true);
        const long = sig.side === "long";
        const c = prep.bars[i]!.c;
        expect(long ? sig.stop < c && sig.target! > c : sig.stop > c && sig.target! < c).toBe(true);
        seen.add(`${tag}:${i}`);
      }
    }
    expect([...seen].filter((k) => k.startsWith("A:")).length).toBeGreaterThanOrEqual([...seen].filter((k) => k.startsWith("A+:")).length);
    expect(paramGrid(boxToBox.specs({ tf: "4h" }), {})).toHaveLength(2 * 3 * 2 * 3);
  });
});

describe("MCB-Leiter und Regel-Baukasten", () => {
  it("bewertet die Leiter nur auf geschlossenen Kerzen und steigt nur bei einem NEUEN Signal ein", () => {
    const cfg = { signal: { ...DEFAULT_SIGNAL_CFG, ladder: ["4h", "1D"], zoneTf: "4h" }, step: "4h" as const };
    expect(mcbLadder.intervals(cfg)).toEqual(["4h"]);
    expect(mcbLadder.intervals({ signal: DEFAULT_SIGNAL_CFG, step: "4h" })).toEqual(["4h", "15m", "1h"]);
    const prep = mcbLadder.prepare({ "4h": H4 }, cfg, H4[1100]!.t * 1000).result();
    expect(prep.facts.slice(prep.start).some((f) => f != null)).toBe(true);
    const cut = mcbLadder.prepare({ "4h": H4.slice(0, 1201) }, cfg, H4[1200]!.t * 1000).result();
    expect(cut.facts[1200]).toEqual(prep.facts[1200]);
    const s = mcbLadder.build(prep, { targetR: 2, stopAtr: 1.5, minStrength: 2, maxBars: 30 });
    for (let i = prep.start + 1; i < prep.bars.length; i++) {
      const sig = s.signalAt(i);
      if (!sig) continue;
      const prev = prep.facts[i - 1]?.[sig.side];
      expect(!!prev && prev.valid && prev.strength >= 2).toBe(false);
      expect(Math.abs(sig.target! - prep.bars[i]!.c)).toBeCloseTo(2 * Math.abs(prep.bars[i]!.c - sig.stop), 6);
    }
  });

  it("Regeln: Bedingungen begrenzt, Texte deutsch, Signal nur beim Wechsel auf wahr", () => {
    expect(sanitizeCond({ kind: "emaCrossUp", a: 50, b: 20 })).toEqual({ kind: "emaCrossUp", a: 20, b: 50 });
    expect(sanitizeCond({ kind: "rsiBelow", a: 400 }).a).toBe(99);
    expect(condText({ kind: "breakoutHigh", a: 20 })).toBe("Schluss über Hoch der letzten 20 Kerzen");
    const hit = evalConds(H4, [{ kind: "rsiBelow", a: 35 }]);
    expect(hit.some((v) => v === 1)).toBe(true);
    const prep = ruleBuilder.prepare({ "4h": H4 }, { interval: "4h", side: "short", conds: [{ kind: "rsiAbove", a: 65 }] }, H4[200]!.t * 1000).result();
    const s = ruleBuilder.build(prep, { targetR: 2, stopAtr: 1, maxBars: 30 });
    let n = 0;
    for (let i = prep.start; i < prep.bars.length; i++) {
      const sig = s.signalAt(i);
      if (!sig) continue;
      n++;
      expect(sig.side).toBe("short");
      expect(prep.facts.hit[i - 1]).toBe(0);
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe("Labor-Job", () => {
  it("liefert Lauf, OOS, Walk-forward, Overfitting-Check – deterministisch", () => {
    const a = createLabJob(input({ strategy: "rules" })).result();
    const b = createLabJob(input({ strategy: "rules" })).result();
    expect(a.stats).toEqual(b.stats);
    expect(a.trades.length).toBe(a.stats.n);
    expect(a.trades.length).toBeGreaterThan(5);
    expect(a.equity.length).toBeGreaterThan(10);
    expect(a.buyHold.length).toBe(a.equity.length);
    expect(a.split.cutTime).not.toBeNull();
    expect(a.wf?.windows.length).toBe(5);
    expect(a.trials).toHaveLength(27);
    expect(a.heat?.cells).toHaveLength(9);
    expect(["robust", "fraglich", "overfit", "wenig"]).toContain(a.robust.verdict);
    // every trade lies in the chosen period
    for (const t of a.trades) expect(t.entryTime).toBeGreaterThanOrEqual(H4[400]!.t * 1000);
    expect(a.specs.map((s) => s.label)).toEqual(["Ziel", "Stop", "Zeit-Stop"]);
  });

  it("Ergebnis übersteht postMessage (structuredClone: keine Funktionen, Heatmap-Achsen mit Texten)", () => {
    const a = createLabJob(input({ strategy: "rules" })).result();
    const b = structuredClone(a);
    expect(b.stats).toEqual(a.stats);
    expect(b.heat?.rows.labels.length).toBe(b.heat?.rows.options.length);
    expect(b.heat?.cols.labels.every((l) => typeof l === "string")).toBe(true);
  });

  it("Box-zu-Box 1D auf der Tages-Historie und Idle-Lauf = synchroner Lauf", async () => {
    const inp = input({ strategy: "box", box: { tf: "1d" }, data: { "1d": D1 }, fromMs: D1[300]!.t * 1000, toMs: (D1[D1.length - 1]!.t + 86_400) * 1000 });
    const sync = createLabJob(inp).result();
    const progress: number[] = [];
    const idle = await runLabIdle(inp, { onProgress: (p) => progress.push(p) });
    expect(idle.stats).toEqual(sync.stats);
    expect(idle.trades).toEqual(sync.trades);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1]!)).toBe(true);
  });

  it("bricht ab, wenn das Signal abbricht", async () => {
    const ctl = new AbortController();
    const p = runLabIdle(input({ strategy: "box" }), { signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("macht aus einem Lauf eine Backtest-Referenz mit derselben Bedeutung wie BacktestCompare", () => {
    const r = createLabJob(input({ strategy: "rules" })).result();
    const ref = toBacktestReference(r.stats, referenceLabel({ strategy: "rules", interval: "4h", symbol: "BTCUSDT", n: r.stats.n }))!;
    expect(ref.label).toBe(`Labor · Regel-Baukasten 4h · BTCUSDT · ${r.stats.n} Trades`);
    expect(ref.winRate).toBeCloseTo(r.stats.winRate!, 4);
    expect(ref.avgWin).toBeGreaterThan(0);
    expect(ref.avgLoss).toBeLessThan(0);
    expect(ref.expectancy).toBeCloseTo(r.stats.moveExp!, 4);
    expect(toBacktestReference({ ...r.stats, n: 0, winRate: null }, "x")).toBeNull();
    expect(referenceLabel({ strategy: "box", interval: "1d", symbol: "VERYLONGSYMBOLNAMEUSDT", n: 12345 }).length).toBeLessThanOrEqual(60);
  });
});
