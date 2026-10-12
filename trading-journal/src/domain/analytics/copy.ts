/**
 * German copy of the Analyse page (P03): titles, empty states, verdicts and the explainers (`Explanation`, rendered
 * by the overview's `ExplanationView`) – every explainer names its formula, its minimum sample and an honest verdict
 * (pattern of `insights/copy.ts`). Short, natural sentences; "klar" only after the FDR test, else "Tendenz" / "offen".
 */
import type { Explanation, ExplainRow, Tone, Verdict } from "../explain";
import { colorClass, DASH, INFINITY_SIGN, n0, n1, n2, pct, pct0, r as fmtR, signed } from "@/lib/format";
import type { Breakdown } from "./breakdowns";
import { BREAKDOWN_MIN_N } from "./breakdowns";
import type { AdaptiveBenchmark, BenchmarkReport } from "./benchmark";
import { ADAPTIVE_MIN_WINDOWS, ADAPTIVE_WINDOW_DAYS } from "./benchmark";
import type { DistributionReport } from "./distribution";
import { HAMPEL_K } from "./distribution";
import type { ExcursionReport } from "./excursion";
import { EXCURSION_MIN_N } from "./excursion";
import type { MonteCarloResult } from "./montecarlo";
import type { Metric, RatioKey, RatioReport } from "./ratios";
import { RATIO_MIN, SQN_CAP } from "./ratios";
import type { RollingReport } from "./rolling";
import type { Significance } from "./stats";
import { CI_LEVEL, FDR_Q } from "./stats";
import type { StreakReport } from "./streaks";
import { STREAK_MIN_N } from "./streaks";

export const ANALYSE_TITLE = "Analyse";
export const ANALYSE_LEAD = "Profi-Kennzahlen mit ehrlicher Unsicherheit: was deine Edge wirklich ist, wo sie liegt und was sie aushält.";
export const ANALYSE_HIGHLIGHT = "ehrlicher Unsicherheit";

export const SECTIONS = {
  ratios: "Kennzahlen",
  future: "Was kommen kann",
  edge: "Wo deine Edge liegt",
  execution: "Ausführung",
  patterns: "Muster",
  compare: "Gegen den Markt",
} as const;

export const CARD_TITLES = {
  hero: "Kennzahlen",
  monteCarlo: "Monte Carlo",
  ruin: "Risk of Ruin",
  breakdown: "Breakdown",
  excursion: "MAE / MFE",
  heatmap: "Wochentag × Uhrzeit",
  rolling: "Rollierend",
  streaks: "Serien",
  distribution: "Verteilung",
  benchmark: "Benchmark",
  compare: "Vergleich",
  custom: "Eigene Kennzahl",
} as const;

export const ANA_EMPTY = {
  trades: { title: "Noch keine Trades", text: "Sobald du Trades abschließt, rechnet die Analyse von selbst." },
  few: { title: "Noch zu wenig Trades", text: "Die Profi-Kennzahlen brauchen mindestens 5 abgeschlossene Trades. Bis dahin wäre jede Zahl Zufall." },
  monteCarlo: { title: "Noch keine Simulation", text: "Monte Carlo braucht mindestens 10 abgeschlossene Trades, aus denen es ziehen kann." },
  excursion: {
    title: "Noch keine MAE / MFE",
    text: "Öffne einen Trade mit Ausstiegszeit – das Journal misst dann aus den Kerzen, wie weit der Kurs gegen und für dich lief (nur für das Live-Symbol).",
  },
  benchmark: { title: "Keine Tageskerzen", text: "Der Vergleich braucht die Tageskerzen des Live-Markts. Sie laden, sobald der Markt verbunden ist." },
  benchmarkSymbol: (s: string) => `Buy & Hold ${s}`,
  compare: { title: "Nichts zu vergleichen", text: "Beide Seiten brauchen Trades. Wähle einen anderen Zeitraum oder andere Setups." },
  custom: { title: "Noch keine eigene Kennzahl", text: "Bau dir deine Zahl: Kennzahl wählen, filtern, gruppieren – sie bleibt gespeichert." },
  breakdown: { title: "Keine Daten für diese Dimension", text: "Keiner deiner Trades hat dafür einen Wert. Wähle eine andere Dimension." },
  heatmap: { title: "Noch keine Trades", text: "Die Heatmap zeigt, zu welcher Zeit du gut handelst." },
  rolling: (w: number) => ({ title: "Noch kein Fenster voll", text: `Für das rollierende Fenster brauchst du mindestens ${w} Trades.` }),
} as const;

