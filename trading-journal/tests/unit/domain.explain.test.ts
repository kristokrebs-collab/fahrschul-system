import { describe, expect, it } from "vitest";
import { explain, explainSetup, EMPTY_VERDICT, tradeLine, formulaText, heroTileValue, heroSubline, EXPLAIN_KEYS } from "@/domain/explain";
import { accountView } from "@/domain/account";
import { backtestCompare, explainBacktest, hasBacktestSetup, BACKTEST_SETUP_DELETED } from "@/domain/backtest";
import { evaluateChecklist, explainChecklist, missedLabel, checklistTileCaption } from "@/domain/checklist";
import { minePatterns, compareGroups } from "@/domain/patterns";
import { aggregate } from "@/domain/agg";
import { A, B, C, D, E, F, enriched, settings } from "./domain.fixtures";

const s = settings();
const now = +new Date("2026-04-01T10:00");
const view = accountView(enriched(), s, "all", { now: () => now });
const empty = accountView([], s, "all");

describe("explain (bundle Jl)", () => {
  it("every key returns title/what/rows/verdict", () => {
    for (const k of EXPLAIN_KEYS) {
      const e = explain(k, view, s);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.what.length).toBeGreaterThan(0);
      expect(Array.isArray(e.rows)).toBe(true);
      expect(["win", "loss", "warn", "mute"]).toContain(e.verdict.tone);
      const ee = explain(k, empty, s);
      expect(ee.verdict.text.length).toBeGreaterThan(0);
    }
  });
  it("net", () => {
    const e = explain("net", view, s);
    expect(e.title).toBe("Netto-P&L");
    expect(formulaText(e.formula)).toBe("Bruttogewinne 446,00 − Bruttoverluste 200,00 = +246,00 USDT");
    expect(e.rows[0]).toEqual(["Rendite aufs Startkapital", `+1,0 %`, "text-win"]);
    expect(e.rows[1]).toEqual(["Kontostand jetzt", "25.246 USDT"]);
    expect(e.rows[2]).toEqual(["Bester Trade", "+396,00 USDT · 05.01.26", "text-win"]);
    expect(e.rows[3]).toEqual(["Schlechtester Trade", "−100,00 USDT · 12.01.26", "text-loss"]);
    expect(e.rows[4]).toEqual(["Gezahlte Gebühren", "4,00 USDT"]);
    expect(e.rows[5]).toEqual(["Offene Positionen", "1"]);
    // 396/246 > 0.5 → concentration warning
    expect(e.verdict).toEqual({ tone: "win", text: "Im Plus. Achtung: mehr als die Hälfte des Gewinns stammt aus einem einzigen Trade." });
    expect(explain("net", empty, s).verdict).toBe(EMPTY_VERDICT);
    const lossView = accountView(enriched([B, F]), s, "all");
    expect(explain("net", lossView, s).verdict.text).toBe("Im Minus. Schau in die Checklisten-Auswertung, welche Regeln bei den Verlusten gefehlt haben.");
    const spread = accountView(enriched([A, { ...A, id: "A2", date: "2026-01-06T10:00" }]), s, "all");
    expect(explain("net", spread, s).verdict.text).toBe("Im Plus. Der Gewinn verteilt sich auf mehrere Trades.");
    expect(tradeLine(null, "USDT")).toBe("–");
  });
  it("trades", () => {
    const e = explain("trades", view, s);
    expect(e.rows).toEqual([
      ["Abgeschlossen", "5"],
      ["Offen", "1"],
      ["Davon Long", "4"],
      ["Davon Short", "1"],
      ["Mit Checkliste komplett", "0"],
      ["Pro Woche", "0,4"],
    ]);
    expect(e.verdict).toEqual({ tone: "warn", text: "Stichprobe noch klein (5). Win-Rate und Erwartung schwanken bis etwa 30 Trades stark." });
  });
  it("winRate", () => {
    const e = explain("winRate", view, s);
    expect(formulaText(e.formula)).toBe(`2 Gewinner ÷ 5 Trades = 40 %\nBreak-even = Ø Verlust ÷ (Ø Gewinn + Ø Verlust) = 100,00 ÷ (223,00 + 100,00) = 31 %`);
    expect(e.rows[3]).toEqual(["Backtest-Referenz", `62,15 %`]);
    expect(e.rows[4]).toEqual(["Chance-Risiko real (Ø Gewinn ÷ Ø Verlust)", "2,23"]);
    expect(e.rows[5]).toEqual(["Nötige Win-Rate", `31 %`]);
    expect(e.verdict.tone).toBe("win");
    expect(e.verdict.text).toBe("Du liegst 9,0 Prozentpunkte über deiner Break-even-Win-Rate. Das System ist profitabel.");
    expect(explain("winRate", accountView(enriched([A]), s, "all"), s).verdict.text).toBe("Für die Break-even-Rechnung brauchst du mindestens einen Gewinner und einen Verlierer.");
    const bad = accountView(enriched([A, B, F, { ...F, id: "F2" }, { ...F, id: "F3" }, { ...F, id: "F4" }, { ...F, id: "F5" }, { ...F, id: "F6" }]), s, "all");
    expect(explain("winRate", bad, s).verdict.text).toMatch(/^Du liegst \d+,\d Prozentpunkte unter deiner Break-even-Win-Rate\. Entweder öfter richtig liegen oder Gewinner länger laufen lassen\.$/);
  });
  it("pf thresholds", () => {
    expect(formulaText(explain("pf", view, s).formula)).toBe("Bruttogewinne 446,00 ÷ Bruttoverluste 200,00 = 2,23");
    expect(explain("pf", view, s).verdict.text).toBe("Über 2: starkes Verhältnis von Gewinnen zu Verlusten.");
    expect(explain("pf", accountView(enriched([A]), s, "all"), s).verdict.text).toBe("Noch kein Verlust. Der Faktor wird aussagekräftig, sobald Verluste dabei sind.");
    expect(formulaText(explain("pf", accountView(enriched([A]), s, "all"), s).formula)).toContain("= ∞");
    expect(explain("pf", accountView(enriched([B, F, C]), s, "all"), s).verdict.text).toBe("Unter 1: Die Verluste sind größer als die Gewinne.");
    const w = { ...A, pnlManual: 120 };
    expect(explain("pf", accountView(enriched([w, B]), s, "all"), s).verdict.text).toBe("Zwischen 1 und 1,5: profitabel, aber knapp. Gebühren und Funding können das kippen.");
    expect(explain("pf", accountView(enriched([{ ...A, pnlManual: 180 }, B]), s, "all"), s).verdict.text).toBe("Zwischen 1,5 und 2: solides System.");
    expect(explain("pf", accountView(enriched([E]), s, "all"), s).verdict).toBe(EMPTY_VERDICT);
  });
  it("avgR", () => {
    const e = explain("avgR", view, s);
    expect(e.rows[0]).toEqual(["Trades mit Stop", "3 von 5"]);
    expect(e.rows[3]).toEqual(["Trades mit ≥ 2 R", `1 (33 %)`]);
    expect(e.verdict.text).toBe(`Mindestens ein Verlust war größer als 1 R (−2,00 R). Das heißt, ein Stop wurde verschoben oder nicht eingehalten.`);
    expect(explain("avgR", accountView(enriched([C]), s, "all"), s).verdict.text).toBe("Trag bei deinen Trades einen Stop-Loss ein, dann berechne ich das R-Multiple.");
    expect(explain("avgR", accountView(enriched([A]), s, "all"), s).verdict.text).toBe("Positiver Durchschnitt: Im Schnitt holst du mehr als du riskierst.");
    expect(explain("avgR", accountView(enriched([B]), s, "all"), s).verdict.text).toBe("Negativer Durchschnitt: Im Schnitt verlierst du einen Teil deines Risikos pro Trade.");
  });
  it("maxDD", () => {
    const e = explain("maxDD", view, s);
    expect(formulaText(e.formula)).toBe(`(Tief 25.246 − Hoch 25.396) ÷ Hoch = −0,6 %`);
    expect(e.rows[2]).toEqual(["Hoch bei", "Trade #1"]);
    expect(e.rows[3]).toEqual(["Tief bei", "Trade #5"]);
    expect(e.verdict.text).toBe("Unter 5 %: sehr kontrolliertes Risiko.");
    const big = accountView(enriched([{ ...B, pnlManual: -2000 }]), s, "all");
    expect(explain("maxDD", big, s).verdict.text).toBe("Zwischen 5 und 15 %: vertretbar, aber im Blick behalten.");
    expect(explain("maxDD", big, s).rows[2]).toEqual(["Hoch bei", "Start"]);
    expect(explain("maxDD", accountView(enriched([{ ...B, pnlManual: -5000 }]), s, "all"), s).verdict.text).toBe("Über 15 %: Positionsgrößen oder Hebel prüfen (Regel: Scalp 4x, Makro höchstens 5x).");
    expect(explain("maxDD", accountView(enriched([A]), s, "all"), s).rows[3]).toEqual(["Tief bei", "–"]);
  });
  it("exp / projection / streak", () => {
    const e = explain("exp", view, s);
    expect(formulaText(e.formula)).toBe(`40 % × 223,00 + 40 % × −100,00 ≈ +49,20 USDT`);
    expect(e.verdict.text).toBe("Positiv: Mit jedem weiteren Trade nach diesem Muster wächst das Konto im Schnitt.");
    expect(explain("exp", accountView(enriched([B]), s, "all"), s).verdict.text).toBe("Negativ: Im Schnitt kostet dich jeder Trade Geld.");
    const p = explain("projection", view, s);
    expect(formulaText(p.formula)).toMatch(/^Linear: \+1,0 % × 365 ÷ \d+ Tage = \+\d+,\d %\nZinseszins: \(1 \+ 0,98 %\)\^\(365 ÷ \d+\) − 1 = \+\d+,\d %$/);
    expect(p.rows[0]![0]).toBe("Basis");
    expect(p.rows[1]).toEqual(["Startkapital", "25.000 USDT"]);
    expect(p.verdict.text).toBe("Wenig Daten: Die Hochrechnung wird ab etwa 30 Tagen und 10 Trades belastbar.");
    expect(explain("projection", empty, s).formula).toBeUndefined();
    expect(explain("projection", empty, s).rows).toEqual([]);
    const st = explain("streak", view, s);
    expect(st.rows[0]).toEqual(["Aktuell", "1× Verlust"]);
    expect(st.verdict.text).toBe("Kein Warnsignal.");
    const three = accountView(enriched([B, F, { ...F, id: "F2", date: "2026-03-02T10:00" }]), s, "all");
    expect(explain("streak", three, s).verdict.text).toBe("3 Verluste in Folge. Pause machen und die Checkliste der letzten Trades prüfen.");
    expect(explain("streak", empty, s).rows[0]).toEqual(["Aktuell", "–"]);
  });
  it("hero tiles", () => {
    expect(heroTileValue("trades", view)).toBe("5 +1 offen");
    expect(heroTileValue("winRate", view)).toBe(`40 %`);
    expect(heroTileValue("pf", view)).toBe("2,23");
    expect(heroTileValue("avgR", view)).toBe(`+0,43 R`);
    expect(heroTileValue("maxDD", view)).toBe(`−0,6 %`);
    expect(heroTileValue("maxDD", empty)).toBe("–");
    expect(heroSubline(view)).toBe("2 gewonnen · 2 verloren · 1 Break-even");
    expect(heroSubline(empty)).toBe("Noch keine abgeschlossenen Trades. Alle Werte starten bei null.");
  });
});

