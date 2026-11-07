/**
 * Handelsplan · Aktien: der Rechenkern auf den deterministischen AAPL-Kerzen (`tests/e2e/mocks/planStockCandles.ts`, dort steht
 * die Handrechnung): ganze Stück, Kursschritt 1 Cent, USD, kein Hebel, keine Funding-Zeile, die Verzögerung der Quelle.
 */
import { describe, expect, it } from "vitest";
import { buildPlanModel, DEFAULT_FORM, DEFAULT_PREFS, feedLag, planCfgOf, normalizePlan, sessionDay, unitOf, type ModelInput, type PlanForm } from "@/domain/plan";
import { limitStatus, riskLimits } from "@/domain/risk";
import { enrich, settingsWith } from "./insights.fixtures";
import { MIN5, STOCK_EXPECT, STOCK_SYMBOL, stockOpen, stockSessionBars } from "../e2e/mocks/planStockCandles";

const DAY = "2026-10-23"; // a Friday, EDT: the open is 13:30 UTC
const OPEN = stockOpen(DAY);
const settings = settingsWith({ capital: { makro: 20_000, scalp: 5000 } });
const limits = riskLimits(settings);
const LATER = Date.UTC(2026, 9, 26, 10, 0); // the session is over
const report = (now: number) => limitStatus({ trades: enrich([], settings), settings, scope: "scalp", now });

const candles = (day = DAY, now = Infinity) =>
  stockSessionBars(day).map(([t, o, h, l, c, v]) => ({ time: t!, open: o!, high: h!, low: l!, close: c!, volume: v!, closed: t! + MIN5 <= now, closeTime: t! + MIN5 - 1 }));

const form = (over: Partial<PlanForm> = {}): PlanForm => ({ ...DEFAULT_FORM, symbol: STOCK_SYMBOL, session: "usstocks", day: DAY, ...over });
const input = (over: Partial<ModelInput> = {}): ModelInput => {
  const now = over.now ?? LATER;
  return { form: form(), candles: candles(DAY, now), now, prefs: DEFAULT_PREFS, capital: 5000, currency: "USDT", limits, report: report(now), sourceLabel: "Yahoo Finance (inoffiziell)", fetchedAt: now, ...over };
};

