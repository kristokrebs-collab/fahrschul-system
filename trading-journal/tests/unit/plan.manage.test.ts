/**
 * Verwaltungsplan (F65) · jede Zahl mit Handrechnung.
 *
 * Long: Einstieg 100, Stop 95 (1R = 5 je Einheit), Ziel 110, Menge 10 → 1R = 50. Gebühr 0,1 % je Seite, Slippage 0.
 *   Einstiegsgebühr 0,001 · 100 · 10 = 1,00.
 *   Stop:        −5 · 10 = −50;  Gebühr 0,001 · 95 · 10 = 0,95  → −50 − 1,00 − 0,95 = −51,95  (R −1,039)
 *   Ziel:        +10 · 10 = +100; Gebühr 0,001 · 110 · 10 = 1,10 → 100 − 1,00 − 1,10 = 97,90   (R 1,958)
 *   Break-even (Einstieg): Auslöser 105, neuer Stop 100 → 0 − 1,00 − 1,00 = −2,00              (R −0,04)
 *   Break-even (netto):    (100 + 0,001 · 100) / (1 − 0,001) = 100,2002 → auf den Kursschritt 0,01 AUF = 100,21
 *                          (100,21 − 100) · 10 = 2,10 − 1,00 − 1,0021 = +0,0979                (kein Verlust)
 *   Teilziel +1,5R (107,50), 50 % = 5 Stück: 7,5 · 5 = 37,50 − Gebühr 0,5375 = 36,9625 gebucht
 *     Rest am Stop 100: 0 − 0,50 → gesamt 37,50 − 1,00 − 0,5375 − 0,50 = 35,4625                 (R 0,70925)
 *     Rest am Ziel 110: 50 − 0,55 → gesamt 87,50 − 1,00 − 0,5375 − 0,55 = 85,4125               (R 1,70825)
 *   Trailing 2 × ATR (ATR 1,5 → 3) ab +1R (105): erster Stop 102 → (2 · 10) − 1,00 − 1,02 = 17,98 (R 0,3596)
 */
import { describe, expect, it } from "vitest";
import { sanitizeCustom } from "@/domain/lab";
import { buildPlanModel, buildTicket, DEFAULT_FORM, DEFAULT_MANAGE, DEFAULT_PREFS, formOf, MANAGE_LIMITS, manageActive, manageEqual, managePlan, manageSpecOf, manageSummary, netBreakEvenPrice, normalizePlan, type ManageInput, type ManageSpec, type ManagePlan, type PlanForm } from "@/domain/plan";
import { limitStatus, riskLimits } from "@/domain/risk";
import { enrich, settingsWith } from "./insights.fixtures";
import { IV, PLAN_DAY, PLAN_OPEN, planCandles } from "../e2e/mocks/planCandles";

const spec = (o: { be?: Partial<ManageSpec["breakEven"]>; pa?: Partial<ManageSpec["partial"]>; tr?: Partial<ManageSpec["trail"]> }): ManageSpec =>
  manageSpecOf({ breakEven: { ...DEFAULT_MANAGE.breakEven, ...o.be }, partial: { ...DEFAULT_MANAGE.partial, ...o.pa }, trail: { ...DEFAULT_MANAGE.trail, ...o.tr } });

