/**
 * F64 / F14 – Indikator-Vertrag und Abgleich mit einem TradingView-Chartdaten-Export: der Leser (Formate, Fehler mit Zeile), der
 * Vertrag je Indikator (Warmup GEMESSEN, kein Wiederzeichnen GETESTET), der Abgleich Kerze für Kerze auf den ECHTEN BTCUSDT-Tageskerzen
 * (500 Kerzen aus TradingView, `tv-binance-btcusdt-1d-indicators.json`) mit Handrechnung der Toleranz, dem Einschwingen eines Anfangs
 * mit anderem Startwert und den Urteilen „gleichwertig / weicht ab / offen / zu wenige Werte“.
 *
 * Die Datei im Test ist nach dem Format des Exports („Chartdaten exportieren“) nachgebaut; eine echte Exportdatei aus einem
 * TradingView-Konto lag der Prüfung nicht vor.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanInputs, compareIndicator, defaultInputs, guessColumn, INDICATORS, indicatorById, intervalLabel, MIN_CHART_BARS, parseTvChart, testBars, VERDICT_LABEL, warmupOf, type ChartColumn, type IndicatorDef } from "@/domain/tvimport";
import type { Bar } from "@/domain/signals/indicators";

const fx = JSON.parse(readFileSync("tests/unit/fixtures/tv-binance-btcusdt-1d-indicators.json", "utf8")) as { bars: number[][] };
const BARS: Bar[] = fx.bars.map(([t, o, h, l, c, v]) => ({ t: t!, o: o!, h: h!, l: l!, c: c!, v: v! }));
const iso = (sec: number): string => new Date(sec * 1000).toISOString().replace(".000Z", "Z");
const def = (id: string): IndicatorDef => indicatorById(id)!;

/** A chart-data export: time, OHLC, Volume and plot columns (`NaN` = empty cell), numbers written with `decimals` places. */
function csvOf(bars: readonly Bar[], plots: Record<string, number[]> = {}, decimals = 8, o: { delimiter?: string; header?: string[] } = {}): string {
  const d = o.delimiter ?? ",";
  const names = Object.keys(plots);
  const head = o.header ?? ["time", "open", "high", "low", "close", "Volume", ...names];
  const fmt = (x: number): string => (Number.isFinite(x) ? x.toFixed(decimals) : "");
  const rows = bars.map((b, i) => [iso(b.t), b.o, b.h, b.l, b.c, b.v ?? 0, ...names.map((n) => plots[n]![i]!)].map((x, k) => (k === 0 ? String(x) : fmt(x as number))).join(d));
  return [head.join(d), ...rows].join("\n");
}

const colOf = (c: ReturnType<typeof parseTvChart>, name: string): ChartColumn => c.columns.find((x) => x.name === name)!;

