/**
 * F73 – "Warum so schwach?": `diagnoseRun` on hand-built trades and bars (every number below is derived in the test),
 * plus one integration pass on a real lab run. The findings must carry the numbers they are based on.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLabJob, DEFAULT_FEES, runStats, type Bar, type BtTrade, type LabJobInput, type LabResult, type RunFunnel, type VariantLite } from "@/domain/backtest/index";
import { DIAG, diagnoseRun, defaultCustom, newGroup, newLeaf, sanitizeCustom, type DiagnoseCfg, type Diagnosis } from "@/domain/lab";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";

const H = 3600;
const T0 = Date.UTC(2026, 0, 5, 0, 0, 0); // a Monday, 00:00 UTC

/** 300 flat 1h bars with a 2-point range (ATR ≈ 2) – the spot where trades enter and exit. */
const flatBars = (n = 300, px = 100): Bar[] => Array.from({ length: n }, (_, i) => ({ t: T0 / 1000 + i * H, o: px, h: px + 1, l: px - 1, c: px }));

let seq = 0;
/** A closed long trade; money numbers follow from `r` (risk 100) and the costs given. */
function trade(o: Partial<BtTrade> & { r: number }): BtTrade {
  const entryIndex = o.entryIndex ?? 40 + (seq++ % 200);
  const bars = o.bars ?? 4;
  const side = o.side ?? "long";
  const entry = 100;
  const stop = o.stop ?? (side === "long" ? 95 : 105);
  const fees = o.fees ?? 0;
  const slippage = o.slippage ?? 0;
  const funding = o.funding ?? 0;
  return {
    id: `t${seq}`,
    side,
    tag: "T",
    entryIndex,
    exitIndex: entryIndex + bars - 1,
    entryTime: T0 + entryIndex * H * 1000,
    exitTime: T0 + (entryIndex + bars) * H * 1000,
    entry,
    exit: entry + (side === "long" ? 1 : -1) * o.r * Math.abs(entry - stop),
    stop,
    target: o.target ?? null,
    qty: 20,
    notional: 2000,
    pnl: o.r * 100,
    fees,
    funding,
    slippage,
    move: 0,
    bars,
    reason: "stop",
    ...o,
  } as BtTrade;
}

const funnel = (over: Partial<RunFunnel> = {}): RunFunnel => ({ examined: 1000, nodes: [], edges: null, conflicts: null, candidates: null, blockedByPosition: null, signals: 0, skippedGap: 0, skippedRisk: 0, executed: 0, ...over });

function result(trades: BtTrade[], over: Partial<LabResult> = {}): LabResult {
  const stats = runStats({ trades, equity: [], from: T0, to: T0 + 300 * H * 1000, capital: 10_000, skipped: 0, skippedGap: 0, skippedRisk: 0, signals: trades.length });
  return {
    strategy: "custom",
    name: "Test",
    configKey: "k",
    symbol: "BTCUSDT",
    interval: "1h",
    params: {},
    specs: [],
    bars: 300,
    gaps: { gaps: 0, missing: 0 },
    from: T0,
    to: T0 + 300 * H * 1000,
    stats,
    trades,
    skipped: 0,
    coverage: [{ interval: "1h", role: "exec", bars: 300, first: T0, last: T0 + 300 * H * 1000, gaps: 0, missing: 0 }],
    expectedBars: 300,
    warmup: { wanted: 100, got: 120 },
    funnel: funnel({ signals: trades.length, executed: trades.length }),
    variants: [],
    ...over,
  } as unknown as LabResult;
}

const cfg: DiagnoseCfg = { strategy: "custom", costs: { exchange: "binance", makerBps: 2, takerBps: 5, slippage: { kind: "fixed", bps: 2 }, funding: "flat" }, capital: 10_000, riskPct: 1, maxLeverage: 5, custom: null };
const data = { bars: flatBars() };
const diag = (r: LabResult, c: DiagnoseCfg = cfg, d = data): Diagnosis => diagnoseRun(r, c, d);
const find = (d: Diagnosis, id: string) => d.findings.find((f) => f.id === id);
const variant = (v: Partial<VariantLite> & Pick<VariantLite, "id" | "kind">): VariantLite => ({ label: v.id, n: 20, avgR: 0, sumR: 0, net: 0, netPct: 0, winRate: 0.5, pf: 1, maxDD: 0.1, ...v });