const base = (over: Partial<ManageInput> = {}): ManageInput => ({
  side: "long",
  entry: 100,
  stop: 95,
  target: 110,
  qty: 10,
  lot: 0.1,
  tick: 0.01,
  feePct: 0.001,
  slippagePct: 0,
  atr: 1.5,
  spec: DEFAULT_MANAGE,
  currency: "USDT",
  unit: "BTC",
  ...over,
});
const plan = (over: Partial<ManageInput> = {}): ManagePlan => {
  const r = managePlan(base(over));
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const sc = (p: ManagePlan, id: string) => p.scenarios.find((s) => s.id === id)!;

describe("Verwaltungsplan · die Regel-Eingabe", () => {
  it("manageSpecOf macht aus allem eine gültige Eingabe und klemmt in dieselben Bereiche wie das Labor", () => {
    expect(manageSpecOf(null)).toEqual(DEFAULT_MANAGE);
    expect(manageSpecOf("kaputt")).toEqual(DEFAULT_MANAGE);
    const wild = { breakEven: { on: true, trigger: "r", value: 99, to: "net" }, trail: { on: true, kind: "atr", value: 99, activateR: 99 }, partial: { on: true, atR: 99, fracPct: 99, thenBreakEven: false } };
    const mine = manageSpecOf(wild);
    const lab = sanitizeCustom({ exits: wild }).exits;
    expect(mine.breakEven).toEqual(lab.breakEven);
    expect(mine.trail).toEqual(lab.trail);
    expect(mine.partial).toEqual(lab.partial);
    const low = { breakEven: { on: true, trigger: "pct", value: 0, to: "x" }, trail: { on: true, kind: "pct", value: 0, activateR: -3 }, partial: { on: true, atR: 0, fracPct: 1 } };
    const m2 = manageSpecOf(low);
    const l2 = sanitizeCustom({ exits: low }).exits;
    expect(m2.breakEven).toEqual(l2.breakEven);
    expect(m2.trail).toEqual(l2.trail);
    expect(m2.partial).toEqual(l2.partial);
    expect(MANAGE_LIMITS.partialPct).toEqual({ min: 5, max: 95 });
  });

  it("Zahlen als Text mit Komma werden gelesen, Unsinn fällt auf den Standard", () => {
    expect(manageSpecOf({ breakEven: { on: true, value: "1,5" } }).breakEven.value).toBe(1.5);
    expect(manageSpecOf({ breakEven: { on: true, value: "abc" } }).breakEven.value).toBe(1);
    expect(manageSpecOf({ breakEven: { on: "ja" } }).breakEven.on).toBe(false);
  });

  it("manageActive, manageEqual und manageSummary", () => {
    expect(manageActive(DEFAULT_MANAGE)).toBe(false);
    expect(manageSummary(DEFAULT_MANAGE)).toBeNull();
    const m = spec({ be: { on: true, to: "net" }, pa: { on: true, atR: 1.5 }, tr: { on: true } });
    expect(manageActive(m)).toBe(true);
    expect(manageEqual(m, manageSpecOf(JSON.parse(JSON.stringify(m))))).toBe(true);
    expect(manageEqual(m, DEFAULT_MANAGE)).toBe(false);
    expect(manageSummary(m)).toBe("Break-even ab +1 R auf Netto-Break-even · Teilziel 50 % bei +1,5 R, danach Break-even · Trailing 2 × ATR ab +1 R");
  });
});

describe("Verwaltungsplan · Netto-Break-even", () => {
  it("(100 + 0,1) / (1 − 0,001) = 100,2002 – und mit Slippage", () => {
    const p = { side: "long" as const, entry: 100, qtyOpen: 10, entryFee: 1, booked: 0, feePct: 0.001, slippagePct: 0 };
    expect(netBreakEvenPrice(p)).toBeCloseTo(100.2002002, 6);
    expect(netBreakEvenPrice({ ...p, slippagePct: 0.001 })).toBeCloseTo(100.1 / 0.998, 6);
    // der Teilgewinn deckt die Einstiegsgebühr: der Rest darf unter den Einstieg
    expect(netBreakEvenPrice({ ...p, qtyOpen: 5, booked: 36.9625 })).toBeCloseTo((100 + (1 - 36.9625) / 5) / 0.999, 6);
    // Short spiegelt
    expect(netBreakEvenPrice({ ...p, side: "short" })).toBeCloseTo(99.9 / 1.001, 6);
  });
});

describe("Verwaltungsplan · Long, Handrechnung", () => {
  it("ohne Regel: aktiv = false, keine Schritte, keine Beispielrechnungen", () => {
    const p = plan();
    expect(p.active).toBe(false);
    expect(p.steps).toEqual([]);
    expect(p.scenarios).toEqual([]);
    expect(p.lines).toEqual([]);
    expect(p.firstTrigger).toBeNull();
  });

  it("Break-even auf den Einstieg nach +1R: Auslöser 105, Stop 100, Ergebnis −2,00", () => {
    const p = plan({ spec: spec({ be: { on: true } }) });
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0]).toMatchObject({ id: "breakEven", trigger: 105, stopAfter: 100, never: false });
    expect(p.firstTrigger).toBe(105);
    expect(sc(p, "stop").pnl).toBeCloseTo(-51.95, 9);
    expect(sc(p, "stop").r).toBeCloseTo(-1.039, 9);
    expect(sc(p, "target").pnl).toBeCloseTo(97.9, 9);
    expect(sc(p, "target").r).toBeCloseTo(1.958, 9);
    expect(sc(p, "breakEven").pnl).toBeCloseTo(-2, 9);
    expect(sc(p, "breakEven").r).toBeCloseTo(-0.04, 9);
    expect(p.lines).toEqual([{ label: "Break-even", text: "ab 105,00 (+1 R) Stop auf 100,00 (Einstieg)" }]);
  });

  it("Break-even auf den Netto-Break-even: Stop 100,21 (aufgerundet), Ergebnis +0,0979 – nie unter null", () => {
    const p = plan({ spec: spec({ be: { on: true, to: "net" } }) });
    expect(p.steps[0]!.stopAfter).toBe(100.21);
    expect(sc(p, "breakEven").pnl).toBeCloseTo(0.0979, 9);
    expect(sc(p, "breakEven").pnl).toBeGreaterThanOrEqual(0);
    expect(p.steps[0]!.then).toContain("Netto-Break-even");
  });

  it("Break-even nach Prozent: +2 % von 100 = 102", () => {
    const p = plan({ spec: spec({ be: { on: true, trigger: "pct", value: 2 } }) });
    expect(p.steps[0]!.trigger).toBe(102);
    expect(p.steps[0]!.when).toContain("+2 %");
  });

  it("Teilziel +1,5R, 50 %: 5 Stück bei 107,50, Rest am Stop 100 oder am Ziel 110", () => {
    const p = plan({ spec: spec({ be: { on: true }, pa: { on: true, atR: 1.5 } }) });
    expect(p.partial).toEqual({ qty: 5, rest: 5, price: 107.5 });
    const part = p.steps.find((s) => s.id === "partial")!;
    expect(part.stopAfter).toBe(100);
    expect(part.then).toContain("= +36,96 USDT nach Gebühren");
    expect(sc(p, "partialStop").pnl).toBeCloseTo(35.4625, 9);
    expect(sc(p, "partialStop").r).toBeCloseTo(0.70925, 9);
    expect(sc(p, "partialTarget").pnl).toBeCloseTo(85.4125, 9);
    expect(sc(p, "partialTarget").r).toBeCloseTo(1.70825, 9);
  });

  it("Teilziel ohne „danach Break-even“: der Stop bleibt, wo er war", () => {
    const p = plan({ spec: spec({ pa: { on: true, atR: 1, thenBreakEven: false } }) });
    expect(p.steps[0]!.stopAfter).toBeNull();
    expect(sc(p, "partialStop").detail).toContain("bei 95,00");
  });

  it("Teilziel mit Netto-Break-even: der Teilgewinn deckt die Gebühren, der Stop zieht nicht zurück (nur nachziehen)", () => {
    const p = plan({ spec: spec({ be: { on: true, to: "net" }, pa: { on: true, atR: 1.5 } }) });
    // Netto-Stand des Rests wäre 92,91 – der Stop steht schon bei 100,21 und wird nie gelockert
    expect(p.steps.find((s) => s.id === "partial")!.stopAfter).toBe(100.21);
  });

  it("Trailing 2 × ATR ab +1R: Start 105, Abstand 3, erster Stop 102 → +17,98", () => {
    const p = plan({ spec: spec({ be: { on: true }, tr: { on: true } }) });
    const t = p.steps.find((s) => s.id === "trail")!;
    expect(t).toMatchObject({ trigger: 105, stopAfter: 102, never: false });
    expect(sc(p, "trail").pnl).toBeCloseTo(17.98, 9);
    expect(sc(p, "trail").r).toBeCloseTo(0.3596, 9);
  });

  it("Trailing in Prozent: 3 % hinter dem besten Kurs (105 · 0,03 = 3,15 → Stop 101,85)", () => {
    const p = plan({ spec: spec({ tr: { on: true, kind: "pct", value: 3 } }) });
    expect(p.steps[0]!.stopAfter).toBe(101.85);
  });

  it("Trailing ohne ATR: Hinweis, kein Stop, kein Beispiel", () => {
    const p = plan({ atr: null, spec: spec({ tr: { on: true } }) });
    expect(p.steps[0]!.stopAfter).toBeNull();
    expect(p.notes.some((n) => n.key === "trail-atr" && n.level === "warn")).toBe(true);
    expect(p.scenarios.some((s) => s.id === "trail")).toBe(false);
  });

  it("Trailing hinter dem Stop, der schon gilt: sagt, ab welchem Kurs es etwas ändert", () => {
    // Abstand 6 > Risiko 5: erster Trailing-Stop 105 − 6 = 99 liegt hinter dem Break-even-Stop 100
    const p = plan({ atr: 3, spec: spec({ be: { on: true }, tr: { on: true } }) });
    expect(p.steps.find((s) => s.id === "trail")!.stopAfter).toBeNull();
    const late = p.notes.find((n) => n.key === "trail-late")!;
    expect(late.text).toContain("über 106,00");
    expect(p.notes.some((n) => n.key === "trail-wide")).toBe(true);
  });

  it("jeder Satz nennt das Wichtigste: Kerzenschluss, nie lockern, gleiche Kerze, Lücke, keine Order", () => {
    const keys = plan({ spec: spec({ be: { on: true } }) }).notes.map((n) => n.key);
    expect(keys).toEqual(expect.arrayContaining(["rule", "same-candle", "gap", "manual"]));
  });
});

