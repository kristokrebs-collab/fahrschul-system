/**
 * Positionsgrößen-Rechner · die „Rechnung“ (`@/domain/risk/bill`): Risiko als Anteil oder als Betrag, Kostenanteil, Mindestabstand,
 * Abstand in ATR, Betrag am Ziel nach Gebühren, das Beispiel für die Rundung auf einen Mengenschritt und die Hinweise – jede Zahl mit
 * Handrechnung, dazu die Randfälle der Eingabe (0, negativ, Stop auf der falschen Seite).
 */
import { describe, expect, it } from "vitest";
import { COST_SHARE_WARN, exampleStep, floorToStep, positionBill, positionSize, riskFraction, type Sizing } from "@/domain/risk";

const FEE = 0.0005;
const SLIP = 0.0005;

function size(p: { capital?: number; riskPct?: number; entry: number; stop: number; side?: "long" | "short"; maxLeverage?: number; leverage?: number }): Sizing {
  const s = positionSize({ capital: p.capital ?? 10_000, riskPct: p.riskPct ?? 0.01, entry: p.entry, stop: p.stop, side: p.side, feePct: FEE, slippagePct: SLIP, maxLeverage: p.maxLeverage ?? 5, leverage: p.leverage ?? null });
  if (!s.ok) throw new Error(`expected ok, got ${s.error}`);
  return s;
}
const bill = (s: Sizing, p: { entry: number; stop: number; target?: number | null; atr?: number | null; own?: number | null; capital?: number; step?: number | null }) =>
  positionBill({ sizing: s, capital: p.capital ?? 10_000, entry: p.entry, stop: p.stop, target: p.target ?? null, feePct: FEE, slippagePct: SLIP, atr: p.atr ?? null, ownRiskPct: p.own === undefined ? 0.01 : p.own, step: p.step ?? null });

describe("Risiko als Anteil oder Betrag", () => {
  it("1 % und 100 von 10 000 sind dasselbe Risiko", () => {
    expect(riskFraction("pct", 1, 10_000)).toBe(0.01);
    expect(riskFraction("amount", 100, 10_000)).toBe(0.01);
    const a = positionSize({ capital: 10_000, riskPct: riskFraction("pct", 1, 10_000), entry: 100, stop: 95 });
    const b = positionSize({ capital: 10_000, riskPct: riskFraction("amount", 100, 10_000), entry: 100, stop: 95 });
    expect(a).toEqual(b);
  });

  it("unbrauchbare Eingaben geben den Fehler „risk“ oder „capital“ – nie eine Größe", () => {
    const run = (riskPct: number, capital = 10_000) => positionSize({ capital, riskPct, entry: 100, stop: 95 });
    expect(run(riskFraction("amount", 0, 10_000))).toEqual({ ok: false, error: "risk" });
    expect(run(riskFraction("amount", -50, 10_000))).toEqual({ ok: false, error: "risk" });
    expect(run(riskFraction("amount", NaN, 10_000))).toEqual({ ok: false, error: "risk" });
    // mehr riskieren als das Konto hält
    expect(run(riskFraction("amount", 10_001, 10_000))).toEqual({ ok: false, error: "risk" });
    expect(run(riskFraction("pct", 0, 10_000))).toEqual({ ok: false, error: "risk" });
    expect(run(riskFraction("pct", -1, 10_000))).toEqual({ ok: false, error: "risk" });
    expect(run(riskFraction("pct", 101, 10_000))).toEqual({ ok: false, error: "risk" });
    // ohne Kapital lässt sich ein Betrag nicht in einen Anteil umrechnen: das Kapital ist der Fehler
    expect(Number.isNaN(riskFraction("amount", 100, 0))).toBe(true);
    expect(run(riskFraction("amount", 100, 0), 0)).toEqual({ ok: false, error: "capital" });
    expect(run(0.01, -500)).toEqual({ ok: false, error: "capital" });
  });

  it("Einstieg / Stop: 0, negativ, gleich und falsche Seite werden abgelehnt", () => {
    const run = (entry: number, stop: number, side?: "long" | "short") => positionSize({ capital: 10_000, riskPct: 0.01, entry, stop, side });
    expect(run(0, 95)).toEqual({ ok: false, error: "entry" });
    expect(run(-100, 95)).toEqual({ ok: false, error: "entry" });
    expect(run(100, 0)).toEqual({ ok: false, error: "stop" });
    expect(run(100, -5)).toEqual({ ok: false, error: "stop" });
    expect(run(100, 100)).toEqual({ ok: false, error: "stop" });
    expect(run(100, 105, "long")).toEqual({ ok: false, error: "side" });
    expect(run(100, 95, "short")).toEqual({ ok: false, error: "side" });
  });
});