describe("Handelsplan · eine US-Aktie, Rückblick auf Freitag 23.10.2026", () => {
  const m = buildPlanModel(input());

  it("1 Einstieg: Range 184,50 – 185,60, das Signal Long um 9:55 New Yorker Zeit zu 185,90", () => {
    expect(m.market).toBe("stocks");
    expect(m.session).toMatchObject({ dayKey: DAY, market: "stocks", openMs: OPEN, closeMs: OPEN + 390 * 60_000, tradingDay: true });
    expect(m.entry.status).toBe("triggered");
    expect(m.entry.range).toMatchObject({ high: STOCK_EXPECT.rangeHigh, low: STOCK_EXPECT.rangeLow, complete: true });
    expect(m.entry.range!.mid).toBeCloseTo(STOCK_EXPECT.rangeMid, 10);
    expect(m.entry.signal).toMatchObject({ side: "long", price: STOCK_EXPECT.signalPrice, barClose: OPEN + STOCK_EXPECT.signalAfterMin * 60_000 });
    expect(m.entry.signal!.volumeX).toBeCloseTo(75_000 / 70_000, 10);
    expect(m.entry.past).toBe(true);
  });

  it("Kursschritt 1 Cent (nicht aus den Kerzen), ganze Stück, Dollar, kein Hebel", () => {
    expect(m.tick).toBe(0.01);
    expect(m.tickSource).toBe("US-Aktien: 1 Cent");
    expect(m.lot).toBe(1);
    expect(m.currency).toBe("USD");
    expect(m.leverage).toBe(1);
  });

  it("2 Ausstieg: Stop = Range-Mitte 185,05, Risiko 0,85, Ziel 2R = 187,60; die ATR liest nur die Kerzen der Sitzung", () => {
    expect(m.exit?.ok).toBe(true);
    if (!m.exit?.ok) return;
    expect(m.exit).toMatchObject({ side: "long", entry: 185.9, stop: STOCK_EXPECT.stop, target: STOCK_EXPECT.target, rr: 2 });
    expect(m.exit.risk).toBeCloseTo(STOCK_EXPECT.risk, 10);
    expect(m.atr!.bars).toBe(5); // Kerzen 0–4: nichts vom Vortag, kein Vorhandel
    expect(m.flatByMs).toBe(OPEN + 385 * 60_000); // 15:55
  });

  it("3 Größe: 20 Stück (der Deckel bindet), 3.718,00 USD, Verlust am Stop 22,56 USD – ganze Stück, keine Nachkommastellen", () => {
    expect(limits.feePct).toBeCloseTo(0.0005, 12);
    expect(limits.slippagePct).toBeCloseTo(0.0005, 12);
    expect(m.size?.ok).toBe(true);
    if (!m.size?.ok) return;
    expect(m.size.lossPerUnit).toBeCloseTo(STOCK_EXPECT.lossPerUnit, 9);
    expect(m.size.rows.find((r) => r.key === "loss")!.qty).toBeCloseTo(50 / 1.128, 9); // 44,33 – die Verlust-Grenze erlaubte mehr
    expect(m.size.rows.find((r) => r.key === "position")!.qty).toBeCloseTo(3750 / 185.9, 9); // 20,17
    expect(m.size.rows.find((r) => r.key === "power")!.qty).toBeCloseTo(4500 / 185.9, 9); // 24,21
    expect(m.size.binding).toBe("position");
    expect(m.size.qty).toBe(STOCK_EXPECT.qty);
    expect(Number.isInteger(m.size.qty)).toBe(true);
    expect(m.size.notional).toBeCloseTo(STOCK_EXPECT.notional, 9);
    expect(m.size.maxLoss).toBeCloseTo(STOCK_EXPECT.maxLoss, 9);
    expect(m.size.margin).toBeCloseTo(STOCK_EXPECT.notional, 9); // ohne Hebel
    expect(m.size.headline).toContain("3.750,00 USD");
  });

  it("4 Risiko: grün, in Dollar, ohne Liquidation; 5 Ticket in Stück und USD", () => {
    expect(m.risk!.light).toBe("green");
    expect(m.risk!.lines.map((l) => l.key)).not.toContain("liquidation");
    expect(m.risk!.lines.find((l) => l.key === "loss")!.detail).toContain("USD");
    expect(m.risk!.lines.find((l) => l.key === "leverage")!.title).toContain("Hebel 0,7×");
    expect(m.ticketPlan).toMatchObject({ symbol: "AAPL", market: "stocks", currency: "USD", leverage: 1, qty: 20, entrySource: "signal" });
    const rows = Object.fromEntries(m.ticket!.rows);
    expect(rows["Größe"]).toBe("20 Stück (Positionswert 3.718,00 USD)");
    expect(rows["Max. Verlust am Stop"]).toContain("22,56 USD");
    expect(rows["Einstieg (Plan)"]).toContain("185,90");
    expect(rows["Stop"]).toContain("185,05");
    expect(rows["Ziel"]).toContain("187,60");
    expect(rows["Quelle"]).toContain("Yahoo Finance (inoffiziell)");
    expect(m.ticket!.text).not.toMatch(/Hebel|Funding/);
    expect(m.ticket!.csv.split("\n")[1]).toContain("AAPL,long,185.9,185.05,187.6,20,3718,22.56");
  });

  it("keine Funding-Zeile und kein Hebel in den Annahmen; die Währung ist USD", () => {
    const all = Object.values(m.assumptions).flat().join("\n");
    expect(all).not.toMatch(/Funding/);
    expect(all).toContain("ohne Hebel (Aktien werden mit 1× gerechnet)");
    expect(all).toContain("Ganze Stück: Mengenschritt 1");
    expect(all).toContain("Konto Scalp mit 5.000,00 USD");
    expect(m.assumptions.exit[1]).toBe("Kursschritt 0,01 (US-Aktien: 1 Cent); der Stop rundet vom Einstieg weg, das Ziel auf den nächsten Schritt");
    expect(m.assumptions.entry.join("\n")).toContain("Nur die reguläre Handelszeit (09:30 bis 16:00 Uhr UTC−4)");
    expect(m.assumptions.risk.join("\n")).toContain("Aktien ohne Hebel");
  });

  it("alle fünf Schritte sind fertig", () => {
    expect(m.steps.map((s) => s.status)).toEqual(["done", "done", "done", "done", "done"]);
  });
});

