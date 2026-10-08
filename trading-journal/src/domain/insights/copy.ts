/**
 * German copy of the "Auswertung" cards: titles, empty states and the explainers (`Explanation`, rendered by the
 * overview's `ExplanationView`). Every explainer names its formula and its minimum sample.
 */
import type { Explanation, ExplainRow, Verdict } from "../explain";
import type { Agg } from "../agg";
import { colorClass, DASH, n0, n2, pct, pct0, r as fmtR, signed } from "@/lib/format";
import type { CalendarMonth, CalendarUnit } from "./calendar";
import type { DisciplineSummary } from "./discipline";
import { EDGE_MIN_TRADES, type EdgeResult } from "./edge";
import { AUTO_RULES, type MistakeReport } from "./mistakes";
import type { DrawdownReport, RDistribution } from "./risk";
import type { ConditionEffect, StrengthResult } from "./signal";
import { FINDING_MIN_N, OVERTRADING_PER_DAY, REVENGE_MINUTES } from "./findings";
import { RECAP_MIN_TRADES } from "./recap";

export const SECTION_TITLE = "Auswertung";
export const SECTION_LEAD = "Kalender, Edge-Score, Disziplin und Muster – alles aus deinen Trades berechnet.";

export const TITLES = {
  recap: "Rückblick",
  findings: "Erkenntnisse",
  calendar: "P&L-Kalender",
  edge: "Edge-Score",
  discipline: "Disziplin",
  mistakes: "Fehler-Kosten",
  signal: "Ergebnis nach Signal-Stärke",
  time: "Zeit & Session",
  r: "R-Verteilung",
  drawdown: "Drawdown",
  winloss: "Gewinner vs. Verlierer",
} as const;

export const EMPTY = {
  trades: { title: "Noch keine Trades", text: "Sobald du Trades abschließt, rechnet sich diese Auswertung von selbst." },
  recap: { title: "Noch kein Rückblick", text: `Ab ${RECAP_MIN_TRADES} abgeschlossenen Trades in einer Woche oder einem Monat steht hier dein Rückblick.` },
  findings: { title: "Noch keine klaren Muster", text: `Jede Erkenntnis braucht mindestens ${FINDING_MIN_N} Trades auf beiden Seiten. Mit mehr Trades tauchen hier deine drei wichtigsten auf.` },
  edge: { title: "Noch keine Trades", text: "Der Score bewertet sechs Kennzahlen deiner abgeschlossenen Trades von 0 bis 100." },
  discipline: { title: "Noch keine Handelstage", text: "Jeder Tag mit Trades wird automatisch gegen deine Regeln geprüft – ohne Abhaken." },
  mistakes: { title: "Keine Fehler markiert", text: "Markiere im Trade unter „Fehler“, was schiefging. Hier siehst du dann, welcher Fehler dich am meisten kostet." },
  signal: {
    title: "Noch keine Trades mit Einstiegs-Check",
    text: "Ab jetzt speichert jeder neue Trade automatisch, wie stark das Signal beim Einstieg war. Hier siehst du dann, ob stärkere Signale wirklich mehr bringen.",
  },
  r: { title: "Noch keine Trades mit Stop", text: "R gibt es nur für Trades mit Stop. Trag beim nächsten Trade einen Stop ein." },
  drawdown: { title: "Kein Drawdown", text: "Dein Konto lag noch nie unter seinem Höchststand. So kann es bleiben." },
  winloss: { title: "Noch kein Vergleich", text: "Für den Vergleich brauchst du mindestens einen Gewinner und einen Verlierer." },
} as const;

export const UNIT_LABELS: Readonly<Record<CalendarUnit, string>> = { money: "€", r: "R", pct: "%" };