describe("explainSetup (bundle g2)", () => {
  it("rows and verdict thresholds", () => {
    const bo = view.setups.find((x) => x.setup.id === "s_bo")!;
    const e = explainSetup(bo, view.list, s.currency);
    expect(e.title).toBe("4H-Breakout über 85.900");
    expect(e.rows[0]).toEqual(["Profit-Faktor", "∞"]);
    expect(e.rows[1]).toEqual(["Ø Gewinn / Ø Verlust", "396 / –"]);
    expect(e.rows[4]).toEqual(["Checkliste komplett", "0 von 1"]);
    expect(e.verdict).toEqual({ tone: "warn", text: "Erst 1 Trade. Ab etwa 10 Trades lässt sich die Grundlage fair bewerten." });
    const ml = view.setups.find((x) => x.setup.id === "s_ml")!;
    const em = explainSetup(ml, view.list, s.currency);
    expect(em.rows[4]).toEqual(["Checkliste komplett", "–"]);
    expect(em.verdict.text).toBe("Noch keine abgeschlossenen Trades mit dieser Grundlage.");
    const many = enriched(Array.from({ length: 6 }, (_, i) => ({ ...A, id: "A" + i, date: `2026-01-0${i + 1}T10:00` })));
    const v6 = accountView(many, s, "all");
    expect(explainSetup(v6.setups.find((x) => x.setup.id === "s_bo")!, v6.list, "USDT").verdict.text).toBe("Diese Grundlage verdient Geld. Weiter so, gleiche Regeln.");
    const bad = enriched(Array.from({ length: 6 }, (_, i) => ({ ...B, id: "B" + i, setups: ["s_bo"], date: `2026-01-0${i + 1}T10:00` })));
    const vb = accountView(bad, s, "all");
    expect(explainSetup(vb.setups.find((x) => x.setup.id === "s_bo")!, vb.list, "USDT").verdict.text).toBe("Diese Grundlage kostet Geld. Regeln schärfen oder seltener handeln.");
    expect(explainSetup({ ...bo, setup: { ...bo.setup, desc: "" } }, view.list, "USDT").what).toBe("Keine Regeln hinterlegt.");
  });
});

