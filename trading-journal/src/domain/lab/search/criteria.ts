/**
 * Die Kriterien der Strategiesuche – VOR dem Lauf festgelegt und unverändert gezeigt. „Bestanden“ heißt: alle sechs sind erfüllt, sonst
 * „verworfen“ mit dem ersten verfehlten Kriterium als Begründung. Die Zahlen sind Setzungen des Produkts (kein Naturgesetz); sie sind
 * absichtlich streng, weil die beste von 1.000 Varianten fast immer zufällig gut aussieht.
 *
 * Zielgröße der Auswahl (nur auf dem Training, den ersten 80 %): der Score des Backtest-Labors (`scoreOf`): Ø R je Trade nach allen
 * Kosten, geteilt durch die Streuung, mal √Trades (höchstens 100) – also Erwartung pro Trade, gewichtet mit der Verlässlichkeit. Eine
 * Variante mit weniger als `minIsTrades` Trades oder ohne positive Erwartung wird nicht gewählt.
 *
 * Warum diese sechs: (1–3) genug Trades und eine positive Erwartung nach Kosten im Training und im Endtest; (4) der Endtest hält mindestens
 * die Hälfte der Trainings-Zahl (eine Zufallsvariante fällt zurück); (5) der Endtest allein ist ein einzelner, ungesehener Test –
 * sein p ist ehrlich; (6) das Training allein ist es nicht: unter 1.000 Versuchen gibt es zufällig ein p um 0,001, darum wird sein p mit der
 * Zahl der Versuche korrigiert (Šidák/Bonferroni). Auf reinen Zufallspfaden liegt die korrigierte Zahl fast immer bei 1,0 (Test pinnt das).
 * Der Rang des Siegers im Endtest unter allen Varianten wird gezeigt (Selektionsverzerrung sichtbar), ist aber kein Kriterium: R-Vielfache
 * verschiedener Stop-/Ziel-Aufbauten sind nur grob vergleichbar, ein echter Treffer kann dort mittelmäßig stehen.
 */
import type { CheckResult, Deflation, SearchFamily, SectionStats, Verdict } from "./types";

export interface Criteria {
  minIsTrades: number;
  minOosTrades: number;
  retention: number;
  maxP: number;
  maxAdjP: number;
}

const TREND: Criteria = {
  /** Training: mindestens so viele Trades, sonst gilt eine Variante nicht als bewertbar */
  minIsTrades: 30,
  /** Endtest: mindestens so viele Trades, sonst ist die Zahl zu dünn */
  minOosTrades: 15,
  /** Endtest-Erwartung muss mindestens diesen Anteil der Trainings-Erwartung erreichen */
  retention: 0.5,
  /** einseitiges p des Endtests (Erwartung > 0); ein einzelner Test */
  maxP: 0.1,
  /** einseitiges p des Trainings, korrigiert um die Zahl der Versuche */
  maxAdjP: 0.1,
};

/** Eröffnungs-Range: ein Trade je Tag – auf 60 Tagen sind es im Training ≥ 8 Tage mit Signal (Setzung des Auftrags), im Endtest (12 Tage) mindestens 4. */
const ORB: Criteria = { ...TREND, minIsTrades: 8, minOosTrades: 4 };

export const CRITERIA = TREND;
export const CRITERIA_BY_FAMILY: Readonly<Record<SearchFamily, Criteria>> = { trend: TREND, orb: ORB };
export const criteriaOf = (family: SearchFamily): Criteria => CRITERIA_BY_FAMILY[family];

const dec = (v: number, d: number): string => v.toFixed(d).replace(".", ",").replace("-", "−");
const rTxt = (v: number | null, d = 2): string => (v == null ? "–" : `${v > 0 ? "+" : ""}${dec(v, d)} R`);
const pTxt = (p: number | null): string => (p == null ? "–" : p < 0.001 ? "p < 0,001" : `p = ${dec(p, 3)}`);

/** Mehrfachtest-Korrektur nach Šidák: aus dem p der besten von `trials` Varianten das p, das für „irgendeine von `trials`“ gilt. */
export function adjustedP(p: number | null, trials: number): number | null {
  if (p == null || !Number.isFinite(p) || trials < 1) return null;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return Math.min(1, -Math.expm1(trials * Math.log1p(-p)));
}

export interface JudgeInput {
  family?: SearchFamily;
  is: SectionStats;
  oos: SectionStats;
  deflation: Deflation | null;
}

/** Wertet die Kriterien aus. Reine Funktion der Zahlen – nichts davon verändert die Auswahl. */
export function judge({ family = "trend", is, oos, deflation }: JudgeInput): Verdict {
  const C = criteriaOf(family);
  const isAvg = is.avgR ?? 0;
  const oosAvg = oos.avgR ?? 0;
  const checks: CheckResult[] = [
    { id: "isTrades", ok: is.n >= C.minIsTrades && isAvg > 0, value: `${is.n} Trades, ${rTxt(is.avgR)}`, need: `≥ ${C.minIsTrades} Trades, Erwartung > 0 R` },
    { id: "oosTrades", ok: oos.n >= C.minOosTrades, value: `${oos.n} Trades`, need: `≥ ${C.minOosTrades} Trades` },
    { id: "oosPositive", ok: oos.n > 0 && oosAvg > 0, value: rTxt(oos.avgR), need: "> 0 R nach allen Kosten" },
    {
      id: "retention",
      ok: oos.n > 0 && isAvg > 0 && oosAvg >= C.retention * isAvg,
      value: isAvg > 0 && oos.avgR != null ? `${Math.round((oosAvg / isAvg) * 100)} % der Trainings-Erwartung` : "–",
      need: `≥ ${Math.round(C.retention * 100)} % der Trainings-Erwartung`,
    },
    { id: "oosSignificance", ok: oos.pEdge != null && oos.pEdge <= C.maxP, value: pTxt(oos.pEdge), need: `p ≤ ${dec(C.maxP, 2)} (einseitig)` },
    {
      id: "multiTest",
      ok: deflation?.adjP != null && deflation.adjP <= C.maxAdjP,
      value: deflation?.adjP == null ? "–" : `${pTxt(deflation.isP)} → nach ${deflation.trials.toLocaleString("de-DE")} Versuchen ${pTxt(deflation.adjP)}`,
      need: `korrigiertes p ≤ ${dec(C.maxAdjP, 2)}`,
    },
  ];
  const failed = checks.find((c) => !c.ok);
  return {
    passed: !failed,
    checks,
    reason: failed ? FAIL_TEXT[failed.id] : "Alle sechs Kriterien sind erfüllt. Das ist ein Hinweis auf eine Kante in diesen Kerzen, kein Beweis und keine Prognose.",
  };
}

const FAIL_TEXT: Readonly<Record<CheckResult["id"], string>> = {
  isTrades: "Im Training hatte keine Variante genug Trades und eine positive Erwartung nach Kosten.",
  oosTrades: "Im Endtest kamen zu wenige Trades zusammen, um etwas zu sagen.",
  oosPositive: "Im Endtest ist die Erwartung nach Kosten nicht positiv – die gute Zahl aus dem Training war Zufall oder hat die Kosten nicht überlebt.",
  retention: "Im Endtest bleibt weniger als die Hälfte der Trainings-Erwartung übrig – typisch für eine zufällig gute Variante.",
  oosSignificance: "Der Endtest ist nicht klar genug vom Zufall zu unterscheiden.",
  multiTest: "Unter 1.000 Versuchen findet man allein durch Glück eine Variante, die im Training so gut aussieht – nach der Korrektur für die Zahl der Versuche bleibt davon kein Beleg übrig.",
};