export function explainCalendar(m: CalendarMonth, currency: string): Explanation {
  return {
    key: "calendar",
    title: "So liest du den Kalender",
    what: "Jeder Tag zeigt das Netto-P&L der Trades, die an diesem Tag eröffnet wurden (das Journal speichert keine Ausstiegszeit). Je kräftiger die Farbe, desto größer der Tag im Vergleich zu deinen anderen Tagen im Monat. Die Spalte „Woche“ summiert nur die Tage dieses Monats, also ergeben alle Wochen zusammen die Monatssumme. Tippe einen Tag an für die Tagesansicht mit Trades und Tagesnotiz.",
    rows: [
      ["Monat netto", `${signed(m.g.net, 0)} ${currency}`, colorClass(m.g.net)],
      ["Handelstage", String(m.tradingDays)],
      ["Tages-Win-Rate", m.dayWinRate == null ? DASH : `${pct0(m.dayWinRate)} (${m.winDays} von ${m.tradingDays})`],
      ["Trades", `${m.g.n} · ${pct0(m.g.winRate)} Win-Rate`],
    ],
    verdict: { tone: "mute", text: "„R“ summiert die R-Werte der Trades mit Stop, „%“ zeigt das Tages-P&L relativ zum Startkapital." },
  };
}

export function explainEdge(e: EdgeResult): Explanation {
  const rows: ExplainRow[] = e.axes.map((a) => [`${a.label} · ${Math.round(a.weight * 100)} %`, `${a.raw} → ${Math.round(a.value)}`]);
  const verdict: Verdict = !e.n
    ? { tone: "mute", text: "Der Score füllt sich mit deinem ersten abgeschlossenen Trade." }
    : !e.reliable
      ? { tone: "mute", text: `Noch vorläufig: aussagekräftig ab ${EDGE_MIN_TRADES} Trades (bisher ${e.n}).` }
      : e.weakest
        ? { tone: e.score != null && e.score >= 60 ? "win" : "warn", text: `Größter Hebel: ${e.weakest.label} (${Math.round(e.weakest.value)} von 100) – hier liegen die meisten Punkte.` }
        : { tone: "win", text: "Alle sechs Kennzahlen auf voller Punktzahl." };
  return {
    key: "edge",
    title: "Sechs Kennzahlen, gewichtet",
    what: "Nach dem Zella-Score 2.0: jede Kennzahl wird stufenlos auf 0–100 abgebildet und gewichtet. Profit-Faktor 25 % (1,0 → 20, 1,8 → 50, ab 2,6 → 100), Ø Gewinn / Ø Verlust 20 % (gleiche Skala), Drawdown 20 % (vom Höchststand des Kontos: 0 % → 100, −10 % → 50, −20 % → 0), Win-Rate 15 % (60 % = volle Punkte), Erholung 10 % (Netto ÷ max. Drawdown, ab 3,5 → 100), Konstanz 10 % (Anteil des besten Tages am Gewinn: bis 30 % → 100, 100 % → 0).",
    formula: [{ text: "Score = " }, ...e.axes.flatMap((a, i) => [{ text: `${i ? " + " : ""}${Math.round(a.value)} × ${Math.round(a.weight * 100)} %` }]), { text: ` = ${e.score ?? DASH}`, bold: true }],
    rows,
    verdict,
  };
}

export function explainMistakes(rep: MistakeReport, currency: string, withAuto: boolean): Explanation {
  return {
    key: "mistakes",
    title: "So wird gerechnet",
    what: `Mehrkosten = P&L der Trades mit diesem Fehler minus (Anzahl × Ø P&L deiner sauberen Trades ohne Fehler). So siehst du, was der Fehler dich wirklich kostet, nicht nur den Verlust des Trades.${withAuto ? " Neben deinen Markierungen erkennt das Journal einige Fehler selbst:" : ""}`,
    rows: [
      ["Saubere Trades", String(rep.clean.n)],
      ["Ø P&L sauber", rep.clean.exp == null ? DASH : `${signed(rep.clean.exp, 0)} ${currency}`, colorClass(rep.clean.exp)],
      ["Ø R sauber", fmtR(rep.clean.avgR)],
      ...(withAuto ? AUTO_RULES.map(([tag, rule]) => [tag, rule] as ExplainRow) : []),
    ],
    verdict: { tone: "mute", text: "Ein Trade mit zwei Fehlern zählt in beiden Zeilen." },
  };
}

/** A further row of "Wirkung der Bedingungen" (Top-Trader legacy reading, graded parts of v2 snapshots). */
export interface SignalEffectRow {
  label: string;
  /** win-rate difference met − missed (fraction), `null` when one side is empty */
  dWin: number | null;
  /** an item of the row above (Top-Trader parts) */
  sub?: boolean;
  /** trades whose check had no data for it (listed, never counted) */
  noData?: number;
}

