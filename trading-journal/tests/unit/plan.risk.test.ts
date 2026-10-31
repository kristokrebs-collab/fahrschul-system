/**
 * Handelsplan · Risiko-Manager (Skill trader-risk): Ampel + Gründe gegen die Grenzen der Risiko-Seite. Die Zahlen kommen aus
 * den vorhandenen Funktionen (`limitStatus`, `riskLimits`, `riskPreview`, `rrCalc`) – hier wird geprüft, dass der Plan sie richtig
 * liest. Konto Scalp mit 5 000 USDT: Verlust pro Trade 2 % = 100, pro Tag 4 % = 200, 5 Trades, offenes Risiko 3 % = 150,
 * Hebelregel 4× (Personal-Ausgabe), Gebühr und Slippage je 0,05 %.
 */
import { describe, expect, it } from "vitest";
import { limitStatus, riskLimits, riskPreview, type LimitReport } from "@/domain/risk";
import { positionSizing, riskCheck, FRESH_MAX_MS, type RiskInput, type RiskLine } from "@/domain/plan";
import type { Settings, Trade } from "@/domain/types";
import { mkTrade } from "./domain.fixtures";
import { enrich, settingsWith } from "./insights.fixtures";

// Mittwoch 2026-10-14 15:00 Ortszeit
const NOW = new Date(2026, 9, 14, 15, 0).getTime();
const at = (d: number, h: number, m = 0): string => {
  const x = new Date(2026, 9, d, h, m);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
};
let seq = 0;
const closedLoss = (date: string, pnl: number): Trade => mkTrade({ id: `c${++seq}`, date, pnlManual: pnl, stop: 1, entry: 100, size: 1000 });
const openTrade = (date: string, extra: Partial<Trade> = {}): Trade => mkTrade({ id: `o${++seq}`, date, status: "open", exit: null, entry: 100, stop: 98, size: 1000, ...extra });

const settings: Settings = settingsWith({ capital: { makro: 20_000, scalp: 5000 } });
const limits = riskLimits(settings);
const report = (trades: Trade[] = []): LimitReport => limitStatus({ trades: enrich(trades, settings), settings, scope: "scalp", now: NOW });

// BTC, Long 100 380, Stop 100 065 (Abstand 315), Ziel 101 010 (2R), 0,037 BTC → Verlust am Stop 0,037 × 465,255 = 17,21 USDT
const sized = positionSizing({ side: "long", entry: 100380, stop: 100065, tick: 0.1, capital: 5000, riskPct: 0.01, maxPositionPct: 0.75, cashBufferPct: 0.1, leverage: 1, dayRemaining: 200, lot: 0.001, feePct: limits.feePct, slippagePct: limits.slippagePct, minOrderValue: 5, currency: "USDT" });
if (!sized.ok) throw new Error("fixture");

const input = (over: Partial<RiskInput> = {}): RiskInput => ({
  side: "long",
  entry: 100380,
  stop: 100065,
  target: 101010,
  qty: sized.qty,
  notional: sized.notional,
  maxLoss: sized.maxLoss,
  leverage: 1,
  account: "scalp",
  limits,
  report: report(),
  capital: 5000,
  now: NOW,
  minRewardRisk: 1,
  tick: 0.1,
  ...over,
});
const line = (v: { lines: RiskLine[] }, key: RiskLine["key"]): RiskLine => v.lines.find((l) => l.key === key)!;

