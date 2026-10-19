/**
 * Schlüsselmarken (F09), Szenarioplan (F08) and mehrstufige Alarme (F22): the pure domain layer. See README.md.
 *
 *   const levels = allKeyLevels(settings);                       // the five fixed levels (derived) + the user's own
 *   const ev = evaluateLevel(level, candlesOfLevelTf, now);      // waiting / provisional / confirmed / invalidated / unknown
 *   const plan = buildDayPlan({ entries, precedence });          // range / long / short / wait
 */
export * from "./types";
export * from "./config";
export * from "./evaluate";
export * from "./timeframes";
export * from "./plan";
export * from "./alerts";
export * from "./delivery";