/** Badge text of a significance verdict. */
export const SIG_LABEL: Readonly<Record<Significance, string>> = { klar: "klar", tendenz: "Tendenz", offen: "offen", wenig: "zu wenig" };
export const SIG_TONE: Readonly<Record<Significance, Tone>> = { klar: "win", tendenz: "warn", offen: "mute", wenig: "mute" };

const ciText = `${Math.round(CI_LEVEL * 100)}-%-Intervall`;

export const RATIO_LABELS: Readonly<Record<RatioKey, { label: string; short: string; what: string }>> = {
  sharpe: { label: "Sharpe", short: "Sharpe", what: "Rendite pro Einheit Schwankung, auf ein Jahr hochgerechnet (Tagesrenditen × √365)." },
  sharpeTrade: { label: "Sharpe pro Trade", short: "Sharpe/T", what: "Ø Rendite pro Trade ÷ ihre Schwankung (Rendite = P&L ÷ Kontostand davor)." },
  sortino: { label: "Sortino", short: "Sortino", what: "Wie Sharpe, aber nur Abwärts-Schwankung zählt als Risiko (Tage × √365)." },
  sortinoTrade: { label: "Sortino pro Trade", short: "Sortino/T", what: "Ø Rendite pro Trade ÷ Abwärts-Abweichung." },
  calmar: { label: "Calmar / MAR", short: "Calmar", what: "Jahresrendite (mit Zinseszins) ÷ größter Drawdown." },
  sqn: { label: "SQN", short: "SQN", what: "System Quality Number nach Van Tharp: √n × Ø R ÷ Schwankung von R (n höchstens 100)." },
  kelly: { label: "Kelly", short: "Kelly", what: "Anteil des Kontos, den die Kelly-Formel pro Trade riskieren würde: W − (1 − W) ÷ Payoff." },
  halfKelly: { label: "Half-Kelly", short: "½ Kelly", what: "Die Hälfte davon – die praxistaugliche Obergrenze fürs Risiko pro Trade." },
  gainToPain: { label: "Gain-to-Pain", short: "G/P", what: "Summe aller Monate ÷ Summe der Verlustmonate (Schwager)." },
  omega: { label: "Omega", short: "Omega", what: "Summe der Gewinntage ÷ Summe der Verlusttage (Schwelle 0)." },
  ulcer: { label: "Ulcer-Index", short: "Ulcer", what: "Wie tief und wie lange du unter Wasser warst: √(Ø der quadrierten Drawdowns in %)." },
  tailRatio: { label: "Tail Ratio", short: "Tail", what: "95. Perzentil ÷ |5. Perzentil| der Trade-Ergebnisse – große Gewinne gegen große Verluste." },
  edge: { label: "Edge-Test", short: "Edge", what: "Ø R (oder Ø P&L) deiner Trades mit t-Test: Ist der Schnitt sicher größer als 0?" },
};

/** "= 0,03" or "< 0,01" (with the relation). */
const pEq = (p: number): string => (p < 0.01 ? pText(p) : `= ${n2(p)}`);

/** p-value text: "0,03", "< 0,01", "< 0,001", "–". */
export const pText = (p: number | null | undefined): string => (p == null || !Number.isFinite(p) ? DASH : p < 0.001 ? "< 0,001" : p < 0.01 ? "< 0,01" : n2(p));

/** "1,23" | "∞" | "–". */
export const ratioText = (v: number | null | undefined): string => (v == null ? DASH : v === Infinity ? INFINITY_SIGN : n2(v));

