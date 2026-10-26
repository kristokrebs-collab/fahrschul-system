/**
 * Handelsplan · Ausstiegsplan (Skill trader-exit). Der Fall des Skills: TSLA, Einstieg 364,18, Range 362,18 / 354,47:
 * Mitte 358,325 → Stop 358,32 (ab auf den Cent), Risiko 5,86 (1,61 % des Preises), 1R-Ziel 370,04, 2R-Ziel 375,90.
 */
import { describe, expect, it } from "vitest";
import { exitPlan, stopRuleText, targetRuleText, ATR_TIGHT, ATR_WIDE, MIN_RISK_FRACTION, type ExitInput, type ExitPlan, type ExitRefusal } from "@/domain/plan";

const RANGE = { high: 362.18, low: 354.47 };
const base = (over: Partial<ExitInput> = {}): ExitInput => ({
  side: "long",
  entry: 364.18,
  range: RANGE,
  atr: { value: 4, bars: 14 },
  stop: { kind: "range-mid" },
  target: { kind: "r", r: 2 },
  tick: 0.01,
  ...over,
});
const ok = (i: ExitInput): ExitPlan => {
  const r = exitPlan(i);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r;
};
const no = (i: ExitInput): ExitRefusal => {
  const r = exitPlan(i);
  if (r.ok) throw new Error("expected a refusal");
  return r;
};

describe("Ausstiegsplan · Stop", () => {
  it("Range-Mitte (358,325) rundet vom Einstieg weg auf 358,32; Risiko 5,86 = 1,61 %", () => {
    const p = ok(base({ target: { kind: "r", r: 1 } }));
    expect(p.stop).toBe(358.32);
    expect(p.risk).toBeCloseTo(5.86, 10);
    expect(p.riskPct).toBeCloseTo(5.86 / 364.18, 10);
    expect(p.stopLabel).toBe("Mitte der Range");
    expect(p.stopDetail).toBe("(362,18 + 354,47) / 2 = 358,325, vom Einstieg weg auf 358,32 gerundet");
  });

  it("Range-Gegenseite: beim Long das Tief 354,47 (Risiko 9,71), beim Short das Hoch", () => {
    expect(ok(base({ stop: { kind: "range-far" } })).stop).toBe(354.47);
    expect(ok(base({ stop: { kind: "range-far" } })).risk).toBeCloseTo(9.71, 10);
    const s = ok(base({ side: "short", entry: 353, stop: { kind: "range-far" } }));
    expect(s.stop).toBe(362.18);
    expect(stopRuleText({ kind: "range-far" }, "short")).toBe("Hoch der Range");
  });

  it("ATR-Stop: 1,5 × 4,00 unter dem Einstieg = 358,18 (genau); mit weniger als 14 Kerzen sagt es das", () => {
    const p = ok(base({ stop: { kind: "atr", mult: 1.5 } }));
    expect(p.stop).toBe(358.18);
    expect(p.atrRatio).toBeCloseTo(1.5, 10);
    expect(p.stopDetail).toBe("ATR 4 über 14 Kerzen");
    expect(ok(base({ stop: { kind: "atr", mult: 1.5 }, atr: { value: 4, bars: 9 } })).stopDetail).toBe("ATR 4 über 9 Kerzen (weniger als 14 vorhanden)");
    expect(no(base({ stop: { kind: "atr", mult: 1.5 }, atr: null })).code).toBe("atr");
  });

  it("Prozent-Stop: 1,5 % unter 364,18 = 358,7173 → ab auf 358,71", () => {
    const p = ok(base({ stop: { kind: "pct", pct: 1.5 } }));
    expect(p.stop).toBe(358.71);
    expect(p.risk).toBeCloseTo(5.47, 10);
  });

  it("eigener Preis wird übernommen (und auf den Schritt gerundet)", () => {
    expect(ok(base({ stop: { kind: "price", price: 360 } })).stop).toBe(360);
    expect(ok(base({ stop: { kind: "price", price: 360.004 } })).stop).toBe(360);
  });

  it("Short spiegelt: Stop über dem Einstieg, aufgerundet – Mitte 358,325 → 358,33, Risiko 5,33, 2R-Ziel 342,34", () => {
    const p = ok(base({ side: "short", entry: 353 }));
    expect(p.stop).toBe(358.33);
    expect(p.risk).toBeCloseTo(5.33, 10);
    expect(p.target).toBeCloseTo(353 - 2 * 5.33, 10); // 342,34
    expect(p.target).toBe(342.34);
  });

  it("Kursschritt 0,1 (Krypto): 100 065 bleibt, 100 064,96 rundet ab", () => {
    const p = ok({ side: "long", entry: 100380, range: { high: 100250, low: 99880 }, atr: null, stop: { kind: "range-mid" }, target: { kind: "r", r: 2 }, tick: 0.1 });
    expect(p.stop).toBe(100065); // (100250 + 99880) / 2
    expect(p.risk).toBe(315);
    expect(p.target).toBe(101010);
    expect(ok({ side: "long", entry: 100380, range: null, atr: null, stop: { kind: "pct", pct: 0.3 }, target: { kind: "r", r: 1 }, tick: 0.1 }).stop).toBe(100078.8); // 100380 × 0,997 = 100078,86 → ab
  });
});