describe("Risiko-Check · grün", () => {
  it("ein sauberer Plan hält alle Grenzen ein: Verlust 0,34 % von 2 %, Chance-Risiko 2,00 (nach Gebühren 1,14), Tageslimit 0 %", () => {
    expect(sized.maxLoss).toBeCloseTo(17.214435, 6);
    const v = riskCheck(input());
    expect(v.light).toBe("green");
    expect(v.blocked).toBe(false);
    expect(v.headline).toBe("Grün: Der Plan hält alle deine Grenzen ein.");
    expect(v.counts).toEqual({ ok: v.lines.length, warn: 0, breach: 0 });
    expect(line(v, "stop")).toMatchObject({ state: "ok", title: "Stop gesetzt", detail: "Stop 100.065,0, 0,31 % vom Einstieg entfernt." });
    expect(line(v, "loss")).toMatchObject({ state: "ok", title: "Verlust am Stop 0,34 % (Limit 2,00 %)" });
    expect(line(v, "loss").detail).toBe("17,21 USDT bis zum Stop, inklusive Gebühren und Slippage – bei 5.000,00 USDT Kapital. Dein Limit pro Trade: 100,00 USDT.");
    expect(line(v, "rr").title).toBe("Chance-Risiko 2,00 : 1 (nach Gebühren 1,14 : 1)");
    expect(line(v, "day")).toMatchObject({ state: "ok", title: "Tageslimit zu 0 % genutzt" });
    expect(line(v, "trades").title).toBe("0 von 5 Trades heute");
    expect(line(v, "leverage").title).toBe("Hebel 0,7× (Regel 4×)");
    expect(line(v, "pause").state).toBe("ok");
  });
});