const m0 = () => buildPlanModel(input());

describe("Handelsplan · Aktien: Abweichungen vom Krypto-Ablauf", () => {
  it("ein Hebel aus dem Krypto-Formular wirkt bei Aktien nicht: Kaufkraft und Ticket rechnen mit 1×", () => {
    const m = buildPlanModel(input({ form: form({ leverage: 5, riskPct: 0.03 }), prefs: { ...DEFAULT_PREFS, maxPositionPct: 10 } }));
    expect(m.leverage).toBe(1);
    expect(m.size?.ok && m.size.rows.find((r) => r.key === "power")!.qty).toBeCloseTo(4500 / 185.9, 9);
    expect(m.size?.ok && m.size.qty).toBe(24); // die Kaufkraft bindet: 24 Stück à 185,90 ≈ 4 461,60
    expect(m.ticketPlan?.leverage ?? 1).toBe(1);
  });

  it("ein Kurs unter einem Dollar bekommt den Kursschritt 0,0001 (Viertel-Cent erlaubt)", () => {
    const cheap = candles().map((c) => ({ ...c, open: c.open / 200, high: c.high / 200, low: c.low / 200, close: c.close / 200 }));
    const m = buildPlanModel(input({ candles: cheap }));
    expect(m.tick).toBe(0.0001);
    expect(m.tickSource).toBe("US-Aktien unter 1 Dollar: 0,0001");
  });

  it("ein eingegebener Kursschritt und Mengenschritt (Bruchstücke beim Broker) gelten", () => {
    const m = buildPlanModel(input({ form: form({ tick: 0.05, lot: 0.01 }) }));
    expect(m.tick).toBe(0.05);
    expect(m.tickSource).toBe("eingegeben");
    expect(m.lot).toBe(0.01);
    expect(m.size?.ok && m.size.qty).toBe(20.17); // 3.750 ÷ 185,90 = 20,17…, abgerundet auf 0,01
  });

  it("Yahoo liefert Kurse mit vier Stellen: der Einstieg wird auf den Cent gerundet (Gleichstand zum schlechteren Preis), ein getippter Preis bleibt", () => {
    const withClose = (close: number) => candles().map((c) => (c.time === OPEN + 4 * MIN5 ? { ...c, high: Math.max(c.high, close), close } : c));
    const near = buildPlanModel(input({ candles: withClose(185.9049) }));
    expect(near.entry.signal!.price).toBe(185.9049); // the candle stays as the source said it
    expect(near.entryPrice).toBe(185.9);
    expect(near.assumptions.entry.join("\n")).toContain("Der Einstieg wird auf den Kursschritt gerundet (185,90)");
    expect(near.ticketPlan!.entry).toBe(185.9);
    const tie = buildPlanModel(input({ candles: withClose(185.905) }));
    expect(tie.entryPrice).toBe(185.91); // Long: auf dem Gleichstand nach oben, zum schlechteren Preis
    expect(tie.exit?.ok && tie.exit.stop).toBe(185.05);
    // eine glatte Zahl wird nicht angefasst und nicht erwähnt
    expect(m0().assumptions.entry.join("\n")).not.toContain("gerundet");
    // ein getippter Preis bleibt, wie er getippt wurde
    const typed = buildPlanModel(input({ form: form({ manualEntry: 185.9049 }) }));
    expect(typed.entryPrice).toBe(185.9049);
  });

  it("in Euro geführtes Journal: die App sagt, dass sie nicht umrechnet", () => {
    const m = buildPlanModel(input({ currency: "EUR" }));
    expect(m.assumptions.size.join("\n")).toContain("Dein Journal rechnet in EUR, Aktien notieren in USD. Die App rechnet nicht um");
    const usdt = buildPlanModel(input({ currency: "USDT" }));
    expect(usdt.assumptions.size.join("\n")).toContain("Dein Kapital (USDT) wird 1 : 1 als USD gelesen");
  });

  it("Short bei einer Aktie: Stop über, Ziel unter dem Einstieg – und der Hinweis auf Leihbestand und Marge", () => {
    // Kerze 4 schließt über der Range; für einen Short plant man vorab am Range-Tief
    const m = buildPlanModel(input({ form: form({ sides: "short", manualSide: "short" }), candles: candles(DAY, LATER).slice(0, 4), now: OPEN + 22 * 60_000 }));
    expect(m.entrySource).toBe("level");
    expect(m.side).toBe("short");
    expect(m.entryPrice).toBe(STOCK_EXPECT.rangeLow);
    expect(m.exit?.ok && m.exit.stop).toBeCloseTo(185.05, 10);
    expect(m.exit?.ok && m.exit.target).toBeCloseTo(184.5 - 2 * 0.55, 10);
    expect(m.assumptions.size.join("\n")).toContain("Leihbestand, Marge und Leihgebühr deines Brokers kennt die App nicht");
  });

  it("die Journal-Währung USDT/USD ändert nichts an den Zahlen – nur der Text", () => {
    const a = buildPlanModel(input({ currency: "USDT" }));
    const b = buildPlanModel(input({ currency: "EUR" }));
    expect(a.size?.ok && b.size?.ok && a.size.qty === b.size.qty && a.size.maxLoss === b.size.maxLoss).toBe(true);
  });
});

