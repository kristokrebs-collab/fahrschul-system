/**
 * „Passt die Strategie zu mir?“ (F49): the pure domain layer. See README.md.
 *
 *   const s = strategyFacts({ name, from, to, riskPct, maxDD, trades });        // what a finished Labor run demands
 *   const j = journalProfile(closedEnriched, settings, behaviorEvents);          // what the journal shows
 *   const r = compareFit(s, j);                                                  // agreements and frictions, with numbers
 */
export * from "./types";
export * from "./profile";
export { compareFit } from "./compare";