/**
 * Info panel of `Ergebnis nach Signal-Stärke`: the ladder conditions' effects plus `extra` — the stored top-trader
 * reading and the graded parts of v2 snapshots (Top-Trader-Kombi and its items, Divergenz, Support / Widerstand).
 */
export function explainSignal(res: StrengthResult, effects: readonly ConditionEffect[], extra: readonly SignalEffectRow[] = []): Explanation {
  const effectRow = (label: string, dWin: number | null, noData = 0): ExplainRow => [
    label,
    `${dWin == null ? DASH : `${signed(dWin * 100, 0)} Prozentpunkte`}${noData > 0 ? ` · ${noData} ohne Daten` : ""}`,
    colorClass(dWin),
  ];
  return {
    key: "signal",
    title: "Zahlt sich Bestätigung aus?",
    what: `Jeder Trade speichert beim Eintragen den Einstiegs-Check (MCB-Leiter, RSI, Zone). Hier wird nach der Stärke gruppiert. Steigen Win-Rate und P&L mit der Stärke, lohnt sich Warten auf mehr Bestätigung. Liegen schwache Signale vorne, steigst du vielleicht zu spät ein. Darunter: wie jede einzelne Bedingung die Win-Rate verändert (mit gegen ohne).${extra.length ? " Neuere Checks speichern auch den Kerzenschluss (vorläufig · bestätigt · stark bestätigt) und die Teil-Bedingungen (Top-Trader-Kombi mit ihren Teilen, Divergenz, Support / Widerstand); Trades ohne Daten dafür zählen weder als erfüllt noch als offen." : ""}`,
    rows: [
      ["Trades mit Check", String(res.withCheck)],
      ...effects.map((e) => effectRow(e.label, e.dWin)),
      ...extra.map((e) => effectRow(e.sub ? `· ${e.label}` : e.label, e.dWin, e.noData ?? 0)),
    ],
    verdict: { tone: "mute", text: "Aussagekräftig ab etwa 10 Trades pro Stufe." },
  };
}

export function explainDiscipline(s: DisciplineSummary): Explanation {
  return {
    key: "discipline",
    title: "Automatisch geprüft",
    what: "Jeder Tag mit Trades wird gegen diese Regeln geprüft – aus den Feldern, die du beim Eintragen sowieso ausfüllst. Tagesscore = erfüllte ÷ anwendbare Regeln. Eine Regel, die an einem Tag nicht geprüft werden kann (z. B. kein Trade mit Checkliste), zählt weder dafür noch dagegen. Serie = Handelstage in Folge mit mindestens 80 %; Tage ohne Trades unterbrechen sie nicht.",
    rows: s.rates.map((r) => [r.label, r.rate == null ? "nicht anwendbar" : `${pct0(r.rate)} an ${r.applicable} Tagen`]),
    verdict: { tone: "mute", text: `Quote der letzten ${s.window} Tage. Kästchen: grau = ohne Trades, heller = mehr Regeln erfüllt.` },
  };
}

export function explainFindings(): Explanation {
  return {
    key: "findings",
    title: "Wie Erkenntnisse entstehen",
    what: `Das Journal vergleicht Gruppen deiner Trades mit dem Rest: nach zwei Verlusten in Folge, bis ${REVENGE_MINUTES} min nach einem Verlust, Wochenende, jede Session, Tage mit mehr als ${OVERTRADING_PER_DAY} Trades, Hebel über der Regel, ohne Stop, Checklisten-Lücken, Gefühl, Plan, Zone und Stärke des Einstiegs-Checks, Short und Überzeugung. Gezeigt wird eine Gruppe nur mit mindestens ${FINDING_MIN_N} Trades auf beiden Seiten und einem echten Unterschied (10 Prozentpunkte Win-Rate oder 1 % des Kapitals).`,
    formula: [{ text: "Wirkung = P&L der Gruppe − Anzahl × Ø P&L der übrigen Trades" }],
    rows: [
      ["klar", "Der Unterschied liegt außerhalb der Zufallsschwankung (80 %)."],
      ["Tendenz", "Noch nicht sicher – mit mehr Trades prüfen."],
    ],
    verdict: { tone: "mute", text: "Sortiert nach der Wirkung in Geld." },
  };
}

