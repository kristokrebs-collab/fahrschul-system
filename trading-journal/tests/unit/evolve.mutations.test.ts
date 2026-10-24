/**
 * Optimiser – the search space: every mutation of every kind yields a VALID rule set (sanitised, no error of the check), differs
 * from its parent, and comes with one plain-language sentence; the degrees of freedom are counted by hand.
 */
import { describe, expect, it } from "vitest";
import { rng } from "@/domain/analytics/stats";
import { allowedKinds, freedomOf, LIGHT_KINDS, lightOnly, mutate, mutateChain, mutateWeighted, MUTATION_KINDS, type MutationCtx, type MutationKind } from "@/domain/evolve";
import { CUSTOM_TEMPLATES, customKey, defaultCustom, leavesOf, mirrorGroup, newGroup, newLeaf, sanitizeCustom, validateCustom, type CustomConfig } from "@/domain/lab";
import { baseRules } from "./evolve.helpers";

const ctx = (seed: number, over: Partial<MutationCtx> = {}): MutationCtx => ({ rng: rng(seed), hasVolume: true, tfs: new Set(["15m", "1h", "4h", "1d"] as const), funding: false, ...over });

/** A rich rule set: both sides, a time stop, break-even, trailing, partial target – so every exit kind has something to move. */
function rich(): CustomConfig {
  const c = sanitizeCustom({
    ...CUSTOM_TEMPLATES[1]!.build(),
    exits: { breakEven: { on: true, trigger: "r", value: 1, to: "entry" }, trail: { on: true, kind: "atr", value: 2, activateR: 1 }, partial: { on: true, atR: 1, fracPct: 50, thenBreakEven: true }, maxBars: 40, exitOnOpposite: true },
    target: { kind: "r", r: 3 },
  });
  return c;
}

const BASES: [string, CustomConfig][] = [
  ["Standard", defaultCustom()],
  ["Test-Idee", baseRules()],
  ["Vorlage 1", CUSTOM_TEMPLATES[0]!.build()],
  ["Vorlage 2 (beide Seiten)", CUSTOM_TEMPLATES[1]!.build()],
  ["Vorlage 3 (ohne Ziel)", CUSTOM_TEMPLATES[2]!.build()],
  ["Vorlage 4", CUSTOM_TEMPLATES[3]!.build()],
  ["reich", rich()],
];