describe("Handelsplan · Aktien: die Verzögerung der Quelle (feedLag)", () => {
  const session = sessionDay("usstocks", DAY);
  const IV = MIN5;
  const at = (min: number): number => OPEN + min * 60_000;

  it("außerhalb der laufenden Sitzung gibt es nichts zu sagen", () => {
    expect(feedLag({ now: OPEN - 60_000, session, intervalMs: IV, lastCloseMs: null, marketTime: null })).toBeNull();
    expect(feedLag({ now: session.closeMs, session, intervalMs: IV, lastCloseMs: at(385), marketTime: null })).toBeNull();
    expect(feedLag({ now: at(60), session: sessionDay("usstocks", "2026-10-24"), intervalMs: IV, lastCloseMs: null, marketTime: null })).toBeNull();
  });

  it("gesund: die neueste Kerze schloss gerade, nichts hängt", () => {
    const l = feedLag({ now: at(62), session, intervalMs: IV, lastCloseMs: at(60), marketTime: at(61) })!;
    expect(l.late).toBe(false);
    expect(l.lagMin).toBe(2);
    expect(l.text).toBe("Die neueste geschlossene Kerze schloss um 10:30 Uhr (vor 2 Minuten).");
  });

  it("die Daten hängen: die Kerze von 10:35 wäre nach der Uhr fällig, ist aber nicht da", () => {
    const l = feedLag({ now: at(68), session, intervalMs: IV, lastCloseMs: at(60), marketTime: at(66) })!;
    expect(l.late).toBe(true);
    expect(l.text).toContain("schloss um 10:30 Uhr (vor 8 Minuten); nach der Uhr wäre die von 10:35 Uhr fällig – die Daten hängen hinterher.");
  });

  it("zwei Minuten Gnade: kurz nach dem Kerzenende ist das noch kein Verzug", () => {
    expect(feedLag({ now: at(61), session, intervalMs: IV, lastCloseMs: at(55), marketTime: at(60) })!.late).toBe(false);
    expect(feedLag({ now: at(65) + 120_001, session, intervalMs: IV, lastCloseMs: at(60), marketTime: at(65) })!.late).toBe(true);
  });

  it("der letzte Handel liegt über 15 Minuten zurück: gesagt, ohne Ursache zu behaupten", () => {
    const l = feedLag({ now: at(60), session, intervalMs: IV, lastCloseMs: at(60), marketTime: at(40) })!;
    expect(l.late).toBe(true);
    expect(l.text).toContain("Der letzte Handel laut Quelle liegt 20 Minuten zurück (10:10 Uhr)");
    expect(l.text).toContain("die App kann das nicht unterscheiden");
  });

  it("noch keine geschlossene Kerze, obwohl die Sitzung schon läuft", () => {
    expect(feedLag({ now: at(4), session, intervalMs: IV, lastCloseMs: null, marketTime: null })!.late).toBe(false);
    const l = feedLag({ now: at(8), session, intervalMs: IV, lastCloseMs: null, marketTime: null })!;
    expect(l.late).toBe(true);
    expect(l.text).toContain("noch keine geschlossene Kerze angekommen");
  });

  it("das Modell trägt die Verzögerung nur für Aktien und nur während die Sitzung läuft", () => {
    const now = at(68);
    const live = buildPlanModel(input({ now, candles: candles(DAY, now).filter((c) => c.time <= at(55)), marketTime: at(60), report: report(now) }));
    expect(live.lag).not.toBeNull();
    expect(live.lag!.late).toBe(true);
    expect(buildPlanModel(input()).lag).toBeNull(); // Rückblick
  });
});