describe("Verwaltungsplan · Short spiegelt", () => {
  const short = { side: "short" as const, entry: 100, stop: 105, target: 90 };
  it("Break-even nach +1R: Auslöser 95; Stop 100; netto: (100 − 0,1)/1,001 = 99,8002 → AB auf 99,80", () => {
    const p = plan({ ...short, spec: spec({ be: { on: true } }) });
    expect(p.steps[0]).toMatchObject({ trigger: 95, stopAfter: 100 });
    const n = plan({ ...short, spec: spec({ be: { on: true, to: "net" } }) });
    expect(n.steps[0]!.stopAfter).toBe(99.8);
    // (100 − 99,8) · 10 = 2,00 − 1,00 − 0,998 = +0,002
    expect(sc(n, "breakEven").pnl).toBeCloseTo(0.002, 9);
  });

  it("Teilziel +1R: 95; Trailing ab +1R mit Abstand 3: Stop 98", () => {
    const p = plan({ ...short, spec: spec({ pa: { on: true, atR: 1 }, tr: { on: true } }) });
    expect(p.partial!.price).toBe(95);
    expect(p.steps.find((s) => s.id === "trail")!.stopAfter).toBe(98);
    // Stop: −5 · 10 = −50 − 1,00 − 0,001 · 105 · 10 = −52,05;  Teilziel 95 (5 Stück) + Ziel 90 (5 Stück): 25 + 50 − 1,00 − 0,475 − 0,45 = 73,075
    expect(sc(p, "stop").pnl).toBeCloseTo(-52.05, 9);
    expect(sc(p, "partialTarget").pnl).toBeCloseTo(73.075, 9);
    expect(p.steps.find((s) => s.id === "partial")!.stopAfter).toBe(100);
  });
});