/** Display of a metric value in its natural unit. */
export function metricText(m: Metric, edgeUnit: "R" | "money" = "R", currency = ""): string {
  if (m.value == null) return DASH;
  if (m.key === "kelly" || m.key === "halfKelly") return pct(m.value, false);
  if (m.key === "ulcer") return `${n1(m.value)} %`;
  if (m.key === "edge") return edgeUnit === "R" ? fmtR(m.value) : `${signed(m.value, 0)} ${currency}`.trim();
  return ratioText(m.value);
}

/** One-sided p below which the edge test says "klar" (stricter than the breakdown FDR: it is the headline claim). */
export const EDGE_CLEAR_P = 0.05;

/** Where an interval must stay above for a "good" ratio to count as sure (0 for most, 1 for the ratio-of-sums ones). */
const SURE_ABOVE: Partial<Record<RatioKey, number>> = { sharpe: 0, sortino: 0, sharpeTrade: 0, sortinoTrade: 0, calmar: 0, sqn: 0, gainToPain: 0, kelly: 0, halfKelly: 0, omega: 1, tailRatio: 1 };

/**
 * Verdict of a metric value (thresholds in the explainers). Honest: a good value whose 80 % interval still reaches
 * below the break-even line is not called good – it is "noch nicht sicher" (mute).
 */
export function ratioVerdict(m: Metric): Verdict {
  const base = baseVerdict(m);
  const line = SURE_ABOVE[m.key];
  if (base.tone === "win" && line != null && m.ci && m.ci.lo <= line) {
    return { tone: "mute", text: `${base.text} Noch nicht sicher: das 80-%-Intervall reicht bis ${line === 0 ? "unter null" : `unter ${line}`}.` };
  }
  return base;
}

function baseVerdict(m: Metric): Verdict {
  const v = m.value;
  if (v == null) return { tone: "mute", text: `Noch zu wenig Daten: ab ${RATIO_MIN[m.key]} ${m.unit === "days" ? "Tagen" : m.unit === "months" ? "Monaten" : "Trades"} (bisher ${m.n}).` };
  const t = (tone: Tone, text: string): Verdict => ({ tone, text });
  switch (m.key) {
    case "sharpe":
    case "sortino":
      return v >= 2 ? t("win", "Stark – deutlich mehr Rendite als Schwankung.") : v >= 1 ? t("win", "Gut – die Rendite trägt ihr Risiko.") : v >= 0.5 ? t("mute", "Ordentlich, aber noch kein Polster.") : v >= 0 ? t("warn", "Schwach – viel Schwankung für wenig Rendite.") : t("loss", "Negativ – das Risiko zahlt sich nicht aus.");
    case "sharpeTrade":
    case "sortinoTrade":
      return v >= 0.3 ? t("win", "Pro Trade klar positiv.") : v >= 0.1 ? t("mute", "Pro Trade leicht positiv.") : v >= 0 ? t("warn", "Pro Trade kaum über null.") : t("loss", "Pro Trade negativ.");
    case "calmar":
      return v >= 3 ? t("win", "Stark – die Rendite ist ein Vielfaches des Drawdowns.") : v >= 1 ? t("win", "Gut – mehr Jahresrendite als Drawdown.") : v >= 0.5 ? t("mute", "Ordentlich.") : v >= 0 ? t("warn", "Der Drawdown ist groß im Verhältnis zur Rendite.") : t("loss", "Negativ.");
    case "sqn":
      return v >= 3 ? t("win", "Hervorragend (Van Tharp: ab 3).") : v >= 2.5 ? t("win", "Sehr gut.") : v >= 2 ? t("win", "Gut handelbar.") : v >= 1.6 ? t("mute", "Durchschnittlich.") : v >= 0 ? t("warn", "Schwer handelbar – die Streuung frisst die Edge.") : t("loss", "Negativ – keine Edge in R.");
    case "kelly":
    case "halfKelly":
      return v <= 0 ? t("loss", "Keine Edge – Kelly würde gar nichts riskieren.") : t("win", `Riskiere höchstens Half-Kelly: ${pct(m.key === "kelly" ? v / 2 : v, false)} pro Trade.`);
    case "gainToPain":
      return v >= 1.5 ? t("win", "Stark (Schwager: ab 1,5).") : v >= 1 ? t("win", "Gut.") : v >= 0 ? t("mute", "Positiv, aber mit spürbaren Verlustmonaten.") : t("loss", "Negativ.");
    case "omega":
      return v >= 1.5 ? t("win", "Gewinntage überwiegen deutlich.") : v >= 1 ? t("mute", "Leicht mehr Gewinn- als Verlusttage (in Summe).") : t("loss", "Verlusttage überwiegen.");
    case "ulcer":
      return v < 2 ? t("win", "Ruhige Kurve – kaum unter Wasser.") : v < 5 ? t("mute", "Normale Rücksetzer.") : v < 10 ? t("warn", "Spürbare, längere Drawdowns.") : t("loss", "Tiefe, lange Drawdowns.");
    case "tailRatio":
      return v >= 1.2 ? t("win", "Deine großen Gewinne sind größer als deine großen Verluste.") : v >= 0.9 ? t("mute", "Große Gewinne und Verluste halten sich die Waage.") : t("warn", "Deine großen Verluste überwiegen – Stops prüfen.");
    case "edge": {
      const p = m.p ?? 1;
      return v <= 0 ? t("loss", "Im Schnitt kein Gewinn pro Trade.") : p < EDGE_CLEAR_P ? t("win", `Klar positiv (p ${pEq(p)}).`) : p < 0.2 ? t("warn", `Positive Tendenz, noch nicht sicher (p ${pEq(p)}).`) : t("mute", `Positiv, aber noch Zufall möglich (p ${pEq(p)}).`);
    }
  }
}