describe("jede Mutation ist ein gültiger Regelsatz", () => {
  for (const kind of MUTATION_KINDS) {
    it(`${kind}: gültig, verändert, ein Satz Erklärung`, () => {
      let produced = 0;
      for (const [name, base] of BASES) {
        for (let seed = 1; seed <= 25; seed++) {
          const m = mutate(base, kind, ctx(seed * 7919));
          if (!m) continue;
          produced++;
          // gültig: keine Fehler der Prüfung, bereinigt (nochmal bereinigen ändert nichts)
          expect(validateCustom(m.config).filter((i) => i.level === "error"), `${name} · ${kind} · ${seed}`).toEqual([]);
          expect(customKey(sanitizeCustom(m.config)), `${name} · ${kind}`).toBe(customKey(m.config));
          // verändert
          expect(customKey(m.config), `${name} · ${kind}: unverändert`).not.toBe(customKey(base));
          // ein Satz: nicht leer, endet mit Punkt, nennt die Art
          expect(m.steps).toHaveLength(1);
          expect(m.steps[0]!.kind).toBe(kind);
          expect(m.steps[0]!.text.length).toBeGreaterThan(12);
          expect(m.steps[0]!.text, `${name} · ${kind}`).toMatch(/[.“]$/);
        }
      }
      // jede Art ist auf mindestens einer der Grundlagen anwendbar
      expect(produced, `${kind} lässt sich nirgends anwenden`).toBeGreaterThan(0);
    });
  }

  it("die Eingabe wird nie verändert", () => {
    const base = rich();
    const before = JSON.stringify(base);
    for (const k of MUTATION_KINDS) for (let s = 1; s < 8; s++) mutate(base, k, ctx(s));
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("konkrete Schritte, von Hand geprüft", () => {
  it("Stop-Abstand: ATR 1,5 → ein Schritt von 0,25 oder 0,5", () => {
    const seen = new Set<number>();
    for (let s = 1; s < 40; s++) {
      const m = mutate(baseRules(), "stopSize", ctx(s))!;
      seen.add(m.config.stop.atr);
      expect(m.steps[0]!.text).toMatch(/^Der Stop wurde von 1,5 × ATR\(14\) auf [\d,]+ × ATR\(14\) geändert\.$/);
    }
    expect([...seen].sort()).toEqual([1, 1.25, 1.75, 2]);
  });

  it("Break-even einführen: nur vor dem Ziel, Text nennt Punkt und Ziel des Stops", () => {
    for (let s = 1; s < 30; s++) {
      const m = mutate(baseRules(), "breakEven", ctx(s))!;
      expect(m.config.exits.breakEven.on).toBe(true);
      expect(m.config.exits.breakEven.value).toBeLessThan(m.config.target.r);
      expect(m.steps[0]!.text).toMatch(/^Break-even wurde eingeführt: nach \+[\d,]+ R rutscht der Stop auf (den Einstieg|den Netto-Break-even)\.$/);
    }
  });

  it("Filter hinzufügen bei beiden Seiten: gespiegelt, beide Seiten bekommen einen", () => {
    const long = newGroup("g1", "and", [{ ...newLeaf("n1", "rsi"), params: { len: 14, mode: "below", level: 30, within: 1 } }]);
    const base = sanitizeCustom({ ...defaultCustom(), interval: "1h", sides: "both", long, short: mirrorGroup(long, "g2", 3) }); // beide Seiten, 1h, noch ohne Trend-Filter
    const m = mutate(base, "addTrend", ctx(3))!;
    expect(leavesOf(m.config.long).length).toBe(leavesOf(base.long).length + 1);
    expect(leavesOf(m.config.short).length).toBe(leavesOf(base.short).length + 1);
    const l = leavesOf(m.config.long).at(-1)!;
    const s = leavesOf(m.config.short).at(-1)!;
    expect(l.block).toBe("maPrice");
    expect(l.params.mode).toBe("above");
    expect(s.params.mode).toBe("below"); // gespiegelt
    expect(l.tf).toBe("4h"); // die nächstgrößere Zeiteinheit zu 1h
    expect(m.steps[0]!.text).toMatch(/^Filter hinzugefügt – Long: „Schluss über EMA \d+ \[4h\]“, Short: „Schluss unter EMA \d+ \[4h\]“\.$/);
  });

  it("Trend-Filter nur mit geladener Zeiteinheit; sonst wird nichts erfunden", () => {
    expect(mutate(baseRules(), "addTrend", ctx(1, { tfs: new Set(["4h"] as const) }))).toBeNull(); // 1d fehlt, Regeln haben schon einen Trend-Filter
    expect(mutate(CUSTOM_TEMPLATES[2]!.build(), "addTrend", ctx(1, { tfs: new Set(["1h"] as const) }))).toBeNull();
  });

  it("Volumen-Filter nur, wenn die Kerzen Volumen haben", () => {
    expect(mutate(baseRules(), "addVolume", ctx(1, { hasVolume: false }))).toBeNull();
    expect(mutate(baseRules(), "addVolume", ctx(1))).not.toBeNull();
  });

  it("Richtung: von beiden auf eine Seite und zurück (gespiegelt)", () => {
    const both = CUSTOM_TEMPLATES[1]!.build();
    const one = mutate(both, "sides", ctx(5))!;
    expect(["long", "short"]).toContain(one.config.sides);
    expect(one.config.exits.exitOnOpposite).toBe(false);
    const back = mutate(one.config, "sides", ctx(5))!;
    expect(back.config.sides).toBe("both");
    expect(leavesOf(back.config.long).length).toBeGreaterThan(0);
    expect(leavesOf(back.config.short).length).toBeGreaterThan(0);
  });

  it("Filter entfernen: nie die letzte Bedingung einer Seite", () => {
    const single = sanitizeCustom({ ...defaultCustom(), long: newGroup("g1", "and", [newLeaf("n1", "rsi")]) });
    expect(mutate(single, "dropFilter", ctx(1))).toBeNull();
    const two = baseRules();
    const m = mutate(two, "dropFilter", ctx(1))!;
    expect(leavesOf(m.config.long)).toHaveLength(1);
    expect(m.steps[0]!.text).toMatch(/^Die Bedingung „.+“ wurde entfernt\.$/);
  });

  it("Schwelle verschieben: nur Zahlen mit Kommastellen; Länge: nur ganze Zahlen", () => {
    for (let s = 1; s < 30; s++) {
      const a = mutate(baseRules(), "ruleLevel", ctx(s))!;
      expect(a.steps[0]!.text).toMatch(/„RSI\(14\) unter 45“ wurde zu „RSI\(14\) unter \d+“\./);
      const b = mutate(baseRules(), "ruleLength", ctx(s))!;
      for (const l of leavesOf(b.config.long)) for (const v of Object.values(l.params)) if (typeof v === "number") expect(Number.isInteger(v) || v === 45).toBe(true);
    }
  });
});

describe("rechenintensive Regeln: nur die Ausstiege", () => {
  const heavy = sanitizeCustom({ ...defaultCustom(), interval: "4h", long: newGroup("g1", "and", [newLeaf("n1", "mcbLadder")]) });
  it("erkennt den Baustein und erlaubt nur leichte Arten", () => {
    expect(lightOnly(heavy)).toBe(true);
    expect(lightOnly(baseRules())).toBe(false);
    expect(allowedKinds(heavy)).toEqual(LIGHT_KINDS);
    expect(allowedKinds(baseRules())).toEqual(MUTATION_KINDS);
  });
  it("jede gewichtete Mutation ändert nur Stop / Ziel / Ausstieg, nie die Regeln", () => {
    for (let s = 1; s < 60; s++) {
      const m = mutateWeighted(heavy, ctx(s))!;
      expect(m).not.toBeNull();
      expect(LIGHT_KINDS).toContain(m.steps[0]!.kind);
      expect(JSON.stringify(m.config.long)).toBe(JSON.stringify(heavy.long));
    }
  });
});

describe("gewichtete Auswahl und Ketten", () => {
  it("ein höheres Gewicht zieht die Art öfter; ein Mindestgewicht schließt keine aus", () => {
    const count = (w: Partial<Record<MutationKind, number>>): number => {
      let n = 0;
      for (let s = 1; s <= 300; s++) if (mutateWeighted(rich(), ctx(s), w)!.steps[0]!.kind === "trail") n++;
      return n;
    };
    const neutral = count({});
    const liked = count({ trail: 1.7, ruleLevel: 0.3 });
    const disliked = count({ trail: 0.3 });
    expect(liked).toBeGreaterThan(neutral);
    expect(disliked).toBeLessThan(neutral);
    expect(disliked).toBeGreaterThan(0);
  });
  it("eine Kette macht mehrere Schritte, jeder mit Satz, das Ergebnis ist gültig", () => {
    for (let s = 1; s < 30; s++) {
      const m = mutateChain(rich(), 3, ctx(s))!;
      expect(m.steps.length).toBeGreaterThanOrEqual(1);
      expect(m.steps.length).toBeLessThanOrEqual(3);
      expect(validateCustom(m.config).filter((i) => i.level === "error")).toEqual([]);
    }
  });
  it("gleicher Seed, gleiche Schritte", () => {
    const a = mutateChain(rich(), 3, ctx(99))!;
    const b = mutateChain(rich(), 3, ctx(99))!;
    expect(a.steps).toEqual(b.steps);
    expect(customKey(a.config)).toBe(customKey(b.config));
  });
});

describe("Freiheitsgrade", () => {
  it("von Hand gezählt: RSI(len, level) + SMA(len) + Stop + Ziel = 7", () => {
    // Bedingung 1 + len + level (mode ist eine Auswahl, within gilt nur beim Kreuzen) = 3 · Bedingung 1 + len = 2 · Stop 1 · Ziel 1
    const f = freedomOf(baseRules());
    expect(f).toEqual({ total: 7, rules: 5, exits: 2 });
  });
  it("Ausstiege zählen ihre Zahlen: Break-even 1, Trailing 2, Teilgewinn 2, Zeit-Stop 1, Gegensignal 1", () => {
    const base = freedomOf(baseRules()).total;
    const e = (patch: object) => freedomOf(sanitizeCustom({ ...baseRules(), exits: { ...baseRules().exits, ...patch } })).total - base;
    expect(e({ breakEven: { on: true, trigger: "r", value: 1, to: "entry" } })).toBe(1);
    expect(e({ trail: { on: true, kind: "atr", value: 2, activateR: 1 } })).toBe(2);
    expect(e({ partial: { on: true, atR: 1, fracPct: 50, thenBreakEven: true } })).toBe(2);
    expect(e({ maxBars: 30 })).toBe(1);
    expect(e({ exitOnOpposite: true })).toBe(1);
  });
  it("ein Filter mehr = mindestens eine Stellschraube mehr; die inaktive Seite zählt nicht", () => {
    const base = baseRules();
    const withFilter = mutate(base, "addVolatility", ctx(2))!.config;
    expect(freedomOf(withFilter).total).toBeGreaterThan(freedomOf(base).total);
    // nur Long: die (ungenutzte) Short-Gruppe zählt nicht mit
    expect(freedomOf({ ...base, short: newGroup("g2", "and", [newLeaf("n9", "macd"), newLeaf("n10", "adx")]) }).total).toBe(freedomOf(base).total);
  });
  it("ein Preis-Niveau ist eine Entscheidung, keine Stellschraube", () => {
    const withLevel = sanitizeCustom({ ...baseRules(), long: newGroup("g1", "and", [{ ...newLeaf("n1", "keyLevel"), params: { level: 65_000, mode: "closeAbove", n: 2, lookback: 20, tol: 0.2, within: 1 } }]) });
    expect(freedomOf(withLevel).rules).toBe(1); // nur die Bedingung selbst; mode ist eine Auswahl, n / lookback / tol gelten nicht für closeAbove
  });
});
