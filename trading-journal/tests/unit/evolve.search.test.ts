/**
 * Optimiser – the search: deterministic for a seed (however the work is sliced), the current version is trial 0, no peeking at the
 * confirmation window, several strategies independent of each other but corrected together, an honest outcome on pure chance
 * and on a real edge (synthetic markets with a known truth), a clean failure for unusable input.
 */
import { describe, expect, it, vi } from "vitest";
import { customStrategy } from "@/domain/backtest/strategies/custom";
import { Evaluator, EvolveMulti, freedomOf, LIGHT_KINDS, MUTATION_KINDS, signalKey, type LogEntry, type MultiResult } from "@/domain/evolve";
import { customKey, defaultCustom, newGroup, newLeaf, sanitizeCustom, validateCustom } from "@/domain/lab";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";
import { baseRules, D1, DATA, drive, ENGINE, FROM_MS, H4, multiInput, path, pathInput, strategy } from "./evolve.helpers";

const keys = (es: LogEntry[]): string[] => es.map((e) => `${e.sid}#${e.i}:${e.via}:${e.key}:${e.score == null ? "–" : e.score.toFixed(9)}:${e.n}`);

/** Runs to the end and returns every log entry and the result. */
function run(input: ConstructorParameters<typeof EvolveMulti>[0], sliceMs = 50): { entries: LogEntry[]; result: MultiResult; m: EvolveMulti } {
  const m = new EvolveMulti(input);
  const entries: LogEntry[] = [];
  const stop = performance.now() + 120_000;
  while (!m.step(performance.now() + sliceMs)) {
    entries.push(...m.drainEntries());
    if (performance.now() > stop) throw new Error("run did not finish");
  }
  entries.push(...m.drainEntries());
  return { entries, result: m.result()!, m };
}