describe("Risiko-Check · Gründe", () => {
  it("Stop fehlt → rot", () => {
    const v = riskCheck(input({ stop: null, maxLoss: null }));
    expect(v.light).toBe("red");
    expect(line(v, "stop")).toMatchObject({ state: "breach", title: "Stop fehlt" });
    expect(v.headline.startsWith("Rot: Stop fehlt.")).toBe(true);
    expect(line(v, "loss")).toBeUndefined();
  });

  it("Stop auf der falschen Seite → rot", () => {
    const v = riskCheck(input({ stop: 100500 }));
    expect(line(v, "stop")).toMatchObject({ state: "breach", title: "Stop auf der falschen Seite" });
  });

  it("Verlust am Stop 2,33 % > Limit 2,00 % → rot (0,25 BTC × 465,255 = 116,31)", () => {
    const v = riskCheck(input({ qty: 0.25, notional: 0.25 * 100380, maxLoss: 0.25 * 465.255, leverage: 6 }));
    expect(line(v, "loss")).toMatchObject({ state: "breach", title: "Verlust am Stop 2,33 % > Limit 2,00 %" });
    expect(v.light).toBe("red");
    expect(v.blocked).toBe(true);
    // 25 095 Positionswert = 5,02× das Konto, Regel 4×
    expect(line(v, "leverage")).toMatchObject({ state: "breach", title: "Hebel 6,0× über deiner Regel (4×)" });
  });

  it("Verlust bei 93 % des Limits → gelb (ab 75 % des Limits)", () => {
    const v = riskCheck(input({ qty: 0.2, notional: 0.2 * 100380, maxLoss: 0.2 * 465.255, leverage: 5 }));
    expect(line(v, "loss").state).toBe("warn");
  });

  it("Chance-Risiko unter dem Minimum → rot; vor Kosten genug, nach Kosten nicht → gelb", () => {
    const low = riskCheck(input({ target: 100500 })); // Gewinn 120 : Risiko 315
    expect(line(low, "rr")).toMatchObject({ state: "breach", title: "Chance-Risiko 0,38 : 1 unter deinem Minimum 1,00 : 1" });
    // 1,05 : 1 vor Kosten: Gewinn 330,75 → Ziel 100 710,75 – nach Gebühren (330,75 − 100,545) ÷ 465,255 = 0,49
    const net = riskCheck(input({ target: 100710.75 }));
    expect(line(net, "rr").state).toBe("warn");
    expect(line(net, "rr").title).toBe("Chance-Risiko 1,05 : 1 – nach Gebühren 0,49 : 1");
    expect(line(riskCheck(input({ target: null })), "rr")).toMatchObject({ state: "warn", title: "Kein Ziel gesetzt" });
    expect(line(riskCheck(input({ target: 100000 })), "rr").title).toBe("Ziel auf der falschen Seite");
    // ein strengeres Minimum macht aus 2,00 : 1 ein Rot
    expect(line(riskCheck(input({ minRewardRisk: 2.5 })), "rr").state).toBe("breach");
  });

  it("Tageslimit schon zu 70 % ausgeschöpft → gelb (140 von 200 USDT, mit diesem Trade 78 %)", () => {
    const v = riskCheck(input({ report: report([closedLoss(at(14, 9), -70), closedLoss(at(14, 11), -70)]) }));
    expect(line(v, "day")).toMatchObject({ state: "warn", title: "Tageslimit schon zu 70 % ausgeschöpft" });
    expect(line(v, "day").detail).toBe("140,00 USDT von 200,00 USDT heute. Mit diesem Trade bis zum Stop wären es 157,21 USDT (79 %).");
    expect(v.light).toBe("amber");
    expect(v.blocked).toBe(false);
    expect(v.headline).toBe("Gelb: Tageslimit schon zu 70 % ausgeschöpft. Der Plan hält deine Grenzen ein, schau bei den markierten Punkten hin.");
  });

  it("der Verlust DIESES Trades zählt: 190 von 200 verbraucht und noch 17,21 dazu → rot", () => {
    const v = riskCheck(input({ report: report([closedLoss(at(14, 9), -95), closedLoss(at(14, 11), -95)]) }));
    expect(line(v, "day")).toMatchObject({ state: "breach", title: "Mit diesem Stop wären es 104 % deines Tageslimits" });
    expect(v.light).toBe("red");
  });

  it("Tageslimit schon erreicht → rot", () => {
    const v = riskCheck(input({ report: report([closedLoss(at(14, 9), -100), closedLoss(at(14, 10), -100)]) }));
    expect(line(v, "day")).toMatchObject({ state: "breach", title: "Tageslimit schon erreicht" });
  });

  it("Trades pro Tag: fünf waren es schon → rot", () => {
    const five = Array.from({ length: 5 }, (_, i) => closedLoss(at(14, 8 + i), 1));
    const v = riskCheck(input({ report: report(five) }));
    expect(line(v, "trades")).toMatchObject({ state: "breach", title: "Schon 5 Trades heute" });
    expect(line(riskCheck(input({ report: report(five.slice(0, 4)) })), "trades").detail).toBe("Das wäre dein letzter Trade des Tages.");
  });

  it("offenes Risiko: ein offener Trade trägt 140 von 150, dazu 17,21 → rot", () => {
    // Menge 70 × Abstand 2 = 140
    const v = riskCheck(input({ report: report([openTrade(at(14, 9), { size: 7000 })]) }));
    expect(line(v, "open")).toMatchObject({ state: "breach", title: "Offenes Risiko über der Grenze" });
  });

  it("Pause nach zwei Verlusten in Folge → rot, mit der Zeit der Pause", () => {
    const v = riskCheck(input({ report: report([closedLoss(at(14, 14, 10), -5), closedLoss(at(14, 14, 40), -5)]) }));
    expect(line(v, "pause").state).toBe("breach");
    expect(line(v, "pause").title).toBe("2 Verluste in Folge – kurze Pause");
    expect(v.light).toBe("red");
  });

  it("Liquidation vor dem Stop (Hebel 20, Stop weit weg) → rot, dazu die Hebelregel", () => {
    const v = riskCheck(input({ stop: 90000, leverage: 20, qty: 0.01, notional: 1003.8, maxLoss: 0.01 * 10600 }));
    expect(line(v, "liquidation")).toMatchObject({ state: "breach", title: "Liquidation vor dem Stop" });
    expect(line(v, "leverage").state).toBe("breach");
    // mit Hebel 3 und engem Stop liegt die Liquidation weit hinter dem Stop
    const calm = riskCheck(input({ leverage: 3 }));
    expect(line(calm, "liquidation").state).toBe("ok");
    // ohne Hebel gibt es die Zeile nicht
    expect(line(riskCheck(input()), "liquidation")).toBeUndefined();
  });

  it("der Kurs ist seit dem Signal gelaufen: vom schlechteren Preis gemessen, Chance-Risiko 0,77 → rot", () => {
    const fresh = { price: 100600, at: NOW - 60_000 };
    const v = riskCheck(input({ fresh }));
    expect(line(v, "price")).toMatchObject({ state: "breach", title: "Der Kurs ist seit dem Plan gelaufen: 100.600,0 statt 100.380,0" });
    expect(line(v, "price").detail).toContain("Chance-Risiko");
    expect(line(v, "price").detail).toContain("das hält deine Grenzen nicht mehr ein");
    // ein Kurs unter dem Einstieg ist nicht schlechter (Long)
    expect(line(riskCheck(input({ fresh: { price: 100300, at: NOW - 1000 } })), "price")).toMatchObject({ state: "ok" });
    // ein Kurs, der älter als 15 Minuten ist, wird nicht benutzt
    expect(line(riskCheck(input({ fresh: { price: 100600, at: NOW - FRESH_MAX_MS - 1 } })), "price")).toBeUndefined();
  });

  it("ein Kurs knapp über dem Einstieg, der alle Grenzen noch hält, ist nur gelb", () => {
    const v = riskCheck(input({ fresh: { price: 100400, at: NOW - 1000 } }));
    expect(line(v, "price").state).toBe("warn");
    expect(v.light).toBe("amber");
  });

  it("ein altes Signal: gelb (älter als eine Kerze); in einer vergangenen Sitzung nicht", () => {
    const v = riskCheck(input({ signal: { ageMin: 25, late: true, past: false } }));
    expect(line(v, "signal")).toMatchObject({ state: "warn", title: "Das Signal ist 25 Minuten alt" });
    expect(line(riskCheck(input({ signal: { ageMin: 25, late: true, past: true } })), "signal")).toBeUndefined();
    expect(line(riskCheck(input({ signal: { ageMin: 2, late: false, past: false } })), "signal")).toBeUndefined();
  });

  it("Short spiegelt: der Kurs UNTER dem Einstieg ist schlechter", () => {
    const v = riskCheck(input({ side: "short", entry: 100000, stop: 100300, target: 99400, fresh: { price: 99800, at: NOW - 1000 }, maxLoss: 0.037 * 450.3, qty: 0.037, notional: 3700 }));
    expect(line(v, "price").title).toBe("Der Kurs ist seit dem Plan gelaufen: 99.800,0 statt 100.000,0");
  });
});