describe("diagnoseRun – Kosten", () => {
  it("Brutto positiv, Netto negativ: das Urteil nennt beide Zahlen und die Kostenarten", () => {
    // 12 trades: gross +10 each, fees 12 → net −2 each (r = −0,02)
    const ts = Array.from({ length: 12 }, () => trade({ r: -0.02, fees: 12 }));
    const d = diag(result(ts));
    const c = d.costs;
    expect(c.net).toBeCloseTo(-24, 9);
    expect(c.fees).toBeCloseTo(144, 9);
    expect(c.gross).toBeCloseTo(120, 9);
    expect(c.costShare).toBeCloseTo(144 / 120, 9);
    expect(c.avgCostR).toBeCloseTo(12 / 100, 9);
    const f = find(d, "costs-flip")!;
    expect(f.severity).toBe("high");
    expect(f.text).toContain("Vor Kosten +120 USDT");
    expect(f.text).toContain("danach −24 USDT");
    expect(f.evidence.map((e) => e.label)).toContain("Ø Kosten pro Trade");
    expect(d.findings[0]!.id).toBe("costs-flip"); // ranked first
  });

  it("schon vor Kosten im Minus: der Befund sagt, dass es nicht an den Kosten liegt", () => {
    const ts = Array.from({ length: 14 }, (_, i) => trade({ r: i % 2 ? 0.5 : -1, fees: 1 }));
    const d = diag(result(ts));
    expect(find(d, "no-edge-gross")?.text).toMatch(/an den Kosten allein liegt es nicht/);
    expect(find(d, "costs-flip")).toBeUndefined();
  });

  it("Brutto / Netto in R: Σ R ohne Kosten und mit", () => {
    const ts = [trade({ r: 1, fees: 5 }), trade({ r: -1, fees: 5 }), trade({ r: 2, fees: 10 })];
    const c = diag(result(ts)).costs;
    expect(c.netR).toBeCloseTo(2, 9);
    expect(c.grossR).toBeCloseTo(2 + 0.05 + 0.05 + 0.1, 9);
  });
});

