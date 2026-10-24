/**
 * Optimiser – learning from accept / reject and from the live check; the "Was habe ich gelernt?" numbers (honest below the
 * minimum sample); the live check ("hat sich der Vorschlag live bestätigt?") with expected against actual in percent.
 */
import { describe, expect, it } from "vitest";
import { accountView, emptyCursor, newAccount, type ForwardAccount } from "@/domain/forward";
import {
  EMPTY_EVOLVE,
  emptyKind,
  evolveCfgOf,
  learnedSummary,
  liveCheck,
  liveFactsOf,
  MAX_WEIGHT,
  MIN_DECISIONS,
  MIN_LIVE_DAYS,
  MIN_LIVE_TRADES,
  MIN_WEIGHT,
  MUTATION_KINDS,
  recordDecision,
  recordOutcome,
  weightOf,
  weightsOf,
  withEvolve,
  type EvolveSettings,
  type Expected,
  type LiveFacts,
} from "@/domain/evolve";
import { defaultCustom } from "@/domain/lab";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";

describe("Gewichte der Änderungsarten", () => {
  it("ohne Geschichte 1, mit Annahmen höher, mit Ablehnungen niedriger – nie unter 0,3 und nie über 1,7", () => {
    expect(weightOf(undefined)).toBe(1);
    expect(weightOf(emptyKind())).toBe(1); // 0,3 + 1,4 × 0,5
    // 5 angenommen, 0 abgelehnt: (5+1)/(5+2) = 6/7 → 0,3 + 1,4 × 6/7 = 1,5
    expect(weightOf({ acc: 5, rej: 0, good: 0, bad: 0 })).toBeCloseTo(1.5, 12);
    // 0 angenommen, 5 abgelehnt: 1/7 → 0,3 + 0,2 = 0,5
    expect(weightOf({ acc: 0, rej: 5, good: 0, bad: 0 })).toBeCloseTo(0.5, 12);
    expect(weightOf({ acc: 0, rej: 1000, good: 0, bad: 1000 })).toBeGreaterThanOrEqual(MIN_WEIGHT);
    expect(weightOf({ acc: 1000, rej: 0, good: 1000, bad: 0 })).toBeLessThanOrEqual(MAX_WEIGHT);
  });
  it("das Live-Urteil zählt wie die Entscheidung: beide Quellen mitteln", () => {
    // Entscheidung 6/7, Live 1/7 → Mittel 0,5 → Gewicht 1,0
    expect(weightOf({ acc: 5, rej: 0, good: 0, bad: 5 })).toBeCloseTo(0.3 + 1.4 * ((6 / 7 + 1 / 7) / 2), 12);
    // nur Live-Urteile ohne Entscheidungen
    expect(weightOf({ acc: 0, rej: 0, good: 3, bad: 0 })).toBeCloseTo(0.3 + 1.4 * (4 / 5), 12);
  });
  it("Annahme / Ablehnung / Urteil zählen jede Art des Vorschlags einmal; die Eingabe bleibt unverändert", () => {
    const m0 = {};
    const m1 = recordDecision(m0, ["trail", "trail", "addTrend"], true);
    expect(m1).toEqual({ trail: { acc: 1, rej: 0, good: 0, bad: 0 }, addTrend: { acc: 1, rej: 0, good: 0, bad: 0 } });
    expect(m0).toEqual({});
    const m2 = recordDecision(m1, ["trail"], false);
    expect(m2.trail).toEqual({ acc: 1, rej: 1, good: 0, bad: 0 });
    const m3 = recordOutcome(m2, ["trail"], true);
    expect(m3.trail).toEqual({ acc: 1, rej: 1, good: 1, bad: 0 });
    const m4 = recordOutcome(m3, ["addTrend"], false);
    expect(m4.addTrend).toEqual({ acc: 1, rej: 0, good: 0, bad: 1 });
  });
  it("die Gewichte verschieben die Auswahl, ohne etwas auszuschließen", () => {
    let map = {};
    for (let i = 0; i < 8; i++) map = recordDecision(map, ["breakEven"], true);
    for (let i = 0; i < 8; i++) map = recordDecision(map, ["addVolume"], false);
    const w = weightsOf(map);
    expect(w.breakEven).toBeGreaterThan(1.4);
    expect(w.addVolume).toBeLessThan(0.6);
    expect(w.stopSize).toBe(1);
    for (const k of MUTATION_KINDS) {
      expect(w[k]).toBeGreaterThanOrEqual(MIN_WEIGHT);
      expect(w[k]).toBeLessThanOrEqual(MAX_WEIGHT);
    }
  });
});

