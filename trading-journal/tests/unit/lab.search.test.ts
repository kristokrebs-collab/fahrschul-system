/**
 * Strategiesuche „1.000 Varianten. Eine bleibt.“ – die Logik gegen BEKANNTE WAHRHEIT:
 *  (a) ein eingebautes, wiederholbares Muster wird gefunden und der Endtest besteht,
 *  (b) auf reinen Zufallspfaden wird in der überwiegenden Mehrzahl verworfen (Fehlalarm-Rate gepinnt),
 *  (c) kein Blick in die Zukunft (Abschneide- und Verschiebe-Test; der Endtest fließt nie in die Auswahl),
 *  (d) alle 1.000 Varianten werden gerechnet, deterministisch, in beliebigen Häppchen,
 * plus die Kriterien, der Suchraum und der aktuelle Kandidat mit Handrechnung.
 */
import { describe, expect, it } from "vitest";
import { atrSeries } from "@/domain/backtest/bars";
import { runBacktest } from "@/domain/backtest/engine";
import { evaluate } from "@/domain/backtest/optimize";
import { evalConds, ruleBuilder, type RuleFacts } from "@/domain/backtest/strategies/rules";
import type { LabStrategy } from "@/domain/backtest/strategies/types";
import type { Bar } from "@/domain/backtest/types";
import {
  adjustedP,
  candidateOf,
  condsOf,
  CRITERIA,
  createSearchJob,
  DEFAULT_SEED,
  drawVariants,
  judge,
  runSearchSync,
  SearchDataError,
  searchSpace,
  sizeCandidate,
  spaceSize,
  variantText,
  type SearchVariant,
  type SectionStats,
} from "@/domain/lab/search";
import { rng } from "@/domain/analytics/stats";
import { ENGINE, market, searchInput } from "./search.helpers";

const stats = (over: Partial<SectionStats>): SectionStats => ({ n: 40, avgR: 0.3, sdR: 1, sumR: 12, winRate: 0.5, pf: 1.5, pEdge: 0.02, maxDdR: 4, avgCostR: 0.1, ...over });

describe("Suchraum und Ziehung", () => {
  it("hat 24.000 Punkte und zieht 1.000 verschiedene Varianten, gesetzt durch den Seed", () => {
    expect(spaceSize(searchSpace("4h"))).toBe(24_000);
    const a = drawVariants("4h", DEFAULT_SEED);
    expect(a).toHaveLength(1000);
    expect(new Set(a.map((v) => JSON.stringify({ ...v, id: 0 }))).size).toBe(1000);
    expect(a.map((v) => v.id)).toEqual(Array.from({ length: 1000 }, (_, i) => i));
    expect(drawVariants("4h", DEFAULT_SEED)).toEqual(a);
    expect(drawVariants("4h", DEFAULT_SEED + 1)).not.toEqual(a);
    // jede Variante liegt im Raum
    const sp = searchSpace("4h");
    for (const v of a) {
      expect(sp.side).toContain(v.side);
      expect(sp.lookback).toContain(v.lookback);
      expect(sp.trendEma).toContain(v.trendEma);
      expect(sp.stopAtr).toContain(v.stopAtr);
      expect(sp.targetR).toContain(v.targetR);
      expect(sp.maxBars).toContain(v.maxBars);
    }
  });

  it("zieht den ganzen Raum, wenn mehr verlangt wird, und hängt nicht von Kerzen ab", () => {
    expect(drawVariants("1d", 1, 99_999)).toHaveLength(24_000);
    // beide Seiten und alle Trendfilter kommen vor
    const a = drawVariants("4h", 5);
    expect(new Set(a.map((v) => v.side))).toEqual(new Set(["long", "short"]));
    expect(new Set(a.map((v) => v.trendEma))).toEqual(new Set([0, 20, 50, 100, 200]));
  });

  it("übersetzt eine Variante in Bedingungen des Regel-Baukastens und einen Satz", () => {
    const v: SearchVariant = { family: "trend", id: 0, side: "short", lookback: 20, trendEma: 50, stopAtr: 1.5, targetR: 2, maxBars: 12 };
    expect(condsOf(v)).toEqual([
      { kind: "breakdownLow", a: 20 },
      { kind: "closeBelowEma", a: 50 },
    ]);
    expect(condsOf({ ...v, side: "long", trendEma: 0 })).toEqual([{ kind: "breakoutHigh", a: 20 }]);
    expect(variantText(v)).toBe("Short, wenn der Schluss unter dem Tief der letzten 20 Kerzen liegt und unter der EMA 50 · Stop 1,5 × ATR · Ziel 2 R · Zeit-Stopp 12 Kerzen");
  });
});