describe("backtest compare (bundle bhe/h2)", () => {
  it("rows, headline, sub, badge", () => {
    const c = backtestCompare(view.closed, s.backtest, "all");
    expect(c.rows.map((r) => r.l)).toEqual(["Win-Rate", "Ø Gewinner", "Ø Verlierer", "Erwartung pro Trade"]);
    expect(c.rows[0]!.youText).toBe(`40 %`);
    expect(c.rows[0]!.refText).toBe(`62,15 %`);
    expect(c.rows[0]!.deltaText).toBe("▼ 22,2");
    expect(c.rows[1]!.you).toBeCloseTo(0.05, 12);
    expect(c.rows[1]!.deltaText).toBe("▼ 11,6");
    expect(c.rows[2]!.tone).toBe("win"); // −1,2 % is better than −9,31 %
    expect(c.rows[2]!.deltaText).toBe("▲ 8,1");
    expect(c.status).toBe("under");
    expect(c.headline).toBe("Du liegst unter dem Backtest");
    expect(c.sub).toMatch(/^Erwartung −6,2 %-Punkte gegenüber Backtest · 4 Trades mit Ein- und Ausstieg$/);
    expect(c.warnBadge).toBe("ab 30 Trades belastbar");
    const bt = backtestCompare(view.closed, s.backtest, "bt");
    expect(bt.stats.n).toBe(1);
    expect(bt.sub).toBe("Erwartung −8,1 %-Punkte gegenüber Backtest · 1 Trade mit Ein- und Ausstieg");
    const none = backtestCompare([], s.backtest);
    expect(none.headline).toBe("Noch kein Vergleich möglich");
    expect(none.sub).toBe("Sobald du Trades mit Ein- und Ausstieg abschließt, vergleiche ich sie mit dem Backtest (214 Signale).");
    expect(none.rows[0]!.deltaText).toBe("–");
    expect(none.warnBadge).toBeNull();
    expect(hasBacktestSetup(s)).toBe(true);
    expect(hasBacktestSetup({ setups: [] })).toBe(false);
    expect(BACKTEST_SETUP_DELETED).toContain("Backtest-Signal (214er)");
  });
  it("explainBacktest", () => {
    const e = explainBacktest("avgLoss", view.g, s);
    expect(e.sheetTitle).toBe("Backtest · 214 Signale");
    expect(e.title).toBe("Ø Verlierer");
    expect(formulaText(e.formula)).toBe(`Du −1,2 % − Backtest −9,3 % = +8,10 Prozentpunkte`);
    expect(e.rows).toEqual([
      ["Datenbasis", "4 Trades"],
      ["Backtest", "214 Signale"],
    ]);
    expect(e.verdict).toEqual({ tone: "win", text: "Besser als der Backtest." });
    const w = explainBacktest("winRate", view.g, s);
    expect(w.rows[0]).toEqual(["Datenbasis", "5 Trades"]);
    expect(w.verdict.text).toBe("Schlechter als der Backtest.");
    const n = explainBacktest("exp", aggregate([]), s);
    expect(n.formula).toBeUndefined();
    expect(n.verdict.text).toBe("Noch keine Trades mit Ein- und Ausstieg.");
  });
});