describe("„Was habe ich gelernt?“", () => {
  const cfg = (patch: Partial<EvolveSettings>): EvolveSettings => ({ ...EMPTY_EVOLVE, ...patch });

  it("nichts passiert: leer – und das sagt die Zusammenfassung", () => {
    const s = learnedSummary(EMPTY_EVOLVE);
    expect(s.empty).toBe(true);
    expect(s.acceptRate).toBeNull();
    expect(s.live.rate).toBeNull();
    expect(s.kinds).toEqual([]);
  });

  it("unter 5 Entscheidungen und unter 3 Live-Urteilen keine Quote – nur Zahlen und der Hinweis", () => {
    const s = learnedSummary(cfg({ stats: { proposed: 5, accepted: 2, rejected: 1, confirmed: 1, below: 0, devSum: 0.5, devN: 1 }, learn: { trail: { acc: 2, rej: 1, good: 1, bad: 0 } } }));
    expect(MIN_DECISIONS).toBe(5);
    expect(s.decided).toBe(3);
    expect(s.acceptRate).toBeNull();
    expect(s.live.rate).toBeNull();
    expect(s.match.avgDevPct).toBeNull();
    expect(s.notes.join(" ")).toMatch(/Bisher 3 Entscheidungen/);
    expect(s.notes.join(" ")).toMatch(/Bisher 1 Live-Urteil /);
    // die Zeile der Art nennt Entscheidungen erst ab 3
    expect(s.kinds[0]!.note).toMatch(/von 3 Entscheidungen hast du 2 angenommen \(67 %\)/);
  });

  it("mit genug Daten: Quoten mit 80-%-Bereich, mittlere Abweichung der Vorhersage, Filter getrennt", () => {
    const s = learnedSummary(
      cfg({
        stats: { proposed: 14, accepted: 6, rejected: 4, confirmed: 3, below: 2, devSum: -7.5, devN: 5 },
        learn: { addTrend: { acc: 3, rej: 0, good: 2, bad: 1 }, trail: { acc: 3, rej: 4, good: 1, bad: 1 } },
        lineages: { a: { trials: 300, to: 1, runs: 2 }, b: { trials: 120, to: 1, runs: 1 } },
      }),
    );
    expect(s.acceptRate).toMatchObject({ k: 6, n: 10, p: 0.6 });
    expect(s.acceptRate!.ci.lo).toBeLessThan(0.6);
    expect(s.acceptRate!.ci.hi).toBeGreaterThan(0.6);
    expect(s.live.rate).toMatchObject({ k: 3, n: 5 });
    expect(s.match.avgDevPct).toBeCloseTo(-1.5, 12); // −7,5 ÷ 5 Prozentpunkte pro 30 Tage
    expect(s.filters.map((f) => f.kind)).toEqual(["addTrend"]);
    expect(s.trials).toBe(420);
    expect(s.strategies).toBe(2);
    const trend = s.kinds.find((k) => k.kind === "addTrend")!;
    expect(trend.weight).toBeGreaterThan(1);
  });
});