describe("Verwaltungsplan · was nie greifen kann", () => {
  it("Break-even-Auslöser hinter dem Ziel: Warnung, kein Beispiel, kein Alarm-Preis", () => {
    const p = plan({ spec: spec({ be: { on: true, value: 2.5 } }) });
    expect(p.steps[0]).toMatchObject({ never: true, stopAfter: null });
    expect(p.notes.find((n) => n.key === "be-never")!.level).toBe("warn");
    expect(p.scenarios.some((s) => s.id === "breakEven")).toBe(false);
    expect(p.firstTrigger).toBeNull();
  });

  it("Teilziel auf oder hinter dem Ziel entfällt, wie im Labor", () => {
    const p = plan({ spec: spec({ pa: { on: true, atR: 2 } }) });
    expect(p.partial).toBeNull();
    expect(p.steps[0]).toMatchObject({ never: true });
    expect(p.notes.some((n) => n.key === "partial-late")).toBe(true);
  });

  it("Teilmenge unter einem Mengenschritt entfällt mit Grund", () => {
    const p = plan({ qty: 0.1, spec: spec({ pa: { on: true, atR: 1, fracPct: 50 } }) });
    expect(p.partial).toBeNull();
    expect(p.notes.find((n) => n.key === "partial-qty")!.text).toContain("Mengenschritt");
  });

  it("ohne Ziel gibt es keine Ziel-Beispiele und nichts ist „hinter dem Ziel“", () => {
    const p = plan({ target: null, spec: spec({ be: { on: true, value: 5 }, pa: { on: true, atR: 3 } }) });
    expect(p.scenarios.some((s) => s.id === "target" || s.id === "partialTarget")).toBe(false);
    expect(p.steps.every((s) => !s.never)).toBe(true);
  });

  it("Eingabe, mit der nichts geht, wird abgelehnt – mit Grund", () => {
    expect(managePlan(base({ stop: 101 }))).toMatchObject({ ok: false });
    expect(managePlan(base({ qty: 0 }))).toMatchObject({ ok: false });
    expect(managePlan(base({ entry: NaN }))).toMatchObject({ ok: false });
    expect(managePlan(base({ side: "short", stop: 95 }))).toMatchObject({ ok: false });
  });
});

