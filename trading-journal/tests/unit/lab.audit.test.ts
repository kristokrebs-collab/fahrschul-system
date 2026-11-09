/**
 * F18 – Strategie-Prüfbericht: `auditRun` on hand-built runs (every number below is derived in the test) plus one pass on a
 * real run. Each statement must name the sample it rests on; below 10 trades the report says so instead of judging.
 */
import { describe, expect, it } from "vitest";
import { createLabJob, gapSpans, gapsOf, runStats, type Bar, type BtTrade, type LabResult, type RunFunnel } from "@/domain/backtest/index";
import { AUDIT, auditRun } from "@/domain/lab/report";
import { chain, H, realInput, T0 } from "./lab.extras.helpers";

const funnel = (over: Partial<RunFunnel> = {}): RunFunnel => ({ examined: 1000, nodes: [], edges: null, conflicts: null, candidates: null, blockedByPosition: null, signals: 0, skippedGap: 0, skippedRisk: 0, executed: 0, ...over });

const TO = T0 + 300 * H * 1000;
function result(trades: BtTrade[], over: Partial<LabResult> = {}): LabResult {
  const stats = runStats({ trades, equity: [], from: T0, to: TO, capital: 10_000, skipped: 0, skippedGap: 0, skippedRisk: 0, signals: trades.length });
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
    to: TO,
    stats,
    trades,
    skipped: 0,
    coverage: [{ interval: "1h", role: "exec", bars: 300, first: T0, last: TO, gaps: 0, missing: 0 }],
    expectedBars: 300,
    warmup: { wanted: 100, got: 120 },
    funnel: funnel({ signals: trades.length, executed: trades.length }),
    variants: [],
    split: { params: null, is: null, oos: null, isCurveR: [], oosCurveR: [], cutTime: null },
    wf: null,
    robust: { verdict: "wenig", text: "Zu wenig Trades", reasons: [] },
    ...over,
  } as unknown as LabResult;
}

/** 300 hourly bars from T0 with the given bar indices removed. */
const bars = (without: readonly number[] = []): Bar[] => Array.from({ length: 300 }, (_, i) => ({ t: T0 / 1000 + i * 3600, o: 100, h: 101, l: 99, c: 100 })).filter((_, i) => !without.includes(i));

describe("Ausreißerabhängigkeit", () => {
  // 12 trades: +5 +3 +1 +1 +1 and seven −1 → Σ = +4 R
  const rs = [5, 3, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1];
  const a = auditRun(result(chain(rs)));

  it("ohne die besten 1 / 3 / 5: Netto-R, Ø R und Profit-Faktor des Rests", () => {
    expect(a.outliers.sumR).toBe(4);
    const b = (k: number) => a.outliers.rows.find((r) => r.kind === "best" && r.k === k)!;
    expect([b(1).removedSumR, b(1).remainN, b(1).remainSumR]).toEqual([5, 11, -1]);
    expect(b(1).remainAvgR).toBeCloseTo(-1 / 11, 12);
    expect([b(3).removedSumR, b(3).remainN, b(3).remainSumR]).toEqual([9, 9, -5]);
    // five best out: seven losers left → no profit, profit factor 0
    expect([b(5).remainN, b(5).remainSumR, b(5).remainPf]).toEqual([7, -7, 0]);
    // money: 100 per R
    expect(b(1).remainNet).toBe(-100);
    expect(b(1).flipsSign).toBe(true);
  });

  it("Urteil: hängt an wenigen Trades – mit Zahl der Trades im Satz, als Hinweis formuliert", () => {
    expect(a.outliers.verdict).toBe("abhaengig");
    expect(a.outliers.text).toContain("Ohne die besten 1 von 12 Trades");
    expect(a.outliers.text).toContain("−1,00 R");
    expect(a.outliers.text).toMatch(/Hinweis, kein Beweis/);
  });

  it("zum Vergleich ohne die schlechtesten", () => {
    const w1 = a.outliers.rows.find((r) => r.kind === "worst" && r.k === 1)!;
    expect([w1.removedSumR, w1.remainN, w1.remainSumR]).toEqual([-1, 11, 5]);
    expect(w1.flipsSign).toBe(false);
  });

  it("breit gestreut: bleibt auch ohne die besten fünf positiv – und sagt, was das nicht heißt", () => {
    const spread = auditRun(result(chain([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, -1, -1, -1, -1, -1, -1])));
    expect(spread.outliers.verdict).toBe("tragfaehig");
    expect(spread.outliers.text).toContain("von 16 Trades");
    expect(spread.outliers.text).toMatch(/nichts über Trades, die noch kommen/);
  });

  it("schon vorher im Minus: keine Ausreißerfrage", () => {
    const loss = auditRun(result(chain([1, -1, -1, -1, -1, 2, -1, -1, -1, -1, -1, -1])));
    expect(loss.outliers.verdict).toBe("verlust");
    expect(loss.outliers.text).toContain("Schon mit allen 12 Trades");
  });

  it("unter 10 Trades: kein Urteil, keine Zeilen", () => {
    const few = auditRun(result(chain([3, -1, -1, 2, -1])));
    expect(few.outliers.verdict).toBe("zuwenig");
    expect(few.outliers.rows).toEqual([]);
    expect(few.outliers.text).toContain("Mit 5 Trades");
    expect(AUDIT.minTrades).toBe(10);
    expect(auditRun(result([])).outliers.text).toMatch(/Ohne Trades/);
  });

  it("Zeilen mit einem großen Teil aller Trades sind als dünn markiert", () => {
    // n = 10: removing 3 is 30 %, removing 1 is 10 %
    const t = auditRun(result(chain([4, 3, 2, 1, 1, -1, -1, -1, -1, -1])));
    expect(t.outliers.rows.find((r) => r.kind === "best" && r.k === 1)!.thin).toBe(false);
    expect(t.outliers.rows.find((r) => r.kind === "best" && r.k === 3)!.thin).toBe(true);
  });
});

