/**
 * Branchen-Trend – the result file of a lab run. The example shipped with the app (`public/branchen-trend/beispiel-megatest.json`) is a REAL run
 * (12,096 variants, 10,000 Monte-Carlo paths): the verdict of that file is VERWORFEN, and the app must say exactly that.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_RESULT_BYTES, easeOutQuart, histogram, logTicks, nearestIndex, parseMegatest, rangeOf, shareBelowDiagonal, verdictOf, paramsText, type MegatestResult } from "@/domain/industryTrend";

const here = dirname(fileURLToPath(import.meta.url));
const TEXT = readFileSync(join(here, "../../public/branchen-trend/beispiel-megatest.json"), "utf8");

function parse(): MegatestResult {
  const r = parseMegatest(TEXT);
  if (!r.ok) throw new Error(r.reason);
  return r.result;
}

describe("Das mitgelieferte Beispiel (ein echter Lauf)", () => {
  it("liest sich und sagt VERWORFEN – mit den Prüfungen, die durchfielen", () => {
    const r = parse();
    expect(r.entscheidung).toBe("VERWORFEN");
    expect(r.n_varianten).toBe(12096);
    expect(r.monte_carlo.pfade).toBe(10000);
    expect(r.daten_bis).toBe("20260930");
    const v = verdictOf(r);
    expect(v.state).toBe("verworfen");
    expect(v.consistent).toBe(true);
    // die Prüfungen der Datei: Mehrfachtest bestanden, Endtest und Kosten nicht, Plateau und Monte-Carlo bestanden
    expect(v.failed.map((c) => c.name.split(":")[0])).toEqual(["Endtest (letzte 20 %)", "Kosten"]);
    expect(v.passed).toHaveLength(3);
  });

  it("Basis bleibt: 20/40, Keltner 2,8, Ziel-Vola 2 %, Hebel 2; die Kandidatin 65/20 ist eine andere", () => {
    const r = parse();
    expect(paramsText(r.basis.parameter)).toBe("20/40 · Keltner 2,8 · Ziel-Vola 2 % · Hebel 2");
    expect(r.kandidatin.parameter.up).toBe(65);
    expect(r.kandidatin.kennzahlen.endtest.sharpe).toBeLessThan(r.basis.kennzahlen.endtest.sharpe);
    expect(r.kandidatin.kennzahlen.devval.sharpe).toBeGreaterThan(r.basis.kennzahlen.devval.sharpe);
  });

  it("Überanpassung ist in den Zahlen zu sehen: Rangkorrelation um 0, die meisten Punkte unter der Diagonale", () => {
    const r = parse();
    expect(Math.abs(r.rang_korrelation)).toBeLessThan(0.05);
    expect(shareBelowDiagonal(r.streu)).toBeGreaterThan(0.5);
    expect(r.streu.length).toBe(700);
  });

  it("der Fächer: fünf Bänder gleicher Länge und Stichprobenpfade", () => {
    const m = parse().monte_carlo;
    const n = m.baender["50"].length;
    expect(n).toBe(61);
    for (const k of ["5", "25", "75", "95"] as const) expect(m.baender[k]).toHaveLength(n);
    expect(m.zeige_gruen.length + m.zeige_rot.length).toBeGreaterThan(100);
    expect(m.baender["5"][n - 1]!).toBeLessThan(m.baender["95"][n - 1]!);
  });
});

describe("Urteil aus den Prüfungen", () => {
  const ok = { name: "a", ok: true, wert: "1" };
  const no = { name: "b", ok: false, wert: "2" };
  it("übernommen nur, wenn jede Prüfung bestanden ist", () => {
    expect(verdictOf({ checks: [ok, ok], entscheidung: "UEBERNOMMEN" }).state).toBe("uebernommen");
    expect(verdictOf({ checks: [ok, no], entscheidung: "VERWORFEN" }).state).toBe("verworfen");
  });
  it("ein Wort, das den Prüfungen widerspricht, wird erkannt – die Prüfungen gelten", () => {
    const v = verdictOf({ checks: [ok, no], entscheidung: "UEBERNOMMEN" });
    expect(v.state).toBe("verworfen");
    expect(v.consistent).toBe(false);
    expect(verdictOf({ checks: [ok], entscheidung: "VERWORFEN" })).toMatchObject({ state: "uebernommen", consistent: false });
  });
});

describe("Prüfung der Datei (nichts wird geglaubt)", () => {
  const raw = (): Record<string, unknown> => JSON.parse(TEXT) as Record<string, unknown>;
  const reason = (o: unknown): string => {
    const r = parseMegatest(typeof o === "string" ? o : JSON.stringify(o));
    if (r.ok) throw new Error("accepted");
    return r.reason;
  };

  it("kein JSON, kein Objekt, ein anderes JSON", () => {
    expect(reason("das ist kein json")).toMatch(/keine gültige JSON-Datei/);
    expect(reason("[1,2,3]")).toMatch(/kein Ergebnis eines Labor-Laufs/);
    expect(reason({ hallo: "welt" })).toMatch(/entscheidung/);
  });

  it("zu groß wird nicht einmal geparst", () => {
    expect(reason("x".repeat(MAX_RESULT_BYTES + 1))).toMatch(/größer als 4 MB/);
  });

  it("nennt die erste fehlerhafte Stelle", () => {
    const a = raw();
    delete (a.basis as Record<string, unknown>).kennzahlen;
    expect(reason(a)).toMatch(/basis\.kennzahlen/);
    const b = raw();
    (b.monte_carlo as { baender: Record<string, unknown> }).baender["50"] = [1];
    expect(reason(b)).toMatch(/monte_carlo\.baender\.50/);
    const c = raw();
    c.checks = [];
    expect(reason(c)).toMatch(/ohne Prüfungen gibt es kein Urteil/);
    const d = raw();
    d.entscheidung = "GEWINNER";
    expect(reason(d)).toMatch(/VERWORFEN oder UEBERNOMMEN/);
    const e = raw();
    (e.checks as { ok: unknown }[])[0]!.ok = "ja";
    expect(reason(e)).toMatch(/checks\[0\]\.ok/);
  });

  it("Zahlen müssen Zahlen sein (kein Text, kein NaN aus null), Daten JJJJMMTT, Listen begrenzt", () => {
    const a = raw();
    (a.basis as { kennzahlen: { endtest: { sharpe: unknown } } }).kennzahlen.endtest.sharpe = "0.5";
    expect(reason(a)).toMatch(/basis\.kennzahlen\.endtest\.sharpe/);
    const b = raw();
    b.daten_bis = "30.09.2026";
    expect(reason(b)).toMatch(/daten_bis/);
    const c = raw();
    c.streu = Array.from({ length: 5001 }, () => [0, 0]);
    expect(reason(c)).toMatch(/streu/);
    const d = raw();
    (d.monte_carlo as { zeige_gruen: number[][] }).zeige_gruen = Array.from({ length: 401 }, () => [1, 1]);
    expect(reason(d)).toMatch(/zeige_gruen/);
  });

  it("ohne Kurve geht es (sie ist nur eine Zugabe)", () => {
    const a = raw();
    delete a.kurve;
    const r = parseMegatest(JSON.stringify(a));
    expect(r.ok && r.result.kurve).toBe(null);
  });
});

describe("Rechnen für die Diagramme", () => {
  it("Histogramm: gleich breite Fächer, außen liegende Werte kommen in die Randfächer, nichts geht verloren", () => {
    const h = histogram([0.1, 0.4, 0.45, 0.9, -5, 99, Number.NaN], 4, 0, 1);
    expect(h).toEqual([2, 2, 0, 2]);
    expect(h.reduce((a, b) => a + b, 0)).toBe(6);
    expect(histogram([1, 2], 3, 1, 1)).toEqual([0, 0, 0]);
  });
  it("gemeinsamer Bereich mit etwas Luft; ohne Werte [0, 1]", () => {
    expect(rangeOf([[0, 1], [2]], 0.1)).toEqual([-0.2, 2.2]);
    expect(rangeOf([[]])).toEqual([0, 1]);
    expect(rangeOf([[3, 3]])).toEqual([2.5, 3.5]);
  });
  it("Anteil unter der Diagonale", () => {
    expect(shareBelowDiagonal([[1, 0.5], [1, 1.5], [2, 2], [0, -1]])).toBe(0.5);
    expect(shareBelowDiagonal([])).toBe(0);
  });
  it("Linien der Log-Skala: 0,5×, 1×, 2×, 4× …", () => {
    expect(logTicks(0.4, 5)).toEqual([0.5, 1, 2, 4]);
  });
  it("Auslauf: schnell am Anfang, ruhig am Ende, nie über 1", () => {
    expect(easeOutQuart(0)).toBe(0);
    expect(easeOutQuart(1)).toBe(1);
    expect(easeOutQuart(0.5)).toBeGreaterThan(0.9);
    expect(easeOutQuart(2)).toBe(1);
  });
  it("Fadenkreuz: nächster Punkt aus der Mausposition", () => {
    expect(nearestIndex(0, 61)).toBe(0);
    expect(nearestIndex(1, 61)).toBe(60);
    expect(nearestIndex(0.5, 61)).toBe(30);
    expect(nearestIndex(-3, 61)).toBe(0);
  });
});