const unitWord = (m: Metric) => (m.unit === "days" ? "Tage" : m.unit === "months" ? "Monate" : "Trades");

/** Explainer of one ratio tile (`fact-ana-{key}`). */
export function explainRatio(m: Metric, rep: Pick<RatioReport, "edgeUnit" | "tradesNeeded" | "cagr" | "maxDD" | "edgeTest">, currency: string): Explanation {
  const L = RATIO_LABELS[m.key];
  const val = metricText(m, rep.edgeUnit, currency);
  const ci = m.ci ? `${metricText({ ...m, value: m.ci.lo }, rep.edgeUnit, currency)} … ${metricText({ ...m, value: m.ci.hi }, rep.edgeUnit, currency)}` : DASH;
  const rows: ExplainRow[] = [
    ["Wert", val],
    [`Stichprobe`, `${m.n} ${unitWord(m)}`],
    [ciText, ci],
    ["Mindeststichprobe", `${RATIO_MIN[m.key]} ${unitWord(m)}`],
  ];
  const formula: Record<RatioKey, string> = {
    sharpe: "Sharpe = Ø Tagesrendite ÷ Schwankung × √365",
    sharpeTrade: "Sharpe = Ø Rendite pro Trade ÷ Schwankung",
    sortino: "Sortino = Ø Tagesrendite ÷ Abwärts-Abweichung × √365",
    sortinoTrade: "Sortino = Ø Rendite pro Trade ÷ Abwärts-Abweichung",
    calmar: "Calmar = Jahresrendite ÷ |max. Drawdown|",
    sqn: `SQN = √min(n, ${SQN_CAP}) × Ø R ÷ Schwankung von R`,
    kelly: "Kelly = W − (1 − W) ÷ (Ø Gewinn ÷ Ø Verlust)",
    halfKelly: "Half-Kelly = Kelly ÷ 2",
    gainToPain: "G/P = Σ Monate ÷ |Σ Verlustmonate|",
    omega: "Omega = Σ Gewinntage ÷ |Σ Verlusttage|",
    ulcer: "Ulcer = √(Ø (Drawdown in %)²)",
    tailRatio: "Tail = 95. Perzentil ÷ |5. Perzentil|",
    edge: "t = Ø ÷ (Schwankung ÷ √n)",
  };
  if (m.key === "calmar") rows.push(["Jahresrendite", rep.cagr == null ? DASH : pct(rep.cagr)], ["Max. Drawdown", pct(rep.maxDD)]);
  if (m.key === "edge") {
    rows.push(["p (einseitig)", pText(m.p)], ["Einheit", rep.edgeUnit === "R" ? "R (Trades mit Stop)" : `${currency} pro Trade`]);
    rows.push(["Trades bis „sicher“", rep.tradesNeeded == null ? DASH : `≈ ${n0(rep.tradesNeeded)} (bei Ø und Schwankung wie bisher)`]);
  }
  return {
    key: `ana-${m.key}`,
    title: L.label,
    what: `${L.what} Das ${ciText} kommt aus ${m.key === "edge" ? "dem t-Test" : "einem Bootstrap: deine Trades werden 100- bis 400-mal neu gezogen"} – je breiter, desto unsicherer die Zahl.`,
    formula: [{ text: formula[m.key] }, { text: ` = ${val}`, bold: true, cls: m.key === "ulcer" ? undefined : colorClass(m.value === Infinity ? 1 : m.value) }],
    rows,
    verdict: ratioVerdict(m),
  };
}