describe("Datenlücken", () => {
  it("ohne Kerzen im Zugriff: Summen aus dem Lauf, Einzelheiten fehlen – mit Satz dazu", () => {
    const r = result(chain([1, -1]), { gaps: { gaps: 2, missing: 7 }, coverage: [{ interval: "1h", role: "exec", bars: 300, first: T0, last: TO, gaps: 2, missing: 7 }] });
    const d = auditRun(r, null).data;
    expect([d.gaps, d.missing]).toEqual([2, 7]);
    expect(d.spans).toEqual([]);
    expect(d.tradesOverGap).toBeNull();
    expect(d.notes.join(" ")).toMatch(/liegen nicht mehr vor/);
    expect(d.missingShare).toBeCloseTo(7 / 307, 12);
  });

  it("die Lücken einzeln, die größten zuerst, mit Datum; Trades über einer Lücke", () => {
    const b = bars([100, 101, 102, 200, 201]); // holes: 3 missing at index 100…102, 2 missing at 200…201
    expect(gapsOf(b, 3600)).toEqual({ gaps: 2, missing: 5 });
    const spans = gapSpans(b, 3600);
    expect(spans.map((s) => s.missing)).toEqual([3, 2]);
    expect(spans.reduce((s, x) => s + x.missing, 0)).toBe(gapsOf(b, 3600).missing);
    // index space of the trades = index into `b`: 20 + k, a trade across the first hole (entry 98, exit 102 in b's indices)
    const t = [{ ...chain([1])[0]!, entryIndex: 98, exitIndex: 101 }, ...chain([-1, 1]).slice(0, 1)];
    const r = result(t, { bars: 295, gaps: { gaps: 2, missing: 5 }, coverage: [{ interval: "1h", role: "exec", bars: 295, first: T0, last: TO, gaps: 2, missing: 5 }] });
    const d = auditRun(r, b).data;
    expect(d.spanCount).toBe(2);
    expect(d.spans.map((s) => s.missing)).toEqual([3, 2]);
    expect(d.spans[0]!.fromMs).toBe(T0 + 100 * H * 1000); // the first missing hour
    expect(d.spans[0]!.toMs).toBe(T0 + 103 * H * 1000); // the first bar after the hole
    expect(d.tradesOverGap).toBe(1);
    expect(d.notes.join(" ")).toMatch(/1 von 2 Trades waren über eine Lücke hinweg offen/);
  });

  it("mehr als 2 % fehlende Kerzen werden benannt; zu kurzer Vorlauf auch", () => {
    const r = result(chain([1]), { gaps: { gaps: 1, missing: 30 }, bars: 270, warmup: { wanted: 300, got: 120 }, coverage: [{ interval: "1h", role: "exec", bars: 270, first: T0, last: TO, gaps: 1, missing: 30 }] });
    const n = auditRun(r, null).data.notes.join(" ");
    expect(n).toMatch(/mehr als 2 % der Kerzen/);
    expect(n).toMatch(/Vorlauf für die Indikatoren zu kurz \(120 von 300/);
  });

  it("ohne Lücken sagt der Bericht das mit der Zahl der Kerzen", () => {
    expect(auditRun(result(chain([1])), bars()).data.notes[0]).toBe("Keine Lücken in den 300 Kerzen der Ausführungsebene.");
  });
});

describe("Signale", () => {
  it("übergeben, übersprungen, blockiert – wie der Trichter, mit Anteil", () => {
    const s = auditRun(result(chain([1, -1]), { funnel: funnel({ edges: 40, conflicts: 2, candidates: 30, blockedByPosition: 12, signals: 18, skippedGap: 3, skippedRisk: 1, executed: 14 }) })).signals;
    expect(s).toMatchObject({ edges: 40, conflicts: 2, candidates: 30, blockedByPosition: 12, handed: 18, skippedGap: 3, skippedRisk: 1, executed: 14 });
    expect(s.skippedShare).toBeCloseTo(4 / 18, 12);
  });
  it("nachträgliche Signale: nicht gemessen (null), nicht 0 – der Text sagt warum", () => {
    const s = auditRun(result(chain([1]), { funnel: funnel() })).signals;
    expect(s.late.n).toBeNull();
    expect(s.late.text).toMatch(/durch seinen Aufbau/);
    expect(s.late.text).toMatch(/nicht einzeln nachgemessen/);
    expect(s.skippedShare).toBeNull(); // no signals handed over
  });
});

describe("Prüfzeiträume", () => {
  const DAYMS = 86_400_000;
  const from = T0;
  const to = T0 + 100 * DAYMS;
  const wfw = (k: number, testN: number) => ({ index: k, train: { from: 0, to: 0 }, test: { from: 0, to: 0 }, trainFrom: from + k * 14 * DAYMS, testFrom: from + (28 + k * 14) * DAYMS, testTo: from + (42 + k * 14) * DAYMS, best: {}, trainMeanR: 0.1, trainN: 20, testMeanR: 0, testSumR: 0, testN });

  it("Walk-forward: wie viel nur Training war, wie viel ungesehen gehandelt wurde, leere Fenster", () => {
    const r = result(chain([1, -1, 1]), {
      from,
      to,
      wf: { windows: [wfw(0, 4), wfw(1, 0), wfw(2, 3), wfw(3, 2), wfw(4, 1)], oosMeanR: 0, efficiency: 0.5, positiveShare: 0.5, oosN: 10, oosSumR: 0 } as never,
    });
    const w = auditRun(r).periods.walkForward!;
    expect(w.windows).toBe(5);
    expect(w.trainOnlyShare).toBeCloseTo(0.28, 12); // 28 of 100 days
    expect(w.testShare).toBeCloseTo(0.7, 12); // 5 × 14 days
    expect(w.emptyWindows).toBe(1);
    expect(w.testTrades).toBe(10);
    expect(auditRun(r).periods.notes.join(" ")).toMatch(/ersten 28 % des Zeitraums dienten im Walk-forward nur dem Training/);
  });

  it("Out-of-Sample: Anteil und Trades; ohne Gewinner bleibt der Abschnitt ungenutzt, mit Satz", () => {
    const used = auditRun(result(chain([1]), { from, to, split: { params: { a: 1 }, is: null, oos: { n: 4 } as never, isCurveR: [], oosCurveR: [], cutTime: from + 70 * DAYMS } })).periods;
    expect(used.oos).toMatchObject({ used: true, n: 4 });
    expect(used.oos.share).toBeCloseTo(0.3, 12);
    expect(used.notes.join(" ")).toMatch(/nur 4 Trades – zu wenig/);
    const unused = auditRun(result(chain([1]), { from, to, split: { params: null, is: null, oos: null, isCurveR: [], oosCurveR: [], cutTime: from + 70 * DAYMS } })).periods;
    expect(unused.oos).toMatchObject({ used: false, n: null });
    expect(unused.notes.join(" ")).toMatch(/blieb ungenutzt/);
  });

  it("ohne Walk-forward: der Satz sagt, der Zeitraum war zu kurz; einen eigenen Rückhalt-Zeitraum gibt es nie", () => {
    const p = auditRun(result(chain([1]))).periods;
    expect(p.walkForward).toBeNull();
    expect(p.notes.join(" ")).toMatch(/zu kurz/);
    expect(p.notes.join(" ")).toMatch(/Einen eigenen, zurückgehaltenen Prüfzeitraum/);
  });

  it("ruhige Phasen: die längsten ohne offenen Trade; Drittel summieren sich zu allen Trades", () => {
    // trades in the first and the last tenth, a long quiet middle
    const t = [
      { ...chain([1])[0]!, entryTime: from + 2 * DAYMS, exitTime: from + 3 * DAYMS },
      { ...chain([-1])[0]!, entryTime: from + 95 * DAYMS, exitTime: from + 96 * DAYMS },
    ];
    const p = auditRun(result(t, { from, to })).periods;
    expect(p.quiet[0]!.days).toBeCloseTo(92, 9); // day 3 → day 95
    expect(p.quiet[0]!.share).toBeCloseTo(0.92, 9);
    expect(p.quiet.length).toBeLessThanOrEqual(3);
    expect(p.thirds.map((x) => x.n)).toEqual([1, 0, 1]);
    expect(p.thirds.reduce((s, x) => s + x.n, 0)).toBe(2);
    expect(p.thirds.reduce((s, x) => s + x.sumR, 0)).toBe(0);
  });
});

describe("Prüfbericht eines echten Laufs", () => {
  it("vollständig, JSON-sicher, jede Zahl kommt aus dem Lauf", () => {
    const input = realInput();
    const res = createLabJob(input).result();
    const bars4h = input.data["4h"]!;
    const a = auditRun(res, bars4h);
    expect(a.n).toBe(res.stats.n);
    expect(a.outliers.net).toBeCloseTo(res.stats.net, 6);
    expect(a.outliers.sumR).toBeCloseTo(res.stats.sumR, 9);
    expect(a.data.received).toBe(res.bars);
    expect(a.signals.executed).toBe(res.trades.length);
    expect(a.periods.thirds.reduce((s, x) => s + x.n, 0)).toBe(res.trades.length);
    expect(a.robust.verdict).toBe(res.robust.verdict);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(auditRun(res, bars4h)).toEqual(a);
  }, 60_000);
});
