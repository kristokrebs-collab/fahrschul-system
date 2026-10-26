/**
 * Handelsplan · der ganze Ablauf (Einstieg → Ausstieg → Größe → Risiko → Ticket) auf den deterministischen BTC-Kerzen der
 * New Yorker Sitzung vom 19.10.2026 (`tests/e2e/mocks/planCandles.ts`, dort steht auch die Handrechnung).
 */
import { describe, expect, it } from "vitest";
import { limitStatus, riskLimits } from "@/domain/risk";
import { buildPlanModel, DEFAULT_FORM, DEFAULT_PREFS, effectiveRiskPct, formOf, type ModelInput, type PlanForm } from "@/domain/plan";
import { enrich, settingsWith } from "./insights.fixtures";
import { IV, PLAN_DAY, PLAN_EXPECT, PLAN_OPEN, planCandles } from "../e2e/mocks/planCandles";

const settings = settingsWith({ capital: { makro: 20_000, scalp: 5000 } });
const limits = riskLimits(settings);
// 25.10.2026 10:00 UTC – die Sitzung vom 19.10. ist lange vorbei (Rückblick)
const LATER = Date.UTC(2026, 9, 25, 10, 0);
const report = (now: number) => limitStatus({ trades: enrich([], settings), settings, scope: "scalp", now });

const form = (over: Partial<PlanForm> = {}): PlanForm => ({ ...DEFAULT_FORM, day: PLAN_DAY, ...over });
const input = (over: Partial<ModelInput> = {}): ModelInput => {
  const now = over.now ?? LATER;
  return {
    form: form(),
    candles: planCandles(PLAN_OPEN - 40 * IV, PLAN_OPEN + 80 * IV, 1500, now),
    now,
    prefs: DEFAULT_PREFS,
    capital: 5000,
    currency: "USDT",
    limits,
    report: report(now),
    sourceLabel: "Binance USDⓈ-M",
    fetchedAt: now,
    ...over,
  };
};

describe("Handelsplan · Rückblick auf die Sitzung vom 19.10.2026", () => {
  const m = buildPlanModel(input());

  it("1 Einstieg: Range 99 880 – 100 250, das Signal Long um 9:55 New Yorker Zeit zu 100 380", () => {
    expect(m.session.dayKey).toBe(PLAN_DAY);
    expect(m.entry.status).toBe("triggered");
    expect(m.entry.range).toMatchObject({ high: PLAN_EXPECT.rangeHigh, low: PLAN_EXPECT.rangeLow, mid: PLAN_EXPECT.rangeMid });
    expect(m.entry.signal).toMatchObject({ side: "long", price: PLAN_EXPECT.signalPrice, barClose: PLAN_EXPECT.signalClose });
    expect(m.entry.past).toBe(true);
    expect(m.entrySource).toBe("signal");
    expect(m.entryPrice).toBe(100380);
    expect(m.tick).toBe(0.1);
    expect(m.tickSource).toBe("aus den Kerzen");
    expect(m.lot).toBe(0.001);
  });

  it("2 Ausstieg: Stop = Range-Mitte 100 065, Risiko 315, Ziel 2R = 101 010, ATR aus den 14 Kerzen bis zum Signal", () => {
    expect(m.exit?.ok).toBe(true);
    if (!m.exit?.ok) return;
    expect(m.exit).toMatchObject({ side: "long", entry: 100380, stop: PLAN_EXPECT.stop, target: PLAN_EXPECT.target, risk: PLAN_EXPECT.risk, rr: 2 });
    expect(m.atr!.bars).toBe(14);
    expect(m.exit.atrRatio).toBeCloseTo(315 / m.atr!.value, 10);
    // Flat by: fünf Minuten vor 24 Stunden nach 13:30 UTC? – die New Yorker Krypto-Sitzung endet nominell nach 6,5 Stunden: 19:55 UTC
    expect(m.flatByMs).toBe(PLAN_OPEN + (390 - 5) * 60_000);
  });

  it("3 Größe: der Deckel (75 % von 5 000) bindet → 0,037 BTC = 3 714,06 USDT, Verlust am Stop 17,21", () => {
    expect(m.size?.ok).toBe(true);
    if (!m.size?.ok) return;
    expect(m.riskPct).toBe(0.01);
    expect(m.size.binding).toBe("position");
    expect(m.size.qty).toBe(PLAN_EXPECT.qty);
    expect(m.size.notional).toBeCloseTo(PLAN_EXPECT.notional, 6);
    expect(m.size.maxLoss).toBeCloseTo(PLAN_EXPECT.maxLoss, 6);
  });

  it("4 Risiko: grün; 5 Ticket: fertig mit Quelle und Stand der Kerzen", () => {
    expect(m.risk!.light).toBe("green");
    expect(m.ticketPlan).toMatchObject({ symbol: "BTCUSDT", side: "long", entry: 100380, stop: 100065, target: 101010, qty: 0.037, light: "green", entrySource: "signal", sourceLabel: "Binance USDⓈ-M" });
    expect(m.ticket!.text).toContain("Quelle: Binance USDⓈ-M · Kerzen bis ");
    expect(m.candlesUntil).toBeGreaterThan(PLAN_OPEN + 70 * IV); // die letzte geschlossene Kerze des Fensters
  });

  it("alle fünf Schritte sind fertig, keiner ist \"aktuell\"", () => {
    expect(m.steps.map((s) => s.status)).toEqual(["done", "done", "done", "done", "done"]);
    expect(m.steps.some((s) => s.current)).toBe(false);
    expect(m.progress).toBe(5);
  });

  it("die Annahmen jedes Schritts stehen da", () => {
    expect(m.assumptions.entry[0]).toBe("Markt BTCUSDT · Quelle Binance USDⓈ-M · 5-Minuten-Kerzen");
    expect(m.assumptions.entry[1]).toContain("New York");
    expect(m.assumptions.entry[2]).toBe("Range: die ersten 15 Minuten (3 Kerzen); Signal: erste geschlossene Kerze, deren Schluss außerhalb liegt (Long über dem Hoch, Short unter dem Tief)");
    expect(m.assumptions.exit[0]).toBe("Stop: Mitte der Range · Ziel: 2R");
    expect(m.assumptions.exit[1]).toBe("Kursschritt 0,1 (aus den Kerzen); der Stop rundet vom Einstieg weg, das Ziel auf den nächsten Schritt");
    expect(m.assumptions.size[0]).toBe("Konto Scalp mit 5.000,00 USDT · Risiko 1,00 % pro Trade = 50,00 USDT (aus den Risiko-Einstellungen)");
    expect(m.assumptions.size[2]).toContain("Mengenschritt 0,001");
    expect(m.assumptions.risk[0]).toContain("Verlust pro Trade 2,00 %");
    expect(m.assumptions.ticket[0]).toContain("Quelle Binance USDⓈ-M · Kerzen bis ");
  });
});

