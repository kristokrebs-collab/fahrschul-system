/**
 * Explainer content for every KPI – 1:1 port of bundle `Jl` (23236–23618), `g2` (setup detail), `Ql`, `Ig`.
 * All German strings verbatim (Anhang A). Formulas are returned as segments so the UI can render the bold part.
 */
import type { Settings, Trade } from "./types";
import type { AccountView, SetupStats } from "./account";
import type { EnrichedTrade } from "./types";
import { DASH, INFINITY_SIGN, date, n0, n1, n2, pct, pct0, r as fmtR, signed, toneClass } from "@/lib/format";
import { tradeTime } from "@/lib/dates";

export type Tone = "win" | "loss" | "warn" | "mute";
export interface Verdict {
  tone: Tone;
  text: string;
}
export interface FormulaSegment {
  text: string;
  bold?: boolean;
  /** colour class (text-win / text-loss / text-fg) */
  cls?: string;
  /** line break BEFORE this segment */
  br?: boolean;
}
/** [label, value, colourClass?, subline?] */
export type ExplainRow = [string, string] | [string, string, string] | [string, string, string, string];

export interface Explanation {
  key: string;
  title: string;
  /** dialog title when different from `title` (e.g. "Backtest · 214 Signale") */
  sheetTitle?: string;
  what: string;
  formula?: FormulaSegment[];
  rows: ExplainRow[];
  verdict: Verdict;
}

export type ExplainKey = "net" | "trades" | "winRate" | "pf" | "avgR" | "maxDD" | "exp" | "projection" | "streak";
export const EXPLAIN_KEYS: readonly ExplainKey[] = ["net", "trades", "winRate", "pf", "avgR", "maxDD", "exp", "projection", "streak"];

/** Bundle `Ql`. */
export const EMPTY_VERDICT: Verdict = {
  tone: "mute",
  text: "Noch keine abgeschlossenen Trades. Der Wert füllt sich mit deinem ersten Trade.",
};

/** Bundle `Ig`: "+123,45 USDT · 12.03.26". */
export function tradeLine(t: Pick<Trade, "pnl" | "date" | "createdAt"> | null | undefined, cur: string): string {
  return t ? `${signed(t.pnl)} ${cur} · ${date(tradeTime(t))}` : DASH;
}

/** Plain-text formula (segments joined, `br` → "\n"). */
export function formulaText(f: FormulaSegment[] | undefined): string {
  return f ? f.map((s) => (s.br ? "\n" : "") + s.text).join("") : "";
}

/** Profit-factor cell: "–" | "∞" | n2. */
const pfText = (pf: number | null): string => (pf == null ? DASH : pf === Infinity ? INFINITY_SIGN : n2(pf));

