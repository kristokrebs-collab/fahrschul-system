/**
 * F73 – the lab strategy "Eigene Idee": signals are NEW transitions of the rule tree, AND vs OR, nesting, unknown handling,
 * a higher timeframe without look-ahead, long and short, stops / targets / management, exit on a counter signal,
 * determinism, the rule funnel and the comparison variants – plus the whole job on REAL BTCUSDT 4h + 1D bars.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  completeParams,
  createLabJob,
  customStrategy,
  DEFAULT_FEES,
  paramGrid,
  runBacktest,
  strategyOf,
  type Bar,
  type BtStrategy,
  type CustomCfgIn,
  type CustomFacts,
  type EngineCfg,
  type LabJobInput,
  type Prepared,
} from "@/domain/backtest/index";
import { defaultParams, sanitizeParams } from "@/domain/lab/rules/blocks";
import { combineTree, defaultCustom, newGroup, newLeaf, sanitizeCustom } from "@/domain/lab/rules/tree";
import { TRUE, type CustomConfig, type Group, type Leaf, type LeafParams } from "@/domain/lab/rules/types";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";

const read = (n: string): Bar[] => (JSON.parse(readFileSync(`tests/unit/fixtures/${n}`, "utf8")) as { bars: number[][] }).bars.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));
const H4 = read("binance-btcusdt-4h.json");
const D1 = read("binance-btcusdt-1d.json");
const SEC4 = 14_400;

const engine: EngineCfg = { capital: 10_000, riskPct: 0.01, maxLeverage: 5, compounding: true, costs: { fees: DEFAULT_FEES, slippage: { kind: "fixed", bps: 2 }, funding: { kind: "none" } } };

const leaf = (id: string, block: Leaf["block"], params: LeafParams = {}, tf: Leaf["tf"] = "exec", not = false): Leaf => ({ ...newLeaf(id, block, tf), params: sanitizeParams(block, { ...defaultParams(block), ...params }), ...(not ? { not: true } : {}) });
const cfgOf = (long: Group, over: Partial<CustomConfig> = {}): CustomConfig => ({ ...sanitizeCustom({ ...defaultCustom(), ...over }), long, ...over });
const input = (config: CustomConfig): CustomCfgIn => ({ config: sanitizeCustom(config), signal: DEFAULT_SIGNAL_CFG });
const prepare = (config: CustomConfig, data = { "4h": H4 } as Record<string, Bar[]>, startMs = H4[300]!.t * 1000): Prepared<CustomFacts> => customStrategy.prepare(data, input(config), startMs).result();
const signals = (s: BtStrategy, from: number, to: number) => Array.from({ length: to - from }, (_, k) => from + k).flatMap((i) => {
  const sig = s.signalAt(i);
  return sig ? [{ i, sig }] : [];
});
const trues = (s: Uint8Array | null | undefined): number => [...(s ?? [])].filter((v) => v === TRUE).length;

describe("Eigene Idee: Signale sind NEUE Übergänge", () => {
  const cfg = cfgOf(newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level: 45 })]));
  const prep = prepare(cfg);
  const strat = customStrategy.build(prep, {});

  it("ein Signal nur dort, wo die Regel jetzt gilt und an der Kerze davor nicht", () => {
    const hit = prep.facts.long!.hit!;
    const sigs = signals(strat, prep.start, prep.bars.length - 1);
    expect(sigs.length).toBeGreaterThan(5);
    for (const { i, sig } of sigs) {
      expect(hit[i]).toBe(TRUE);
      expect(hit[i - 1]).not.toBe(TRUE);
      expect(sig.side).toBe("long");
      expect(sig.stop).toBeLessThan(prep.bars[i]!.c);
      expect(sig.target!).toBeGreaterThan(prep.bars[i]!.c);
    }
    // the state holds on many more bars than there are new signals
    expect(trues(hit)).toBeGreaterThan(sigs.length);
  });

  it("sieht in Kerze i nur Kerzen bis i (Facts mit abgeschnittener Historie)", () => {
    const full = prep.facts.long!.hit!;
    for (const i of [700, 1000, 1400]) {
      const cut = prepare(cfg, { "4h": H4.slice(0, i + 1) });
      expect(cut.facts.long!.hit![i]).toBe(full[i]);
      expect(cut.facts.long!.hit![i - 1]).toBe(full[i - 1]);
    }
  });
});

describe("AND, OR und Verschachtelung", () => {
  const a = leaf("n1", "rsi", { mode: "below", level: 45 });
  const b = leaf("n2", "maPrice", { type: "sma", len: 20, mode: "above" });
  const c = leaf("n3", "volume");
  const hitsOf = (g: Group) => prepare(cfgOf(g)).facts.long!.hit!;

  it("AND ⊆ A ⊆ OR – und genau die Kleene-Tabelle der Blattreihen", () => {
    const and = hitsOf(newGroup("g1", "and", [a, b]));
    const or = hitsOf(newGroup("g1", "or", [a, b]));
    const pa = prepare(cfgOf(newGroup("g1", "and", [a, b])));
    const sa = pa.facts.leaves.get("n1")!;
    const sb = pa.facts.leaves.get("n2")!;
    for (let i = 0; i < and.length; i++) {
      if (and[i] === TRUE) {
        expect(or[i]).toBe(TRUE);
        expect(sa[i]).toBe(TRUE);
        expect(sb[i]).toBe(TRUE);
      }
      expect(or[i] === TRUE).toBe(sa[i] === TRUE || sb[i] === TRUE);
    }
    expect(trues(or)).toBeGreaterThan(trues(and));
    expect(trues(and)).toBeGreaterThan(0);
  });

  it("verschachtelt: a UND (b ODER c) – Volumen fehlt in den Daten, c bleibt unbekannt und trägt nichts bei", () => {
    const nested = hitsOf(newGroup("g1", "and", [a, newGroup("g9", "or", [b, c])]));
    const flat = hitsOf(newGroup("g1", "and", [a, b]));
    // the real fixture has no volume: c is unknown everywhere, (b OR unknown) = b when b is true, else unknown/false
    for (let i = 0; i < nested.length; i++) if (nested[i] === TRUE) expect(flat[i]).toBe(TRUE);
    expect(trues(nested)).toBe(trues(flat));
  });

  it("unbekannt erfüllt nie: eine MCB-Leiter ohne Daten blockiert AND, lässt OR mit einem wahren Blatt durch", () => {
    const ladder = leaf("n9", "mcbLadder", { mode: "validLong", minStrength: 2 });
    const andP = prepare(cfgOf(newGroup("g1", "and", [a, ladder])));
    expect(trues(andP.facts.long!.hit)).toBe(0);
    expect(signals(customStrategy.build(andP, {}), andP.start, andP.bars.length - 1)).toHaveLength(0);
    const orP = prepare(cfgOf(newGroup("g1", "or", [a, ladder])));
    expect(trues(orP.facts.long!.hit)).toBe(trues(orP.facts.leaves.get("n1")));
  });

  it("NICHT dreht ein Blatt um", () => {
    const p = prepare(cfgOf(newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level: 45 }, "exec", true)])));
    const raw = p.facts.leaves.get("n1")!;
    const hit = p.facts.long!.hit!;
    for (let i = 0; i < hit.length; i++) expect(hit[i] === TRUE).toBe(raw[i] === 0);
  });
});

describe("Höherer Timeframe in der Strategie", () => {
  const long = newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level: 50 }), leaf("n2", "maPrice", { type: "sma", len: 5, mode: "above" }, "1d")]);
  const dayCloseS = (b: Bar): number => b.t + 86_400;

  it("das Tages-Blatt zählt in einer 4h-Kerze nur über Tageskerzen, die zu deren Schluss geschlossen waren", () => {
    const prep = prepare(cfgOf(long), { "4h": H4, "1d": D1 });
    const d = prep.facts.leaves.get("n2")!;
    // find a 4h bar in the middle of a day and check it does NOT use that day's value
    const k = H4.findIndex((b) => b.t % 86_400 === 8 * 3600 && b.t > D1[300]!.t + 10 * 86_400);
    expect(k).toBeGreaterThan(0);
    const closeAt = H4[k]!.t + SEC4;
    const closedDays = D1.filter((x) => dayCloseS(x) <= closeAt);
    const want = closedDays.length;
    expect(want).toBeGreaterThan(5);
    // altering the (still running) day's candle changes nothing at bar k
    const alt = D1.map((x) => (x.t === closedDays[closedDays.length - 1]!.t + 86_400 ? { ...x, c: x.c * 0.2, l: x.l * 0.2 } : x));
    const prep2 = prepare(cfgOf(long), { "4h": H4, "1d": alt });
    expect(prep2.facts.leaves.get("n2")![k]).toBe(d[k]);
    // … while altering the last CLOSED day can (when its value matters)
    const sma5 = (arr: Bar[], upTo: number) => arr.slice(upTo - 4, upTo + 1).reduce((s, x) => s + x.c, 0) / 5;
    const lastClosed = closedDays.length - 1;
    expect(d[k] === TRUE).toBe(closedDays[lastClosed]!.c > sma5(closedDays, lastClosed));
  });

  it("gleiche Facts, wenn Ausführungs- UND Tagesdaten nach der Kerze abgeschnitten werden", () => {
    const full = prepare(cfgOf(long), { "4h": H4, "1d": D1 }).facts.long!.hit!;
    for (const i of [600, 601, 602, 603, 604, 605, 900, 1301]) {
      const e = H4.slice(0, i + 1);
      const closeAt = e[i]!.t + SEC4;
      const d = D1.filter((x) => dayCloseS(x) <= closeAt);
      const cut = prepare(cfgOf(long), { "4h": e, "1d": d }).facts.long!.hit!;
      expect(cut[i]).toBe(full[i]);
    }
  });

  it("fehlen die Tagesdaten ganz, ist das Blatt unbekannt und es gibt kein Signal", () => {
    const prep = prepare(cfgOf(long), { "4h": H4 });
    expect(trues(prep.facts.long!.hit)).toBe(0);
  });
});

describe("Long und Short, Stop, Ziel, Verwaltung", () => {
  const longRules = newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level: 42 })]);
  const shortRules = newGroup("g2", "and", [leaf("n2", "rsi", { mode: "above", level: 58 })]);
  const both = (over: Partial<CustomConfig> = {}): CustomConfig => ({ ...defaultCustom(), sides: "both", long: longRules, short: shortRules, ...over });

  it("beide Seiten: Long-Signale unter dem Kurs, Short-Signale darüber, Ziel = r × Stop-Abstand", () => {
    const prep = prepare(both({ target: { kind: "r", r: 2.5 }, stop: { kind: "atr", atr: 1.2, pct: 1, swing: 10, buffer: 0.1 } }));
    const sigs = signals(customStrategy.build(prep, {}), prep.start, prep.bars.length - 1);
    const sides = new Set(sigs.map((s) => s.sig.side));
    expect(sides).toEqual(new Set(["long", "short"]));
    for (const { i, sig } of sigs) {
      const close = prep.bars[i]!.c;
      const dist = Math.abs(close - sig.stop);
      expect(dist).toBeCloseTo(1.2 * prep.atr[i]!, 9);
      expect(sig.target).toBeCloseTo(close + (sig.side === "long" ? 1 : -1) * 2.5 * dist, 9);
      expect(sig.side === "long" ? sig.stop < close : sig.stop > close).toBe(true);
      expect(sig.tag).toContain(sig.side === "long" ? "Long" : "Short");
    }
  });

  it("gleichzeitige Signale beider Seiten werden nicht gehandelt (Konflikt gezählt)", () => {
    const same = cfgOf(newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level: 45 })]), { sides: "both", short: newGroup("g2", "and", [leaf("n2", "rsi", { mode: "below", level: 45 })]) });
    const prep = prepare(same);
    expect(signals(customStrategy.build(prep, {}), prep.start, prep.bars.length - 1)).toHaveLength(0);
    const f = customStrategy.funnel!(prep, {}, { from: prep.start, to: prep.bars.length - 1 });
    expect(f.conflicts).toBeGreaterThan(0);
    expect(f.edges).toBe(f.conflicts);
    expect(f.candidates).toHaveLength(0);
  });

  it("Stop-Arten: Prozent und Swing (inkl. ATR-Puffer)", () => {
    const pct = prepare(both({ stop: { kind: "percent", atr: 1, pct: 2, swing: 10, buffer: 0 } }));
    for (const { i, sig } of signals(customStrategy.build(pct, {}), pct.start, pct.bars.length - 1)) expect(Math.abs(sig.stop - pct.bars[i]!.c) / pct.bars[i]!.c).toBeCloseTo(0.02, 9);
    const sw = prepare(both({ stop: { kind: "swing", atr: 1, pct: 1, swing: 6, buffer: 0.5 } }));
    const swSigs = signals(customStrategy.build(sw, {}), sw.start, sw.bars.length - 1);
    expect(swSigs.length).toBeGreaterThan(0);
    for (const { i, sig } of swSigs) {
      const win = sw.bars.slice(i - 5, i + 1);
      const want = sig.side === "long" ? Math.min(...win.map((b) => b.l)) - 0.5 * sw.atr[i]! : Math.max(...win.map((b) => b.h)) + 0.5 * sw.atr[i]!;
      expect(sig.stop).toBeCloseTo(want, 9);
    }
  });

  it("Verwaltung und Zeit-Stop gehen mit jedem Einstieg zur Engine; ohne Ziel kein Ziel", () => {
    const c = both({
      target: { kind: "none", r: 2 },
      exits: { breakEven: { on: true, trigger: "r", value: 1, to: "net" }, trail: { on: true, kind: "atr", value: 2, activateR: 1.5 }, partial: { on: true, atR: 1, fracPct: 40, thenBreakEven: false }, maxBars: 24, exitOnOpposite: false },
    });
    const prep = prepare(c);
    const [first] = signals(customStrategy.build(prep, {}), prep.start, prep.bars.length - 1);
    expect(first!.sig.target).toBeNull();
    expect(first!.sig.maxBars).toBe(24);
    expect(first!.sig.manage).toEqual({ breakEven: { after: { kind: "r", value: 1 }, to: "net" }, trail: { kind: "atr", value: 2, activateR: 1.5 }, partial: { atR: 1, frac: 0.4, thenBreakEven: false } });
    const plain = prepare(both());
    expect(signals(customStrategy.build(plain, {}), plain.start, 900)[0]!.sig.manage).toBeUndefined();
  });

  it("Ausstieg bei neuem Gegensignal (nur wenn eingeschaltet)", () => {
    const on = prepare(both({ exits: { ...defaultCustom().exits, exitOnOpposite: true } }));
    const off = prepare(both());
    const run = (p: Prepared<CustomFacts>) => runBacktest(p.bars, customStrategy.build(p, {}), { ...engine, maxLeverage: 20 }, { from: p.start, equity: false, atr: p.atr, secLen: SEC4 });
    expect(run(on).trades.some((t) => t.reason === "signal")).toBe(true);
    expect(run(off).trades.some((t) => t.reason === "signal")).toBe(false);
  });
});

describe("Parameter für die Optimierung, Determinismus", () => {
  it("die konfigurierten Werte stehen vorn: ohne gespeicherte Parameter läuft genau die Idee des Nutzers", () => {
    const c = input(cfgOf(newGroup("g1", "and", [leaf("n1", "rsi")]), { stop: { kind: "atr", atr: 1.75, pct: 1, swing: 10, buffer: 0.1 }, target: { kind: "r", r: 3 } }));
    const specs = customStrategy.specs(c);
    expect(specs.map((s) => s.key)).toEqual(["stopK", "targetR"]);
    expect(completeParams(specs, {})).toEqual({ stopK: 1.75, targetR: 3 });
    expect(paramGrid(specs, completeParams(specs, {}))).toHaveLength(specs.reduce((n, s) => n * s.options.length, 1));
    expect(specs[1]!.options[0]).toBe(3);
    const none = customStrategy.specs(input(cfgOf(newGroup("g1", "and", [leaf("n1", "rsi")]), { target: { kind: "none", r: 2 } })));
    expect(none.map((s) => s.key)).toEqual(["stopK"]);
  });

  it("gleiche Konfiguration + gleiche Daten → bit-gleiche Trades und Equity", () => {
    const cfg = cfgOf(newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level: 45 }), leaf("n2", "maPrice", { type: "sma", len: 5, mode: "above" }, "1d")]), {
      exits: { ...defaultCustom().exits, breakEven: { on: true, trigger: "r", value: 1, to: "entry" }, trail: { on: true, kind: "atr", value: 2, activateR: 0 } },
    });
    const once = () => {
      const p = prepare(cfg, { "4h": H4, "1d": D1 });
      return runBacktest(p.bars, customStrategy.build(p, {}), engine, { from: p.start, atr: p.atr, secLen: SEC4 });
    };
    const a = once();
    const b = once();
    expect(a.trades.length).toBeGreaterThan(3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("Trichter und Vergleiche", () => {
  const cfg = cfgOf(newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level: 45 }), newGroup("g5", "or", [leaf("n2", "maPrice", { type: "sma", len: 20, mode: "above" }), leaf("n3", "breakout", { mode: "up", n: 10 })])]), {
    exits: { ...defaultCustom().exits, trail: { on: true, kind: "atr", value: 2, activateR: 0 } },
  });
  const prep = prepare(cfg);
  const win = { from: prep.start, to: prep.bars.length - 1 };

  it("jede Zeile zählt true + false + unbekannt = Kerzen des Zeitraums; die Wurzel = die Kleene-Verknüpfung", () => {
    const f = customStrategy.funnel!(prep, {}, win);
    const total = win.to - win.from + 1;
    expect(f.nodes.map((n) => n.id)).toEqual(["g1", "n1", "g5", "n2", "n3"]);
    for (const n of f.nodes) expect(n.t + n.f + n.u).toBe(total);
    const root = f.nodes[0]!;
    expect(root.kind).toBe("side");
    expect(root.t).toBe([...prep.facts.long!.hit!].slice(win.from).filter((v) => v === TRUE).length);
    expect(f.nodes.find((n) => n.id === "n1")!.label).toBe("RSI(14) unter 45");
    expect(f.edges).toBeLessThan(root.t);
  });

  it("Kandidaten = was die Engine bei freier Position bekäme; ‚blockiert‘ + Signale der Engine gehen auf", () => {
    const f = customStrategy.funnel!(prep, {}, win);
    const run = runBacktest(prep.bars, customStrategy.build(prep, {}), engine, { from: win.from, to: win.to, equity: false, atr: prep.atr, secLen: SEC4 });
    let blocked = 0;
    for (const c of f.candidates) if (run.trades.some((t) => t.entryIndex <= c && c < t.exitIndex)) blocked++;
    expect(f.candidates.length - blocked).toBe(run.signals);
    expect(run.trades.length + run.skippedGap + run.skippedRisk).toBe(run.signals);
  });

  it("Varianten: ohne jedes Blatt (Seiten mit ≥ 2 Blättern) und ohne Verwaltung; ohne Filter gibt es mindestens so viele Signale", () => {
    const vs = customStrategy.variants!(input(cfg));
    expect(vs.map((v) => v.id)).toEqual(["leaf:n1", "leaf:n2", "leaf:n3", "exits"]);
    expect(vs[0]!.label).toBe("Ohne „RSI(14) unter 45“");
    const base = customStrategy.funnel!(prep, {}, win).candidates.length;
    const without = customStrategy.buildVariant!(prep, {}, "leaf:n1")!;
    expect(signals(without, win.from, win.to).length).toBeGreaterThan(base);
    const noExits = customStrategy.buildVariant!(prep, {}, "exits")!;
    expect(signals(noExits, win.from, win.to)[0]!.sig.manage).toBeUndefined();
    // a side with a single leaf has nothing to compare
    expect(customStrategy.variants!(input(cfgOf(newGroup("g1", "and", [leaf("n1", "rsi")]))))).toEqual([]);
    expect(customStrategy.buildVariant!(prep, {}, "leaf:unbekannt")).not.toBeNull(); // unknown leaf id: the tree is unchanged
    expect(combineTree(cfg.long, prep.facts.leaves, prep.bars.length, new Set(["n1", "n2", "n3"])).hit).toBeNull();
  });
});

describe("Der ganze Lauf auf echten Daten", () => {
  const jobInput = (config: CustomConfig): LabJobInput => ({
    strategy: "custom",
    symbol: "BTCUSDT",
    box: { tf: "4h" },
    mcb: { signal: DEFAULT_SIGNAL_CFG, step: "4h" },
    rules: { interval: "4h", side: "long", conds: [] },
    custom: input(config),
    params: {},
    fromMs: H4[400]!.t * 1000,
    toMs: (H4[H4.length - 1]!.t + SEC4) * 1000,
    engine,
    data: { "4h": H4, "1d": D1 },
  });

  it("Ergebnis mit Abdeckung, Trichter, Varianten – konsistent, serialisierbar, deterministisch", () => {
    const cfg = cfgOf(newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level: 45 }), leaf("n2", "maPrice", { type: "sma", len: 5, mode: "above" }, "1d")]), { name: "Test-Idee" });
    const r = createLabJob(jobInput(cfg)).result();
    expect(r.strategy).toBe("custom");
    expect(r.name).toBe("Test-Idee");
    expect(r.configKey).toMatch(/^[0-9a-z]+$/);
    expect(r.interval).toBe("4h");
    expect(r.coverage.map((c) => [c.interval, c.role])).toEqual([
      ["4h", "exec"],
      ["1d", "other"],
    ]);
    expect(r.coverage[0]!.bars).toBe(H4.length);
    expect(r.expectedBars).toBeGreaterThan(900);
    expect(r.warmup.wanted).toBeGreaterThan(0);
    expect(r.warmup.got).toBe(400);
    const f = r.funnel;
    expect(f.examined).toBeGreaterThan(900);
    expect(f.executed).toBe(r.trades.length);
    expect(f.executed + f.skippedGap + f.skippedRisk).toBe(f.signals);
    expect(f.candidates! - f.blockedByPosition!).toBe(f.signals);
    expect(f.nodes.length).toBe(3);
    const noCosts = r.variants.find((v) => v.kind === "noCosts")!;
    expect(noCosts).toBeTruthy();
    expect(noCosts.n).toBeGreaterThan(0);
    expect(r.variants.filter((v) => v.kind === "noLeaf").map((v) => v.id)).toEqual(["leaf:n1", "leaf:n2"]);
    expect(() => structuredClone(r)).not.toThrow();
    expect(JSON.stringify(createLabJob(jobInput(cfg)).result().trades)).toBe(JSON.stringify(r.trades));
    // the lab's strategy registry knows it, and the optimiser grid ran on the user's own stop / target
    expect(strategyOf("custom")).toBe(customStrategy);
    expect(r.specs.map((s) => s.label)).toEqual(["Stop", "Ziel"]);
    expect(r.trials.length).toBe(9);
  }, 60_000);

  it("ohne ein gültiges Signal: leeres Ergebnis ohne Absturz, Trichter zeigt die Ursache", () => {
    const cfg = cfgOf(newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level: 1 }), leaf("n2", "rsi", { mode: "above", level: 99 })]));
    const r = createLabJob(jobInput(cfg)).result();
    expect(r.trades).toHaveLength(0);
    expect(r.funnel.signals).toBe(0);
    expect(r.funnel.nodes[0]!.t).toBe(0);
  }, 60_000);
});
