/**
 * Strategiesuche „1.000 Varianten. Eine bleibt.“ – Datentypen (rein, JSON-sicher: eine fehlende Zahl ist `null`, nie NaN / Infinity).
 */
import type { Bar, BtSide, EngineCfg } from "@/domain/backtest/types";
import type { OrbSessionId, OrbStop } from "./orb";

/** Kerzenlängen der Familie „Ausbruch mit Trendfilter“ (die des Regel-Baukastens). */
export type SearchInterval = "1h" | "4h" | "1d";

export type SearchFamily = "trend" | "orb";

/**
 * Stop-Führung nach dem Einstieg – jede Variante läuft mit allen dreien (eine Regel je Lauf):
 *   fixed  der Stop bleibt, wo er gesetzt wurde
 *   be     ab +1 R (bester Kurs seit der Füllung) zieht der Stop auf den Einstand (Einstiegspreis)
 *   trail  ab +1 R folgt der Stop dem besten Kurs im Abstand des Anfangs-Stops (Trend: k × ATR, Eröffnungs-Range: 1 R)
 * Entschieden wird am Schluss einer Kerze, gültig ab der nächsten; der Stop wird nur enger, nie weiter.
 */
export type StopRule = "fixed" | "be" | "trail";

/** Eine Parameter-Variante der Familie „Ausbruch mit Trendfilter“. */
export interface SearchVariant {
  family: "trend";
  /** Platz in der Ziehung 0 … 999 (stabil: gleicher Seed → gleicher Platz) */
  id: number;
  side: BtSide;
  /** Schluss über dem Hoch (Long) bzw. unter dem Tief (Short) der letzten N Kerzen */
  lookback: number;
  /** Trendfilter: Schluss über (Long) / unter (Short) der EMA dieser Länge; 0 = kein Filter */
  trendEma: number;
  /** Stop = Schluss ∓ k × ATR(14) */
  stopAtr: number;
  /** Ziel = Vielfaches des Stop-Abstands */
  targetR: number;
  /** Zeit-Stopp in Kerzen */
  maxBars: number;
}

/** Eine Variante der Familie „Eröffnungs-Range-Ausbruch“ (siehe `orb.ts`). */
export interface OrbVariant {
  family: "orb";
  id: number;
  session: OrbSessionId;
  /** Minuten der Range: 15 / 30 / 60 */
  rangeMin: number;
  /** Volumen der Ausbruchskerze ÷ Schnitt der 20 davor muss mindestens so groß sein */
  volThr: number;
  targetR: number;
  stop: OrbStop;
  /** nur handeln, wenn der Kurs auf der passenden Seite der EMA 50 liegt */
  trend: boolean;
}

export type AnyVariant = SearchVariant | OrbVariant;

/** Woher die Kerzen stammen – nur `fixture` wird als Demo beschriftet. */
export interface DatasetMeta {
  symbol: string;
  interval: SearchInterval | "5m";
  /** "binance" | "proxy" | "bybit" | "spot" | "spot-app" | "fixture" */
  source: string;
  /** Kerzen aus einer Test-/Demo-Vorlage, nicht vom Markt */
  fixture: boolean;
}

export interface TrendInput {
  /** aufsteigende, geschlossene Kerzen (`t` = Eröffnung in Sekunden), inklusive Vorlauf vor `fromMs` */
  bars: readonly Bar[];
  interval: SearchInterval;
  /** erste handelbare Zeit (ms); Kerzen davor sind nur Vorlauf für die Kennzahlen */
  fromMs: number;
  meta: DatasetMeta;
}

export interface OrbInput {
  /** 5-Minuten-Kerzen, geschlossen, inklusive Vorlauf (EMA 50, Volumenschnitt) */
  bars: readonly Bar[];
  fromMs: number;
  meta: DatasetMeta;
}

