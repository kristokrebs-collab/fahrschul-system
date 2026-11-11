/**
 * German sentences for the phase analysis (F43), shared by the Markt card and the assistant: what was measured, with which
 * sample, and what the numbers do NOT say. Observations with their sample – never a cause, never a promise.
 */
import { n0, pct, r as fmtR } from "@/lib/format";
import { SIG_LABEL, type Significance } from "../analytics/stats";
import type { PhaseGroup, PhaseReport, PhaseRow } from "./phases";

export const VERDICT_LABEL: Readonly<Record<Significance, string>> = SIG_LABEL;

/** What a verdict means in one line. */
export const VERDICT_MEANING: Readonly<Record<Significance, string>> = {
  klar: "Der Unterschied hält die Korrektur für viele Vergleiche stand – trotzdem eine Beobachtung, keine Ursache.",
  tendenz: "Ein Hinweis, kein Beleg: der Unterschied ist auffällig, aber nicht klar genug von Zufall zu trennen.",
  offen: "Der Unterschied ist von Zufall nicht zu unterscheiden.",
  wenig: "Zu wenig Trades auf mindestens einer Seite für eine Aussage.",
};

/** "12 Trades · Treffer 58 % · Ø R +0,31 R" (R only with a stop). */
export function groupLine(g: PhaseGroup): string {
  if (!g.n) return "keine Trades";
  const bits = [`${n0(g.n)} ${g.n === 1 ? "Trade" : "Trades"}`, `Treffer ${g.hit != null ? `${Math.round(g.hit * 100)} %` : "–"}`];
  bits.push(g.avgR != null ? `Ø ${fmtR(g.avgR)} (${n0(g.nR)} mit Stop)` : "Ø R: keine Daten");
  return bits.join(" · ");
}

/** The reading of one phase: the numbers and the verdict. */
export function phaseReading(row: PhaseRow): string {
  if (!row.inside.n) return "In dieser Phase liegt kein Trade.";
  const parts: string[] = [];
  if (row.dR) {
    const d = row.dR;
    parts.push(`Ø R ${fmtR(row.inside.avgR)} in der Phase gegenüber ${fmtR(row.outside.avgR)} außerhalb (Unterschied ${fmtR(d.diff)}, 80-%-Intervall ${fmtR(d.ci.lo)} bis ${fmtR(d.ci.hi)}).`);
  } else if (row.dHit) {
    parts.push(`Trefferquote ${pct(row.inside.hit, false)} in der Phase gegenüber ${pct(row.outside.hit, false)} außerhalb (Unterschied ${pct(row.dHit.diff)}); für Ø R fehlen Trades mit Stop.`);
  } else {
    parts.push("Außerhalb der Phase liegt kein Vergleichstrade.");
  }
  parts.push(VERDICT_MEANING[row.verdict]);
  return parts.join(" ");
}

/** The caveat under the table: how many comparisons, why a lone outlier is expected. */
export function chanceNote(rep: Pick<PhaseReport, "tests" | "minN">): string {
  const k = rep.tests;
  return `Verglichen werden ${n0(k)} ${k === 1 ? "Phase" : "Phasen"} mit mindestens einem Trade; bei so vielen Vergleichen fällt rein zufällig immer wieder eine Phase auf. „klar“ gilt erst nach der Korrektur für mehrere Vergleiche (Benjamini-Hochberg, 10 %), unter ${n0(rep.minN)} Trades auf einer Seite steht „zu wenig“. Das sind Beobachtungen deiner Vergangenheit, keine Ursachen und keine Prognose.`;
}
