/**
 * Handelsplan · Ticket, `settings.plan` (versionierter Passthrough-Schlüssel) und die Alarme aus dem Plan.
 */
import { describe, expect, it } from "vitest";
import { allKeyLevels, keyLevelsCfgOf } from "@/domain/keylevels";
import { merge3 } from "@/store/merge3";
import {
  ALARM_TF,
  baseOf,
  buildTicket,
  DEFAULT_PREFS,
  dueFlatBy,
  EMPTY_PLAN_CFG,
  flatByMessage,
  FLAT_BY_STALE_MS,
  MAX_PLANS,
  nextFlatBy,
  normalizePlan,
  planAlarmLevels,
  planCfgOf,
  prefsOf,
  withPlanCfg,
  DEFAULT_FORM,
  TICKET_NOTE,
  type SavedPlan,
  type TicketPlan,
} from "@/domain/plan";

const OPEN = Date.UTC(2026, 9, 19, 13, 30);
const ticketPlan = (over: Partial<TicketPlan> = {}): TicketPlan => ({
  symbol: "BTCUSDT",
  side: "long",
  entry: 100380,
  stop: 100065,
  target: 101010,
  qty: 0.037,
  notional: 3714.06,
  maxLoss: 17.214435,
  maxLossPct: 17.214435 / 5000,
  rr: 2,
  leverage: 1,
  flatByMs: OPEN + 385 * 60_000,
  light: "green",
  tick: 0.1,
  lot: 0.001,
  currency: "USDT",
  tz: "America/New_York",
  sessionLabel: "Mo 19.10. · New York 9:30 (UTC−4)",
  entrySource: "signal",
  signalAt: OPEN + 25 * 60_000,
  stopLabel: "Mitte der Range",
  targetLabel: "2R",
  sourceLabel: "Binance USDⓈ-M",
  intervalLabel: "5 Minuten-Kerzen",
  candlesUntil: OPEN + 30 * 60_000,
  fetchedAt: Date.UTC(2026, 9, 25, 10, 0),
  ...over,
});