describe("Kriterien (vorab festgelegt)", () => {
  it("adjustedP: Šidák, von Hand (1 − (1 − p)^N)", () => {
    expect(adjustedP(0.001, 1000)).toBeCloseTo(1 - Math.pow(0.999, 1000), 10); // 0,632
    expect(adjustedP(0.001, 1000)).toBeCloseTo(0.632, 3);
    expect(adjustedP(1e-9, 1000)).toBeCloseTo(1e-6, 9);
    expect(adjustedP(0, 1000)).toBe(0);
    expect(adjustedP(1, 1000)).toBe(1);
    expect(adjustedP(null, 1000)).toBeNull();
  });

  const ok = { is: stats({ n: 80, avgR: 0.4 }), oos: stats({ n: 20, avgR: 0.35, pEdge: 0.03 }), deflation: { isP: 1e-12, adjP: 1e-9, trials: 1000 } };
  it("besteht, wenn alle sechs Kriterien erfüllt sind", () => {
    const v = judge(ok);
    expect(v.passed).toBe(true);
    expect(v.checks.map((c) => c.id)).toEqual(["isTrades", "oosTrades", "oosPositive", "retention", "oosSignificance", "multiTest"]);
    expect(v.checks.every((c) => c.ok)).toBe(true);
    expect(v.reason).toMatch(/kein Beweis und keine Prognose/);
  });

  it("verwirft bei jedem einzelnen verfehlten Kriterium – und nennt dieses", () => {
    const fail = (over: Parameters<typeof judge>[0], id: string) => {
      const v = judge(over);
      expect(v.passed, id).toBe(false);
      expect(v.checks.find((c) => !c.ok)?.id, id).toBe(id);
    };
    fail({ ...ok, is: stats({ n: CRITERIA.minIsTrades - 1, avgR: 0.4 }) }, "isTrades");
    fail({ ...ok, oos: stats({ n: CRITERIA.minOosTrades - 1, avgR: 0.35, pEdge: 0.03 }) }, "oosTrades");
    fail({ ...ok, oos: stats({ n: 20, avgR: -0.01, pEdge: 0.6 }) }, "oosPositive");
    // 0,19 R sind weniger als die Hälfte von 0,4 R
    fail({ ...ok, oos: stats({ n: 20, avgR: 0.19, pEdge: 0.03 }) }, "retention");
    fail({ ...ok, oos: stats({ n: 20, avgR: 0.3, pEdge: 0.12 }) }, "oosSignificance");
    fail({ ...ok, deflation: { isP: 0.001, adjP: 0.632, trials: 1000 } }, "multiTest");
  });

  it("verwirft ohne Mehrfachtest-Zahl und mit leeren Endtest-Zahlen", () => {
    expect(judge({ ...ok, deflation: null }).passed).toBe(false);
    expect(judge({ ...ok, oos: stats({ n: 0, avgR: null, pEdge: null, sdR: null }) }).passed).toBe(false);
  });
});