export function explain(key: ExplainKey, view: AccountView, settings: Pick<Settings, "currency" | "backtest">): Explanation {
  const n = view.g;
  const cur = settings.currency;
  switch (key) {
    case "net":
      return {
        key,
        title: "Netto-P&L",
        what: "Summe aller realisierten Gewinne und Verluste deiner abgeschlossenen Trades, nach Gebühren. Offene Positionen zählen erst mit dem Schließen.",
        formula: [
          { text: `Bruttogewinne ${n2(n.gw)} − Bruttoverluste ${n2(-n.gl)} = ` },
          { text: `${signed(n.net)} ${cur}`, bold: true, cls: toneClass(n.net) },
        ],
        rows: [
          ["Rendite aufs Startkapital", view.start ? pct(n.net / view.start) : DASH, toneClass(n.net)],
          ["Kontostand jetzt", `${n0(view.balance)} ${cur}`],
          ["Bester Trade", tradeLine(n.best, cur), "text-win"],
          ["Schlechtester Trade", tradeLine(n.worst, cur), "text-loss"],
          ["Gezahlte Gebühren", `${n2(n.fees)} ${cur}`],
          ["Offene Positionen", String(view.open.length)],
        ],
        verdict: n.n
          ? n.net >= 0
            ? {
                tone: "win",
                text: `Im Plus. ${
                  n.best && n.net > 0 && (n.best.pnl || 0) / n.net > 0.5
                    ? "Achtung: mehr als die Hälfte des Gewinns stammt aus einem einzigen Trade."
                    : "Der Gewinn verteilt sich auf mehrere Trades."
                }`,
              }
            : { tone: "loss", text: "Im Minus. Schau in die Checklisten-Auswertung, welche Regeln bei den Verlusten gefehlt haben." }
          : EMPTY_VERDICT,
      };
    case "trades":
      return {
        key,
        title: "Trades",
        what: "Anzahl abgeschlossener Trades im gewählten Konto. Offene Positionen sind separat gezählt und fließen noch nicht in die Statistik ein.",
        rows: [
          ["Abgeschlossen", String(n.n)],
          ["Offen", String(view.open.length)],
          ["Davon Long", String(view.closed.filter((o) => o.side !== "short").length)],
          ["Davon Short", String(view.closed.filter((o) => o.side === "short").length)],
          ["Mit Checkliste komplett", String(view.closed.filter((o) => o.complete).length)],
          ["Pro Woche", view.proj ? n1(view.proj.perWeek) : DASH],
        ],
        verdict:
          n.n < 30
            ? { tone: "warn", text: `Stichprobe noch klein (${n.n}). Win-Rate und Erwartung schwanken bis etwa 30 Trades stark.` }
            : { tone: "win", text: "Genug Trades für belastbare Kennzahlen." },
      };
    case "winRate": {
      const formula: FormulaSegment[] = [
        { text: `${n.wins} Gewinner ÷ ${n.n} Trades = ` },
        { text: pct0(n.winRate), bold: true },
      ];
      if (n.beWinRate != null)
        formula.push(
          {
            br: true,
            text: `Break-even = Ø Verlust ÷ (Ø Gewinn + Ø Verlust) = ${n2(-(n.avgLoss || 0))} ÷ (${n2(n.avgWin)} + ${n2(-(n.avgLoss || 0))}) = `,
          },
          { text: pct0(n.beWinRate), bold: true },
        );
      return {
        key,
        title: "Win-Rate",
        what: "Anteil der Trades mit Gewinn. Allein sagt sie wenig: Entscheidend ist, ob sie über der Break-even-Win-Rate liegt, die sich aus deinem Verhältnis von Ø Gewinn zu Ø Verlust ergibt.",
        formula,
        rows: [
          ["Gewonnen", String(n.wins), "text-win"],
          ["Verloren", String(n.losses), "text-loss"],
          ["Break-even", String(n.be)],
          ["Backtest-Referenz", n2(settings.backtest.winRate * 100) + " %"],
          ["Chance-Risiko real (Ø Gewinn ÷ Ø Verlust)", n.payoff != null ? n2(n.payoff) : DASH],
          ["Nötige Win-Rate", pct0(n.beWinRate)],
        ],
        verdict:
          n.winRate == null
            ? EMPTY_VERDICT
            : n.beWinRate == null
              ? { tone: "mute", text: "Für die Break-even-Rechnung brauchst du mindestens einen Gewinner und einen Verlierer." }
              : n.winRate >= n.beWinRate
                ? {
                    tone: "win",
                    text: `Du liegst ${n1((n.winRate - n.beWinRate) * 100)} Prozentpunkte über deiner Break-even-Win-Rate. Das System ist profitabel.`,
                  }
                : {
                    tone: "loss",
                    text: `Du liegst ${n1((n.beWinRate - n.winRate) * 100)} Prozentpunkte unter deiner Break-even-Win-Rate. Entweder öfter richtig liegen oder Gewinner länger laufen lassen.`,
                  },
      };
    }
    case "pf":
      return {
        key,
        title: "Profit-Faktor",
        what: "Wie viel Gewinn du pro Einheit Verlust machst. Unter 1 verliert das System Geld, ab 1,5 ist es solide, über 2 stark.",
        formula: [{ text: `Bruttogewinne ${n2(n.gw)} ÷ Bruttoverluste ${n2(-n.gl)} = ` }, { text: pfText(n.pf), bold: true }],
        rows: [
          ["Bruttogewinne", `${n2(n.gw)} ${cur}`, "text-win"],
          ["Bruttoverluste", `${n2(n.gl)} ${cur}`, "text-loss"],
          ["Ø Gewinn", `${n2(n.avgWin)} ${cur}`],
          ["Ø Verlust", `${n2(n.avgLoss)} ${cur}`],
        ],
        verdict:
          n.pf == null
            ? EMPTY_VERDICT
            : n.pf === Infinity
              ? { tone: "win", text: "Noch kein Verlust. Der Faktor wird aussagekräftig, sobald Verluste dabei sind." }
              : n.pf < 1
                ? { tone: "loss", text: "Unter 1: Die Verluste sind größer als die Gewinne." }
                : n.pf < 1.5
                  ? { tone: "warn", text: "Zwischen 1 und 1,5: profitabel, aber knapp. Gebühren und Funding können das kippen." }
                  : n.pf < 2
                    ? { tone: "win", text: "Zwischen 1,5 und 2: solides System." }
                    : { tone: "win", text: "Über 2: starkes Verhältnis von Gewinnen zu Verlusten." },
      };
    case "avgR":
      return {
        key,
        title: "Ø R-Multiple",
        what: "Ergebnis pro Trade gemessen am geplanten Risiko (Einstieg bis Stop). 1 R heißt: genau so viel gewonnen, wie riskiert. Nur Trades mit Stop-Loss fließen ein.",
        formula: [
          { text: `R = P&L ÷ (|Einstieg − Stop| × Menge) · Ø über ${n.rN} Trades = ` },
          { text: fmtR(n.avgR), bold: true, cls: toneClass(n.avgR) },
        ],
        rows: [
          ["Trades mit Stop", `${n.rN} von ${n.n}`],
          ["Bester R", fmtR(n.bestR), "text-win"],
          ["Schlechtester R", fmtR(n.worstR), "text-loss"],
          ["Trades mit ≥ 2 R", n.rN ? `${n.r2} (${pct0(n.r2 / n.rN)})` : DASH],
        ],
        verdict:
          n.avgR == null
            ? { tone: "mute", text: "Trag bei deinen Trades einen Stop-Loss ein, dann berechne ich das R-Multiple." }
            : n.worstR != null && n.worstR < -1.2
              ? {
                  tone: "warn",
                  text: `Mindestens ein Verlust war größer als 1 R (${fmtR(n.worstR)}). Das heißt, ein Stop wurde verschoben oder nicht eingehalten.`,
                }
              : n.avgR > 0
                ? { tone: "win", text: "Positiver Durchschnitt: Im Schnitt holst du mehr als du riskierst." }
                : { tone: "loss", text: "Negativer Durchschnitt: Im Schnitt verlierst du einen Teil deines Risikos pro Trade." },
      };
    case "maxDD":
      return {
        key,
        title: "Maximaler Drawdown",
        what: "Der größte Rückgang vom bisherigen Kontohöchststand bis zum folgenden Tiefpunkt. Zeigt, wie tief das Konto zwischendurch gefallen ist.",
        formula: [
          { text: `(Tief ${n0(view.dd.trough)} − Hoch ${n0(view.dd.peak)}) ÷ Hoch = ` },
          { text: pct(view.maxDD), bold: true, cls: view.maxDD < 0 ? "text-loss" : "" },
        ],
        rows: [
          ["Höchststand", `${n0(view.peak)} ${cur}`],
          ["Aktueller Abstand zum Hoch", pct(view.curDD), view.curDD < 0 ? "text-loss" : "text-win"],
          ["Hoch bei", view.dd.peakI ? `Trade #${view.dd.peakI}` : "Start"],
          ["Tief bei", view.dd.troughI ? `Trade #${view.dd.troughI}` : DASH],
        ],
        verdict: n.n
          ? view.maxDD > -0.05
            ? { tone: "win", text: "Unter 5 %: sehr kontrolliertes Risiko." }
            : view.maxDD > -0.15
              ? { tone: "warn", text: "Zwischen 5 und 15 %: vertretbar, aber im Blick behalten." }
              : { tone: "loss", text: "Über 15 %: Positionsgrößen oder Hebel prüfen (Regel: Scalp 4x, Makro höchstens 5x)." }
          : EMPTY_VERDICT,
      };
    case "exp":
      return {
        key,
        title: "Erwartungswert",
        what: "Was dir ein durchschnittlicher Trade bringt. Kombiniert Win-Rate und Größe von Gewinnen und Verlusten in einer Zahl.",
        formula: [
          { text: `${pct0(n.winRate)} × ${n2(n.avgWin)} + ${n.n ? pct0(n.losses / n.n) : DASH} × ${n2(n.avgLoss)} ≈ ` },
          { text: `${signed(n.exp)} ${cur}`, bold: true, cls: toneClass(n.exp) },
        ],
        rows: [
          ["Pro Trade in Kursbewegung", pct(n.moveExp), toneClass(n.moveExp)],
          ["Backtest-Referenz", pct(settings.backtest.expectancy)],
        ],
        verdict:
          n.exp == null
            ? EMPTY_VERDICT
            : n.exp > 0
              ? { tone: "win", text: "Positiv: Mit jedem weiteren Trade nach diesem Muster wächst das Konto im Schnitt." }
              : { tone: "loss", text: "Negativ: Im Schnitt kostet dich jeder Trade Geld." },
      };
    case "projection": {
      const o = view.proj;
      return {
        key,
        title: "Hochrechnung aufs Jahr",
        what: "Rechnet deine bisherige Rendite auf 365 Tage hoch. Linear heißt: gleicher Betrag pro Tag. Mit Zinseszins wächst die Basis mit, der Wert wird bei kurzer Historie schnell unrealistisch.",
        formula: o
          ? [
              { text: `Linear: ${pct(o.r)} × 365 ÷ ${n0(o.days)} Tage = ` },
              { text: pct(o.linear), bold: true, cls: toneClass(o.linear) },
              {
                br: true,
                text: `Zinseszins: (1 ${o.r >= 0 ? "+" : "−"} ${n2(Math.abs(o.r) * 100)} %)^(365 ÷ ${n0(o.days)}) − 1 = ${
                  Math.abs(o.comp) > 99 ? "> 9.900 %" : pct(o.comp)
                }`,
              },
            ]
          : undefined,
        rows: o
          ? [
              ["Basis", `${n0(o.days)} Tage, ${n.n} Trades`],
              ["Startkapital", `${n0(view.start)} ${cur}`],
              ["Ø pro Monat", pct(o.monthly), toneClass(o.monthly)],
              ["Konto in 12 Monaten", `${n0(o.endLin)} ${cur}`],
            ]
          : [],
        verdict: o
          ? o.weak
            ? { tone: "warn", text: "Wenig Daten: Die Hochrechnung wird ab etwa 30 Tagen und 10 Trades belastbar." }
            : { tone: "mute", text: "Die Zahl beschreibt deine bisherige Performance, sie ist keine Prognose." }
          : EMPTY_VERDICT,
      };
    }
    case "streak":
      return {
        key,
        title: "Serie",
        what: "Wie viele Trades in Folge zuletzt gleich ausgegangen sind. Lange Verlustserien sind ein Signal für eine Pause, lange Gewinnserien für erhöhte Vorsicht vor Übermut.",
        rows: [
          [
            "Aktuell",
            view.streak
              ? `${view.streak}× ${view.streakType === "win" ? "Gewinn" : view.streakType === "loss" ? "Verlust" : "Break-even"}`
              : DASH,
          ],
        ],
        verdict:
          view.streakType === "loss" && view.streak >= 3
            ? { tone: "loss", text: "3 Verluste in Folge. Pause machen und die Checkliste der letzten Trades prüfen." }
            : { tone: "mute", text: "Kein Warnsignal." },
      };
  }
}