export function explainMonteCarlo(res: MonteCarloResult | null, unit: "R" | "money", currency: string): Explanation {
  const u = (v: number | null | undefined) => (v == null ? DASH : unit === "R" ? fmtR(v) : `${signed(v, 0)} ${currency}`);
  return {
    key: "ana-mc",
    title: "So rechnet Monte Carlo",
    what: "Aus deinen echten Trade-Ergebnissen werden tausende mögliche Zukünfte gezogen: Bootstrap zieht mit Zurücklegen (ein Trade kann mehrfach vorkommen), Reshuffle mischt nur die Reihenfolge. Das Band zeigt, wo 90 % der Läufe landen (5. bis 95. Perzentil). Gleiche Daten, gleiches Ergebnis – die Simulation ist geseedet.",
    formula: [{ text: "Pfad = Σ zufällig gezogene Trades · " }, { text: `${res?.runs ?? 0} Läufe × ${res?.horizon ?? 0} Trades`, bold: true }],
    rows: res?.final
      ? [
          ["Median am Ende", u(res.final.p50), colorClass(res.final.p50)],
          ["Schlechte 5 %", u(res.final.p5), colorClass(res.final.p5)],
          ["Gute 5 %", u(res.final.p95), colorClass(res.final.p95)],
          ["Längste Verlustserie (Median · 95 %)", res.longestLoss ? `${n0(res.longestLoss.p50)} · ${n0(res.longestLoss.p95)}` : DASH],
        ]
      : [],
    verdict: { tone: "mute", text: "Die Simulation nimmt an, dass deine Zukunft wie deine Vergangenheit aussieht. Ab etwa 30 Trades wird sie belastbar." },
  };
}

export function explainRuin(analytic: number | null, simulated: number | null, risk: number, ruinAt: number, trades: number): Explanation {
  const show = (v: number | null) => (v == null ? DASH : v < 0.001 ? "< 0,1 %" : pct(v, false));
  return {
    key: "ana-ror",
    title: "Risk of Ruin",
    what: `Wie wahrscheinlich ist es, dass dein Konto ${pct0(ruinAt)} verliert, wenn du ${pct(risk, false)} pro Trade riskierst? Analytisch über unendlich viele Trades (Cramér-Lundberg auf dem Log-Konto), simuliert über die nächsten ${n0(trades)} Trades mit deinen echten R-Werten.`,
    formula: [{ text: "p · e^(−λ·u) + q · e^(λ·d) = 1 → Ruin ≈ e^(−λ·L)" }],
    rows: [
      ["Analytisch (unendlich)", show(analytic)],
      [`Simuliert (${n0(trades)} Trades)`, show(simulated)],
      ["Risiko pro Trade", pct(risk, false)],
      ["Ruin ab", `−${pct0(ruinAt)}`],
    ],
    verdict:
      simulated == null
        ? { tone: "mute", text: "Für die Simulation fehlen Trades mit Stop (R)." }
        : simulated < 0.01
          ? { tone: "win", text: "Bei diesem Risiko praktisch kein Ruin-Risiko." }
          : simulated < 0.05
            ? { tone: "warn", text: "Kleines, aber echtes Ruin-Risiko – Risiko pro Trade senken hilft sofort." }
            : { tone: "loss", text: "Zu hohes Ruin-Risiko. Riskiere weniger pro Trade." },
  };
}