describe("(a) eingebautes Muster: die Suche findet es, der Endtest besteht", () => {
  // Muster (Testdaten, Wahrheit bekannt): auf jeden Schluss über dem Hoch der letzten 20 Kerzen steigt der Preis 4 Kerzen lang um 1 σ je
  // Kerze und fällt danach wieder auf den Zufallspfad zurück (ohne Netto-Drift). Wahrer Parameter: Rückblick 20, Long.
  const SEEDS = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
  const results = SEEDS.map((s) => runSearchSync(searchInput(market(4800, s, { edge: { lookback: 20, hold: 4, drift: 1 } }), 7)));

  it("findet eine Long-Variante, deren Endtest in (fast) allen Läufen besteht – und verwirft ehrlich, wo die Trades fehlen", () => {
    for (const r of results) {
      expect(r.winner, "ein Sieger").not.toBeNull();
      expect((r.winner!.variant as SearchVariant).side).toBe("long");
      expect(r.winner!.is.avgR).toBeGreaterThan(0.5);
      expect(r.winner!.oos.avgR).toBeGreaterThan(0.3);
      expect(r.deflation!.adjP!).toBeLessThan(1e-6);
    }
    const passed = results.filter((r) => r.verdict.passed);
    expect(passed.length, "bestandene Läufe von 10").toBeGreaterThanOrEqual(8);
    // wer nicht besteht, scheitert an der Zahl der Endtest-Trades – nicht an der Statistik
    for (const r of results.filter((x) => !x.verdict.passed)) expect(r.verdict.checks.filter((c) => !c.ok).map((c) => c.id)).toEqual(["oosTrades"]);
  });

  it("liegt in der Nähe des wahren Parameters (Rückblick 16–24 in allen Läufen) und das Profil über alle 1.000 stimmt", () => {
    for (const r of results) expect((r.winner!.variant as SearchVariant).lookback, "Sieger-Rückblick").toBeGreaterThanOrEqual(16);
    for (const r of results) expect((r.winner!.variant as SearchVariant).lookback, "Sieger-Rückblick").toBeLessThanOrEqual(24);
    // Profil: die mittlere Trainings-Erwartung der Long-Varianten mit Rückblick 16–28 liegt klar über der mit Rückblick ≥ 40 – dort feuert die
    // Regel nur noch selten und nicht mehr auf den Impuls
    const vs = drawVariants("4h", 7);
    for (const r of results) {
      const avg = (pick: (v: SearchVariant) => boolean): number => {
        const xs = vs.filter((v) => v.side === "long" && pick(v) && r.rows[v.id]!.isAvgR != null && r.rows[v.id]!.isN >= 20).map((v) => r.rows[v.id]!.isAvgR!);
        return xs.reduce((a, b) => a + b, 0) / xs.length;
      };
      expect(avg((v) => v.lookback >= 16 && v.lookback <= 28)).toBeGreaterThan(avg((v) => v.lookback >= 40) + 0.1);
    }
  });
});