describe("ein Lauf auf den echten BTC-Kerzen", { timeout: 120_000 }, () => {
  const a = run(multiInput({}, [strategy("s1", { maxTrials: 60 })]));

  it("Versuch 0 ist die jetzige Version; danach genau so viele Versuche wie das Budget; kein Versuch zweimal", () => {
    const own = a.entries.filter((e) => e.via === "baseline");
    expect(own).toHaveLength(1);
    expect(own[0]!.i).toBe(0);
    expect(own[0]!.key).toBe(customKey(baseRules()));
    const search = a.entries.filter((e) => e.via === "mutation" || e.via === "restart");
    expect(search).toHaveLength(60);
    expect(new Set(search.map((e) => e.key)).size).toBe(60);
    expect(search.map((e) => e.i)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(a.result.strategies[0]!.trials).toBe(60);
    expect(a.result.strategies[0]!.reason).toBe("budget");
  });

  it("jeder Eintrag hat Score oder den Grund, Satz, Seed und die Art der Änderung", () => {
    const seed = a.entries[0]!.seed;
    for (const e of a.entries) {
      expect(e.sid).toBe("s1");
      expect(e.seed).toBe(seed);
      expect(e.text.length).toBeGreaterThan(8);
      expect(e.n).toBeGreaterThanOrEqual(0);
      if (e.via === "mutation" || e.via === "restart") expect(e.kinds.length).toBeGreaterThan(0);
      if (e.score == null) expect(e.n).toBeLessThan(15); // ohne Score nur wegen zu weniger Trades
    }
  });

  it("derselbe Seed gibt dieselben Versuche – egal wie die Arbeit in Zeitscheiben zerlegt wird", () => {
    const tiny = run(multiInput({}, [strategy("s1", { maxTrials: 60 })]), 0.2);
    const big = run(multiInput({}, [strategy("s1", { maxTrials: 60 })]), 5_000);
    expect(keys(tiny.entries)).toEqual(keys(a.entries));
    expect(keys(big.entries)).toEqual(keys(a.entries));
    expect(tiny.result.strategies[0]!.proposals.map((p) => p.key)).toEqual(a.result.strategies[0]!.proposals.map((p) => p.key));
  });

  it("ein anderer Seed probiert andere Varianten", () => {
    const b = run(multiInput({ seed: 999 }, [strategy("s1", { maxTrials: 60 })]));
    expect(keys(b.entries)).not.toEqual(keys(a.entries));
    const shared = b.entries.filter((e) => a.entries.some((x) => x.key === e.key)).length;
    expect(shared).toBeLessThan(40);
  });

  it("die Fenster folgen aufeinander ohne Überlappung; das Bestätigungsfenster steht ganz am Ende", () => {
    const w = a.m.snapshot().strategies[0]!.windows!;
    expect(w.train.to).toBeLessThanOrEqual(w.tests[0]!.from);
    for (let i = 1; i < w.tests.length; i++) expect(w.tests[i]!.from).toBeGreaterThanOrEqual(w.tests[i - 1]!.to);
    expect(w.holdout.from).toBeGreaterThanOrEqual(w.tests.at(-1)!.to);
    expect(w.holdout.to).toBe((H4.at(-1)!.t + 14_400) * 1000);
    expect(w.train.from).toBeGreaterThanOrEqual(FROM_MS);
  });

  it("das Bestätigungsfenster beeinflusst keinen Versuch: andere Kerzen dort ändern kein Protokoll, nur dessen Zahlen", () => {
    const w = a.m.snapshot().strategies[0]!.windows!;
    const cut = H4.findIndex((b) => b.t * 1000 >= w.holdout.from);
    // ab dem Bestätigungsfenster ein ganz anderer Markt (Crash, dann Spitze)
    const crashed = H4.map((b, i) => (i < cut ? b : { ...b, o: b.o * 0.5, h: b.h * (i % 2 ? 0.6 : 0.5), l: b.l * 0.4, c: b.c * (i % 3 ? 0.4 : 0.6) }));
    const dailyCut = D1.findIndex((b) => b.t * 1000 >= w.holdout.from);
    const d1 = D1.map((b, i) => (i < dailyCut ? b : { ...b, c: b.c * 0.5, h: b.h * 0.5, l: b.l * 0.4, o: b.o * 0.5 }));
    const b = run(multiInput({ datasets: { btc: { "4h": crashed, "1d": d1 } } }, [strategy("s1", { maxTrials: 60 })]));
    expect(keys(b.entries)).toEqual(keys(a.entries));
    // gesehen wird das Fenster nur von den Finalisten – ihre Bestätigungs-Zahlen sind dann andere
    const pa = a.result.strategies[0]!.proposals;
    const pb = b.result.strategies[0]!.proposals;
    if (pa.length && pb.length && pa[0]!.holdout && pb[0]!.holdout) expect(pb[0]!.holdout.cand.sumR).not.toBe(pa[0]!.holdout.cand.sumR);
  });

  it("Turnier: die jetzige Version steht als Referenz in der Liste, Ränge nur mit genug Trades", () => {
    const rows = a.result.tournament;
    expect(rows.some((r) => r.label === "Jetzige Version" && r.p == null)).toBe(true);
    for (const r of rows) {
      if (r.n < 5) expect(r.rankValue).toBeNull();
      else expect(r.rankValue).not.toBeNull();
    }
    const ranked = rows.filter((r) => r.rankValue != null).map((r) => r.rankValue!);
    expect(ranked).toEqual([...ranked].sort((x, y) => y - x));
  });
});

describe("mehrere Strategien", { timeout: 120_000 }, () => {
  const two = [strategy("alpha", { maxTrials: 40 }), strategy("beta", { maxTrials: 40, base: sanitizeCustom({ ...baseRules(), long: newGroup("g1", "and", [{ ...newLeaf("n1", "rsi"), params: { len: 10, mode: "below", level: 35, within: 1 } }]) }) })];

  it("jede Strategie hat ihren eigenen Seed und ihre eigene Bestenliste – ihre Versuche hängen nicht von den anderen ab", () => {
    const alone = run(multiInput({}, [two[0]!]));
    const both = run(multiInput({}, two));
    const only = (es: LogEntry[], sid: string): LogEntry[] => es.filter((e) => e.sid === sid);
    expect(keys(only(both.entries, "alpha"))).toEqual(keys(alone.entries));
    expect(only(both.entries, "beta").length).toBeGreaterThan(40);
    expect(only(both.entries, "alpha")[0]!.seed).not.toBe(only(both.entries, "beta")[0]!.seed);
    expect(both.m.snapshot().strategies.map((s) => s.id)).toEqual(["alpha", "beta"]);
  });

  it("die Mehrfachtest-Korrektur zählt ALLE Varianten ALLER Strategien (und frühere Versuche)", () => {
    const both = run(multiInput({}, [{ ...two[0]!, priorTrials: 100 }, { ...two[1]!, priorTrials: 50 }]));
    for (const s of both.result.strategies) {
      for (const p of s.proposals) {
        expect(p.overfit.trialsRun).toBe(80);
        expect(p.overfit.trialsPrior).toBe(150);
        expect(p.overfit.strategiesInRun).toBe(2);
        expect(p.overfit.p).toBeGreaterThanOrEqual(p.overfit.pRun);
      }
    }
    expect(both.result.trialsRun).toBe(80);
    expect(both.result.trialsPrior).toBe(150);
  });

  it("zusammen gerechnet ist die Hürde höher als allein (mehr Varianten → höherer p-Wert desselben Vorschlags)", () => {
    // gleiche Zufallszüge des Bootstraps, mehr Kandidaten → das Maximum kann nur größer werden
    const bars = path(5000, 4, 0.12);
    const solo = run(pathInput(bars, 7, 150));
    const pair = run({ ...pathInput(bars, 7, 150), strategies: [...pathInput(bars, 7, 150).strategies, { ...pathInput(bars, 7, 150).strategies[0]!, id: "t", name: "Zweite" }] });
    const sp = solo.result.strategies[0]!.proposals;
    const pp = pair.result.strategies.find((s) => s.id === "s")!.proposals;
    expect(sp.length).toBeGreaterThan(0);
    for (const p of sp) {
      const same = pp.find((q) => q.key === p.key);
      if (same) expect(same.overfit.pRun).toBeGreaterThanOrEqual(p.overfit.pRun);
    }
  });

  it("eine unbrauchbare Strategie scheitert mit Grund, die anderen laufen weiter", () => {
    const empty = sanitizeCustom({ ...defaultCustom(), long: newGroup("g1", "and", []) });
    const r = run(multiInput({}, [strategy("ok", { maxTrials: 20 }), strategy("kaputt", { base: empty })]));
    const bad = r.result.strategies.find((s) => s.id === "kaputt")!;
    expect(bad.reason).toBe("failed");
    expect(bad.error).toMatch(/Die Regeln lassen sich so nicht testen/);
    expect(r.result.strategies.find((s) => s.id === "ok")!.trials).toBe(20);
    expect(r.m.snapshot().strategies.find((s) => s.id === "kaputt")!.phase).toBe("failed");
  });

  it("zu wenige Kerzen für die Fenster: klare Meldung statt gequetschter Fenster", () => {
    const short = H4.slice(0, 380);
    const r = run(multiInput({ datasets: { btc: { "4h": short, "1d": D1 } } }, [strategy("s1")]));
    expect(r.result.strategies[0]!.error).toMatch(/Zu wenige Kerzen/);
  });
});

describe("Beenden", { timeout: 120_000 }, () => {
  it("Stopp beendet die Suche nach dem laufenden Versuch, wertet die Finalisten aber noch aus", () => {
    const m = new EvolveMulti(multiInput({}, [strategy("s1", { maxTrials: 400 })]));
    // ein paar Scheiben, dann Stopp
    for (let i = 0; i < 6; i++) m.step(performance.now() + 10);
    const before = m.snapshot().strategies[0]!.trials;
    expect(before).toBeLessThan(400);
    m.requestStop();
    drive(m);
    const s = m.result()!.strategies[0]!;
    expect(s.reason).toBe("stopped");
    expect(s.trials).toBeLessThan(400);
    expect(s.trials).toBeGreaterThanOrEqual(before);
    expect(m.result()!.tournament.length).toBeGreaterThan(0);
  });

  it("Stagnation beendet die Suche als „converged“", () => {
    const r = run(multiInput({ opts: { boot: 100, stagnation: 12 } }, [strategy("s1", { maxTrials: 400 })]));
    expect(r.result.strategies[0]!.reason).toBe("converged");
    expect(r.result.strategies[0]!.trials).toBeLessThan(400);
  });
});

describe("gelernte Gewichte lenken die Suche", { timeout: 120_000 }, () => {
  it("eine Art mit hohem Gewicht wird deutlich öfter ausprobiert als bei neutralen Gewichten", () => {
    const share = (w?: Partial<Record<(typeof MUTATION_KINDS)[number], number>>): number => {
      const r = run(multiInput({}, [strategy("s1", { maxTrials: 150, weights: w })]));
      const search = r.entries.filter((e) => e.via === "mutation" || e.via === "restart");
      return search.filter((e) => e.kinds.includes("trail")).length / search.length;
    };
    const neutral = share();
    const liked = share({ ...Object.fromEntries(MUTATION_KINDS.map((k) => [k, 0.3])), trail: 1.7 });
    expect(liked).toBeGreaterThan(neutral);
  });
});

describe("rechenintensive Regeln werden nur im Ausstieg verändert", { timeout: 120_000 }, () => {
  it("MCB-Leiter in den Regeln → nur leichte Arten, mit Hinweis", () => {
    const heavy = sanitizeCustom({ ...defaultCustom(), interval: "4h", long: newGroup("g1", "and", [newLeaf("n1", "mcbLadder"), { ...newLeaf("n2", "rsi"), params: { len: 14, mode: "below", level: 60, within: 1 } }]) });
    expect(validateCustom(heavy).filter((i) => i.level === "error")).toEqual([]);
    const m = new EvolveMulti(multiInput({}, [strategy("h", { base: heavy, maxTrials: 12 })]));
    expect(m.snapshot().strategies[0]!.notes[0]).toMatch(/rechenintensiven Baustein/);
  });
});

describe("Auswerte-Cache", () => {
  it("eine Variante, die nur den Stop ändert, rechnet die Signale nicht neu", () => {
    const spy = vi.spyOn(customStrategy, "prepare");
    const ev = new Evaluator({ data: DATA, signal: DEFAULT_SIGNAL_CFG, funding: null, fromMs: FROM_MS, engine: ENGINE, opts: { folds: 4, sub: 6, trainFrac: 0.3, holdoutFrac: 0.2, elite: 6, restartP: 0.1, stagnation: 120, proposals: 3, boot: 100, neighbors: 12, minGain: 0.25 } });
    const base = baseRules();
    ev.prepare(base).result();
    expect(spy).toHaveBeenCalledTimes(1);
    const otherStop = sanitizeCustom({ ...base, stop: { ...base.stop, atr: 2.25 } });
    expect(signalKey(otherStop)).toBe(signalKey(base));
    const prep = ev.prepare(otherStop);
    expect(prep.step(performance.now() - 1)).toBe(true); // sofort fertig, kein neuer Lauf
    expect(spy).toHaveBeenCalledTimes(1);
    // die Fakten tragen die NEUE Konfiguration: ein anderer Stop gibt andere Trades
    const win = ev.setWindows(ev.prepare(base).result());
    expect(win.ok).toBe(true);
    const e1 = ev.evaluate(ev.prepare(base).result(), base, freedomOf(base).total);
    const e2 = ev.evaluate(prep.result(), otherStop, freedomOf(base).total);
    expect(e2.ev.key).not.toBe(e1.ev.key);
    expect(JSON.stringify(e2.blocks)).not.toBe(JSON.stringify(e1.blocks));
    // eine andere Regel dagegen rechnet neu
    const otherRule = sanitizeCustom({ ...base, long: newGroup("g1", "and", [{ ...newLeaf("n1", "rsi"), params: { len: 14, mode: "below", level: 50, within: 1 } }]) });
    ev.prepare(otherRule).result();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
    expect(LIGHT_KINDS.length).toBeGreaterThan(0);
  });
});

describe("Wahrheit bekannt: Zufall gegen echte Kante (synthetische Märkte, feste Seeds)", { timeout: 240_000 }, () => {
  const prop = (kappa: number, ds: number) => run(pathInput(path(5000, ds * 31, kappa), 7, 300)).result.strategies[0]!;

  it("rückkehrende Märkte (echte Kante für „kaufen nach dem Fall“): Vorschläge mit kleiner Zufalls-Wahrscheinlichkeit, im Bestätigungsfenster bestätigt", () => {
    for (const ds of [1, 2]) {
      const s = prop(0.12, ds);
      expect(s.proposals.length, `Datensatz ${ds}`).toBeGreaterThan(0);
      const best = s.proposals[0]!;
      expect(best.overfit.p, `Datensatz ${ds}`).toBeLessThan(0.1);
      expect(best.test.cand.avgR!).toBeGreaterThan(best.test.base.avgR! + 0.5);
      expect(best.holdout!.cand.avgR!).toBeGreaterThan(0);
      expect(best.overfit.floor).toBeNull();
    }
  });

  it("reiner Zufall (Random Walk): einzeln wirken die Besten „signifikant“, nach allen Versuchen und dem Bestätigungsfenster nicht", () => {
    let seen = 0;
    for (const ds of [2, 4, 5]) {
      const s = prop(0, ds);
      seen += s.proposals.length;
      for (const p of s.proposals) {
        expect(p.overfit.pNaive!, `Datensatz ${ds}`).toBeLessThan(0.1); // ohne Korrektur sähe es gut aus …
        expect(p.overfit.p, `Datensatz ${ds}`).toBeGreaterThan(0.1); // … mit Korrektur nicht
        expect(p.warnings.length).toBeGreaterThan(0);
      }
    }
    expect(seen).toBeGreaterThan(0); // der Test prüft etwas
  });

  it("fällt ein Vorschlag im Bestätigungsfenster durch, kann seine Wahrscheinlichkeit nicht klein sein", () => {
    let failed = 0;
    for (const ds of [1, 6]) {
      const s = prop(0, ds);
      for (const p of s.proposals) {
        const h = p.holdout;
        if (h && h.cand.n >= 5 && (h.cand.avgR ?? 0) < 0) {
          failed++;
          expect(p.overfit.p).toBeGreaterThanOrEqual(0.5);
          expect(p.overfit.floor).toBe(0.5);
        }
      }
    }
    expect(failed).toBeGreaterThan(0); // der Test prüft etwas
  });
});