describe("Verwaltungsplan · im Handelsplan (Formular, Modell, Ticket)", () => {
  const settings = settingsWith({ capital: { makro: 20_000, scalp: 5000 } });
  const limits = riskLimits(settings);
  const LATER = Date.UTC(2026, 9, 25, 10, 0);
  const report = limitStatus({ trades: enrich([], settings), settings, scope: "scalp", now: LATER });
  const input = (over: Partial<PlanForm> = {}) => ({
    form: { ...DEFAULT_FORM, day: PLAN_DAY, ...over },
    candles: planCandles(PLAN_OPEN - 40 * IV, PLAN_OPEN + 80 * IV, 1500, LATER),
    now: LATER,
    prefs: DEFAULT_PREFS,
    capital: 5000,
    currency: "USDT",
    limits,
    report,
    sourceLabel: "Binance USDⓈ-M",
    fetchedAt: LATER,
  });

  it("das Formular trägt die Verwaltung und liest alte Formulare ohne sie", () => {
    expect(DEFAULT_FORM.manage).toEqual(DEFAULT_MANAGE);
    expect(formOf({ symbol: "ETHUSDT" }).manage).toEqual(DEFAULT_MANAGE);
    expect(formOf({ manage: { breakEven: { on: true, value: "2" } } }).manage.breakEven).toMatchObject({ on: true, value: 2 });
    const saved = normalizePlan({ id: "p1", savedAt: 1, side: "long", entry: 100, stop: 95, qty: 1, light: "green", form: { manage: { partial: { on: true, fracPct: 30 } } } })!;
    expect(saved.form.manage.partial).toMatchObject({ on: true, fracPct: 30 });
  });

  it("ohne Regel gibt es keinen Verwaltungsplan; das Ticket bleibt, wie es war (kein Spaltenwechsel im CSV)", () => {
    const m = buildPlanModel(input());
    expect(m.manage).toBeNull();
    expect(m.ticket!.csv.split("\n")[0]).not.toContain("Verwaltung");
    expect(m.ticket!.rows.some(([k]) => k.startsWith("Verwaltung"))).toBe(false);
  });

  it("mit Break-even und Teilziel: auf den Zahlen der Sitzung vom 19.10. (Einstieg 100 380, Stop 100 065, Risiko 315, Menge 0,037)", () => {
    const m = buildPlanModel(input({ manage: spec({ be: { on: true }, pa: { on: true, atR: 1.5 } }) }));
    expect(m.manage?.ok).toBe(true);
    if (!m.manage?.ok) return;
    // Auslöser 100 380 + 315 = 100 695; Teilziel 100 380 + 1,5 · 315 = 100 852,5 → auf den Kursschritt 0,1 = 100 852,5
    expect(m.manage.steps[0]).toMatchObject({ id: "breakEven", trigger: 100_695, stopAfter: 100_380 });
    expect(m.manage.partial).toMatchObject({ price: 100_852.5, qty: 0.018, rest: 0.019 });
    expect(m.ticket!.rows.map(([k]) => k)).toEqual(expect.arrayContaining(["Verwaltung · Break-even", "Verwaltung · Teilziel"]));
    expect(m.ticket!.text).toContain("die App ändert keine Order");
    expect(m.ticket!.csv.split("\n")[0]).toMatch(/,Verwaltung$/);
    expect(m.ticket!.csv.split("\n")[1]).toContain("Break-even: ab 100.695,0");
  });

  it("buildTicket: ohne Verwaltung unverändert, mit Verwaltung zusätzliche Zeilen", () => {
    const m = buildPlanModel(input());
    const tp = m.ticketPlan!;
    const plain = buildTicket(tp);
    const withM = buildTicket({ ...tp, manage: [{ label: "Break-even", text: "ab 1 Stop auf 2" }] });
    expect(withM.rows.length).toBe(plain.rows.length + 1);
    expect(withM.text.split("\n").length).toBe(plain.text.split("\n").length + 2);
  });
});