describe("(b) reiner Zufallspfad: überwiegend verworfen, Fehlalarm-Rate gepinnt", () => {
  const N = 40;
  const runs = Array.from({ length: N }, (_, i) => runSearchSync(searchInput(market(4800, 900 + i), 7)));

  it(`bestanden in höchstens 10 % von ${N} Zufallspfaden (Fehlalarm-Rate)`, () => {
    const alarms = runs.filter((r) => r.verdict.passed).length;
    expect(alarms / N).toBeLessThanOrEqual(0.1);
    // gemessen: 0 von 60 (Entwicklung, andere Seeds); hier gepinnt als Obergrenze
    expect(alarms).toBeLessThanOrEqual(4);
  });

  it("die beste von 1.000 sieht im Training oft gut aus – der Endtest und die Mehrfachtest-Korrektur nehmen das zurück", () => {
    const withWinner = runs.filter((r) => r.winner);
    expect(withWinner.length).toBeGreaterThanOrEqual(N * 0.9);
    // Trainings-Erwartung der Sieger ist im Schnitt positiv (Auswahl!), die im Endtest deutlich kleiner
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const isMean = mean(withWinner.map((r) => r.winner!.is.avgR!));
    const oosMean = mean(withWinner.map((r) => r.winner!.oos.avgR ?? 0));
    expect(isMean).toBeGreaterThan(0.15);
    expect(oosMean).toBeLessThan(isMean / 2);
    // das korrigierte Training-p ist in (fast) allen Zufallsläufen kein Beleg
    const weak = withWinner.filter((r) => (r.deflation!.adjP ?? 1) > CRITERIA.maxAdjP).length;
    expect(weak / withWinner.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe("(b2) Zufallspfad mit wechselnder Schwankung (Regime)", () => {
  it("auch hier höchstens 10 % Fehlalarme (20 Pfade), und die Verteilung der Endtest-Erwartung ist da", () => {
    const runs = Array.from({ length: 20 }, (_, i) => runSearchSync(searchInput(market(4800, 7000 + i, { volCycle: true }), 7)));
    expect(runs.filter((r) => r.verdict.passed).length).toBeLessThanOrEqual(2);
    const r = runs[0]!;
    const d = r.distribution!;
    expect(d.counts).toHaveLength(24);
    // alle bewertbaren Varianten stehen im Histogramm (so viele wie `rank.of` ohne den Sieger, falls dieser nicht bewertbar ist)
    expect(d.counts.reduce((a, b) => a + b, 0)).toBe(r.rows.filter((x) => x.oosScore != null).length);
    expect(d.max).toBeGreaterThan(d.min);
    // der Rang ist ein Platz unter den bewertbaren, 1 … of
    if (r.rank?.rank != null) {
      expect(r.rank.rank).toBeGreaterThanOrEqual(1);
      expect(r.rank.rank).toBeLessThanOrEqual(r.rank.of);
    }
  });
});

describe("(c) kein Blick in die Zukunft", () => {
  const bars = market(1800, 4242);
  const vs = drawVariants("4h", 99, 30);

  it("Abschneide-Test: das Signal einer Kerze t hängt nur von Kerzen bis t ab (30 Varianten × 12 Stellen)", () => {
    const pick = rng(5);
    for (const v of vs) {
      const full = evalConds(bars, condsOf(v));
      for (let k = 0; k < 12; k++) {
        const t = 250 + Math.floor(pick() * (bars.length - 300));
        const cut = evalConds(bars.slice(0, t + 1), condsOf(v));
        expect(cut[t], `Variante ${v.id} bei ${t}`).toBe(full[t]);
        // und alle früheren Kerzen sind unverändert
        expect(Array.from(cut.subarray(0, t + 1))).toEqual(Array.from(full.subarray(0, t + 1)));
      }
    }
    // dasselbe für ATR (Stop-Abstand)
    for (const t of [300, 777, 1500]) expect(atrSeries(bars.slice(0, t + 1))[t]).toBe(atrSeries(bars)[t]);
  });

  it("Verschiebe-Test: andere Zukunft ab t ändert keinen Trade, der bis t gehandelt wurde", () => {
    const t0 = 1200;
    const future = market(600, 31337).map((b, i): Bar => ({ ...b, t: bars[t0]!.t + (i + 1) * 4 * 3600, o: bars[t0]!.c * (b.o / 30_000), h: bars[t0]!.c * (b.h / 30_000), l: bars[t0]!.c * (b.l / 30_000), c: bars[t0]!.c * (b.c / 30_000) }));
    const other = [...bars.slice(0, t0 + 1), ...future];
    expect(other).toHaveLength(bars.length + 1);
    const strat = ruleBuilder as unknown as LabStrategy<RuleFacts, unknown>;
    for (const v of vs) {
      const run = (series: Bar[]) => {
        const hit = evalConds(series, condsOf(v));
        const prep = { interval: "4h" as const, bars: series, atr: atrSeries(series), start: 400, facts: { hit, side: v.side } };
        return evaluate(strat, prep, { targetR: v.targetR, stopAtr: v.stopAtr, maxBars: v.maxBars }, ENGINE, { from: 400, to: t0 }, false).trades;
      };
      expect(run(other), `Variante ${v.id}`).toEqual(run(bars));
    }
  });

  it("Befund im Labor-Engine: die Funding-Marke am Fensterrand liest die nächste Kerze – darum bekommt das Training nur seine eigenen Kerzen", () => {
    // 4h-Kerzen ab 00:00 UTC; Long auf Kerze 2, Fensterende nach Kerze 5 = genau 24:00, dort liegt eine Funding-Abrechnung (00:00 UTC)
    const mk = (lastClose: number): Bar[] => Array.from({ length: 7 }, (_, i) => ({ t: Date.UTC(2026, 0, 1) / 1000 + i * 14_400, o: 100, h: 101, l: 99, c: i === 6 ? lastClose : 100 }));
    const strategy = { start: 0, signalAt: (i: number) => (i === 2 ? { side: "long" as const, stop: 50, target: null, maxBars: null, tag: "t" } : null) };
    const run = (bars: Bar[], to: number) => runBacktest(bars, strategy, ENGINE, { from: 0, to, equity: false, secLen: 14_400 }).trades[0]!;
    // volle Kerzen, Fenster endet bei Kerze 5: die Funding-Kosten hängen vom Schluss der Kerze 6 ab (Zukunft)
    expect(run(mk(100), 5).funding).not.toBe(run(mk(300), 5).funding);
    // nur die Kerzen des Fensters (so läuft das Training): kein Unterschied möglich
    expect(run(mk(100).slice(0, 6), 5)).toEqual(run(mk(300).slice(0, 6), 5));
  });

  it("der Endtest fließt nie in die Auswahl: andere Kerzen im letzten Fünftel ändern weder Training noch Sieger", () => {
    const base = market(2400, 77, { edge: { lookback: 20, hold: 4, drift: 1 } });
    const a = runSearchSync(searchInput(base, 7));
    const cutIdx = base.findIndex((b) => b.t * 1000 === a.datasets[0]!.cutT);
    expect(cutIdx).toBeGreaterThan(0);
    // Absturz und Spitze im Endtest
    const wild = base.map((b, i): Bar => (i < cutIdx ? b : { ...b, o: b.o * (i % 2 ? 0.5 : 2), h: b.h * (i % 2 ? 0.55 : 2.2), l: b.l * (i % 2 ? 0.45 : 1.8), c: b.c * (i % 2 ? 0.5 : 2) }));
    const b = runSearchSync(searchInput(wild, 7));
    expect(b.winner!.variant.id).toBe(a.winner!.variant.id);
    expect(b.rows.map((r) => [r.isN, r.isAvgR, r.isScore])).toEqual(a.rows.map((r) => [r.isN, r.isAvgR, r.isScore]));
    expect(b.winner!.is).toEqual(a.winner!.is);
    expect(b.curves.is).toEqual(a.curves.is);
    // nur der Endtest hat sich geändert
    expect(b.winner!.oos).not.toEqual(a.winner!.oos);
  });
});

describe("(d) alle 1.000 werden gerechnet, deterministisch", () => {
  const bars = market(2400, 55, { edge: { lookback: 20, hold: 4, drift: 1 } });
  const input = searchInput(bars, 7);

  it("Zähler: 1.000 Trainingsläufe, 1.000 Endtest-Läufe (der Sieger genau einmal), 1.000 Zeilen mit eigenen Kurven", () => {
    const r = runSearchSync(input);
    expect(r.counts.variants).toBe(1000);
    expect(r.counts.isRuns).toBe(1000);
    expect(r.counts.oosRuns).toBe(1000);
    expect(r.counts.winnerOosRuns).toBe(1);
    expect(r.rows).toHaveLength(1000);
    expect(new Set(r.rows.map((x) => x.id)).size).toBe(1000);
    expect(r.curves.is).toHaveLength(1000);
    for (const c of r.curves.is) expect(c).toHaveLength(r.curves.isPoints);
    expect(r.curves.winner).toHaveLength(r.curves.grid.length);
    // jede Zeile trägt eine Endtest-Zahl, die nur der Rang-Lauf liefern kann (Trades oder 0 – nie "ungeprüft")
    expect(r.rows.every((x) => Number.isInteger(x.isN) && Number.isInteger(x.oosN))).toBe(true);
    expect(r.counts.qualified).toBe(r.rows.filter((x) => x.isScore != null).length);
  });

  it("gleicher Seed → byte-genau gleiches Ergebnis; anderer Seed → andere Ziehung", () => {
    const a = JSON.stringify(runSearchSync(input));
    expect(JSON.stringify(runSearchSync(input))).toBe(a);
    expect(JSON.stringify(runSearchSync(searchInput(bars, 8)))).not.toBe(a);
  });

  it("gleiches Ergebnis in beliebigen Zeit-Häppchen, Fortschritt wächst nur, die Zahl ist echt", () => {
    const job = createSearchJob(input);
    let last = -1;
    let steps = 0;
    const seen = new Set<number>();
    let guard = 0;
    // 1-ms-Häppchen: mehrere hundert Schritte
    while (!job.step(performance.now() + 1)) {
      steps++;
      const p = job.progress();
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
      const c = job.checked();
      if (c.phase === "score") seen.add(c.done);
      expect(c.total).toBe(1000);
      if (++guard > 100_000) throw new Error("hängt");
    }
    expect(steps).toBeGreaterThan(5);
    expect(job.progress()).toBe(1);
    expect(job.checked()).toEqual({ phase: "done", done: 1000, total: 1000 });
    expect(Math.max(...seen)).toBeGreaterThan(100);
    expect(JSON.stringify(job.result())).toBe(JSON.stringify(runSearchSync(input)));
  });

  it("zu wenige Kerzen → ein klarer Fehler, keine Zahl", () => {
    expect(() => createSearchJob(searchInput(market(500, 1), 7, {}, 300))).toThrow(SearchDataError);
  });

  it("weniger Varianten sind möglich (Tests), die Zählung folgt", () => {
    const r = runSearchSync({ ...input, count: 40 });
    expect(r.counts.variants).toBe(40);
    expect(r.rows).toHaveLength(40);
    expect(r.counts.isRuns).toBe(40);
  });
});

describe("aktueller Kandidat", () => {
  const v: SearchVariant = { family: "trend", id: 0, side: "long", lookback: 10, trendEma: 0, stopAtr: 2, targetR: 2, maxBars: 12 };
  /** 60 ruhige Kerzen um 100, dann (optional) ein Ausbruch auf der letzten */
  const flat = (n: number): Bar[] => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000 + i * 14_400, o: 100, h: 101, l: 99, c: 100 + (i % 2 ? 0.2 : -0.2) }));
  const closeAt = (b: Bar[]) => (b[b.length - 1]!.t + 14_400) * 1000;

  it("Signal auf der letzten geschlossenen Kerze: Einstieg, Stop und Ziel aus den Regeln (Handrechnung)", () => {
    const bars = flat(60);
    bars.push({ t: bars[59]!.t + 14_400, o: 100, h: 106, l: 100, c: 105 });
    const c = candidateOf(bars, "4h", v, closeAt(bars));
    expect(c.state).toBe("long");
    const atr = atrSeries(bars)[bars.length - 1]!;
    expect(c.signal!.entry).toBe(105);
    expect(c.signal!.stop).toBeCloseTo(105 - 2 * atr, 10);
    expect(c.signal!.target).toBeCloseTo(105 + 2 * 2 * atr, 10);
    expect(c.signal!.maxBars).toBe(12);
    expect(c.signal!.stopPct).toBeCloseTo(((2 * atr) / 105) * 100, 10);
    expect(c.text).toMatch(/Long-Signal/);
  });

  it("kein Signal: ehrlich „Heute kein Signal – warte“, auch wenn die Bedingung schon länger gilt (kein Nachsteigen)", () => {
    const quiet = candidateOf(flat(60), "4h", v, closeAt(flat(60)));
    expect(quiet.state).toBe("none");
    expect(quiet.signal).toBeNull();
    expect(quiet.holdsFor).toBeNull();
    expect(quiet.text).toMatch(/^Heute kein Signal – warte\./);
    const bars = flat(60);
    bars.push({ t: bars[59]!.t + 14_400, o: 100, h: 106, l: 100, c: 105 }, { t: bars[59]!.t + 28_800, o: 105, h: 108, l: 104, c: 107 });
    const late = candidateOf(bars, "4h", v, closeAt(bars));
    expect(late.state).toBe("none");
    expect(late.holdsFor).toBe(2);
    expect(late.text).toMatch(/^Heute kein Signal – warte\. Die Bedingung gilt seit 2 Kerzen/);
  });

  it("Kerzen, die nicht mehr aktuell sind, geben keine Aussage; ohne Uhr (Demo) wird das Alter nicht geprüft", () => {
    const bars = flat(60);
    expect(candidateOf(bars, "4h", v, closeAt(bars) + 3 * 14_400 * 1000).state).toBe("stale");
    expect(candidateOf(bars, "4h", v, null).state).toBe("none");
    expect(candidateOf([], "4h", v, 0).state).toBe("nodata");
  });

  it("Positionsgröße nur aus den EIGENEN Risikoeinstellungen: ohne gespeichertes Risiko keine Zahl; sonst der Risikorechner (Handrechnung)", () => {
    const sig = { side: "long" as const, entry: 100, stop: 95, target: 110, maxBars: 12, stopPct: 5, targetR: 2, stopAtr: 2 };
    const base = { capital: 10_000, feePct: 0.0005, slippagePct: 0.0005, maxLeverage: 5 };
    expect(sizeCandidate(sig, { ...base, riskPct: null }).kind).toBe("needRisk");
    expect(sizeCandidate(sig, { ...base, riskPct: 0.01, capital: null }).kind).toBe("needCapital");
    const r = sizeCandidate(sig, { ...base, riskPct: 0.01 });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    // Risiko 100 USDT; Verlust je Einheit am Stop = 5 + 0,0005 × (100 + 95) + 0,0005 × 95 = 5,145
    expect(r.sizing.riskAmount).toBe(100);
    expect(r.sizing.lossPerUnit).toBeCloseTo(5.145, 10);
    expect(r.sizing.qty).toBeCloseTo(100 / 5.145, 10);
    expect(r.sizing.notional).toBeCloseTo((100 / 5.145) * 100, 8);
  });
});
