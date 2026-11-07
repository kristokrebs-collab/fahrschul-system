/**
 * Handelsplan · Positionsgröße (Skill trader-budget): ganze Einheiten innerhalb von vier Grenzen, die kleinste gewinnt und
 * heißt "bindend". Alles von Hand gerechnet.
 *
 * Aktien (ohne Kosten, damit die Handrechnung glatt bleibt): TSLA 364,18, Stop 358,32 → Risiko je Aktie 5,86.
 *   Konto 10 000, Risiko 1 % = 100        Verlust  100 ÷ 5,86 = 17,065 → 17
 *   Deckel 75 % = 7 500 ÷ 364,18          Position 20,594
 *   Cash 9 000 (10 % Puffer, Hebel 1)     Kaufkraft 24,712
 *   Tageslimit-Rest 400                   Tag      400 ÷ 5,86 = 68,26
 */
import { describe, expect, it } from "vitest";
import { floorLot, positionSizing, LIMIT_LABEL, type SizeInput, type Sizing, type SizeRefusal } from "@/domain/plan";

const stock = (over: Partial<SizeInput> = {}): SizeInput => ({
  side: "long",
  entry: 364.18,
  stop: 358.32,
  tick: 0.01,
  capital: 10_000,
  riskPct: 0.01,
  maxPositionPct: 0.75,
  cashBufferPct: 0.1,
  leverage: 1,
  dayRemaining: 400,
  lot: 1,
  feePct: 0,
  slippagePct: 0,
  minOrderValue: 5,
  currency: "USD",
  ...over,
});
const ok = (i: SizeInput): Sizing => {
  const r = positionSizing(i);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r;
};
const no = (i: SizeInput): SizeRefusal => {
  const r = positionSizing(i);
  if (r.ok) throw new Error("expected a refusal");
  return r;
};

describe("Positionsgröße · die vier Grenzen (Aktien, ganze Stück)", () => {
  it("Verlust bindet: 100 ÷ 5,86 = 17,07 → 17 Aktien; Verlust am Stop 17 × 5,86 = 99,62", () => {
    const s = ok(stock());
    expect(s.qty).toBe(17);
    expect(s.binding).toBe("loss");
    expect(s.priceLoss).toBeCloseTo(99.62, 8);
    expect(s.maxLoss).toBeCloseTo(99.62, 8);
    expect(s.notional).toBeCloseTo(17 * 364.18, 8); // 6 191,06
    expect(s.riskOfCapital).toBeCloseTo(0.009962, 8);
    const by = Object.fromEntries(s.rows.map((r) => [r.key, r]));
    expect(by.loss!.qty).toBeCloseTo(100 / 5.86, 10);
    expect(by.position!.qty).toBeCloseTo(7500 / 364.18, 10); // 20,594
    expect(by.power!.qty).toBeCloseTo(9000 / 364.18, 10); // 24,712
    expect(by.day!.qty).toBeCloseTo(400 / 5.86, 10); // 68,26
    expect(s.rows.map((r) => r.rounded)).toEqual([17, 20, 24, 68]);
    expect(s.rows.filter((r) => r.binding).map((r) => r.key)).toEqual(["loss"]);
    expect(s.headline).toBe("Dein Risiko pro Trade bindet: mehr Menge würde am Stop mehr als 100,00 USD verlieren.");
  });

  it("Positionsdeckel bindet: Konto 2 000, Risiko 2 % = 40 → 6,83; Deckel 1 500 ÷ 364,18 = 4,12 → 4", () => {
    const s = ok(stock({ capital: 2000, riskPct: 0.02 }));
    expect(s.binding).toBe("position");
    expect(s.qty).toBe(4);
    expect(s.rows.find((r) => r.key === "position")!.detail).toBe("75 % von 2.000,00 USD = 1.500,00 USD ÷ Einstieg 364,18");
    expect(s.maxLoss).toBeCloseTo(4 * 5.86, 8); // 23,44 – weit unter dem Risiko von 40
  });

  it("Kaufkraft bindet: Puffer 50 % → 1 000 ÷ 364,18 = 2,75 → 2; mit Hebel 3 wären es 8", () => {
    const s = ok(stock({ capital: 2000, riskPct: 0.02, maxPositionPct: 2, cashBufferPct: 0.5 }));
    expect(s.binding).toBe("power");
    expect(s.qty).toBe(2);
    expect(ok(stock({ capital: 2000, riskPct: 0.02, maxPositionPct: 5, cashBufferPct: 0.5, leverage: 3 })).qty).toBe(6); // 3 000 ÷ 364,18 = 8,24 – aber der Verlust (40 ÷ 5,86 = 6,83) bindet
    expect(ok(stock({ capital: 2000, riskPct: 0.1, maxPositionPct: 5, cashBufferPct: 0.5, leverage: 3 })).qty).toBe(8); // Kaufkraft 3 000 ÷ 364,18 = 8,24 → 8
  });

  it("Tageslimit-Rest bindet: 30 ÷ 5,86 = 5,12 → 5", () => {
    const s = ok(stock({ dayRemaining: 30 }));
    expect(s.binding).toBe("day");
    expect(s.qty).toBe(5);
    expect(s.headline).toBe("Der Rest des Tageslimits bindet (30,00 USD): heute ist nicht mehr Verlust eingeplant.");
  });

  it("Gleichstand: die erste Grenze in der Reihenfolge Verlust, Position, Kaufkraft, Tag bindet", () => {
    // Verlust 100 ÷ 5,86 und Tag 100 ÷ 5,86 sind gleich
    expect(ok(stock({ dayRemaining: 100 })).binding).toBe("loss");
  });

  it("ohne bekanntes Tageslimit entfällt die Zeile", () => {
    const s = ok(stock({ dayRemaining: null }));
    expect(s.rows.find((r) => r.key === "day")).toMatchObject({ qty: null, rounded: null, detail: "Kein Tageslimit bekannt." });
    expect(s.qty).toBe(17);
  });

  it("die Namen der Grenzen", () => {
    expect(LIMIT_LABEL).toEqual({ loss: "Max. Verlust pro Trade", position: "Max. Positionswert", power: "Kaufkraft (Hebel, Cash-Puffer)", day: "Rest des Tageslimits" });
  });
});

