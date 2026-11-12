/**
 * F14 / F64 – the Pine export: snapshot tests of the generated scripts (a change to the text must be a conscious one), the
 * honesty rules (untranslated blocks are named and become a default-off input, never dropped), structural checks of the Pine
 * syntax the app can verify without TradingView, and the TradingView link.
 */
import { describe, expect, it } from "vitest";
import { BLOCK_ORDER, BLOCKS, defaultParams } from "@/domain/lab/rules/blocks";
import { STRATEGY_CARDS, buildCard } from "@/domain/lab/library";
import { toPine, pineSupports, tvChartUrl, tvSymbol, DEFAULT_PINE_ENGINE } from "@/domain/lab/pine";
import { defaultCustom, newGroup, newLeaf, sanitizeCustom } from "@/domain/lab/rules/tree";
import type { BlockId, CustomConfig } from "@/domain/lab/rules/types";

const ENGINE = { ...DEFAULT_PINE_ENGINE, slippage: { kind: "fixed", bps: 2 } as const };
const opts = { symbol: "BTCUSDT", engine: ENGINE, tick: 0.1, refPrice: 65_000, stamp: "Test" };
const card = (id: string, level: "conservative" | "standard" | "aggressive" = "standard"): CustomConfig => buildCard(STRATEGY_CARDS.find((c) => c.id === id)!, level);

describe("Pine-Skripte (Snapshots)", () => {
  it("die Standardidee (RSI + Tages-EMA, nur Long, ATR-Stop, 2 R)", () => {
    expect(toPine(defaultCustom(), opts).code).toMatchSnapshot();
  });

  it("EMA-Kreuz, beide Seiten, Trailing und Gegensignal", () => {
    expect(toPine(card("ema-cross"), opts).code).toMatchSnapshot();
  });

  it("Rücksetzer im Trend: Break-even auf Netto, höhere Zeit-Ebene in einer Gruppe", () => {
    const base = card("ema200-pullback");
    const cfg = sanitizeCustom({ ...base, long: { ...base.long, children: [...base.long.children, { ...newLeaf("n90", "maPrice", "1d"), params: { ...defaultParams("maPrice"), len: 50 } }] } });
    expect(toPine(cfg, opts).code).toMatchSnapshot();
  });

  it("Teil-Gewinn, Break-even danach, Zeit-Stop, Swing-Stop (Golden Pocket)", () => {
    const base = card("golden-pocket");
    const cfg = sanitizeCustom({ ...base, exits: { ...base.exits, partial: { on: true, atR: 1, fracPct: 50, thenBreakEven: true } } });
    expect(toPine(cfg, opts).code).toMatchSnapshot();
  });

  it("Opening-Range-Ausbruch London (Sitzung, Swing-Stop, beide Seiten)", () => {
    expect(toPine(card("orb-london"), opts).code).toMatchSnapshot();
  });

  it("nicht übersetzbare Bausteine: Funding und MCB-Leiter, namentlich im Kopf, als Eingabe aus", () => {
    const cfg = sanitizeCustom({ ...defaultCustom(), sides: "long", long: newGroup("g1", "or", [newLeaf("n1", "funding"), { ...newLeaf("n2", "rsi"), params: { ...defaultParams("rsi"), level: 25 } }, newLeaf("n3", "mcbLadder")]) });
    expect(toPine(cfg, opts).code).toMatchSnapshot();
  });
});