describe("diagnoseRun – Stopps, Ausflüge, Auszahlung", () => {
  it("Stopps innerhalb von 3 Kerzen: Anteil, ATR-Abstand und die vorsichtige Formulierung", () => {
    // stop distance 1 on bars with ATR ≈ 2 → 0,5 × ATR; 10 of 14 stop losses within 2 bars
    const ts = [
      ...Array.from({ length: 10 }, () => trade({ r: -1, stop: 99, bars: 2 })),
      ...Array.from({ length: 4 }, () => trade({ r: -1, stop: 99, bars: 8 })),
      ...Array.from({ length: 6 }, () => trade({ r: 2, stop: 99, bars: 6, reason: "target" })),
    ];
    const d = diag(result(ts));
    expect(d.excursion.quickStopN).toBe(10);
    expect(d.excursion.stopLosses).toBe(14);
    expect(d.excursion.stopAtrMed).toBeCloseTo(0.5, 1);
    const f = find(d, "quick-stops")!;
    expect(f.text).toContain("71 % der Stopp-Verluste (10 von 14) kamen innerhalb von 3 Kerzen");
    expect(f.text).toContain("0,5");
    expect(f.text).toMatch(/evtl\. enger als die typische Schwankung/);
    expect(f.severity).toBe("high");
    // not a verdict: no claim of a proven cause
    expect(f.text).not.toMatch(/liegt daran|ist die Ursache/);
  });

  it("weiter Stop (≥ 1 × ATR): kein Hinweis auf zu enge Stops, sondern auf den Zeitpunkt", () => {
    const ts = [...Array.from({ length: 10 }, () => trade({ r: -1, stop: 96, bars: 2 })), ...Array.from({ length: 4 }, () => trade({ r: 2, stop: 96, reason: "target" }))];
    const f = find(diag(result(ts)), "quick-stops")!;
    expect(f.text).not.toMatch(/evtl\. enger/);
    expect(f.text).toMatch(/eher passen Zeitpunkt oder Richtung/);
  });

  it("MFE / MAE in R aus den Kerzen des Trades; Verlierer, die vorher im Plus lagen", () => {
    const bars = flatBars();
    // trades 0-4: hold bars reach +6 (1,2 R of 5) → green losers; trades 5-9: stay within the flat range
    const ts: BtTrade[] = [];
    for (let k = 0; k < 10; k++) {
      const idx = 40 + k * 10;
      if (k < 5) bars[idx + 1] = { ...bars[idx + 1]!, h: 106, l: 97 };
      ts.push(trade({ r: -1, entryIndex: idx, bars: 3 }));
    }
    const d = diag(result(ts), cfg, { bars });
    expect(d.excursion.losersReached1R).toBeCloseTo(0.5, 9);
    expect(d.excursion.mfeMed).toBeCloseTo((0.2 + 1.2) / 2, 9); // flat high = 101 → +1 = 0,2 R; spiked 106 → 1,2 R
    expect(d.excursion.maeMed).toBeCloseTo((0.2 + 0.6) / 2, 9); // flat low 99 → 0,2 R; spiked low 97 → 0,6 R
    const f = find(d, "losers-were-green")!;
    expect(f.text).toContain("50 % der Verlierer");
    expect(f.text).toMatch(/deutet darauf hin/);
  });

  it("Win-Rate unter der Break-even-Schwelle", () => {
    // 30 % winners at +1 R, 70 % losers at −1 R → break-even needs 50 %
    const ts = [...Array.from({ length: 6 }, () => trade({ r: 1, reason: "target" })), ...Array.from({ length: 14 }, () => trade({ r: -1 }))];
    const d = diag(result(ts));
    expect(d.payoff.breakEvenWinRate).toBeCloseTo(0.5, 9);
    expect(d.payoff.winRate).toBeCloseTo(0.3, 9);
    const f = find(d, "payoff")!;
    expect(f.text).toContain("Win-Rate 30 %");
    expect(f.text).toContain("erst ab 50 %");
    expect(f.severity).toBe("high");
  });

  it("Ø gegen Median: wenige Treffer tragen das Ergebnis", () => {
    const ts = [trade({ r: 9, reason: "target" }), trade({ r: 6, reason: "target" }), trade({ r: 5, reason: "target" }), ...Array.from({ length: 17 }, () => trade({ r: -0.8 }))];
    const d = diag(result(ts));
    expect(d.payoff.medR).toBeCloseTo(-0.8, 9);
    expect(d.payoff.avgR!).toBeGreaterThan(0);
    expect(find(d, "few-winners")?.text).toMatch(/drei besten Trades machen \d+ %/);
  });

  it("Ausstiege nach Grund mit Anzahl und Ø R; Zeit-Exits mit Minus werden genannt", () => {
    const ts = [...Array.from({ length: 6 }, () => trade({ r: -1 })), ...Array.from({ length: 10 }, () => trade({ r: -0.3, reason: "time" })), ...Array.from({ length: 4 }, () => trade({ r: 1.5, reason: "target" }))];
    const d = diag(result(ts));
    expect(d.exits.map((e) => [e.reason, e.n])).toEqual([
      ["time", 10],
      ["stop", 6],
      ["target", 4],
    ]);
    expect(d.exits.find((e) => e.reason === "time")!.avgR).toBeCloseTo(-0.3, 9);
    expect(find(d, "time-exits")?.text).toContain("50 % der Trades (10)");
  });
});