/** Bundle `g2`: setup detail (ranking dialog). `trades` = the account view's list (closed + open). */
export function explainSetup(e: SetupStats, trades: readonly EnrichedTrade[], cur: string): Explanation {
  const withSetup = trades.filter((o) => (o.setups || []).includes(e.setup.id) && o.result !== "open");
  const complete = withSetup.filter((o) => o.complete).length;
  return {
    key: `setup:${e.setup.id}`,
    title: e.setup.name,
    what: e.setup.desc || "Keine Regeln hinterlegt.",
    rows: [
      ["Profit-Faktor", pfText(e.pf)],
      ["Ø Gewinn / Ø Verlust", `${n0(e.avgWin)} / ${n0(e.avgLoss)}`],
      ["Bester Trade", tradeLine(e.best, cur), "text-win"],
      ["Schlechtester Trade", tradeLine(e.worst, cur), "text-loss"],
      ["Checkliste komplett", withSetup.length ? `${complete} von ${withSetup.length}` : DASH],
      ["Ø Kursbewegung", pct(e.moveExp), toneClass(e.moveExp)],
    ],
    verdict: e.n
      ? e.n < 5
        ? { tone: "warn", text: `Erst ${e.n} Trade${e.n === 1 ? "" : "s"}. Ab etwa 10 Trades lässt sich die Grundlage fair bewerten.` }
        : e.net > 0
          ? { tone: "win", text: "Diese Grundlage verdient Geld. Weiter so, gleiche Regeln." }
          : { tone: "loss", text: "Diese Grundlage kostet Geld. Regeln schärfen oder seltener handeln." }
      : { tone: "mute", text: "Noch keine abgeschlossenen Trades mit dieser Grundlage." },
  };
}