describe("Die Rechnung", () => {
  it("Handrechnung Long 100 → 95, Ziel 110, 1 % von 10 000", () => {
    const s = size({ entry: 100, stop: 95 });
    // Verlust je Einheit = 5 + 0,0005 × (100 + 95) + 0,0005 × 95 = 5,145 → 100 / 5,145 = 19,4363…
    expect(s.lossPerUnit).toBeCloseTo(5.145, 12);
    expect(s.qty).toBeCloseTo(100 / 5.145, 10);
    const b = bill(s, { entry: 100, stop: 95, target: 110, atr: 4 });
    expect(b.costPerUnit).toBeCloseTo(0.145, 12);
    expect(b.cost).toBeCloseTo((100 / 5.145) * 0.145, 10);
    expect(b.costShare).toBeCloseTo(0.145 / 5.145, 10);
    // Mindestabstand: Kosten = 25 % des Verlusts ⇔ Abstand = 3 × Kosten je Einheit
    expect(b.minDist).toBeCloseTo(0.435, 12);
    expect(b.minDistPct).toBeCloseTo(0.00435, 12);
    expect(b.belowMin).toBe(false);
    expect(b.stopAtr).toBeCloseTo(1.25, 12);
    // Ziel: 10 Gewinn je Einheit − Gebühren beider Seiten 0,0005 × 210 = 9,895
    expect(b.target!.gain).toBeCloseTo((100 / 5.145) * 9.895, 8);
    expect(b.target!.rr.rr).toBeCloseTo(2, 12);
    expect(b.target!.rr.rrNet).toBeCloseTo(9.895 / 5.145, 10);
    expect(b.riskPct).toBeCloseTo(0.01, 12);
    expect(b.notes).toEqual([{ code: "ok", tone: "ok" }]);
    expect(b.tone).toBe("ok");
  });

  it("Short spiegelbildlich: Stop über dem Einstieg, Ziel darunter", () => {
    const s = size({ entry: 100, stop: 104, side: "short" });
    expect(s.side).toBe("short");
    const b = bill(s, { entry: 100, stop: 104, target: 92 });
    expect(b.side).toBe("short");
    expect(b.target!.rr.rr).toBeCloseTo(2, 12);
    expect(b.target!.gain).toBeCloseTo(s.qty * (8 - FEE * 192), 8);
    expect(b.targetWrongSide).toBe(false);
  });

  it("ein Ziel auf der falschen Seite wird gesagt und nicht gerechnet; ohne Ziel gibt es keinen Betrag", () => {
    const s = size({ entry: 100, stop: 95 });
    const wrong = bill(s, { entry: 100, stop: 95, target: 90 });
    expect(wrong.target).toBeNull();
    expect(wrong.targetWrongSide).toBe(true);
    expect(wrong.notes).toContainEqual({ code: "targetSide", tone: "warn" });
    const none = bill(s, { entry: 100, stop: 95 });
    expect(none.target).toBeNull();
    expect(none.targetWrongSide).toBe(false);
    expect(bill(s, { entry: 100, stop: 95, target: NaN }).targetWrongSide).toBe(false);
  });

  it("enger Stop: Kosten über einem Viertel des Risikos, Stop unter dem Mindestabstand, eng in ATR", () => {
    // Abstand 0,3 bei Kosten je Einheit 0,0005 × 199,7 + 0,0005 × 99,7 = 0,1497 → Anteil 0,1497 / 0,4497 = 33,3 %
    const s = size({ entry: 100, stop: 99.7, maxLeverage: 50 });
    const b = bill(s, { entry: 100, stop: 99.7, atr: 1 });
    expect(b.costShare).toBeCloseTo(0.1497 / 0.4497, 8);
    expect(b.costShare).toBeGreaterThan(COST_SHARE_WARN);
    expect(b.belowMin).toBe(true);
    expect(b.minDist).toBeCloseTo(0.4491, 10);
    expect(b.stopAtr).toBeCloseTo(0.3, 10);
    expect(b.notes.map((n) => n.code)).toEqual(["cost", "tight"]);
    expect(b.tone).toBe("warn");
  });

  it("genau auf dem Mindestabstand gilt die Rechnung nicht als teuer", () => {
    // d = 3c mit c = fee × (2e − d) + slip × (e − d) → d = 3 × (0,15 − 0,001 d) → d = 0,45 / 1,003
    const d = 0.45 / 1.003;
    const s = size({ entry: 100, stop: 100 - d, maxLeverage: 100 });
    const b = bill(s, { entry: 100, stop: 100 - d });
    expect(b.costShare).toBeCloseTo(0.25, 10);
    expect(b.notes).toEqual([{ code: "ok", tone: "ok" }]);
  });

  it("über der Hebel-Regel und über dem eigenen Risiko: die schwersten Hinweise zuerst", () => {
    const s = size({ entry: 100, stop: 99, riskPct: 0.03, maxLeverage: 2 });
    expect(s.overRule).toBe(true);
    const b = bill(s, { entry: 100, stop: 99, own: 0.01 });
    expect(b.notes[0]).toEqual({ code: "overRule", tone: "bad" });
    // 3 % gegen die eigene Regel von 1 %: mehr als das Doppelte → rot
    expect(b.notes).toContainEqual({ code: "overRisk", tone: "bad" });
    expect(b.tone).toBe("bad");
    // 1,5 % gegen 1 %: über der Regel, aber nicht über dem Doppelten → gelb; genau die Regel → kein Hinweis
    expect(bill(size({ entry: 100, stop: 90, riskPct: 0.015 }), { entry: 100, stop: 90, own: 0.01 }).notes).toEqual([{ code: "overRisk", tone: "warn" }]);
    expect(bill(size({ entry: 100, stop: 90, riskPct: 0.01 }), { entry: 100, stop: 90, own: 0.01 }).notes).toEqual([{ code: "ok", tone: "ok" }]);
    expect(bill(size({ entry: 100, stop: 90, riskPct: 0.05 }), { entry: 100, stop: 90, own: null }).notes).toEqual([{ code: "ok", tone: "ok" }]);
  });

  it("die Margin über dem Kapital wird gemeldet", () => {
    const s = size({ entry: 100, stop: 99.5, riskPct: 0.02, leverage: 1, maxLeverage: 100 });
    expect(s.marginOver).toBe(true);
    expect(bill(s, { entry: 100, stop: 99.5, own: 0.02 }).notes[0]).toEqual({ code: "marginOver", tone: "bad" });
  });
});