describe("diagnoseRun – Aufteilungen und Ehrlichkeit der Engine", () => {
  it("Long gegen Short mit je ≥ 8 Trades", () => {
    const ts = [...Array.from({ length: 10 }, () => trade({ r: 0.6, side: "long", reason: "target" })), ...Array.from({ length: 10 }, () => trade({ r: -0.6, side: "short" }))];
    const d = diag(result(ts));
    expect(d.sides.map((s) => [s.side, s.n])).toEqual([
      ["long", 10],
      ["short", 10],
    ]);
    expect(find(d, "sides")?.text).toContain("(10 Trades)");
  });

  it("Uhrzeit und Wochentag erst ab 60 Trades; sonst nur der Hinweis", () => {
    const few = diag(result(Array.from({ length: 20 }, () => trade({ r: 0.1 }))));
    expect(few.sample.warnings.join(" ")).toContain(`erst ab ${DIAG.minForSplits} Trades`);
    expect(find(few, "hours")).toBeUndefined();
    // 70 trades: 4h-block 0 (00-04 UTC) loses, block 1 wins
    const ts: BtTrade[] = [];
    for (let i = 0; i < 70; i++) {
      const hour = i % 2 === 0 ? 1 : 5;
      ts.push(trade({ r: hour === 1 ? -1 : 0.5, entryIndex: 24 * 2 + hour + 24 * (i >> 1) * 0 + (i >> 1) * 24 }));
    }
    const many = diag(result(ts), cfg, { bars: flatBars(2000) });
    expect(many.byHour).toHaveLength(6);
    expect(many.byHour[0]!.label).toBe("00–04");
    expect(many.byHour[0]!.avgR).toBeCloseTo(-1, 9);
    expect(many.byHour[1]!.avgR).toBeCloseTo(0.5, 9);
    expect(many.byWeekday).toHaveLength(7);
    expect(find(many, "hours")?.text).toContain("00–04 Uhr UTC");
  });

  it("Stop und Ziel in derselben Kerze werden gezählt und benannt", () => {
    const ts = [...Array.from({ length: 4 }, () => trade({ r: -1, ambiguous: true })), ...Array.from({ length: 12 }, () => trade({ r: 0.2, reason: "target" }))];
    const d = diag(result(ts));
    expect(d.ambiguous).toEqual({ n: 4, share: 0.25 });
    expect(find(d, "ambiguous")?.text).toContain("Bei 4 von 16 Trades (25 %)");
  });

  it("Stichproben-Stufen und -Warnungen", () => {
    expect(diag(result([])).sample.level).toBe("none");
    expect(diag(result([trade({ r: 1 }), trade({ r: -1 })])).sample.level).toBe("tiny");
    const tiny = diag(result([trade({ r: 1 }), trade({ r: -1 })]));
    expect(tiny.sample.warnings.join(" ")).toMatch(/Zufall/);
    expect(find(tiny, "sample")?.severity).toBe("high");
    expect(diag(result(Array.from({ length: 20 }, () => trade({ r: 0.1 })))).sample.level).toBe("small");
    expect(diag(result(Array.from({ length: 50 }, () => trade({ r: 0.1 })))).sample.level).toBe("ok");
    expect(diag(result(Array.from({ length: 120 }, () => trade({ r: 0.1 })))).sample.level).toBe("good");
  });
});