export interface SearchJobInput {
  engine: EngineCfg;
  seed: number;
  /** Anzahl Varianten insgesamt (Standard 1.000; Tests dürfen weniger wählen). Die ORB-Familie ist mit allen 540 enthalten, der Rest ist Trend-Ausbruch. */
  count?: number;
  /** mindestens eine der beiden Familien */
  trend?: TrendInput;
  orb?: OrbInput;
}

export type SearchPhase = "prepare" | "score" | "seal" | "rank" | "done";

/** Eine Zeile je Variante – alle stehen im Ergebnis (der Zähler ist belegbar, nicht nur gezeichnet). */
export interface VariantRow {
  id: number;
  family: SearchFamily;
  /** die Stop-Führung mit der besten Zielgröße dieser Variante im Training (bei Gleichstand die einfachere: fest vor Einstand vor Nachziehen) – die Zahlen der Zeile gehören zu ihr */
  stop: StopRule;
  /** Zielgröße je Stop-Führung in der Reihenfolge fest / Einstand / Nachziehen (`null` = nicht qualifiziert) – jede ist ein eigener Kandidat der Auswahl */
  isScores: (number | null)[];
  /** Trainingsabschnitt (erste 80 %) */
  isN: number;
  isAvgR: number | null;
  /** Zielgröße; `null` = nicht qualifiziert (zu wenige Trades) */
  isScore: number | null;
  /** Endtest (letzte 20 %): nur gerechnet, nachdem der Sieger festgelegt war – er fließt nie in die Auswahl */
  oosN: number;
  oosAvgR: number | null;
  /** Ø R ÷ Streuung auf dem Endtest; `null` unter der Mindestzahl Trades der Familie */
  oosScore: number | null;
}

/** Kennzahlen eines Abschnitts in R (nach allen Kosten). */
export interface SectionStats {
  n: number;
  avgR: number | null;
  sdR: number | null;
  sumR: number;
  winRate: number | null;
  /** Profitfaktor; `null` ohne Verlusttrade */
  pf: number | null;
  /** einseitiges p für „Erwartung > 0“ (t-Test); `null` unter 2 Trades */
  pEdge: number | null;
  /** größter Rückgang der Summe in R */
  maxDdR: number;
  /** Ø Kosten (Gebühren + Slippage + Funding) je Trade in R */
  avgCostR: number | null;
}

export interface CheckResult {
  id: "isTrades" | "oosTrades" | "oosPositive" | "retention" | "oosSignificance" | "multiTest";
  ok: boolean;
  /** was gemessen wurde, als Text ("0,31 R", "48 Trades") */
  value: string;
  /** was vorab verlangt war ("> 0 R", "≥ 15 Trades") */
  need: string;
}

export interface Verdict {
  passed: boolean;
  checks: CheckResult[];
  /** Satz für die Ergebniskarte; bei „verworfen“ die Begründung */
  reason: string;
}

export interface RankInfo {
  /** Platz des Siegers im Endtest unter den bewertbaren Varianten (1 = bestes Verhältnis Erwartung ÷ Streuung); `null` = der Sieger selbst hat im Endtest zu wenige Trades für einen Vergleich */
  rank: number | null;
  /** wie viele Varianten im Endtest genug Trades hatten (den Sieger eingerechnet, wenn er bewertbar ist) */
  of: number;
  /** Anteil der anderen bewertbaren Varianten, die im Endtest schlechter sind (0…1); `null` ohne Rang */
  beaten: number | null;
  /** Quantile der Endtest-Erwartung (R) aller bewertbaren Varianten: p10, p25, p50, p75, p90 */
  quantiles: { p10: number; p25: number; p50: number; p75: number; p90: number } | null;
  /** Median der Endtest-Erwartung der 10 besten Trainings-Varianten (so viel halten die „besten“ im Schnitt) */
  topTenMedianOos: number | null;
}