describe("Ticket zum Kopieren", () => {
  it("der Text: Richtung, Einstieg, Stop, Ziel, Größe, maximaler Verlust, Quelle und Stand – und der Hinweis, dass nichts gesendet wird", () => {
    const t = buildTicket(ticketPlan());
    expect(t.text.split("\n")).toEqual([
      "HANDELSPLAN – Ticket zum Kopieren",
      "Symbol: BTCUSDT",
      "Richtung: Long",
      "Einstieg (Plan): 100.380,0 – Schlusskurs der Signal-Kerze (09:55 Uhr)",
      "Stop: 100.065,0 – Mitte der Range",
      "Ziel: 101.010,0 – 2R",
      "Größe: 0,037 BTC (Positionswert 3.714,06 USDT)",
      "Max. Verlust am Stop: 17,21 USDT (0,34 % des Kontos, inkl. Gebühren und Slippage)",
      "Chance-Risiko: 2,00 : 1",
      "Flat by: 15:55 Uhr (UTC−4)",
      "Risiko-Check: Grün",
      "Sitzung: Mo 19.10. · New York 9:30 (UTC−4), 5 Minuten-Kerzen",
      "Quelle: Binance USDⓈ-M · Kerzen bis 19.10.2026 10:00 Uhr (UTC−4), abgerufen 25.10.2026 06:00 Uhr",
      TICKET_NOTE,
    ]);
    expect(TICKET_NOTE).toContain("die App sendet nichts an eine Börse und platziert keine Order");
    expect(TICKET_NOTE).toContain("Keine professionelle Finanzberatung.");
  });

  it("die CSV-Zeile: Kopf + eine Zeile, Punkt als Dezimalzeichen, Zeiten in UTC", () => {
    const [head, row] = buildTicket(ticketPlan()).csv.split("\n");
    expect(head).toBe("Symbol,Richtung,Einstieg,Stop,Ziel,Menge,Positionswert,Max_Verlust,Max_Verlust_Prozent,Chance_Risiko,Flat_by_UTC,Ampel,Quelle,Kerzen_bis_UTC,Abgerufen_UTC");
    expect(row).toBe("BTCUSDT,long,100380,100065,101010,0.037,3714.06,17.21,0.344,2,2026-10-19T19:55:00Z,Grün,Binance USDⓈ-M,2026-10-19T14:00:00Z,2026-10-25T10:00:00Z");
  });

  it("ohne Ziel, Flat-by und Kerzendaten: leer statt erfunden; Felder mit Komma werden gequotet", () => {
    const t = buildTicket(ticketPlan({ target: null, rr: null, flatByMs: null, candlesUntil: null, fetchedAt: null, sourceLabel: "Binance, EU-Proxy" }));
    expect(t.text).toContain("Ziel: keins");
    expect(t.text).toContain("Chance-Risiko: –");
    expect(t.text).toContain("Flat by: nicht gesetzt");
    expect(t.text).toContain("Quelle: Binance, EU-Proxy · keine Daten");
    const [, row] = t.csv.split("\n");
    expect(row).toBe('BTCUSDT,long,100380,100065,,0.037,3714.06,17.21,0.344,,,Grün,"Binance, EU-Proxy",,');
  });

  it("eingegebener und vorab geplanter Einstieg heißen so; Hebel steht bei der Größe; Short", () => {
    expect(buildTicket(ticketPlan({ entrySource: "manual" })).rows[2]![1]).toBe("100.380,0 – von dir eingegeben");
    expect(buildTicket(ticketPlan({ entrySource: "level" })).rows[2]![1]).toBe("100.380,0 – geplant am Ausbruchsniveau, noch kein Signal");
    expect(buildTicket(ticketPlan({ leverage: 3 })).rows[5]![1]).toBe("0,037 BTC (Positionswert 3.714,06 USDT, Hebel 3×)");
    expect(buildTicket(ticketPlan({ side: "short" })).rows[1]).toEqual(["Richtung", "Short"]);
    expect(baseOf("ETHUSDT")).toBe("ETH");
    expect(baseOf("XYZ")).toBe("XYZ");
  });
});

const savedPlan = (over: Partial<SavedPlan> = {}): SavedPlan => ({
  id: "p_1",
  savedAt: Date.UTC(2026, 9, 25, 10, 0),
  symbol: "BTCUSDT",
  side: "long",
  entry: 100380,
  stop: 100065,
  target: 101010,
  qty: 0.037,
  notional: 3714.06,
  maxLoss: 17.21,
  rr: 2,
  light: "green",
  currency: "USDT",
  sourceLabel: "Binance USDⓈ-M",
  candlesUntil: OPEN + 30 * 60_000,
  fetchedAt: Date.UTC(2026, 9, 25, 10, 0),
  signalAt: OPEN + 25 * 60_000,
  flatByMs: OPEN + 385 * 60_000,
  tz: "America/New_York",
  sessionLabel: "Mo 19.10. · New York 9:30 (UTC−4)",
  stopLabel: "Mitte der Range",
  targetLabel: "2R",
  form: { ...DEFAULT_FORM, day: "2026-10-19" },
  alarms: null,
  journalAt: null,
  ...over,
});