describe("Positionsgröße · Krypto: Mengenschritt 0,001, Gebühren und Slippage im Puffer", () => {
  // BTC 100 380 → Stop 100 065 (Abstand 315), Konto 5 000, Risiko 1 % = 50, Gebühr 0,05 % je Seite, Slippage 0,05 % am Stop
  // Verlust je Einheit = 315 + 0,0005 × (100 380 + 100 065) + 0,0005 × 100 065 = 315 + 100,2225 + 50,0325 = 465,255
  const btc = (over: Partial<SizeInput> = {}): SizeInput => ({
    side: "long",
    entry: 100380,
    stop: 100065,
    tick: 0.1,
    capital: 5000,
    riskPct: 0.01,
    maxPositionPct: 0.75,
    cashBufferPct: 0.1,
    leverage: 1,
    dayRemaining: 200,
    lot: 0.001,
    feePct: 0.0005,
    slippagePct: 0.0005,
    minOrderValue: 5,
    currency: "USDT",
    ...over,
  });

  it("Verlust je Einheit 465,255; der Deckel (3 750 ÷ 100 380 = 0,037358) bindet → 0,037 BTC", () => {
    const s = ok(btc());
    expect(s.lossPerUnit).toBeCloseTo(465.255, 8);
    const by = Object.fromEntries(s.rows.map((r) => [r.key, r]));
    expect(by.loss!.qty).toBeCloseTo(50 / 465.255, 10); // 0,10747
    expect(by.position!.qty).toBeCloseTo(3750 / 100380, 10); // 0,037358
    expect(by.power!.qty).toBeCloseTo(4500 / 100380, 10); // 0,044830
    expect(by.day!.qty).toBeCloseTo(200 / 465.255, 10); // 0,42988
    expect(s.binding).toBe("position");
    expect(s.qty).toBe(0.037); // ab auf den Schritt, ohne Gleitkomma-Staub
    expect(s.notional).toBeCloseTo(3714.06, 8);
    expect(s.maxLoss).toBeCloseTo(0.037 * 465.255, 8); // 17,2144
    expect(s.priceLoss).toBeCloseTo(0.037 * 315, 8); // 11,655
    expect(s.fees).toBeCloseTo(0.037 * 0.0005 * (100380 + 100065), 8);
    expect(s.slippage).toBeCloseTo(0.037 * 0.0005 * 100065, 8);
    expect(s.maxLoss).toBeCloseTo(s.priceLoss + s.fees + s.slippage, 8);
  });

  it("Rundung immer AB: 0,1074 → 0,107 und nicht 0,108; 0,0369999 → 0,036", () => {
    expect(floorLot(0.10747, 0.001)).toBe(0.107);
    expect(floorLot(0.108999, 0.001)).toBe(0.108);
    expect(floorLot(0.0369999, 0.001)).toBe(0.036);
    expect(floorLot(0.3, 0.1)).toBe(0.3); // 0,3 ÷ 0,1 = 2,9999… im Gleitkomma
    expect(floorLot(7, 1)).toBe(7);
    expect(floorLot(0.0004, 0.001)).toBe(0);
  });

  it("mit Hebel 3 fällt die Kaufkraft nicht mehr ins Gewicht; der Verlust bindet: 0,10747 → 0,107, Hebel nötig 2,14", () => {
    const s = ok(btc({ leverage: 3, maxPositionPct: 5, dayRemaining: 1000 }));
    expect(s.binding).toBe("loss");
    expect(s.qty).toBe(0.107);
    expect(s.notional).toBeCloseTo(0.107 * 100380, 8); // 10 740,66
    expect(s.neededLeverage).toBeCloseTo(10740.66 / 5000, 8);
    expect(s.margin).toBeCloseTo(10740.66 / 3, 8);
    expect(s.maxLoss).toBeCloseTo(0.107 * 465.255, 8); // 49,78
    expect(s.maxLoss).toBeLessThan(50);
  });

  it("Short: Verlust je Einheit mit den Kosten am Stop-Preis oben", () => {
    // Short 100 000, Stop 100 300 (Abstand 300): 300 + 0,0005 × 200 300 + 0,0005 × 100 300 = 300 + 100,15 + 50,15 = 450,3
    const s = ok(btc({ side: "short", entry: 100000, stop: 100300 }));
    expect(s.lossPerUnit).toBeCloseTo(450.3, 8);
    expect(s.rows[0]!.qty).toBeCloseTo(50 / 450.3, 10);
  });
});