describe("Ehrlichkeit des Exports", () => {
  it("jeder Baustein ist übersetzt – oder steht namentlich in den Lücken, nie still weg", () => {
    for (const id of BLOCK_ORDER) {
      const cfg = sanitizeCustom({ ...defaultCustom(), sides: "long", long: newGroup("g1", "and", [newLeaf("n1", id as BlockId)]) });
      const r = toPine(cfg, opts);
      if (pineSupports(id)) {
        expect(r.gaps, id).toEqual([]);
        expect(r.code, id).toContain("f_n1() =>");
        expect(r.code, id).not.toContain("allow_n1");
        expect(r.translated).toBe(1);
      } else {
        expect(r.gaps.map((g) => g.block), id).toEqual([id]);
        expect(r.gaps[0]!.label).toBe(BLOCKS[id].label);
        expect(r.gaps[0]!.reason.length).toBeGreaterThan(20);
        expect(r.code).toContain(`allow_n1 = input.bool(false`);
        expect(r.code).toContain("NICHT ÜBERSETZT");
        expect(r.code).toContain(BLOCKS[id].label);
        expect(r.translated).toBe(0);
      }
      expect(r.total).toBe(1);
    }
  });

  it("nur diese fünf Bausteine sind nicht übersetzbar (MCB-Punkte, MCB-Leiter, Premium/Discount, RSI-Linie, Funding)", () => {
    expect(BLOCK_ORDER.filter((b) => !pineSupports(b)).sort()).toEqual(["funding", "mcbLadder", "rsiLine", "wtEvent", "zone"]);
  });

  it("eine nicht übersetzte Bedingung mit NICHT wird nicht zu „immer wahr“: die Eingabe ist die Bedingung selbst, Standard aus", () => {
    const leaf = { ...newLeaf("n1", "zone"), not: true };
    const r = toPine(sanitizeCustom({ ...defaultCustom(), sides: "long", long: newGroup("g1", "and", [leaf]) }), opts);
    expect(r.code).toContain("bool n1 = allow_n1");
    expect(r.code).not.toMatch(/bool n1 = not allow_n1/);
  });

  it("der Kopf nennt Abweichungen (Kerzen, Gebühren, Slippage, Reihenfolge in der Kerze, Lücken, Funding) und den Rückweg", () => {
    const code = toPine(defaultCustom(), opts).code;
    for (const w of ["Kerzen:", "Gebühren:", "Slippage:", "Reihenfolge in einer Kerze", "Lücken:", "Funding:", "Ergebnisse in TradingView weichen vom Labor ab", "Liste der Trades"]) expect(code, w).toContain(w);
    expect(code).toContain("Die App kann Pine weder ausführen noch prüfen");
  });

  it("Gebühr und Größe kommen aus dem Lauf; Slippage nur mit bekannter Tick-Größe", () => {
    const code = toPine(defaultCustom(), { ...opts, engine: { ...ENGINE, takerBps: 6, riskPct: 0.5, maxLeverage: 3, capital: 25_000 } }).code;
    expect(code).toContain("commission_value = 0.06");
    expect(code).toContain("initial_capital = 25000.0");
    expect(code).toContain('input.float(0.5, "Risiko je Trade');
    expect(code).toContain('input.float(3.0, "Maximaler Hebel');
    expect(code).toContain("slippage = 130"); // 2 bp von 65 000 = 13 USDT = 130 Ticks zu 0,1
  });

  it("ohne Tick-Größe bleibt die Slippage 0 und der Kopf sagt, wie sie nachzutragen ist", () => {
    const r = toPine(defaultCustom(), { symbol: "BTCUSDT", engine: ENGINE });
    expect(r.code).toContain("slippage = 0");
    expect(r.notes.join(" ")).toMatch(/Tick-Größe des Marktes ist der App nicht bekannt/);
  });

  it("ATR-Slippage lässt sich nicht in Ticks fassen – das steht dabei", () => {
    const r = toPine(defaultCustom(), { engine: { ...ENGINE, slippage: { kind: "atr", frac: 0.1 } } });
    expect(r.notes.join(" ")).toMatch(/10 % der ATR/);
  });
});