describe("checklist evaluation (bundle khe)", () => {
  it("full vs gaps, missed items, explain", () => {
    const full = { ...A, id: "A_full", checks: Object.fromEntries(enriched([A])[0]!.items.map((i) => [i.id, true])) };
    const ev = evaluateChecklist(accountView(enriched([A, B, F, full]), s, "all").closed);
    expect(ev.withList.length).toBe(4);
    expect(ev.full.n).toBe(1);
    expect(ev.full.winRate).toBe(1);
    expect(ev.gaps.n).toBe(3);
    expect(ev.missed[0]!.text).toBe("Top-down geprüft (W → 3D → D → 4H → 1H)");
    expect(ev.missed[0]!.n).toBe(3);
    expect(ev.missed[0]!.loss).toBe(2);
    expect(missedLabel(ev.missed[0]!)).toBe("3× · 67 % Verlust");
    expect(ev.missed.length).toBe(3);
    const trig = ev.items.find((i) => i.text === "Trigger ausgelöst, nicht geraten")!;
    expect(trig.withChecked.n).toBe(2);
    expect(trig.withoutChecked.n).toBe(2);
    expect(trig.delta).toBe(1);
    const ex = explainChecklist(ev);
    expect(ex.title).toBe("Checklisten-Auswertung");
    expect(ex.rows[1]).toEqual(["Alles erfüllt", `1 · 100 % Win-Rate`]);
    expect(ex.rows[2]).toEqual(["Mit Lücken", `3 · 33 % Win-Rate`]);
    expect(ex.rows[3]).toEqual(["Differenz", "+67 Prozentpunkte"]);
    expect(ex.verdict.text).toBe("Mit voller Checkliste gewinnst du öfter. Die Regeln wirken.");
    expect(checklistTileCaption(ev.full)).toBe("1 Trades · +396");
    const onlyGaps = explainChecklist(evaluateChecklist(view.closed));
    expect(onlyGaps.rows[3]).toEqual(["Differenz", "–"]);
    expect(onlyGaps.verdict.text).toBe("Für einen Vergleich brauchst du Trades mit und ohne vollständige Checkliste.");
    const worse = explainChecklist(evaluateChecklist(accountView(enriched([{ ...full, pnlManual: -10 }, A]), s, "all").closed));
    expect(worse.verdict.text).toBe("Mit Lücken läuft es bisher besser. Prüfe, ob die Checklisten-Punkte zu deinem Stil passen.");
  });
});