describe("Der Leser des Chartdaten-Exports", () => {
  it("liest Kerzen, Volumen und jede Plot-Spalte; eine leere Zelle ist „kein Wert“; Dezimalstellen und Zeitabstand werden erkannt", () => {
    const rsi = def("rsi").compute(BARS, { len: 14 }).rsi!;
    const c = parseTvChart(csvOf(BARS, { RSI: rsi }, 2));
    expect(c.errors).toEqual([]);
    expect(c.bars).toHaveLength(500);
    expect(c.bars[0]).toMatchObject({ t: BARS[0]!.t, o: BARS[0]!.o, c: BARS[0]!.c });
    expect(c.hasVolume).toBe(true);
    expect(c.intervalSec).toBe(86_400);
    expect(intervalLabel(c.intervalSec)).toBe("1D");
    expect(c.from).toBe(BARS[0]!.t * 1000);
    expect(c.to).toBe(BARS[499]!.t * 1000);
    const col = colOf(c, "RSI");
    expect(col.decimals).toBe(2);
    expect(col.values).toHaveLength(500);
    expect(col.values.slice(0, 14).every(Number.isNaN)).toBe(true);
    expect(col.filled).toBe(rsi.filter(Number.isFinite).length);
    expect(col.values[100]).toBeCloseTo(rsi[100]!, 2);
  });

  it("Semikolon und Komma als Dezimalzeichen, deutsche Kopfzeile, UNIX-Zeit, BOM", () => {
    const text = `\uFEFFZeit;Eröffnung;Hoch;Tief;Schluss;Volumen;RSI\n` + BARS.slice(0, 40).map((b, i) => `${b.t};${b.o.toFixed(2).replace(".", ",")};${b.h.toFixed(2).replace(".", ",")};${b.l.toFixed(2).replace(".", ",")};${b.c.toFixed(2).replace(".", ",")};1,5;${i > 20 ? "55,25" : ""}`).join("\n");
    const c = parseTvChart(text);
    expect(c.errors).toEqual([]);
    expect(c.bars).toHaveLength(40);
    expect(c.bars[0]!.t).toBe(BARS[0]!.t);
    expect(c.bars[0]!.o).toBeCloseTo(BARS[0]!.o, 2);
    expect(colOf(c, "RSI").filled).toBe(19);
    expect(colOf(c, "RSI").decimals).toBe(2);
    // UNIX in Millisekunden
    const ms = parseTvChart(["time,open,high,low,close", ...BARS.slice(0, 5).map((b) => `${b.t * 1000},${b.o},${b.h},${b.l},${b.c}`)].join("\n"));
    expect(ms.bars.map((b) => b.t)).toEqual(BARS.slice(0, 5).map((b) => b.t));
  });

  it("Zeiten mit Offset gelten absolut, ohne Offset in der gewählten Zone", () => {
    const row = (t: string) => `${t},1,2,0.5,1.5`;
    const text = `time,open,high,low,close\n${row("2026-01-01T02:00:00+02:00")}\n${row("2026-01-02T00:00:00Z")}\n${row("2026-01-03 03:00")}`;
    const utc = parseTvChart(text);
    expect(utc.bars.map((b) => iso(b.t))).toEqual(["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "2026-01-03T03:00:00Z"]);
    expect(parseTvChart(text, { utcOffsetMinutes: 180 }).bars.map((b) => iso(b.t))[2]).toBe("2026-01-03T00:00:00Z");
  });

  it("jede unlesbare Zeile steht mit ihrer Zeilennummer da und fehlt im Rest; die übrigen werden gelesen", () => {
    const lines = ["time,open,high,low,close,RSI"];
    BARS.slice(0, 40).forEach((b) => lines.push(`${iso(b.t)},${b.o},${b.h},${b.l},${b.c},50`));
    lines[5] = "gestern,1,2,0.5,1.5,50"; // Zeile 6
    lines[9] = `${iso(BARS[8]!.t)},1,2,0.5,x,50`; // Zeile 10
    lines[12] = `${iso(BARS[11]!.t)},1,0.5,2,1.5,50`; // Zeile 13: Hoch unter Tief
    lines[15] = lines[14]!; // Zeile 16: dieselbe Zeit noch einmal
    const c = parseTvChart(lines.join("\n"));
    expect(c.errors.map((e) => e.line)).toEqual([6, 10, 13, 16]);
    expect(c.errors[0]!.message).toContain("gestern");
    expect(c.errors[1]!.message).toContain("Preisspalten");
    expect(c.errors[2]!.message).toContain("Hoch liegt unter dem Tief");
    expect(c.errors[3]!.message).toContain("aufsteigend");
    expect(c.bars).toHaveLength(36);
  });

  it("fehlende Pflichtspalten, leere Datei, zu wenige Kerzen und eine Datei ohne Indikatorspalte werden mit Grund gemeldet", () => {
    expect(parseTvChart("").errors[0]!.message).toContain("leer");
    const noClose = parseTvChart("time,open,high,low,RSI\n2026-01-01T00:00:00Z,1,2,0.5,50");
    expect(noClose.errors[0]!.message).toContain("fehlen die Spalten: close");
    const few = parseTvChart(csvOf(BARS.slice(0, 10), { RSI: Array(10).fill(50) }));
    expect(few.bars).toHaveLength(10);
    expect(few.warnings.join(" ")).toContain(`mindestens ${MIN_CHART_BARS}`);
    const bare = parseTvChart(csvOf(BARS.slice(0, 40)));
    expect(bare.columns).toEqual([]);
    expect(bare.warnings.join(" ")).toContain("keine Spalte mit Indikatorwerten");
    const onlyHead = parseTvChart("time,open,high,low,close\n");
    expect(onlyHead.errors[0]!.message).toContain("Keine lesbare Kerze");
  });

  it("Fehlerlisten sind begrenzt, die Dateien sind es durch den Aufrufer", () => {
    const lines = ["time,open,high,low,close"];
    for (let i = 0; i < 100; i++) lines.push(`kaputt${i},1,2,0.5,1.5`);
    const c = parseTvChart(lines.join("\n"));
    expect(c.errors).toHaveLength(40);
    expect(c.errorsCut).toBe(true);
  });
});

describe("Der Vertrag je Indikator", () => {
  it("jeder Indikator hat Pine-Aufruf, Eingaben mit Vorgabe, Ausgänge mit TradingView-Namen, einen Satz zum Start und eine Prüfaussage", () => {
    expect(INDICATORS.map((d) => d.id)).toEqual(["rsi", "ema", "sma", "atr", "macd", "bollinger", "adx", "stoch", "cci", "williamsR", "ichimoku", "keltner"]);
    for (const d of INDICATORS) {
      const p = defaultInputs(d);
      expect(d.pine(p).length, d.id).toBeGreaterThan(8);
      expect(d.pine(p), d.id).not.toContain("undefined");
      expect(d.params.length, d.id).toBeGreaterThan(0);
      for (const q of d.params) expect(q.def >= q.min && q.def <= q.max, `${d.id}.${q.key}`).toBe(true);
      expect(d.outputs.length, d.id).toBeGreaterThan(0);
      for (const o of d.outputs) expect(o.tv.length, `${d.id}.${o.key}`).toBeGreaterThan(0);
      expect(d.start.length, d.id).toBeGreaterThan(30);
      expect(d.validation.note.length, d.id).toBeGreaterThan(30);
    }
  });

  it("die Prüfaussage nennt nur, was die Tests wirklich gegen TradingView-Werte halten", () => {
    const tv = INDICATORS.filter((d) => d.validation.kind === "tv").map((d) => d.id);
    // Tests: lab.blocksPlus.test.ts (ADX/DI, Stochastic, CCI, %R, Bollinger/SMA, RSI, MACD, Ichimoku) gegen tv-binance-btcusdt-1d-indicators.json
    expect(tv).toEqual(["rsi", "sma", "macd", "bollinger", "adx", "stoch", "cci", "williamsR", "ichimoku"]);
    for (const d of INDICATORS) if (d.validation.kind === "tv") expect(d.validation.on).toBe("2026-10-19");
    expect(def("ema").validation.kind).toBe("definition");
    expect(def("keltner").validation.note).toContain("nicht gegen TradingView-Zahlen geprüft");
  });

  it("Warmup ist GEMESSEN (die echte Funktion auf einer Testreihe), nicht behauptet – mit Handrechnung", () => {
    const w = (id: string, p?: Record<string, number>) => warmupOf(def(id), p ? cleanInputs(def(id), p) : undefined);
    expect(w("sma")).toBe(20); // 20 Schlusskurse
    expect(w("sma", { len: 5 })).toBe(5);
    expect(w("bollinger")).toBe(20);
    expect(w("cci")).toBe(20);
    expect(w("williamsR")).toBe(14);
    expect(w("atr")).toBe(14); // erste True Range an Kerze 1, Mittel der ersten 14
    expect(w("rsi")).toBe(15); // 14 Änderungen brauchen 15 Schlusskurse
    expect(w("stoch")).toBe(16); // %K nach 14 Kerzen (Glättung 1), %D = Mittel von 3 → 14 + 3 − 1
    expect(w("ema")).toBe(1); // Startwert = erster Schluss (Pine: erst ab Länge)
    expect(w("macd")).toBe(1);
    expect(w("keltner")).toBe(10); // die ATR (10) kommt zuletzt
    expect(w("ichimoku")).toBe(77); // Senkou B: 52 Kerzen, dazu der Versatz 25
    expect(w("adx")).toBe(28); // DI nach 14 Änderungen, ADX braucht noch einmal 14 DX-Werte
    expect(w("sma", { len: 500 })).toBe(500); // die Testreihe hat 900 Kerzen: auch lange Längen werden gemessen
  });

  it("Einschwingzeit: rekursive Glättung ≈ ln(10⁻⁴) ÷ ln(1 − α), sonst keine", () => {
    expect(def("ema").settle({ len: 20 })).toBe(Math.ceil(Math.log(1e-4) / Math.log(1 - 2 / 21)));
    expect(def("rsi").settle({ len: 14 })).toBe(Math.ceil(Math.log(1e-4) / Math.log(1 - 1 / 14)));
    expect(def("rsi").settle({ len: 14 })).toBeGreaterThan(110);
    expect(def("sma").settle({ len: 20 })).toBeNull();
    expect(def("stoch").settle({})).toBeNull();
    expect(def("bollinger").settle({})).toBeNull();
  });

  it("kein Wiederzeichnen: der Wert einer Kerze ändert sich nicht, wenn später Kerzen dazukommen (jeder Indikator, jeder Ausgang)", () => {
    const bars = testBars(300);
    for (const d of INDICATORS) {
      const p = defaultInputs(d);
      const full = d.compute(bars, p);
      for (const cut of [120, 211, 299]) {
        const part = d.compute(bars.slice(0, cut), p);
        for (const o of d.outputs) {
          for (let i = 0; i < cut; i++) {
            const a = part[o.key]![i]!;
            const b = full[o.key]![i]!;
            expect(Number.isNaN(a) === Number.isNaN(b), `${d.id}.${o.key}[${i}] defined at cut ${cut}`).toBe(true);
            if (Number.isFinite(a)) expect(a, `${d.id}.${o.key}[${i}] at cut ${cut}`).toBeCloseTo(b, 9);
          }
        }
      }
    }
  });

  it("die Testreihe ist überall dieselbe (gleicher Startwert, gleiche Kerzen)", () => {
    const a = testBars(50);
    const b = testBars(50);
    expect(a).toEqual(b);
    expect(a[0]!.o).toBe(100);
    for (const k of a) expect(k.h >= Math.max(k.o, k.c) && k.l <= Math.min(k.o, k.c)).toBe(true);
  });

  it("cleanInputs klemmt in die Bereiche und rundet ganze Zahlen", () => {
    expect(cleanInputs(def("rsi"), { len: 0 })).toEqual({ len: 1 });
    expect(cleanInputs(def("rsi"), { len: 9999 })).toEqual({ len: 500 });
    expect(cleanInputs(def("rsi"), { len: 13.6 })).toEqual({ len: 14 });
    expect(cleanInputs(def("rsi"), { len: "x" })).toEqual({ len: 14 });
    expect(cleanInputs(def("bollinger"), { len: 20, mult: 2.26 })).toEqual({ len: 20, mult: 2.3 });
  });
});

describe("Spalten den Indikatoren zuordnen", () => {
  it("eindeutige Namen werden erkannt, doppeldeutige nicht – und eine Zahl am Namen ist die Länge", () => {
    expect(guessColumn("RSI")).toEqual({ id: "rsi", output: "rsi" });
    expect(guessColumn("MACD")).toEqual({ id: "macd", output: "macd" });
    expect(guessColumn("Signal")).toEqual({ id: "macd", output: "sig" });
    expect(guessColumn("Histogram")).toEqual({ id: "macd", output: "hist" });
    expect(guessColumn("%K")).toEqual({ id: "stoch", output: "k" });
    expect(guessColumn("+DI")).toEqual({ id: "adx", output: "plus" });
    expect(guessColumn("ADX")).toEqual({ id: "adx", output: "adx" });
    expect(guessColumn("Leading Span A")).toEqual({ id: "ichimoku", output: "cloudA" });
    expect(guessColumn("EMA200")).toEqual({ id: "ema", output: "ema", inputs: { len: 200 } });
    expect(guessColumn("SMA 50")).toEqual({ id: "sma", output: "sma", inputs: { len: 50 } });
    // Basis / Upper / Lower gibt es bei Bollinger und bei Keltner; „MA“ kann alles sein
    for (const n of ["Basis", "Upper", "Lower", "MA", "Plot", ""]) expect(guessColumn(n), n).toBeNull();
  });
});

describe("Der Abgleich auf echten Kerzen", () => {
  const chart = (plots: Record<string, number[]>, decimals = 8, bars: Bar[] = BARS) => {
    const c = parseTvChart(csvOf(bars, plots, decimals));
    expect(c.errors).toEqual([]);
    return c;
  };

  it("jeder Ausgang jedes Indikators, als Datei geschrieben und wieder gelesen, ist „gleichwertig validiert“ – Kerze für Kerze innerhalb der Rundung des Exports", () => {
    for (const d of INDICATORS) {
      const p = defaultInputs(d);
      const s = d.compute(BARS, p);
      const c = chart(Object.fromEntries(d.outputs.map((o) => [o.label, s[o.key]!])), 6);
      for (const o of d.outputs) {
        const r = compareIndicator(c, colOf(c, o.label), d, o.key, p);
        expect(r.verdict, `${d.id}.${o.key}`).toBe("equal");
        expect(r.compared, `${d.id}.${o.key}`).toBeGreaterThan(300);
        expect(r.tail!.within, `${d.id}.${o.key}`).toBe(1);
        expect(r.all!.maxAbs, `${d.id}.${o.key}`).toBeLessThanOrEqual(0.5e-6 * 1.0001 + 1e-3 * 0);
      }
    }
  });

  it("die Toleranz ist die Rundung der Datei: bei zwei Nachkommastellen ±0,005, bei sechs ±0,0000005", () => {
    const rsi = def("rsi").compute(BARS, { len: 14 }).rsi!;
    const two = chart({ RSI: rsi }, 2);
    const r2 = compareIndicator(two, colOf(two, "RSI"), def("rsi"), "rsi", { len: 14 });
    expect(r2.decimals).toBe(2);
    expect(r2.tolerance).toBeCloseTo(0.005, 4);
    expect(r2.verdict).toBe("equal");
    expect(r2.all!.maxAbs).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(r2.all!.maxAbs).toBeGreaterThan(0.001); // Rundung ist tatsächlich sichtbar, nicht null
    const six = chart({ RSI: rsi }, 6);
    expect(compareIndicator(six, colOf(six, "RSI"), def("rsi"), "rsi", { len: 14 }).tolerance).toBeCloseTo(0.0000005, 9);
  });

  it("ein einziger abweichender Wert am Ende → „weicht ab“, und der schlechteste Wert nennt die Kerze, TradingView-Wert, unseren Wert und die Differenz", () => {
    const rsi = def("rsi").compute(BARS, { len: 14 }).rsi!.slice();
    rsi[450] = rsi[450]! + 0.5;
    const c = chart({ RSI: rsi }, 6);
    const r = compareIndicator(c, colOf(c, "RSI"), def("rsi"), "rsi", { len: 14 });
    expect(r.verdict).toBe("differs");
    expect(r.worst[0]).toMatchObject({ time: BARS[450]!.t * 1000 });
    expect(r.worst[0]!.diff).toBeCloseTo(-0.5, 5); // wir − TradingView
    expect(r.worst[0]!.tv - r.worst[0]!.ours).toBeCloseTo(0.5, 5);
    expect(r.tail!.within).toBeLessThan(1);
    expect(r.all!.maxAbs).toBeCloseTo(0.5, 5);
  });

  it("falsche Eingaben (RSI 21 gegen eine Datei mit RSI 14) weichen ab; der richtige Wert stimmt", () => {
    const rsi = def("rsi").compute(BARS, { len: 14 }).rsi!;
    const c = chart({ RSI: rsi }, 6);
    expect(compareIndicator(c, colOf(c, "RSI"), def("rsi"), "rsi", { len: 21 }).verdict).toBe("differs");
    expect(compareIndicator(c, colOf(c, "RSI"), def("rsi"), "rsi", { len: 14 }).verdict).toBe("equal");
  });

  it("anderer Startwert: TradingView rechnete mit mehr Historie als die Datei zeigt – der Anfang weicht ab und schwingt ein, das Ende stimmt → „gleichwertig“, mit dem Anfang als Beobachtung", () => {
    // „TradingView“ rechnet die EMA(20) auf allen 500 Kerzen, die Datei zeigt nur die letzten 300
    const tvEma = def("ema").compute(BARS, { len: 20 }).ema!;
    const slice = BARS.slice(200);
    const c = chart({ EMA: tvEma.slice(200) }, 2, slice);
    const r = compareIndicator(c, colOf(c, "EMA"), def("ema"), "ema", { len: 20 });
    expect(r.verdict).toBe("equal");
    expect(r.head).not.toBeNull();
    expect(r.head!.within).toBeLessThan(1); // der Anfang weicht ab …
    expect(r.head!.maxAbs).toBeGreaterThan(r.tail!.maxAbs * 10); // … deutlich stärker als das Ende
    expect(r.tail!.within).toBe(1);
    expect(r.settled).toBe(true);
    expect(r.settle).toBe(def("ema").settle({ len: 20 }));
  });

  it("eine zu kurze Datei, die noch nicht eingeschwungen ist, ist „offen“ – nie „weicht ab“", () => {
    const tvEma = def("ema").compute(BARS, { len: 200 }).ema!;
    const c = chart({ EMA: tvEma.slice(440) }, 2, BARS.slice(440));
    const r = compareIndicator(c, colOf(c, "EMA"), def("ema"), "ema", { len: 200 });
    expect(r.compared).toBe(60);
    expect(r.settled).toBe(false);
    expect(r.verdict).toBe("open");
    expect(VERDICT_LABEL[r.verdict]).toContain("zu kurz");
  });

  it("weniger als 30 gemeinsame Werte: „nicht vergleichbar“", () => {
    const sma = def("sma").compute(BARS, { len: 20 }).sma!;
    const c = chart({ SMA: sma.slice(0, 40) }, 4, BARS.slice(0, 40));
    const r = compareIndicator(c, colOf(c, "SMA"), def("sma"), "sma", { len: 20 });
    expect(r.compared).toBe(21);
    expect(r.verdict).toBe("few");
  });

  it("der Anfang der Reihe: wo TradingView und wir den ersten Wert haben (Warmup), steht im Ergebnis", () => {
    const tvEma = def("ema").compute(BARS, { len: 20 }).ema!.map((v, i) => (i < 19 ? NaN : v)); // Pine: erst ab Länge
    const c = chart({ EMA: tvEma }, 6);
    const r = compareIndicator(c, colOf(c, "EMA"), def("ema"), "ema", { len: 20 });
    expect(r.tvStart).toBe(20);
    expect(r.ourStart).toBe(1);
    expect(r.compared).toBe(481);
    expect(r.verdict).toBe("equal");
  });

  it("eine Spalte ohne Gegenstück (Ausgang, den es nicht gibt) vergleicht nichts – keine erfundene Zahl", () => {
    const c = chart({ X: Array(500).fill(1) }, 2);
    const r = compareIndicator(c, colOf(c, "X"), def("rsi"), "gibtesnicht", { len: 14 });
    expect(r.compared).toBe(0);
    expect(r.verdict).toBe("few");
    expect(r.tail).toBeNull();
    expect(r.all).toBeNull();
    expect(r.worst).toEqual([]);
  });

  it("deterministisch: dieselbe Datei, dasselbe Ergebnis", () => {
    const s = def("macd").compute(BARS, { fast: 12, slow: 26, signal: 9 });
    const c = chart({ MACD: s.macd!, Signal: s.sig! }, 4);
    const run = () => compareIndicator(c, colOf(c, "MACD"), def("macd"), "macd", { fast: 12, slow: 26, signal: 9 });
    expect(run()).toEqual(run());
  });
});