describe("Selbstprüfung im Vorwärtstest", () => {
  const DAY = 86_400_000;
  const exp: Expected = { avgR: 0.4, avgRCI: { lo: 0.15, hi: 0.65 }, pctPer30d: 3, n: 40, days: 100 };
  const live = (over: Partial<LiveFacts>): LiveFacts => ({ startMs: 0, asOfMs: 45 * DAY, n: 14, avgR: 0.35, avgRCI: { lo: 0, hi: 0.7 }, netPct: 0.045, ...over });

  it("zu früh: unter 21 Tagen oder unter 10 Trades gibt es kein Urteil – nur die Zahlen", () => {
    expect(MIN_LIVE_DAYS).toBe(21);
    expect(MIN_LIVE_TRADES).toBe(10);
    const a = liveCheck(exp, live({ asOfMs: 15 * DAY }));
    expect(a.level).toBe("early");
    expect(a.headline).toBe("Noch zu früh für ein Urteil");
    const b = liveCheck(exp, live({ n: 9 }));
    expect(b.level).toBe("early");
    expect(b.text).toMatch(/9 Trades/);
  });

  it("bestätigt: Ø R über der unteren Grenze des erwarteten 80-%-Bereichs und im Plus – in Prozent pro 30 Tage ausgedrückt", () => {
    const c = liveCheck(exp, live({}));
    expect(c.level).toBe("confirmed");
    expect(c.actualPct).toBeCloseTo((4.5 / 45) * 30, 12); // 3,0 % pro 30 Tage
    expect(c.expectedPct).toBe(3);
    expect(c.text).toMatch(/Erwartet \(aus den Testfenstern\): Ø \+0,40 R, \+3,0 % pro 30 Tage/);
    expect(c.text).toMatch(/Tatsächlich im Vorwärtstest \(45 Tage, 14 Trades\): Ø \+0,35 R, \+3,0 % pro 30 Tage/);
    expect(c.notes.join(" ")).toMatch(/kein Beweis/);
  });

  it("nicht bestätigt: Ø R unter der unteren Grenze; nicht eindeutig: Ø R passt, das Geld nicht", () => {
    const below = liveCheck(exp, live({ avgR: 0.05, netPct: 0.004 }));
    expect(below.level).toBe("below");
    expect(below.headline).toBe("Nicht bestätigt");
    const open = liveCheck(exp, live({ avgR: 0.3, netPct: -0.01 }));
    expect(open.level).toBe("open");
  });

  it("ohne Erwartung oder ohne Live-Ø R: nicht entscheidbar, nie geschätzt", () => {
    expect(liveCheck({ ...exp, avgR: null, avgRCI: null }, live({})).level).toBe("open");
    expect(liveCheck(exp, live({ avgR: null })).level).toBe("open");
  });

  it("die Live-Zahlen werden wie in der Suche gemessen: ohne Funding-Einnahmen, mit höchstens ±5 R je Trade", () => {
    const a0 = newAccount({ id: "f1", name: "x", config: defaultCustom(), signal: DEFAULT_SIGNAL_CFG, symbol: "BTCUSDT", capital: 10_000, riskPct: 1, maxLeverage: 5, exchange: "binance", slippage: { kind: "none" }, funding: "none", source: { kind: "editor", label: "x" } }, 0);
    const trade = (i: number, r: number, funding: number) => ({ id: `f${i}`, side: "long" as const, entryTime: i * 1000, exitTime: i * 1000 + 500, entry: 100, exit: 101, stop: 99, target: null, qty: 100, notional: 10_000, pnl: r * 100, fees: 0, funding, slippage: 0, r, move: 0.01, bars: 3, reason: "stop" as const });
    const a: ForwardAccount = { ...a0, cursor: { ...emptyCursor(), t: 3600 }, trades: [trade(1, 1, -40), trade(2, 60, 0), trade(3, -1, 0)] };
    const f = liveFactsOf(a);
    // Trade 1: 1 R − 0,4 R Funding-Einnahmen = 0,6 · Trade 2: 60 R → 5 · Trade 3: −1 → (0,6 + 5 − 1) ÷ 3
    expect(f.avgR).toBeCloseTo(4.6 / 3, 12);
    expect(f.n).toBe(accountView(a).stats.n);
    // Geld: (100 − 40) + 6000 − 100 = 5960 ÷ 10 000
    expect(f.netPct).toBeCloseTo(5960 / 10_000, 12);
  });
});

describe("settings.evolve lernt und bleibt lesbar", () => {
  it("withEvolve schreibt Lernstände und Zähler zurück, Unbekanntes bleibt", () => {
    const raw = { v: 1, future: { keep: true }, learn: {}, stats: {}, proposals: [], lineages: {}, prefs: {} };
    const next = withEvolve(raw, { learn: recordDecision({}, ["trail"], true), stats: { ...EMPTY_EVOLVE.stats, accepted: 1, proposed: 1 } });
    expect(next.future).toEqual({ keep: true });
    const back = evolveCfgOf(next);
    expect(back.learn.trail).toEqual({ acc: 1, rej: 0, good: 0, bad: 0 });
    expect(back.stats.accepted).toBe(1);
  });
});