describe("Ausstiegsplan · Ziel", () => {
  it("R-Vielfaches: 1R = 370,04, 2R = 375,90 (5,86 × 2 = 11,72 → 375,90)", () => {
    expect(ok(base({ target: { kind: "r", r: 1 } })).target).toBe(370.04);
    const two = ok(base());
    expect(two.target).toBe(375.9);
    expect(two.rr).toBeCloseTo(2, 10);
    expect(two.targetLabel).toBe("2R");
    expect(two.targetDetail).toBe("364,18 + 2 × 5,86");
    expect(targetRuleText({ kind: "r", r: 1.5 })).toBe("1,5R");
  });

  it("Range-Projektion: die Range-Höhe 7,71 ab dem durchbrochenen Hoch → 369,89 (Short: ab dem Tief nach unten)", () => {
    const p = ok(base({ target: { kind: "range-projection", mult: 1 } }));
    expect(p.target).toBe(369.89);
    expect(p.targetDetail).toBe("Range-Hoch 362,18 + 1,0 × Range-Höhe 7,71, 0,97 × das Risiko");
    const s = ok(base({ side: "short", entry: 353, target: { kind: "range-projection", mult: 1 } }));
    expect(s.target).toBe(346.76); // 354,47 − 7,71
  });

  it("Schlüsselmarke und eigener Preis: das Ziel ist der Preis, R wird ausgerechnet", () => {
    const p = ok(base({ target: { kind: "level", price: 372, name: "4H-Widerstand" } }));
    expect(p.target).toBe(372);
    expect(p.rr).toBeCloseTo((372 - 364.18) / 5.86, 10);
    expect(p.targetLabel).toBe("Schlüsselmarke 4H-Widerstand");
    expect(ok(base({ target: { kind: "price", price: 380 } })).targetLabel).toBe("eigener Preis");
  });

  it("Gleichstand beim Runden geht vom Einstieg weg: Long 104,5 → 105, Short 95,5 → 95 (Kursschritt 1)", () => {
    const long = ok({ side: "long", entry: 100, range: null, atr: null, stop: { kind: "price", price: 97 }, target: { kind: "r", r: 1.5 }, tick: 1 });
    expect(long.target).toBe(105);
    const short = ok({ side: "short", entry: 100, range: null, atr: null, stop: { kind: "price", price: 103 }, target: { kind: "r", r: 1.5 }, tick: 1 });
    expect(short.target).toBe(95);
  });
});