describe("diagnoseRun – Trichter, Abdeckung, Vergleiche", () => {
  it("ohne Trades: die Stufe, an der es endet, wird genannt (nie erfüllt / unbekannt / nie gleichzeitig / verworfen)", () => {
    const node = (id: string, label: string, t: number, u: number, kind: "leaf" | "side" = "leaf") => ({ id, label, kind, side: "long" as const, depth: kind === "leaf" ? 1 : 0, t, f: 1000 - t - u, u });
    const never = diag(result([], { funnel: funnel({ nodes: [node("g1", "alle", 0, 0, "side"), node("n1", "RSI(14) unter 1", 0, 0), node("n2", "Schluss über EMA 50", 600, 0)] }) }));
    expect(find(never, "no-trades")!.text).toContain("„RSI(14) unter 1“ war in keiner einzigen der 1.000 Kerzen erfüllt");
    const unknown = diag(result([], { funnel: funnel({ nodes: [node("g1", "alle", 0, 0, "side"), node("n1", "x [1D]", 0, 700)] }) }));
    expect(find(unknown, "no-trades")!.text).toContain("70 % der Kerzen nicht genug Daten");
    const together = diag(result([], { funnel: funnel({ nodes: [node("g1", "alle", 0, 0, "side"), node("n1", "A", 300, 0), node("n2", "B", 200, 0)] }) }));
    expect(find(together, "no-trades")!.text).toMatch(/nie alle zugleich/);
    const dropped = diag(result([], { funnel: funnel({ edges: 6, candidates: 6, signals: 6, skippedGap: 4, skippedRisk: 2 }) }));
    expect(find(dropped, "no-trades")!.text).toContain("6 Signale kamen bei der Engine an, aber keins wurde eröffnet (4 hinter Stop oder Ziel, 2 Stop zu eng)");
    expect(dropped.findings[0]!.severity).toBe("high");
  });

  it("der Trichter listet Stufen von den Kerzen bis zu den Trades, Verlustzeilen nur bei > 0", () => {
    const ts = Array.from({ length: 5 }, () => trade({ r: 0.2 }));
    const d = diag(result(ts, { funnel: funnel({ examined: 900, edges: 40, conflicts: 2, candidates: 30, blockedByPosition: 20, signals: 10, skippedGap: 4, skippedRisk: 1, executed: 5 }) }));
    expect(d.funnel.map((s) => [s.id, s.count])).toEqual([
      ["examined", 900],
      ["edges", 40],
      ["conflicts", 2],
      ["candidates", 30],
      ["blocked", 20],
      ["signals", 10],
      ["skipGap", 4],
      ["skipRisk", 1],
      ["executed", 5],
    ]);
    expect(find(d, "skipped")?.text).toContain("5 von 10 Signalen wurden nicht eröffnet");
    expect(find(d, "blocked")?.text).toContain("67 %");
  });

  it("Abdeckung: Lücken, zu wenige Kerzen und zu kurzes Warm-up werden gemeldet", () => {
    const r = result(Array.from({ length: 12 }, () => trade({ r: 0.1 })), {
      bars: 200,
      expectedBars: 300,
      gaps: { gaps: 2, missing: 12 },
      coverage: [{ interval: "1h", role: "exec", bars: 200, first: T0, last: T0 + 200 * H * 1000, gaps: 2, missing: 12 }],
      warmup: { wanted: 300, got: 50 },
    });
    const d = diag(r);
    expect(d.coverage.receivedShare).toBeCloseTo(200 / 300, 9);
    expect(d.coverage.missing).toBe(12);
    expect(d.coverage.warmupOk).toBe(false);
    expect(find(d, "gaps")?.text).toContain("12 Kerzen fehlen in 2 Lücken");
    expect(find(d, "short-data")?.text).toContain("vorhanden sind 200");
    expect(find(d, "warmup")?.text).toContain("50");
  });

  it("Vergleich ohne Kosten / ohne Filter / ohne Verwaltung mit Δ Ø R und Stichproben-Hinweis", () => {
    const ts = [...Array.from({ length: 10 }, () => trade({ r: 0.5, reason: "target", fees: 8 })), ...Array.from({ length: 10 }, () => trade({ r: -0.6, fees: 8 }))];
    const r = result(ts, {
      variants: [
        variant({ id: "noCosts", kind: "noCosts", label: "Ohne Kosten", n: 20, avgR: 0.12, net: 240 }),
        variant({ id: "leaf:n1", kind: "noLeaf", label: "Ohne „RSI(14) unter 30“", n: 48, avgR: 0.2 }),
        variant({ id: "leaf:n2", kind: "noLeaf", label: "Ohne „Schluss über EMA 50“", n: 5, avgR: -0.5 }),
        variant({ id: "exits", kind: "noExits", label: "Ohne Verwaltung", n: 20, avgR: -0.2 }),
      ],
    });
    const d = diag(r);
    expect(d.compare.map((c) => c.id)).toEqual(["base", "noCosts", "leaf:n1", "leaf:n2", "exits"]);
    expect(d.compare[0]!.deltaAvgR).toBeNull();
    expect(d.compare[1]!.deltaAvgR).toBeCloseTo(0.12 - (d.compare[0]!.avgR as number), 9);
    expect(find(d, "cmp-costs")!.text).toContain("Ø +0,12 R bei 20 Trades statt");
    const filter = find(d, "cmp-leaf:n1")!;
    expect(filter.text).toContain("bei 48 Trades");
    expect(filter.text).toMatch(/Gewinner aussortiert/);
    expect(find(d, "cmp-exits")?.title).toBe("Die Verwaltung hilft");
    // ≥ 5 trades but below 10 → the note about the small sample
    expect(find(d, "cmp-leaf:n2")?.text).toContain("kleine Stichprobe");
  });
});