describe("Positionsgröße · klare Ablehnungen statt stiller Verkleinerung", () => {
  it("Stop zu weit für das Risiko: schon eine Aktie würde mehr verlieren als erlaubt – keine kleinere Position, kein engerer Stop", () => {
    // Konto 1 000, Risiko 0,1 % = 1 → 1 ÷ 5,86 = 0,17 → 0 Aktien
    const r = no(stock({ capital: 1000, riskPct: 0.001, dayRemaining: 40 }));
    expect(r.code).toBe("too-far");
    expect(r.reason).toBe("Schon die kleinste Menge (1) würde am Stop 5,86 USD verlieren – mehr als dein Risiko von 1,00 USD. Der Stop ist für dieses Risiko zu weit weg. Die App macht daraus keine kleinere Position und rückt den Stop nicht: Stop näher setzen, das Risiko erhöhen oder den Trade auslassen.");
    expect(r.rows).toHaveLength(4);
  });

  it("Tageslimit schon erreicht: heute keine neue Position", () => {
    const r = no(stock({ dayRemaining: 0 }));
    expect(r.code).toBe("day");
    expect(r.reason).toBe("Das Tageslimit ist schon erreicht – heute keine neue Position.");
    expect(no(stock({ dayRemaining: 3 })).reason).toContain("Der Rest des Tageslimits (3,00 USD) reicht nicht einmal für die kleinste Menge (1)");
  });

  it("die kleinste Menge passt nicht in Deckel oder Kaufkraft", () => {
    const small = no(stock({ capital: 300, riskPct: 0.5, maxPositionPct: 0.75, dayRemaining: null }));
    expect(small.code).toBe("position"); // 225 ÷ 364,18 = 0,62 → 0
    expect(small.reason).toContain("mehr als der Deckel für eine Position erlaubt (225,00 USD)");
    expect(no(stock({ capital: 300, riskPct: 0.5, maxPositionPct: 5, dayRemaining: null })).code).toBe("power");
  });

  it("Mindestwert einer Position: 7 Stück zu 2,00 = 14,00 liegen unter dem Minimum von 20,00", () => {
    // Konto 20, Risiko 5 % = 1,00, Abstand 0,10 → 10 Stück; Deckel 15 ÷ 2 = 7,5; Kaufkraft 18 ÷ 2 = 9 → 7 Stück = 14
    const i = stock({ capital: 20, riskPct: 0.05, entry: 2, stop: 1.9, dayRemaining: null, minOrderValue: 0 });
    expect(ok(i).qty).toBe(7);
    const r = no({ ...i, minOrderValue: 20 });
    expect(r.code).toBe("min-order");
    expect(r.reason).toBe("Der Positionswert 14,00 USD liegt unter dem Minimum von 20,00 USD.");
  });

  it("ungültige Eingaben", () => {
    expect(no(stock({ capital: 0 })).reason).toBe("Das Konto hat kein Kapital – trage es in den Einstellungen ein.");
    expect(no(stock({ riskPct: 0 })).reason).toBe("Das Risiko pro Trade muss zwischen 0 und 100 % liegen.");
    expect(no(stock({ lot: 0 })).reason).toBe("Der Mengenschritt muss über null liegen.");
    expect(no(stock({ leverage: 0.5 })).reason).toBe("Der Hebel ist mindestens 1 (kein Hebel).");
    expect(no(stock({ stop: 370 })).reason).toBe("Der Stop liegt auf der falschen Seite des Einstiegs.");
    expect(no(stock({ entry: Number.NaN })).reason).toBe("Eine Eingabe fehlt oder ist keine Zahl.");
  });
});
