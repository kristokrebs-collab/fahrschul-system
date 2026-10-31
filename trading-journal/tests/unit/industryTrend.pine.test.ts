/**
 * Branchen-Trend – the Pine v5 export. TradingView is not available here: the script was NOT compiled. What the app CAN check is
 * checked – the structure of the text (version line, one `indicator()`, balanced brackets and quotes per line, 4-space steps, no tabs,
 * every name used after it is declared, every input used), the logic against the lab rule (same lines as the TypeScript port), and
 * the alert payload against its JSON schema.
 */
import { describe, expect, it } from "vitest";
import { BASE_PARAMS, PAYLOAD_JSON_SCHEMA, buildPine, payloadTemplate, strategyId } from "@/domain/industryTrend";

const base = buildPine({ ...BASE_PARAMS });
const code = base.code;

describe("Pine-Skript der Basis (Snapshot)", () => {
  it("bleibt, wie es ist – eine Änderung am Text ist eine bewusste", () => {
    expect(code).toMatchSnapshot();
  });
  it("heißt nach der Variante und ist deterministisch", () => {
    expect(base.fileName).toBe("Branchen-Trend_s-20-40-2.8-0.02-2.0.pine");
    expect(buildPine({ ...BASE_PARAMS }).code).toBe(code);
  });
});