describe("Handelsplan · andere Eingaben", () => {
  it("Stop Range-Gegenseite und Ziel Range-Projektion: Stop 99 880, Risiko 500, Ziel 100 250 + 370 = 100 620", () => {
    const m = buildPlanModel(input({ form: form({ stop: { kind: "range-far" }, target: { kind: "range-projection", mult: 1 } }) }));
    expect(m.exit?.ok && m.exit.stop).toBe(99880);
    expect(m.exit?.ok && m.exit.target).toBe(100620);
    // Risiko 500: Verlust je Einheit 500 + 100,2225 + 49,94 = 650,16; Menge nach dem Verlust 0,0769 – der Deckel (0,03736) bindet weiter
    expect(m.size?.ok && m.size.qty).toBe(0.037);
  });

  it("ein weiter Stop und ein enges Risiko: die Größe wird abgelehnt, das Ticket gibt es nicht", () => {
    const m = buildPlanModel(input({ form: form({ stop: { kind: "price", price: 95000 }, riskPct: 0.0005 }) }));
    expect(m.exit?.ok).toBe(true);
    expect(m.size?.ok).toBe(false);
    expect(m.size && !m.size.ok && m.size.code).toBe("too-far");
    expect(m.risk).toBeNull();
    expect(m.ticket).toBeNull();
    expect(m.steps.map((s) => s.status)).toEqual(["done", "done", "blocked", "todo", "todo"]);
    expect(m.steps.find((s) => s.current)!.id).toBe("size");
  });

  it("ein rotes Risiko sperrt das Ticket: Risiko 3 % pro Trade über dem Limit von 2 %", () => {
    const m = buildPlanModel(input({ form: form({ riskPct: 0.03, leverage: 5 }), prefs: { ...DEFAULT_PREFS, maxPositionPct: 10 } }));
    expect(m.size?.ok).toBe(true);
    expect(m.risk!.light).toBe("red");
    expect(m.ticket).toBeNull();
    expect(m.steps.map((s) => s.status)).toEqual(["done", "done", "done", "blocked", "todo"]);
  });

  it("der Kontoname und das Risiko aus den Einstellungen: ohne eigenes Risiko gilt das kleinere von Risiko-Einstellung (1 %) und Limit (2 %)", () => {
    expect(effectiveRiskPct(form(), limits)).toBe(0.01);
    expect(effectiveRiskPct(form({ riskPct: 0.015 }), limits)).toBe(0.015);
    const strict = riskLimits(settingsWith({ capital: { makro: 1, scalp: 5000 }, discipline: { maxLossTradePct: 0.005 } } as never));
    expect(effectiveRiskPct(form(), strict)).toBe(0.005);
  });

  it("Short: nur Short sucht den Schluss unter dem Tief – in diesem Tag gibt es keinen, also kein Signal", () => {
    const m = buildPlanModel(input({ form: form({ sides: "short" }) }));
    expect(m.entry.signal).toBeNull();
    expect(m.entry.status).toBe("expired");
    expect(m.entryPrice).toBeNull(); // abgelaufen: keine Planung "vorab"
    expect(m.steps[0]!.status).toBe("blocked");
    expect(m.steps.slice(1).every((s) => s.status === "todo")).toBe(true);
  });

  it("ein eigener Einstiegspreis ersetzt das Signal (Quelle \"manual\", Richtung von Hand)", () => {
    const m = buildPlanModel(input({ form: form({ manualEntry: 100300, manualSide: "short", stop: { kind: "price", price: 100500 } }) }));
    expect(m.entrySource).toBe("manual");
    expect(m.exit?.ok && m.exit).toMatchObject({ side: "short", entry: 100300, stop: 100500, target: 99900 });
    expect(m.ticketPlan?.entrySource).toBe("manual");
  });

  it("zu kleiner Zeitrahmen für die Sitzung: ein-Stunden-Kerzen beginnen nicht um 9:30 → ungültig, nichts weiter", () => {
    const m = buildPlanModel(input({ form: form({ tf: "1h", orMinutes: 60 }) }));
    expect(m.entry.status).toBe("invalid");
    expect(m.steps[0]!.status).toBe("blocked");
  });
});