/** Hero tile labels + value formatters (bundle `yhe`). */
export const HERO_TILES: readonly { key: ExplainKey; label: string }[] = [
  { key: "trades", label: "Trades" },
  { key: "winRate", label: "Win-Rate" },
  { key: "pf", label: "Profit-Faktor" },
  { key: "avgR", label: "Ø R" },
  { key: "maxDD", label: "Max. Drawdown" },
];

export function heroTileValue(key: ExplainKey, view: AccountView): string {
  const g = view.g;
  switch (key) {
    case "trades":
      return String(g.n) + (view.open.length ? ` +${view.open.length} offen` : "");
    case "winRate":
      return pct0(g.winRate);
    case "pf":
      return pfText(g.pf);
    case "avgR":
      return fmtR(g.avgR);
    case "maxDD":
      return g.n ? pct(view.maxDD) : DASH;
    case "exp":
      return g.exp == null ? DASH : signed(g.exp);
    case "streak":
      return view.streak ? `${view.streak}×` : DASH;
    case "projection":
      return view.proj ? signed(view.proj.linear * 100, 1) + " %" : DASH;
    case "net":
      return signed(g.net);
  }
}

/** Hero subline: "{wins} gewonnen · {losses} verloren[ · {be} Break-even]" or the empty text. */
export function heroSubline(view: AccountView): string {
  const g = view.g;
  if (!g.n) return "Noch keine abgeschlossenen Trades. Alle Werte starten bei null.";
  return `${g.wins} gewonnen · ${g.losses} verloren` + (g.be ? ` · ${g.be} Break-even` : "");
}

export const Jl = explain;
export const g2 = explainSetup;
export const Ql = EMPTY_VERDICT;
export const Ig = tradeLine;