describe("settings.plan als versionierter Passthrough-Schlüssel", () => {
  it("fehlt der Schlüssel, gelten die Voreinstellungen, und nichts wird geschrieben", () => {
    expect(planCfgOf(undefined)).toBe(EMPTY_PLAN_CFG);
    expect(planCfgOf("x").plans).toEqual([]);
    expect(prefsOf(undefined)).toEqual({ maxPositionPct: 0.75, cashBufferPct: 0.1, minRewardRisk: 1, minOrderValue: 5 });
    expect(withPlanCfg(undefined, {})).toBeUndefined();
  });

  it("Lesen bereinigt: kaputte Werte fallen auf die Voreinstellung, unlesbare Pläne werden beiseite gelegt, doppelte IDs behalten den ersten", () => {
    const cfg = planCfgOf({ v: 1, prefs: { maxPositionPct: "x", cashBufferPct: 0.2, minRewardRisk: -1 }, plans: [savedPlan(), savedPlan({ entry: 1 }), { id: "bad" }, "nope", { ...savedPlan({ id: "p_2" }), light: "blue" }] });
    expect(cfg.prefs).toEqual({ ...DEFAULT_PREFS, cashBufferPct: 0.2 });
    expect(cfg.plans.map((p) => p.id)).toEqual(["p_1"]);
    expect(cfg.rejected).toHaveLength(3);
  });

  it("Schreiben behält unbekannte Schlüssel der Wurzel und unlesbare Pläne – auch aus einer neueren Version", () => {
    const stored = { v: 1, plans: [savedPlan(), { id: "future", kind: "grid" }], futureKey: { a: 1 } };
    const next = withPlanCfg(stored, { plans: [savedPlan({ id: "p_9" })] });
    expect(next.futureKey).toEqual({ a: 1 });
    expect(next.plans).toEqual([savedPlan({ id: "p_9" }), { id: "future", kind: "grid" }]);
    expect(next.v).toBe(1);
  });

  it("ändert sich nichts, kommt dasselbe Objekt zurück (kein Speichern)", () => {
    const stored = withPlanCfg(undefined, { plans: [savedPlan()] });
    expect(withPlanCfg(stored, { plans: [savedPlan()] })).toBe(stored);
    expect(withPlanCfg(stored, { prefs: { maxPositionPct: DEFAULT_PREFS.maxPositionPct } })).toBe(stored);
    expect(withPlanCfg(stored, { prefs: { maxPositionPct: 0.5 } })).not.toBe(stored);
    expect(planCfgOf(withPlanCfg(stored, { prefs: { maxPositionPct: 0.5 } })).prefs.maxPositionPct).toBe(0.5);
  });

  it("höchstens 20 Pläne; ein Plan überlebt die Runde durch JSON", () => {
    const many = Array.from({ length: MAX_PLANS + 5 }, (_, i) => savedPlan({ id: `p_${i}` }));
    expect(planCfgOf({ plans: many }).plans).toHaveLength(MAX_PLANS);
    const back = planCfgOf(JSON.parse(JSON.stringify({ v: 1, plans: [savedPlan({ alarms: { stopId: "k_a", targetId: "k_b", flatBy: { at: 5, state: "pending", firedAt: null }, createdAt: 1 }, journalAt: 7 })] }))).plans[0]!;
    expect(back.alarms).toEqual({ stopId: "k_a", targetId: "k_b", flatBy: { at: 5, state: "pending", firedAt: null }, createdAt: 1 });
    expect(back.journalAt).toBe(7);
    expect(back.form).toEqual({ ...DEFAULT_FORM, day: "2026-10-19" });
    expect(normalizePlan({ ...savedPlan(), form: "kaputt" })!.form).toEqual(DEFAULT_FORM);
  });

  it("Abgleich zweier Tabs: Pläne werden je Plan zusammengeführt (Liste von Objekten mit id)", () => {
    const base = withPlanCfg(undefined, { plans: [savedPlan({ id: "a" })] });
    const mine = withPlanCfg(base, { plans: [savedPlan({ id: "a" }), savedPlan({ id: "b" })] });
    const theirs = withPlanCfg(base, { plans: [savedPlan({ id: "a", journalAt: 99 }), savedPlan({ id: "c" })] });
    const merged = planCfgOf(merge3(base, mine, theirs)).plans;
    expect(merged.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
    expect(merged.find((p) => p.id === "a")!.journalAt).toBe(99);
  });
});

describe("Plan → 3 Alarme", () => {
  const p = savedPlan();

  it("Stop und Ziel werden Schlüsselmarken: Berührung auf 30-Minuten-Kerzen, nur Vorbereitung + Bestätigung, Rolle Info", () => {
    const { stop, target } = planAlarmLevels(p, { stop: "k_stop", target: "k_target" }, 0.1, 1_000);
    expect(stop).toMatchObject({ id: "k_stop", symbol: "BTCUSDT", price: 100065, tf: ALARM_TF, direction: "below", kind: "touch", role: "info", enabled: true, since: 1_000, name: "Plan-Stop BTCUSDT" });
    expect(target).toMatchObject({ id: "k_target", price: 101010, direction: "above", kind: "touch", role: "info", name: "Plan-Ziel BTCUSDT" });
    expect(stop.alerts).toEqual({ on: true, prepare: true, confirm: true, retest: false, invalid: false, recurring: false });
    expect(stop.note).toContain("Läuft nur bei geöffneter App; eine Nachricht, keine Order.");
    expect(stop.note).toBe("Stop aus dem Handelsplan (Long BTCUSDT vom Mo 19.10. 09:55, Einstieg 100.380,0). Läuft nur bei geöffneter App; eine Nachricht, keine Order.");
    expect(ALARM_TF).toBe("30m");
  });

  it("Short spiegelt: der Stop über, das Ziel unter dem Einstieg", () => {
    const s = planAlarmLevels(savedPlan({ side: "short", stop: 100500, target: 99900 }), { stop: "a", target: "b" }, 0.1, 1);
    expect(s.stop.direction).toBe("above");
    expect(s.target.direction).toBe("below");
  });

  it("die Marken sind ein gültiger Eintrag von settings.keyLevels: sie überstehen die Runde durch das Marken-Modell", () => {
    const { stop, target } = planAlarmLevels(p, { stop: "k_stop", target: "k_target" }, 0.1, 1_000);
    const cfg = keyLevelsCfgOf({ v: 1, levels: [stop, target] });
    expect(cfg.rejected).toEqual([]);
    expect(cfg.levels.map((l) => l.id)).toEqual(["k_stop", "k_target"]);
    expect(allKeyLevels({ keyLevels: { v: 1, levels: [stop, target] } }).map((l) => l.name)).toEqual(["Plan-Stop BTCUSDT", "Plan-Ziel BTCUSDT"]);
  });

  it("Flat by: fällig ab der Uhrzeit, einmal; zu alte werden still als verpasst markiert", () => {
    const at = Date.UTC(2026, 9, 19, 19, 55);
    const withAlarm = (id: string, flatAt: number, state: "pending" | "fired" | "missed" = "pending"): SavedPlan => savedPlan({ id, alarms: { stopId: "a", targetId: "b", flatBy: { at: flatAt, state, firedAt: null }, createdAt: 1 } });
    const plans = [withAlarm("early", at), withAlarm("later", at + 3_600_000), withAlarm("done", at - 1000, "fired"), savedPlan({ id: "none" })];
    expect(dueFlatBy(plans, at - 1)).toEqual([]);
    expect(dueFlatBy(plans, at).map((d) => [d.plan.id, d.lateMin, d.stale])).toEqual([["early", 0, false]]);
    expect(dueFlatBy(plans, at + 30 * 60_000)[0]).toMatchObject({ lateMin: 30, stale: false });
    expect(dueFlatBy(plans, at + FLAT_BY_STALE_MS + 1)[0]!.stale).toBe(true);
    expect(nextFlatBy(plans, at - 5000)).toBe(at);
    expect(nextFlatBy(plans, at)).toBe(at + 3_600_000);
    expect(nextFlatBy([plans[2]!, plans[3]!], at)).toBeNull();
  });

  it("die Nachricht: pünktlich oder verspätet, immer als Erinnerung und nie als Handlung", () => {
    const f = savedPlan({ alarms: { stopId: "a", targetId: "b", flatBy: { at: Date.UTC(2026, 9, 19, 19, 55), state: "pending", firedAt: null }, createdAt: 1 } });
    expect(flatByMessage(f, 0)).toEqual({
      title: "Flat by close: BTCUSDT",
      detail: "Es ist 15:55 Uhr. Wenn dein Long-Trade noch offen ist, schließ ihn. Das ist eine Erinnerung – die App tut nichts für dich.",
    });
    expect(flatByMessage(f, 12).detail).toContain("(fällig war 15:55 Uhr, 12 Minuten her)");
  });
});
