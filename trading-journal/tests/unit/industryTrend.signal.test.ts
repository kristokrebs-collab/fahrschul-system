/**
 * Branchen-Trend – the signal rule. Three layers of evidence:
 *  1. a mini example worked out BY HAND (comments show the arithmetic), so the rule is checked against the words of the paper,
 *  2. the indicators against hand-computed values,
 *  3. the lab script's own output (`megatest.py` `signal_pass`, run on REAL Ken-French series; `tests/fixtures/industryTrend/signal-cases.json`
 *     – eight cuts of real industries with missing values, a crash, and three parameter sets): every day the position changes must be the same.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MISSING, computeAmpel, ema, industryReturns, lastChangeIndex, rollExtreme, rollMeanChange, rollStd0, runSignal, strategyId, weights, BASE_PARAMS, type IndustryDataset } from "@/domain/industryTrend";

const here = dirname(fileURLToPath(import.meta.url));
const nan = Number.NaN;

describe("Indikatoren (von Hand gerechnet)", () => {
  it("EMA beginnt mit dem ersten Wert (kein SMA-Start, kein NaN)", () => {
    // a = 2/3: 1 → 2/3·2 + 1/3·1 = 5/3 → 2/3·3 + 1/3·5/3 = 23/9
    const e = ema([1, 2, 3], 2);
    expect(e[0]).toBe(1);
    expect(e[1]).toBeCloseTo(5 / 3, 12);
    expect(e[2]).toBeCloseTo(23 / 9, 12);
  });

  it("Höchst- und Tiefstwert der letzten w Tage einschließlich heute, erst ab Tag w - 1", () => {
    const x = [1, 3, 2, 5, 4];
    expect(Array.from(rollExtreme(x, 3, true))).toEqual([nan, nan, 3, 5, 5]);
    expect(Array.from(rollExtreme(x, 3, false))).toEqual([nan, nan, 1, 2, 2]);
  });

  it("mittlere absolute Änderung: der Kurs hat am ersten Tag keine Änderung, der erste Wert steht bei Index w", () => {
    // Änderungen [NaN, 0, 1, 2, 2, 1, 0], Fenster 2 → (0+1)/2, (1+2)/2, (2+2)/2, (2+1)/2, (1+0)/2
    expect(Array.from(rollMeanChange([nan, 0, 1, 2, 2, 1, 0], 2))).toEqual([nan, nan, 0.5, 1.5, 2, 1.5, 0.5]);
  });

  it("Standardabweichung mit Teiler w (Grundgesamtheit); eine flache Reihe hat 0, nie NaN oder eine Wurzel aus Negativem", () => {
    const s = rollStd0([1, 2, 3, 4], 2);
    expect(Number.isNaN(s[0])).toBe(true);
    expect(Array.from(s).slice(1)).toEqual([0.5, 0.5, 0.5]);
    expect(Array.from(rollStd0([0.1, 0.1, 0.1, 0.1], 3)).slice(2)).toEqual([0, 0]);
  });
});

describe("Signal: ein Beispiel von Hand durchgerechnet", () => {
  // Kurs 1, 1, 2, 4, 2, 1, 1  ←  Renditen 0, 0, +100 %, +100 %, −50 %, −50 %, 0.  Fenster up = 2, down = 2, Keltner-Faktor 1.
  //   EMA(2):   1, 1, 1,667, 3,222, 2,407, 1,469, 1,156
  //   mittl. |Δ| (2):          –, –, 0,5, 1,5, 2, 1,5, 0,5
  //   oberer Kanal  = max(Höchst 2 Tage, EMA + 1·Δ):  – – 2,167  4,722  4,407  2,969  1,656
  //   unterer Kanal = min(Tiefst 2 Tage, EMA − 1·Δ):  – – 1      1,722  0,407 −0,031  0,656
  //   Tag 3: Kurs 4 ≥ oberer Kanal von gestern (2,167) und der ist über dem unteren (1) → rein, Stop = 1,722
  //   Tag 4: Stop bleibt 1,722 (der untere Kanal 0,407 zieht ihn nicht runter); Kurs 2 > 1,722 → drin
  //   Tag 5: Kurs 1 ≤ Stop 1,722 → raus.   Tag 6: Kurs 1 < oberer Kanal von gestern (2,969) → bleibt draußen.
  const rets = [0, 0, 1, 1, -0.5, -0.5, 0];
  const p = { up: 2, down: 2, kelt: 1 };

  it("rein am Tag 3, raus am Tag 5, sonst Cash", () => {
    const { exposure } = runSignal(rets, p);
    expect(Array.from(exposure)).toEqual([0, 0, 0, 1, 1, 0, 0]);
    expect(lastChangeIndex(exposure)).toBe(5);
  });

  it("ohne Daten der Kanäle (die ersten Tage) gibt es nie ein Signal – auch bei Kurssprung", () => {
    expect(Array.from(runSignal([0, 1, 1], p).exposure)).toEqual([0, 0, 0]);
  });

  it("ein fehlender Wert (NaN) schließt die Position an diesem Tag, im Kurs zählt er als 0 %", () => {
    // wie oben, aber der Tag 4 hat keinen Wert: Position zu, am Tag 5 gilt der Kurs 2 (unverändert) – kein Einstieg, weil 2 < oberer Kanal
    const r = runSignal([0, 0, 1, 1, nan, -0.5, 0], p);
    expect(r.exposure[3]).toBe(1);
    expect(r.exposure[4]).toBe(0);
    expect(r.exposure[5]).toBe(0);
  });

  it("das Gewicht auf den letzten Tag ist 1 / (σ·√252) der letzten `up` Renditen (Teiler w)", () => {
    // Kurs 1, 1, 2, 4, 5: am Tag 4 ist die Position noch drin (Stop 2,907 < 5); letzte zwei Renditen 1,0 und 0,25:
    // Mittel 0,625, Varianz (1 + 0,0625)/2 − 0,625² = 0,140625 → σ = 0,375
    const r = runSignal([0, 0, 1, 1, 0.25], p);
    expect(r.exposure[4]).toBe(1);
    expect(r.unitLast).toBeCloseTo(1 / (0.375 * Math.sqrt(252)), 12);
    // draußen: kein Gewicht
    expect(runSignal(rets, p).unitLast).toBe(0);
  });

  it("der Stop wird nur hochgezogen", () => {
    // gleiche Reihe wie oben, aber lange seitwärts auf hohem Niveau: der Stop (1,722) bleibt und löst erst bei einem Schluss darunter aus
    const r = runSignal([0, 0, 1, 1, -0.2, -0.1, 0.05, 0.05, -0.5], p);
    // Kurse 1,1,2,4,3.2,2.88,3.024,3.1752,1.5876: der Stop ist ≥ 1,722 → erst der Absturz auf 1,5876 löst aus
    expect(Array.from(r.exposure)).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 0]);
  });
});

describe("Zielgewichte", () => {
  it("Ziel-Vola × Gewicht je Branche; unter dem Hebel bleibt alles wie es ist", () => {
    const w = weights([10, 20, 0], 0.02, 2);
    expect(w.w).toEqual([0.2, 0.4, 0]);
    expect(w.sum).toBeCloseTo(0.6, 12);
    expect(w.capped).toBe(false);
  });
  it("über dem Hebel werden alle gemeinsam im gleichen Verhältnis gekürzt (Summe = Hebel)", () => {
    // 0,2 + 0,4 + 0,6 = 1,2 > 0,5 → Faktor 0,5/1,2
    const w = weights([10, 20, 30], 0.02, 0.5);
    expect(w.sum).toBe(0.5);
    expect(w.capped).toBe(true);
    expect(w.w[0]).toBeCloseTo(0.2 * (0.5 / 1.2), 12);
    expect(w.w.reduce((a, b) => a + b, 0)).toBeCloseTo(0.5, 12);
    expect(w.w[2]! / w.w[0]!).toBeCloseTo(3, 12);
  });
});

describe("gegen die Ausgabe des Python-Skripts (echte Ken-French-Reihen)", () => {
  interface Case {
    branche: string;
    von: string;
    bis: string;
    tage: number;
    up: number;
    down: number;
    kelt: number;
    returnsBp: number[];
    erwartet: { first: number; changes: number[]; final: number; unit_last: number };
  }
  const file = JSON.parse(readFileSync(join(here, "../fixtures/industryTrend/signal-cases.json"), "utf8")) as { cases: Case[] };

  it("enthält die acht Ausschnitte (mit fehlenden Werten, verschiedenen Parametern, Wechseln)", () => {
    expect(file.cases).toHaveLength(8);
    expect(file.cases.some((c) => c.returnsBp.includes(MISSING))).toBe(true);
    expect(file.cases.reduce((n, c) => n + c.erwartet.changes.length, 0)).toBeGreaterThan(40);
  });

  for (const c of file.cases) {
    it(`${c.branche} ${c.von}–${c.bis}, ${c.up}/${c.down}, Keltner ${c.kelt}: dieselben Wechseltage und dasselbe Gewicht`, () => {
      const data: IndustryDataset = { names: [c.branche], dates: new Int32Array(c.tage), returns: Int16Array.from(c.returnsBp) };
      const r = runSignal(industryReturns(data, 0), c);
      const changes: number[] = [];
      for (let t = 1; t < r.exposure.length; t++) if (r.exposure[t] !== r.exposure[t - 1]) changes.push(t);
      expect(changes).toEqual(c.erwartet.changes);
      expect(r.exposure[0]).toBe(c.erwartet.first);
      expect(r.exposure[c.tage - 1]).toBe(c.erwartet.final);
      expect(r.unitLast).toBeCloseTo(c.erwartet.unit_last, 9);
    });
  }
});

describe("Ampel", () => {
  // 3 Branchen, 300 Tage: A steigt um +0,4 / +0,6 % am Tag (immer neue Hochs), B fällt −0,3 % am Tag (nie ein Einstieg), C steigt 200 Tage und fällt dann
  const T = 300;
  const names = ["Agric", "Food", "Soda"];
  const dates = Int32Array.from({ length: T }, (_, t) => 20250101 + t);
  const returns = new Int16Array(3 * T);
  for (let t = 0; t < T; t++) {
    const up = t % 2 ? 40 : 60; // +0,4 % / +0,6 % im Wechsel: immer neue Hochs, aber eine Streuung > 0 (sonst kein Gewicht)
    returns[t] = up;
    returns[T + t] = -30;
    returns[2 * T + t] = t < 200 ? up : -80;
  }
  const data: IndustryDataset = { names, dates, returns };

  it("grün, rot und die Branche, die nach dem Anstieg ausgestiegen ist – mit dem Tag des letzten Wechsels", async () => {
    const a = await computeAmpel(data);
    expect(a.asOf).toBe(20250101 + T - 1);
    expect(a.rows.map((r) => r.state)).toEqual(["kauf", "cash", "cash"]);
    expect(a.kauf).toBe(1);
    expect(a.cash).toBe(2);
    const [agric, food, soda] = a.rows;
    expect(agric!.name).toBe("Landwirtschaft");
    expect(food!.since).toBeNull();
    expect(agric!.weight).toBeGreaterThan(0);
    expect(food!.weight).toBe(0);
    // Soda: raus an einem Tag nach dem Kippen (Tag 200), irgendwann zwischen 200 und 300
    const sodaChange = soda!.since!;
    expect(sodaChange).toBeGreaterThan(20250101 + 200);
    expect(soda!.daysSince).toBe(T - 1 - (sodaChange - 20250101));
  });

  it("Wechsel der letzten Tage als Ereignisse (KAUF grün, VERKAUF rot), älteste zuerst", async () => {
    const a = await computeAmpel(data, { eventDays: T });
    const kinds = a.events.map((e) => `${e.branche}:${e.signal}:${e.punkt}`);
    expect(kinds).toContain("Agric:KAUF:gruen");
    expect(kinds).toContain("Soda:VERKAUF:rot");
    const days = a.events.map((e) => e.datum);
    expect([...days].sort()).toEqual(days);
    // nur die letzten 5 Tage: keine Ereignisse, weil dort nichts wechselt (A bleibt drin, C ist längst raus)
    expect((await computeAmpel(data, { eventDays: 5 })).events).toEqual([]);
  });

  it("gibt unterwegs die Hand ab (kein langer Block) und lässt sich abbrechen", async () => {
    let pauses = 0;
    await computeAmpel(data, { yieldEvery: 1, pause: async () => void pauses++ });
    expect(pauses).toBe(2);
    const ctl = new AbortController();
    ctl.abort();
    await expect(computeAmpel(data, { signal: ctl.signal })).rejects.toThrow("aborted");
  });

  it("zu wenige Daten: ein Fehler mit Grund, keine leere Ampel", async () => {
    await expect(computeAmpel({ names: ["Agric"], dates: new Int32Array(1), returns: new Int16Array(1) })).rejects.toThrow("Zu wenige Daten");
  });
});

describe("Kennung der Variante", () => {
  it("wie im Labor-Skript: s-up-down-kelt-vola-hebel mit Python-Zahlenschreibweise", () => {
    expect(strategyId(BASE_PARAMS)).toBe("s-20-40-2.8-0.02-2.0");
    expect(strategyId({ up: 65, down: 20, kelt: 1, tv: 0.01, lev: 2 })).toBe("s-65-20-1.0-0.01-2.0");
  });
});