describe("Aufbau des Skripts (ohne TradingView prüfbar)", () => {
  const SCRIPTS = [...STRATEGY_CARDS.map((c) => [c.id, buildCard(c)] as const), ["default", defaultCustom()] as const];
  for (const [id, cfg] of SCRIPTS) {
    it(`${id}: v6, genau eine strategy()-Deklaration, jede Funktion vor ihrer Nutzung, ausgeglichene Klammern, keine Tabs`, () => {
      const code = toPine(cfg, opts).code;
      expect(code.startsWith("//@version=6\n")).toBe(true);
      expect(code.match(/^strategy\(/gm)).toHaveLength(1);
      expect(code).not.toMatch(/\t/);
      expect(code).not.toMatch(/undefined|NaN|\[object/);
      // Klammern und Anführungszeichen je Zeile (Kommentare ausgenommen)
      for (const line of code.split("\n")) {
        const l = line.replace(/\/\/.*$/, "").replace(/"[^"]*"/g, '""');
        expect(l.split("(").length, line).toBe(l.split(")").length);
        expect(l.split("[").length, line).toBe(l.split("]").length);
        expect((line.replace(/\/\/.*$/, "").match(/"/g) ?? []).length % 2, line).toBe(0);
      }
      // Einrückung nur in 4er-Schritten
      for (const line of code.split("\n")) expect(/^( {4})*\S|^$/.test(line), line).toBe(true);
      // jede f_-Funktion steht vor ihrem Aufruf
      for (const m of code.matchAll(/^(f_\w+)\(.*\) =>/gm)) {
        const first = code.indexOf(`${m[1]}(`);
        expect(first, m[1]).toBe(m.index);
      }
      // jede Eingabe-Variable wird verwendet
      for (const m of code.matchAll(/^(?:int|float|bool) (\w+) = input\./gm)) {
        const uses = code.split(new RegExp(`\\b${m[1]}\\b`)).length - 1;
        expect(uses, `${id}: ${m[1]}`).toBeGreaterThan(1);
      }
      // jede genutzte Bedingung ist definiert
      for (const m of code.matchAll(/^bool (n\d+) = /gm)) expect(code.split(new RegExp(`\\b${m[1]}\\b`)).length - 1, m[1]).toBeGreaterThan(1);
    });
  }

  it("Seiten: nur Long erzeugt keinen Short-Code, beide Seiten erzeugen Gegensignal-Ausstieg", () => {
    const long = toPine(card("connors-rsi2"), opts).code;
    expect(long).toContain('strategy.entry("Long"');
    expect(long).not.toContain('strategy.entry("Short"');
    const both = toPine(card("ema-cross"), opts).code;
    expect(both).toContain('strategy.entry("Short"');
    expect(both).toContain('strategy.close("Long", comment = "Gegensignal")');
  });

  it("höhere Zeit-Ebene: request.security ohne Blick in die Zukunft", () => {
    const base = card("ema200-pullback");
    const cfg = sanitizeCustom({ ...base, long: { ...base.long, children: [{ ...newLeaf("n1", "maPrice", "1d"), params: { ...defaultParams("maPrice"), len: 50 } }] } });
    const code = toPine(cfg, opts).code;
    expect(code).toContain('request.security(syminfo.tickerid, "1D", f_n1(), lookahead = barmerge.lookahead_off)');
    expect(code).not.toContain("lookahead_on");
  });

  it("Name mit Anführungszeichen und Sonderzeichen bricht das Skript nicht", () => {
    const r = toPine({ ...defaultCustom(), name: 'Mein "Test" – Idee/ß' }, opts);
    expect(r.code).toContain(`strategy("Mein 'Test' – Idee/ß"`);
    expect(r.fileName).toBe("Eigene-Idee_Mein-Test-Idee-ss_BTCUSDT.pine");
  });

  it("ist deterministisch (gleiche Eingabe → gleicher Text) und ändert die Idee nicht", () => {
    const cfg = card("ichimoku-cloud");
    const before = JSON.stringify(cfg);
    expect(toPine(cfg, opts).code).toBe(toPine(cfg, opts).code);
    expect(JSON.stringify(cfg)).toBe(before);
  });
});

describe("Link „In TradingView öffnen“", () => {
  it("BTCUSDT → BINANCE:BTCUSDT.P mit dem Intervall der Ausführung", () => {
    expect(tvSymbol("btcusdt")).toBe("BINANCE:BTCUSDT.P");
    expect(tvChartUrl("BTCUSDT", "4h")).toBe("https://www.tradingview.com/chart/?symbol=BINANCE%3ABTCUSDT.P&interval=240");
    expect(tvChartUrl("ETHUSDT", "1d")).toContain("interval=D");
    expect(tvChartUrl("SOLUSDT", "15m")).toContain("interval=15");
  });
  it("unbrauchbare Symbole geben keinen Link (nie ein halber)", () => {
    expect(tvChartUrl("", "1h")).toBeNull();
    expect(tvChartUrl("BTC/USDT", "1h")).toBeNull();
    expect(tvChartUrl("A".repeat(40), "1h")).toBeNull();
  });
});