export interface Deflation {
  /** einseitiges p des Siegers im Training (Erwartung > 0) */
  isP: number | null;
  /** dasselbe p, korrigiert um die Zahl der Versuche („irgendeine von N sieht so gut aus“) */
  adjP: number | null;
  trials: number;
}

export interface Distribution {
  /** Ränder der Spanne (R); Werte außerhalb zählen im ersten / letzten Behälter */
  min: number;
  max: number;
  /** Anzahl Varianten je Behälter (gleich breit) */
  counts: number[];
}

export interface WinnerInfo {
  variant: AnyVariant;
  /** die Stop-Führung des Siegers (im Training gewählt, zusammen mit der Variante) */
  stop: StopRule;
  /** Klartext der Regeln (mit Stop-Führung) */
  text: string;
  is: SectionStats;
  oos: SectionStats;
  /** die drei Stop-Führungen derselben Einstiegsregeln im Training und im Endtest – Vergleich, keine Auswahl */
  stops: StopCompare;
  /** Rückgang und Spanne der Endtest-Trades (Neuziehung), `null` unter 2 Endtest-Trades */
  risk: RiskInfo | null;
}

/** Eine Stop-Führung derselben Einstiegsregeln: Training (Teil der Auswahl) und Endtest (Vergleichslauf nach der Auswahl). */
export interface StopLine {
  rule: StopRule;
  isN: number;
  isAvgR: number | null;
  isScore: number | null;
  oosN: number;
  oosAvgR: number | null;
  oosSumR: number;
}

/**
 * Die Stop-Führung des Siegers gegen eine andere im Endtest. Partner: „fest“, wenn der Sieger nachzieht; sonst die bessere der beiden
 * anderen (im Endtest). Die Spanne der Differenz kommt aus einer Neuziehung beider Trade-Listen (gesetzt, `n` Ziehungen). „Besser“ gilt
 * erst, wenn der Endtest allein die Differenz vom Zufall trennt (einseitig p ≤ 0,05; es wird genau EIN Paar verglichen) UND das Training in
 * dieselbe Richtung zeigt; ausgesprochen wird es nur bei „bestanden“.
 */
export interface StopCompare {
  rule: StopRule;
  /** fest, Einstand, Nachziehen */
  lines: StopLine[];
  vs: StopRule;
  /** gepaarte Einstiege (gleiche Einstiegskerze); 0 = ungepaart verglichen (zu wenige Paare) */
  pairs: number;
  /** Ø R je Trade im Endtest: Sieger − Partner (alle Trades beider Läufe) */
  diffAvgR: number | null;
  /** Summe R im Endtest: Sieger − Partner */
  diffSumR: number | null;
  /** 5 % / 95 % der neu gezogenen Differenz (Ø R; gepaart, wenn `pairs` > 0) */
  lo: number | null;
  hi: number | null;
  /** einseitig: Anteil der Neuziehungen mit Differenz ≤ 0 */
  p: number | null;
  /** der Endtest trennt die Differenz vom Zufall und das Training zeigt in dieselbe Richtung */
  edge: boolean;
  /** nur nach „bestanden“: die Stop-Führung des Siegers wird als besser ausgewiesen */
  declared: boolean;
  /** Ziehungen der Neuziehung */
  n: number;
}

/** Quantile 5 % / 50 % / 95 %. */
export interface Q3 {
  p5: number;
  p50: number;
  p95: number;
}

/**
 * Rückgangs-Risiko aus den Endtest-Trades des Siegers – keine Prognose: die Trades werden `n`-mal mit Zurücklegen neu gezogen (gesetzt), in
 * ihrer Anzahl; daraus die Spanne des größten Rückgangs und der Summe. In Prozent mit `riskPct` je Trade (Versuchsaufbau, mit Zinseszins).
 */