describe("Rundung auf einen Mengenschritt – nur als Hinweis", () => {
  it("der Beispiel-Schritt richtet sich nach der Größe der Menge", () => {
    expect(exampleStep(0.037)).toBe(0.001);
    expect(exampleStep(1)).toBe(0.01);
    expect(exampleStep(19.4)).toBe(0.1);
    expect(exampleStep(218)).toBe(1);
    expect(exampleStep(2680)).toBe(1);
    expect(exampleStep(0)).toBe(0.001);
    expect(exampleStep(NaN)).toBe(0.001);
  });

  it("es wird immer ABgerundet – nie mehr Risiko als geplant; Gleitkomma-Reste stören nicht", () => {
    expect(floorToStep(19.4363, 0.1)).toBe(19.4);
    expect(floorToStep(0.0379, 0.001)).toBe(0.037);
    expect(floorToStep(0.3, 0.1)).toBe(0.3);
    expect(floorToStep(1.1, 0.1)).toBe(1.1);
    expect(floorToStep(0.0009, 0.001)).toBe(0);
    expect(floorToStep(-5, 0.1)).toBe(0);
    expect(floorToStep(5, 0)).toBe(0);
  });

  it("die Rechnung zeigt die abgerundete Menge und ihren (kleineren) Verlust; ein echter Schritt des Aufrufers gilt als solcher", () => {
    const s = size({ entry: 100, stop: 95 });
    const b = bill(s, { entry: 100, stop: 95 });
    expect(b.step).toMatchObject({ step: 0.1, example: true, qty: 19.4 });
    expect(b.step.loss).toBeCloseTo(19.4 * 5.145, 10);
    expect(b.step.loss).toBeLessThanOrEqual(s.riskAmount);
    expect(b.step.notional).toBeCloseTo(1940, 10);
    expect(b.step.lossPct).toBeCloseTo((19.4 * 5.145) / 10_000, 12);
    const real = bill(s, { entry: 100, stop: 95, step: 5 });
    expect(real.step).toMatchObject({ step: 5, example: false, qty: 15 });
    // kleiner als ein Schritt: 0 – die Seite sagt es, statt aufzurunden
    expect(bill(s, { entry: 100, stop: 95, step: 50 }).step.qty).toBe(0);
  });
});