export function explainTime(): Explanation {
  return {
    key: "time",
    title: "Zeiten für Krypto",
    what: "Wochentag und Stunde nach deiner Ortszeit. Sessions in UTC: Asien 00–07, London 07–13, New York 13–21, Spät 21–24 an Werktagen; Samstag und Sonntag (UTC) sind „Wochenende“. Beste und schlechteste Zeit erst ab 3 Trades.",
    rows: [],
    verdict: { tone: "mute", text: "Der Balken zeigt das Netto-P&L, die Zahl daneben die Win-Rate." },
  };
}

export function explainR(d: RDistribution): Explanation {
  return {
    key: "r",
    title: "Geplant gegen realisiert",
    what: "R = Ergebnis ÷ Risiko bis zum Stop. Geplant ist das Chance-Risiko-Verhältnis aus Ziel und Stop beim Eintragen. Die R-Effizienz zeigt, wie viel vom geplanten R deine Gewinner wirklich mitnehmen.",
    rows: [
      ["Trades mit R", String(d.rN)],
      ["Ø R realisiert", fmtR(d.avgR), colorClass(d.avgR)],
      ["Ø R geplant", d.planned == null ? DASH : `${n2(d.planned)} R (${d.plannedN} Trades)`],
      ["Anteil ≥ 2R", pct0(d.share2R)],
      ["Verluste größer als 1R", String(d.bigLosses.length)],
      ["R-Effizienz der Gewinner", d.efficiency == null ? DASH : `${pct0(d.efficiency)} (${d.efficiencyN} Gewinner)`],
    ],
    verdict:
      d.bigLosses.length > 0
        ? { tone: "warn", text: `${d.bigLosses.length} Verlust${d.bigLosses.length === 1 ? "" : "e"} über 1,1 R: Stop verschoben oder Slippage?` }
        : { tone: "win", text: "Kein Verlust über 1R – deine Stops halten." },
  };
}

export function explainDrawdown(rep: DrawdownReport, g: Agg, currency: string): Explanation {
  return {
    key: "drawdown",
    title: "Unter Wasser",
    what: "Die Kurve zeigt, wie weit dein Konto nach jedem Trade unter seinem bisherigen Höchststand lag (Startkapital eingerechnet). Erholungs-Faktor = Netto-Gewinn ÷ größter Drawdown in Geld.",
    rows: [
      ["Max. Drawdown", `${pct(rep.maxDD)} · ${n0(-rep.maxDDAbs)} ${currency}`, colorClass(rep.maxDD)],
      ["Aktuell", pct(rep.current), colorClass(rep.current)],
      ["Ø Drawdown", rep.avgDD == null ? DASH : pct(rep.avgDD)],
      ["Erholungs-Faktor", rep.recovery == null ? DASH : n2(rep.recovery)],
      ["Nötig bis zum Höchststand", rep.needed > 0 ? pct(rep.needed) : DASH],
      ["Netto", `${signed(g.net, 0)} ${currency}`, colorClass(g.net)],
    ],
    verdict:
      rep.current < 0
        ? { tone: "warn", text: `Du liegst ${pct(rep.current, false).replace("−", "")} unter dem Höchststand – dafür braucht es ${pct(rep.needed)}.` }
        : { tone: "win", text: "Das Konto steht auf seinem Höchststand." },
  };
}

export function explainWinLoss(): Explanation {
  return {
    key: "winloss",
    title: "Wo sich Gewinner und Verlierer unterscheiden",
    what: "Die gleichen Kennzahlen für deine Gewinner und deine Verlierer nebeneinander. Hervorgehoben sind die drei Zeilen mit dem größten Unterschied – dort liegt, was deine Gewinner anders machen.",
    rows: [],
    verdict: { tone: "mute", text: "Break-even-Trades zählen zu keiner Seite." },
  };
}

export function explainRecap(): Explanation {
  return {
    key: "recap",
    title: "Dein Rückblick",
    what: `Die laufende Kalenderwoche (Mo–So) oder der laufende Monat. Hat der laufende Zeitraum weniger als ${RECAP_MIN_TRADES} abgeschlossene Trades, zeigt der Rückblick den vorherigen. Edge-Score und Disziplin sind dieselben Werte wie in den Karten darunter.`,
    rows: [],
    verdict: { tone: "mute", text: "Immer aktuell, direkt aus deinen Trades berechnet." },
  };
}