export function explainBreakdown(b: Breakdown, currency: string): Explanation {
  const u = b.unit === "R" ? "Ø R" : `Ø P&L (${currency})`;
  return {
    key: "ana-breakdown",
    title: `Breakdown nach ${b.label}`,
    what: `Jede Zeile ist eine Gruppe deiner Trades. Der Balken zeigt ${u} mit ${ciText}, daneben die Win-Rate mit Wilson-Intervall. Getestet wird jede Gruppe gegen alle übrigen Trades (Welch-t-Test). Weil viele Gruppen gleichzeitig geprüft werden, korrigiert das Journal mit Benjamini-Hochberg (FDR ${pct0(FDR_Q)}): „klar“ heißt, der Unterschied hält auch diese Korrektur aus.`,
    rows: [
      ["Trades", String(b.total)],
      ["Einheit", b.unit === "R" ? "R (mind. 60 % der Trades haben einen Stop)" : `${currency} pro Trade`],
      ["Mindeststichprobe", `${BREAKDOWN_MIN_N} Trades pro Gruppe`],
      ["Beste Gruppe (untere Grenze)", b.best ? b.best.label : DASH],
      ["Schwächste Gruppe", b.worst ? b.worst.label : DASH],
    ],
    verdict: (() => {
      const best = b.best ? (b.unit === "R" ? b.best.expR : b.best.exp) : null;
      if (b.best && best?.ci && best.ci.lo > 0) return { tone: "win" as const, text: `Trade the best: ${b.best.label} ist auch im ungünstigen Fall noch positiv.` };
      if (b.best) return { tone: "mute" as const, text: `${b.best.label} liegt vorn, aber das Intervall reicht unter null – noch kein Beweis. Mehr Trades sammeln.` };
      return { tone: "mute" as const, text: "Noch keine Gruppe ist robust positiv – mehr Trades sammeln." };
    })(),
  };
}

export function explainExcursion(rep: ExcursionReport, currency: string): Explanation {
  return {
    key: "ana-excursion",
    title: "MAE / MFE",
    what: "MAE = wie weit der Kurs maximal gegen dich lief, MFE = wie weit er maximal für dich lief – beides in R (Abstand ÷ Stop-Abstand). Exit-Effizienz = mitgenommene Bewegung ÷ MFE deiner Gewinner. Entry-Effizienz = MAE ÷ Stop-Abstand: klein heißt präziser Einstieg. Gemessen wird aus ganzen Kerzen, deshalb ist die Exit-Effizienz bei 100 % gedeckelt.",
    rows: [
      ["Trades mit Messung", `${rep.n} von ${rep.total}`],
      ["Exit-Effizienz (Ø Gewinner)", rep.exitEfficiency.mean == null ? DASH : pct0(rep.exitEfficiency.mean)],
      ["Entry: Ø MAE in R", rep.entryEfficiency.mean == null ? DASH : `${n2(rep.entryEfficiency.mean)} R`],
      ["Liegengelassen (Gewinner)", `${n0(rep.leftOnTable.money)} ${currency}`],
      ["Verlierer, die ≥ 1 R im Plus waren", String(rep.givenBack.length)],
      ["Mindeststichprobe", `${EXCURSION_MIN_N} Trades`],
    ],
    verdict:
      rep.winnerMaeP80 != null
        ? { tone: "mute", text: `80 % deiner Gewinner liefen nie mehr als ${n2(rep.winnerMaeP80)} R gegen dich – ein engerer Stop könnte reichen.` }
        : { tone: "mute", text: "Mit mehr gemessenen Trades zeigt die Karte, wo dein Stop und dein Ziel liegen sollten." },
  };
}