describe("Risiko-Check · Gleichlauf mit der Risiko-Seite", () => {
  it("dieselben Zahlen wie riskPreview: Verlust-Grenze, Liquidation und Tageslimit sagen dasselbe", () => {
    const rep = report([closedLoss(at(14, 9), -70), closedLoss(at(14, 11), -70)]);
    const pv = riskPreview({ account: "scalp", side: "long", status: "open", entry: 100380, stop: 100065, target: 101010, qty: 0.25, leverage: 3, marginMode: "isolated" }, { limits, report: rep, capital: 5000, now: NOW });
    const mine = riskCheck(input({ report: rep, qty: 0.25, notional: 0.25 * 100380, maxLoss: 0.25 * 465.255, leverage: 3 }));
    // die Risiko-Seite warnt vor dem Risiko pro Trade (ohne Kosten 78,75 = 1,58 %) – das Plan-Risiko mit Kosten (116,3) ist strenger
    expect(pv.riskPct).toBeCloseTo((0.25 * 315) / 5000, 10);
    expect(line(mine, "loss").state).toBe("breach");
    // Tageslimit: die Risiko-Seite meldet "Stop würde dein Tageslimit reißen", der Plan auch (rot)
    expect(pv.warnings.some((w) => w.key === "preview:day")).toBe(true);
    expect(line(mine, "day").state).toBe("breach");
    // Liquidation: keine Warnung dort, keine hier
    expect(pv.warnings.some((w) => w.key === "preview:liq")).toBe(false);
    expect(line(mine, "liquidation").state).toBe("ok");
  });
});