describe("Aufbau (ohne TradingView prüfbar)", () => {
  const variants = [BASE_PARAMS, { up: 65, down: 20, kelt: 1, tv: 0.01, lev: 2 }, { up: 10, down: 30, kelt: 3.4, tv: 0.03, lev: 1.5 }];
  for (const p of variants) {
    it(`${strategyId(p)}: Version 5, genau ein indicator(), ausgeglichene Klammern und Anführungszeichen, 4er-Einrückung, keine Tabs`, () => {
      const c = buildPine({ ...p }).code;
      expect(c.startsWith("//@version=5\n")).toBe(true);
      expect(c.match(/^indicator\(/gm)).toHaveLength(1);
      expect(c).not.toMatch(/^strategy\(/m);
      expect(c).not.toMatch(/\t/);
      expect(c).not.toMatch(/undefined|NaN|\[object/);
      for (const line of c.split("\n")) {
        const noComment = line.replace(/\/\/.*$/, "");
        const l = noComment.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
        expect(l.split("(").length, line).toBe(l.split(")").length);
        expect(l.split("[").length, line).toBe(l.split("]").length);
        expect((noComment.replace(/'[^']*'/g, "").match(/"/g) ?? []).length % 2, line).toBe(0);
        expect(/^( {4})*\S|^$/.test(line), line).toBe(true);
      }
      // jede Eingabe wird benutzt
      for (const m of c.matchAll(/^(\w+) = input\./gm)) expect(c.split(new RegExp(`\\b${m[1]}\\b`)).length - 1, m[1]).toBeGreaterThan(1);
      // ein Wert wird erst benutzt, nachdem er deklariert wurde
      for (const m of c.matchAll(/^(?:float|int|bool) (\w+) = /gm)) {
        const first = c.search(new RegExp(`\\b${m[1]}\\b`));
        expect(first, m[1]).toBe(m.index! + m[0].split(" ")[0]!.length + 1);
      }
      // die Funktion steht vor ihrem Aufruf
      expect(c.indexOf("f_ema(src, len) =>")).toBeLessThan(c.indexOf("f_ema(close"));
    });
  }

  it("setzt die Parameter ein (Fenster, Keltner mit Dezimalpunkt)", () => {
    expect(buildPine({ up: 10, down: 30, kelt: 3, tv: 0.02, lev: 2 }).code).toContain('kelt = input.float(3.0, "Keltner-Faktor"');
    expect(code).toContain('upLen = input.int(20, "Oberer Kanal: Fenster (Tage)", minval = 2)');
    expect(code).toContain('downLen = input.int(40, "Unterer Kanal und Stop: Fenster (Tage)", minval = 2)');
    expect(code).toContain('kelt = input.float(2.8, "Keltner-Faktor"');
  });
});

describe("Regel wie im Labor-Skript", () => {
  it("Kanäle: erst definiert, wenn das Fenster voll ist; Höchst/Tiefst und EMA ± Keltner × mittlere |Änderung|", () => {
    expect(code).toContain("float upper = bar_index >= upLen ? math.max(hi, emaUp + kelt * madUp) : na");
    expect(code).toContain("float lower = bar_index >= downLen ? math.min(lo, emaDn - kelt * madDn) : na");
    expect(code).toContain("float hi = ta.highest(close, upLen)");
    expect(code).toContain("float lo = ta.lowest(close, downLen)");
    expect(code).toContain("float absChg = math.abs(ta.change(close))");
  });

  it("EMA mit dem ersten Wert gestartet (nicht ta.ema)", () => {
    expect(code).toContain("e := na(e[1]) ? src : a * src + (1 - a) * e[1]");
    expect(code).not.toContain("ta.ema(");
  });

  it("Einstieg gegen den Kanal von GESTERN, Stop nur hochgezogen, Ausstieg bei Schluss auf oder unter dem Stop", () => {
    expect(code).toContain("float prevUp = upper[1]");
    expect(code).toContain("else if close >= prevUp and prevUp > prevLo");
    expect(code).toContain("stopLevel := na(stopLevel) ? lower : math.max(stopLevel, lower)");
    expect(code).toContain("if close <= stopLevel");
    // kein Blick in die Zukunft, keine höhere Zeitebene
    expect(code).not.toContain("request.security");
    expect(code).not.toContain("lookahead");
  });

  it("die Reihenfolge der Bedingungen ist die des Labor-Skripts (kein Wert/erster Tag → raus, drin → Stop prüfen, sonst Einstieg)", () => {
    const a = code.indexOf("if bar_index == 0 or na(prevUp) or na(prevLo)");
    const b = code.indexOf("else if inTrade == 1");
    const c = code.indexOf("else if close >= prevUp and prevUp > prevLo");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("grüner Punkt beim Einstieg, roter beim Ausstieg; Warnung auf anderen Zeitrahmen als Tageskerzen", () => {
    expect(code).toContain('plotshape(buySig, "Kauf", style = shape.circle, location = location.belowbar, color = color.green');
    expect(code).toContain('plotshape(sellSig, "Verkauf", style = shape.circle, location = location.abovebar, color = color.red');
    expect(code).toContain("if barstate.islast and not timeframe.isdaily");
  });

  it("sendet nichts: kein strategy.*, kein alert() – nur alertcondition mit fester Nachricht", () => {
    expect(code).not.toMatch(/strategy\./);
    expect(code).not.toMatch(/\balert\(/);
    expect(code.match(/^alertcondition\(/gm)).toHaveLength(2);
  });
});

describe("Hinweise und Nutzlast", () => {
  it("sagt offen, dass nicht in TradingView kompiliert wurde – im Kopf des Skripts und in den Hinweisen", () => {
    expect(code.split("\n").slice(0, 8).join("\n")).toContain("NICHT in TradingView kompiliert");
    expect(base.notes[0]).toMatch(/Nicht in TradingView kompiliert/);
    expect(base.notes.join(" ")).toMatch(/Ken French/);
    expect(base.notes.join(" ")).toMatch(/Einmal pro Balkenschluss/);
  });

  it("die Nachricht der Alarme ist JSON (nach dem Ersetzen der Platzhalter) und passt zum Schema", () => {
    const id = strategyId(BASE_PARAMS);
    for (const sig of ["KAUF", "VERKAUF"] as const) {
      const tpl = payloadTemplate(id, sig);
      expect(code).toContain(`message = '${tpl}'`);
      const filled = tpl.replace("{{ticker}}", "XLE").replace("{{time}}", "2026-09-30T04:00:00Z").replace("{{close}}", "91.37");
      const o = JSON.parse(filled) as Record<string, unknown>;
      const s = PAYLOAD_JSON_SCHEMA;
      expect(Object.keys(o).sort()).toEqual([...s.required].sort());
      expect(o.schema).toBe(s.properties.schema.const);
      expect(o.signal).toBe(sig);
      expect(String(o.strategie)).toMatch(new RegExp(s.properties.strategie.pattern));
      expect(typeof o.kurs).toBe("number");
      expect(o.modus).toBe("DEMO/PAPIER");
      expect(Number.isNaN(Date.parse(String(o.datum)))).toBe(false);
    }
  });

  it("vor dem Ersetzen steht {{close}} ohne Anführungszeichen (sonst wäre der Kurs ein Text)", () => {
    expect(payloadTemplate("s-1-2-3.0-0.02-2.0", "KAUF")).toContain('"kurs":{{close}},');
  });
});