describe("Handelsplan · Aktien: Hilfsfunktionen", () => {
  it("unitOf: Stück für Aktien, der Basiswert für Krypto", () => {
    expect(unitOf("stocks", "AAPL")).toBe("Stück");
    expect(unitOf("stocks", "COIN")).toBe("Stück");
    expect(unitOf("crypto", "BTCUSDT")).toBe("BTC");
    expect(unitOf(undefined, "ETHUSDT")).toBe("ETH");
  });

  it("ein gespeicherter Aktien-Plan ohne Schlüsselmarken (leere Ids) bleibt lesbar", () => {
    const m = buildPlanModel(input());
    const t = m.ticketPlan!;
    const saved = {
      id: "p_stock",
      savedAt: LATER,
      symbol: t.symbol,
      side: t.side,
      entry: t.entry,
      stop: t.stop,
      target: t.target,
      qty: t.qty,
      notional: t.notional,
      maxLoss: t.maxLoss,
      rr: t.rr,
      tick: 0.01,
      lot: 1,
      light: "green",
      currency: "USD",
      sourceLabel: "Yahoo Finance (inoffiziell)",
      candlesUntil: null,
      fetchedAt: null,
      signalAt: null,
      flatByMs: m.flatByMs,
      tz: "America/New_York",
      sessionLabel: t.sessionLabel,
      stopLabel: "",
      targetLabel: "",
      form: form(),
      alarms: { stopId: "", targetId: "", createdAt: LATER, flatBy: { at: m.flatByMs, state: "pending", firedAt: null } },
      journalAt: null,
    };
    const p = normalizePlan(saved);
    expect(p).not.toBeNull();
    expect(p!.alarms).toEqual({ stopId: "", targetId: "", createdAt: LATER, flatBy: { at: m.flatByMs, state: "pending", firedAt: null } });
    expect(p!.form.symbol).toBe("AAPL");
    expect(p!.form.session).toBe("usstocks");
    expect(planCfgOf({ v: 1, plans: [saved] }).plans).toHaveLength(1);
    // ein Alarm ohne Ids war früher nicht lesbar – der Plan darf deshalb nie verloren gehen
    expect(planCfgOf({ v: 1, plans: [{ ...saved, alarms: { stopId: 7, targetId: "", createdAt: 1 } }] }).plans[0]!.alarms).toBeNull();
  });
});