export function explainHeatmap(): Explanation {
  return {
    key: "ana-heat",
    title: "Wochentag × Uhrzeit",
    what: "Jede Zelle sind deine Trades an diesem Wochentag in diesem Zwei-Stunden-Block (Ortszeit, Einstieg). Die Farbe zeigt das Ergebnis, die Kaskade startet in deiner besten Zelle. Erst ab 3 Trades pro Zelle wird eine Zelle hervorgehoben.",
    rows: [],
    verdict: { tone: "mute", text: "Einzelne Zellen sind klein – nutze sie als Hinweis, nicht als Regel." },
  };
}

export function explainRolling(rep: RollingReport, currency: string): Explanation {
  const f = rep.form;
  return {
    key: "ana-rolling",
    title: "Rollierendes Fenster",
    what: `Jeder Punkt zeigt die Kennzahlen deiner letzten ${rep.window} Trades bis zu diesem Trade. So siehst du, ob deine Edge stabil ist, wächst oder schwindet. „Form“ vergleicht das letzte Fenster mit deiner Gesamt-Win-Rate (${ciText}).`,
    rows: f
      ? [
          ["Win-Rate letztes Fenster", pct0(f.current.winRate)],
          ["Win-Rate gesamt", pct0(f.overall)],
          ["Ø P&L letztes Fenster", f.current.exp == null ? DASH : `${signed(f.current.exp, 0)} ${currency}`, colorClass(f.current.exp)],
          ["Ø R letztes Fenster", fmtR(f.current.expR), colorClass(f.current.expR)],
        ]
      : [],
    verdict: !f
      ? { tone: "mute", text: `Ab ${rep.window} Trades.` }
      : f.verdict === "heiss"
        ? { tone: "win", text: "Du bist gerade besser als dein Schnitt – klar außerhalb der Zufallsschwankung." }
        : f.verdict === "kalt"
          ? { tone: "warn", text: "Du bist gerade schwächer als dein Schnitt. Kleiner handeln, Plan prüfen." }
          : { tone: "mute", text: "Deine aktuelle Form liegt im normalen Bereich." },
  };
}

export function explainStreaks(rep: StreakReport): Explanation {
  return {
    key: "ana-streaks",
    title: "Serien",
    what: "Eine Serie endet mit dem ersten anderen Ergebnis; ein Break-even beendet jede Serie. Die erwartete längste Verlustserie folgt aus deiner Win-Rate und der Zahl der Trades (Schilling) – so siehst du, ob eine Pechsträhne normal ist.",
    rows: [
      ["Längste Gewinnserie", String(rep.longestWin)],
      ["Längste Verlustserie", String(rep.longestLoss)],
      ["Erwartet bei deiner Win-Rate", n1(rep.expectedLoss)],
      ["P(Gewinn | nach Gewinn)", rep.pWinAfterWin == null ? DASH : `${pct0(rep.pWinAfterWin)} (${rep.afterWin})`],
      ["P(Gewinn | nach Verlust)", rep.pWinAfterLoss == null ? DASH : `${pct0(rep.pWinAfterLoss)} (${rep.afterLoss})`],
      ["Mindeststichprobe", `${STREAK_MIN_N} Trades`],
    ],
    verdict:
      rep.lossVsExpected == null
        ? { tone: "mute", text: `Ab ${STREAK_MIN_N} Trades.` }
        : rep.lossVsExpected === "laenger"
          ? { tone: "warn", text: "Deine längste Verlustserie ist länger als bei Zufall zu erwarten. Prüfe Tilt und Regeln nach Verlusten." }
          : { tone: "mute", text: "Deine Serien passen zu deiner Win-Rate – Pechsträhnen dieser Länge sind normal." },
  };
}