describe("diagnoseRun – Eigenschaften der Ausgabe", () => {
  const ts = [...Array.from({ length: 10 }, () => trade({ r: -1, bars: 2 })), ...Array.from({ length: 10 }, () => trade({ r: 1.5, reason: "target", fees: 3 }))];
  const r = result(ts, { variants: [variant({ id: "noCosts", kind: "noCosts", avgR: 0.4 })] });

  it("deterministisch und serialisierbar: JSON ohne NaN / Infinity, gleiche Eingabe → gleiche Ausgabe", () => {
    const a = diag(r);
    const b = diag(r);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    const bad: string[] = [];
    const walk = (v: unknown, path: string): void => {
      if (typeof v === "number" && !Number.isFinite(v)) bad.push(path);
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(a, "d");
    expect(bad).toEqual([]);
    expect(a.v).toBe(1);
  });

  it("Befunde sind nach Gewicht geordnet (hoch vor mittel vor Info) und tragen Zahlen als Beleg", () => {
    const d = diag(r);
    const order = { high: 3, medium: 2, info: 1 } as const;
    for (let i = 1; i < d.findings.length; i++) expect(order[d.findings[i - 1]!.severity]).toBeGreaterThanOrEqual(order[d.findings[i]!.severity]);
    for (const f of d.findings) {
      expect(f.title.length).toBeGreaterThan(3);
      expect(f.evidence.length).toBeGreaterThan(0);
      expect(f.evidence.every((e) => e.label && e.value)).toBe(true);
      expect(f.text).toMatch(/\d/); // each finding names a number
    }
  });

  it("ohne Kerzen: die Ausflug-Zahlen sind null, nichts bricht", () => {
    const d = diag(r, cfg, { bars: [] });
    expect(d.excursion.mfeMed).toBeNull();
    expect(d.excursion.stopAtrMed).toBeNull();
    expect(d.n).toBe(20);
  });
});

describe("diagnoseRun – ein echter Lauf", () => {
  const read = (n: string): Bar[] => (JSON.parse(readFileSync(`tests/unit/fixtures/${n}`, "utf8")) as { bars: number[][] }).bars.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));
  const H4 = read("binance-btcusdt-4h.json");
  const D1 = read("binance-btcusdt-1d.json");

  it("liefert Trichter, Kosten, Ausstiege und geordnete Befunde auf echten BTCUSDT-Kerzen", () => {
    const config = sanitizeCustom({ ...defaultCustom(), long: newGroup("g1", "and", [{ ...newLeaf("n1", "rsi"), params: { len: 14, mode: "below", level: 45, within: 1 } }, { ...newLeaf("n2", "maPrice", "1d"), params: { type: "sma", len: 5, mode: "above", within: 1 } }]), exits: { ...defaultCustom().exits, breakEven: { on: true, trigger: "r", value: 1, to: "net" } } });
    const input: LabJobInput = {
      strategy: "custom",
      symbol: "BTCUSDT",
      box: { tf: "4h" },
      mcb: { signal: DEFAULT_SIGNAL_CFG, step: "4h" },
      rules: { interval: "4h", side: "long", conds: [] },
      custom: { config, signal: DEFAULT_SIGNAL_CFG },
      params: {},
      fromMs: H4[400]!.t * 1000,
      toMs: (H4[H4.length - 1]!.t + 14_400) * 1000,
      engine: { capital: 10_000, riskPct: 0.01, maxLeverage: 5, compounding: true, costs: { fees: DEFAULT_FEES, slippage: { kind: "fixed", bps: 2 }, funding: { kind: "flat", ratePer8h: 0.0001 } } },
      data: { "4h": H4, "1d": D1 },
    };
    const res = createLabJob(input).result();
    const d = diagnoseRun(res, { ...cfg, custom: config }, { bars: H4 });
    expect(d.n).toBe(res.stats.n);
    expect(d.funnel[0]!.id).toBe("examined");
    expect(d.funnel.some((s) => s.kind === "leaf")).toBe(true);
    expect(d.funnel[d.funnel.length - 1]!.count).toBe(res.trades.length);
    expect(d.costs.net).toBeCloseTo(res.stats.net, 6);
    expect(d.exits.reduce((s, e) => s + e.n, 0)).toBe(res.trades.length);
    expect(d.compare[0]!.id).toBe("base");
    expect(d.compare.some((c) => c.kind === "noCosts")).toBe(true);
    expect(d.coverage.rows.map((c) => c.interval)).toEqual(["4h", "1d"]);
    expect(d.findings.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  }, 60_000);
});