describe("patterns (bundle The)", () => {
  it("dimensions with min sample rules", () => {
    const rows = minePatterns(view.closed);
    expect(rows.map((r) => r.title)).toEqual(["Plan befolgt?", "Richtung", "Überzeugung", "Gefühl beim Einstieg", "Wochentag"]);
    const plan = rows[0]!;
    expect(plan.a.label).toBe("Ja");
    expect(plan.a.g.n).toBe(2); // A, E
    expect(plan.b.g.n).toBe(2); // B, F
    expect(plan.verdict).toBe("Mit Plan besser");
    expect(rows[1]!.verdict).toBe("Long besser");
    expect(rows[2]!.a.label).toBe("Hoch (4–5)");
    expect(rows[2]!.a.g.n).toBe(2); // A (4), F (5)
    expect(rows[2]!.b.g.n).toBe(2); // B (3), E (2)
    expect(rows[3]!.verdict).toBe("bestes / schlechtestes");
    expect(rows[3]!.a.label).toBe("Ruhig");
    expect(rows[3]!.b.label).toBe("Gierig"); // FOMO and Gierig both −100 → stable sort keeps FOMO first, Gierig last
    expect(rows[4]!.verdict).toBe("bester / schlechtester");
    expect(minePatterns([])).toEqual([]);
    // Konto row only when both accounts have trades
    const withMakro = accountView(enriched([A, B, { ...D, status: "closed", exit: 84000 }]), s, "all").closed;
    expect(minePatterns(withMakro).find((r) => r.key === "account")?.verdict).toBe("Makro besser");
    expect(compareGroups(aggregate([]), view.g, "x", "y")).toBe("");
    expect(compareGroups(view.g, view.g, "x", "y")).toBe("gleich");
  });
});