export interface RiskInfo {
  /** Ziehungen */
  n: number;
  /** Endtest-Trades, aus denen gezogen wird */
  trades: number;
  riskPct: number;
  /** tatsächlicher größter Rückgang im Endtest */
  ddR: number;
  ddPct: number;
  /** größter Rückgang über die Ziehungen (p95 = schlechte Fälle) */
  ddRq: Q3;
  ddPctQ: Q3;
  /** Summe R über die Ziehungen: p5 = ungünstiger, p95 = günstiger Fall */
  sumRq: Q3;
  /** Anteil der Ziehungen, deren Summe ≤ 0 ist */
  pLoss: number;
  /** Spanne der Summenkurve an den Endtest-Rasterpunkten (kumulierte R ab dem Schnitt, relativ 0): unten 5 %, Mitte 50 %, oben 95 % */
  band: { lo: number[]; mid: number[]; hi: number[] };
}

export interface SearchCurves {
  /** Rasterpunkte als Anteil des Zeitraums der Familie (0…1): die ersten `isPoints` liegen im Training (bis 0,8), der Rest im Endtest */
  grid: number[];
  isPoints: number;
  /** je Variante: kumulierte R nach Kosten an den ersten `isPoints` Rasterpunkten (nur Training!) */
  is: number[][];
  /** der Sieger über alle Rasterpunkte (Training + Endtest) */
  winner: number[];
}

export interface SearchCounts {
  variants: number;
  /** davon je Familie */
  byFamily: Record<SearchFamily, number>;
  /** Stop-Führungen je Variante (3) */
  stopRules: number;
  /** Kandidaten der Auswahl = Varianten × Stop-Führungen; so viele Versuche zählt die Mehrfachtest-Korrektur */
  candidates: number;
  /** wie oft im Training gerechnet wurde (muss `candidates` sein) */
  isRuns: number;
  /** qualifizierte Kandidaten (genug Trades, Erwartung > 0) */
  qualified: number;
  /** Endtest-Läufe insgesamt: der Sieger genau einmal, seine zwei anderen Stop-Führungen zum Vergleich, die übrigen Varianten (je mit ihrer Trainings-Stop-Führung) für die Verteilung */
  oosRuns: number;
  winnerOosRuns: number;
  /** Vergleichsläufe der Stop-Führung im Endtest (2) */
  compareRuns: number;
}

/** Kosten-Annahmen der Läufe in Worten (für die Zeile unter dem Ergebnis). */
export interface CostInfo {
  takerBps: number;
  makerBps: number;
  slippage: string;
  /** Trend-Familie; die Eröffnungs-Range rechnet kein Funding */
  funding: string;
}

/** Datenstand einer Familie. Bei ORB zählen `window` / `isBars` / `oosBars` Handelstage, sonst Kerzen. */
export type DatasetInfo = DatasetMeta & {
  family: SearchFamily;
  unit: "Kerzen" | "Tage";
  bars: number;
  window: number;
  isBars: number;
  oosBars: number;
  /** ms: Beginn des Fensters, Schnitt Training|Endtest, Ende der letzten geschlossenen Kerze */
  fromT: number;
  cutT: number;
  toT: number;
};

export interface SearchResult {
  /** Modellversion – ändert sich, sobald Familie, Raum, Zielgröße oder Kriterien sich ändern */
  model: string;
  seed: number;
  /** Namen der geprüften Familien */
  families: SearchFamily[];
  datasets: DatasetInfo[];
  counts: SearchCounts;
  rows: VariantRow[];
  /** `null` = keine Variante war qualifiziert (genug Trades, Erwartung > 0) */
  winner: WinnerInfo | null;
  /** Familie des Siegers */
  winnerFamily: SearchFamily | null;
  verdict: Verdict;
  rank: RankInfo | null;
  deflation: Deflation | null;
  /** Verteilung der Endtest-Erwartung (Ø R) aller bewertbaren Varianten – „die beste von 1.000 sieht zufällig gut aus“ */
  distribution: Distribution | null;
  curves: SearchCurves;
  costs: CostInfo;
}