describe("Ausstiegsplan · Ablehnungen (mit Grund, nichts wird zurechtgebogen)", () => {
  it("Stop auf oder über dem Einstieg (Long), auf oder unter dem Einstieg (Short)", () => {
    const a = no(base({ stop: { kind: "price", price: 364.18 } }));
    expect(a.code).toBe("stop-side");
    expect(a.reason).toBe("Der Stop 364,18 liegt auf oder über dem Einstieg 364,18 – bei Long gehört er darunter.");
    expect(no(base({ stop: { kind: "price", price: 370 } })).code).toBe("stop-side");
    const b = no(base({ side: "short", entry: 353, stop: { kind: "price", price: 350 } }));
    expect(b.reason).toBe("Der Stop 350,00 liegt auf oder unter dem Einstieg 353,00 – bei Short gehört er darüber.");
  });

  it("Risiko unter 0,05 % des Preises: zu eng für den Spread", () => {
    const r = no({ ...base(), entry: 100, stop: { kind: "price", price: 99.96 } });
    expect(r.code).toBe("stop-tight");
    expect(r.reason).toContain("unter 0,05 % des Preises");
    expect(MIN_RISK_FRACTION).toBe(0.0005);
    // genau 0,05 % ist erlaubt
    expect(exitPlan({ ...base(), entry: 100, stop: { kind: "price", price: 99.95 } }).ok).toBe(true);
  });

  it("Stop bei null oder darunter", () => {
    expect(no({ ...base(), entry: 5, stop: { kind: "pct", pct: 100 } }).code).toBe("rule");
    expect(no(base({ stop: { kind: "price", price: 0 } })).code).toBe("stop-zero");
  });

  it("Ziel auf der falschen Seite: die Bewegung ist schon passiert", () => {
    const r = no(base({ target: { kind: "level", price: 363, name: "Marke" } }));
    expect(r.code).toBe("target-side");
    expect(r.reason).toBe("Das Ziel 363,00 liegt auf oder unter dem Einstieg 364,18 – bei Long gehört es darüber. Die Bewegung, auf die das Ziel wartet, ist dann schon passiert.");
    expect(no(base({ side: "short", entry: 353, target: { kind: "price", price: 360 } })).code).toBe("target-side");
  });

  it("Range-Stops ohne fertige Range, Einstieg zur oder nach der Flat-by-Zeit", () => {
    expect(no(base({ range: null })).code).toBe("range");
    expect(no(base({ range: null, target: { kind: "range-projection", mult: 1 }, stop: { kind: "pct", pct: 1 } })).code).toBe("range");
    const flat = Date.UTC(2026, 9, 19, 19, 55);
    expect(no(base({ entryMs: flat, flatByMs: flat, tz: "America/New_York" })).reason).toBe("Der Einstieg liegt zur oder nach der „Flat by“-Zeit (15:55 Uhr) – bis dahin sollst du draußen sein, ein Einstieg danach hat keinen Platz mehr im Plan.");
    expect(exitPlan(base({ entryMs: flat - 1, flatByMs: flat })).ok).toBe(true);
  });

  it("kein Einstieg, kein Kursschritt", () => {
    expect(no(base({ entry: 0 })).code).toBe("entry");
    expect(no(base({ tick: 0 })).code).toBe("rule");
  });
});

describe("Ausstiegsplan · Hinweise zur ATR", () => {
  it("Stop unter 0,5 ATR: zu eng für das Kerzenrauschen", () => {
    const p = ok(base({ stop: { kind: "price", price: 363 }, atr: { value: 4, bars: 14 } })); // 1,18 / 4 = 0,295
    expect(p.hints.map((h) => h.key)).toContain("atr-tight");
    expect(p.hints.find((h) => h.key === "atr-tight")!.text).toBe("Der Stop ist nur 0,30 ATR vom Einstieg entfernt – normales Kerzenrauschen kann ihn auslösen (Richtwert der App: unter 0,5 ATR).");
    expect(ATR_TIGHT).toBe(0.5);
  });

  it("Stop über 3 ATR: zu weit", () => {
    const p = ok(base({ stop: { kind: "price", price: 350 }, atr: { value: 4, bars: 14 } })); // 14,18 / 4 = 3,545
    expect(p.hints.find((h) => h.key === "atr-wide")!.text).toBe("Der Stop ist 3,55 ATR weit – die Menge wird klein, und das Risiko ist groß im Vergleich zur üblichen Bewegung (Richtwert der App: über 3 ATR).");
    expect(ATR_WIDE).toBe(3);
  });

  it("zwischen 0,5 und 3 ATR kein Hinweis; ohne ATR der Hinweis, dass sich das nicht sagen lässt; Ziel näher als der Stop", () => {
    expect(ok(base()).hints).toEqual([]);
    expect(ok(base({ atr: null })).hints[0]!.key).toBe("atr-short");
    const low = ok(base({ target: { kind: "r", r: 0.5 } }));
    expect(low.hints.find((h) => h.key === "rr-low")!.text).toBe("Das Ziel ist nur 0,50 × so weit entfernt wie der Stop: ohne Kosten bräuchte es eine Trefferquote von über 67 %, um bei null zu landen.");
  });
});