describe("Handelsplan · live: das Signal ist noch nicht da", () => {
  // 13:52 UTC: Kerzen 0–3 sind geschlossen, Kerze 4 (13:50) läuft noch
  const now = PLAN_OPEN + 22 * 60_000;
  const liveCandles = planCandles(PLAN_OPEN - 40 * IV, PLAN_OPEN + 4 * IV, 1500, now);
  const m = buildPlanModel(input({ now, candles: liveCandles, report: report(now) }));

  it("Warten – und die laufende Kerze zählt nicht", () => {
    expect(m.entry.status).toBe("waiting");
    expect(m.entry.signal).toBeNull();
    expect(m.entry.past).toBe(false);
    expect(m.entry.forming).toMatchObject({ time: PLAN_OPEN + 4 * IV, price: 100380 });
    expect(m.entry.reasons.join(" ")).toContain("läuft noch");
  });

  it("vorab planen am Ausbruchsniveau (Range-Hoch 100 250): gelber Schritt, der Plan rechnet weiter", () => {
    expect(m.entrySource).toBe("level");
    expect(m.entryPrice).toBe(100250);
    expect(m.steps[0]!.status).toBe("warn");
    expect(m.exit?.ok && m.exit.risk).toBe(185); // 100 250 − 100 065
    expect(m.exit?.ok && m.exit.target).toBe(100620);
    expect(m.ticketPlan?.entrySource).toBe("level");
  });
});

describe("Handelsplan · Aktien am Wochenende und die Formular-Bereinigung", () => {
  it("die US-Börse am Samstag: keine Sitzung, Schritt 1 gesperrt", () => {
    const now = Date.UTC(2026, 9, 24, 15, 0);
    const m = buildPlanModel(input({ now, candles: [], form: form({ session: "usstocks", day: "2026-10-24" }), report: report(now) }));
    expect(m.entry.status).toBe("closed");
    expect(m.lot).toBe(1); // ganze Stück
    expect(m.tick).toBe(0.01);
    expect(m.tickSource).toBe("Voreinstellung");
    expect(m.steps[0]!.status).toBe("blocked");
  });

  it("formOf macht aus allem ein gültiges Formular", () => {
    expect(formOf(null)).toEqual(DEFAULT_FORM);
    expect(formOf({ symbol: "ethusdt", tf: "7m", session: "mars", orMinutes: "30", sides: "short", leverage: "3", stop: { kind: "atr", mult: "1,5" }, target: { kind: "r", r: -1 }, day: "2026-02-30", flatBy: "25:00", riskPct: 5 })).toMatchObject({
      symbol: "ETHUSDT",
      tf: "5m",
      session: "newyork",
      orMinutes: 30,
      sides: "short",
      leverage: 3,
      stop: { kind: "atr", mult: 1.5 },
      target: { kind: "r", r: 2 },
      day: null,
      flatBy: null,
      riskPct: null,
    });
    expect(formOf({ stop: { kind: "pct", pct: 0 } }).stop).toEqual({ kind: "range-mid" });
    expect(formOf({ target: { kind: "level", price: 101000, name: "4H-Marke" } }).target).toEqual({ kind: "level", price: 101000, name: "4H-Marke" });
  });
});
