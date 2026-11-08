/**
 * Strategiesuche „1.000 Varianten. Eine bleibt.“ (rein, kein React, kein I/O). Siehe docs/STRATEGIESUCHE.md.
 *
 *   space.ts      die Familie „Ausbruch mit Trendfilter“ (Suchraum 24.000 Punkte, gesetzte Ziehung), die Texte der Varianten
 *   orb.ts        die Familie „Eröffnungs-Range-Ausbruch“ (540 Varianten) und die reine Funktion Sitzung → Range, Signal, Gründe, Note, Verlauf
 *   criteria.ts   die vorab festgelegten Kriterien und das Urteil „bestanden“ / „verworfen“
 *   job.ts        der schrittweise Auftrag (Training 80 % → Sieger festlegen → EIN Endtest 20 % → Verteilung)
 *   candidate.ts  nach „bestanden“: die Regeln des Siegers auf die aktuellen Kerzen
 */
export * from "./types";
export * from "./space";
export * from "./orb";
export { CRITERIA, CRITERIA_BY_FAMILY, criteriaOf, judge, adjustedP, type Criteria } from "./criteria";
export { candidateOf, sizeCandidate, type Candidate, type CandidateReason, type CandidateSignal, type CandidateSizing, type CandidateState, type OwnRisk } from "./candidate";
export { assembleVariants, createSearchJob, runSearchSync, sectionStats, scoreR, cumulativeAt, gridFractions, GRID_IS, GRID_OOS, MIN_ORB_DAYS, SearchDataError, type SearchJob, type Tr } from "./job";