export function explainDistribution(rep: DistributionReport, currency: string): Explanation {
  const u = (v: number | null) => (v == null ? DASH : rep.unit === "R" ? fmtR(v) : `${signed(v, 0)} ${currency}`);
  return {
    key: "ana-dist",
    title: "Verteilung deiner Ergebnisse",
    what: `Schiefe > 0 heißt: wenige große Gewinne, viele kleine Verluste – typisch für Trendfolge. Kurtosis > 0 heißt dicke Ränder: Ausreißer kommen öfter vor als bei einer Normalverteilung. Ausreißer = mehr als ${HAMPEL_K} robuste Standardabweichungen (MAD) vom Median (Hampel).`,
    rows: [
      ["Mittelwert · Median", `${u(rep.mean)} · ${u(rep.median)}`],
      ["Schiefe", rep.skew == null ? DASH : n2(rep.skew)],
      ["Kurtosis (Exzess)", rep.kurt == null ? DASH : n2(rep.kurt)],
      ["Ausreißer", String(rep.outliers.length)],
      ["Anteil Top 3 am Bruttogewinn", rep.concentration.top3 == null ? DASH : pct0(rep.concentration.top3)],
    ],
    verdict:
      rep.concentration.top3 != null && rep.concentration.top3 > 0.6
        ? { tone: "warn", text: "Mehr als 60 % deines Gewinns stammen aus 3 Trades. Ohne sie sieht es anders aus – siehe „ohne Top 3“." }
        : { tone: "mute", text: "Dein Gewinn verteilt sich auf viele Trades." },
  };
}

export function explainBenchmark(rep: BenchmarkReport | null, adaptive: AdaptiveBenchmark | null, symbol: string): Explanation {
  return {
    key: "ana-bench",
    title: "Gegen den Markt",
    what: `Deine Konto-Rendite gegen „${symbol} am ersten Tag kaufen und halten“ – Tag für Tag aus den Tageskerzen des Live-Markts (UTC-Tage). Darunter der adaptive Benchmark: Deine letzten ${ADAPTIVE_WINDOW_DAYS} Tage gegen jedes frühere ${ADAPTIVE_WINDOW_DAYS}-Tage-Fenster deiner eigenen Historie (ab ${ADAPTIVE_MIN_WINDOWS} Fenstern).`,
    rows: rep
      ? [
          ["Deine Rendite", pct(rep.own), colorClass(rep.own)],
          [`Buy & Hold ${symbol}`, pct(rep.bh), colorClass(rep.bh)],
          ["Differenz", pct(rep.alpha), colorClass(rep.alpha)],
          ["Korrelation (Tage)", rep.corr == null ? DASH : n2(rep.corr)],
          ...(adaptive ? ([["Letzte 90 Tage", `${pct(adaptive.current)} · besser als ${pct0(adaptive.percentile)} deiner Quartale`]] as ExplainRow[]) : []),
        ]
      : [],
    verdict: !rep
      ? { tone: "mute", text: "Ohne Tageskerzen kein Vergleich." }
      : rep.alpha >= 0
        ? { tone: "win", text: "Du schlägst Buy & Hold." }
        : { tone: "warn", text: "Buy & Hold hätte mehr gebracht – mit welchem Risiko, zeigt der Drawdown." },
  };
}

export function explainCompare(): Explanation {
  return {
    key: "ana-compare",
    title: "Vergleich mit Unsicherheit",
    what: `Gleiche Kennzahlen für zwei Gruppen, die Differenz A − B mit ${ciText}. Win-Rate: Newcombe-Intervall und Zwei-Proportionen-Test, Ø P&L und Ø R: Welch-t-Test. „klar“ ab p < ${n2(FDR_Q)}, „Tendenz“ ab p < 0,20.`,
    rows: [],
    verdict: { tone: "mute", text: "Ein Unterschied ohne „klar“ kann Zufall sein." },
  };
}

export function explainCustom(): Explanation {
  return {
    key: "ana-custom",
    title: "Eigene Kennzahl",
    what: "Wähle eine Kennzahl, filtere deine Trades (Richtung, Konto, Zeitraum, eine Gruppe) und gruppiere optional nach einer Dimension. Gespeichert wird in deinen Einstellungen – sie reist mit dem Backup und der Cloud.",
    rows: [],
    verdict: { tone: "mute", text: `Werte mit ${ciText}, wo es eins gibt.` },
  };
}
