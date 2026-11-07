/**
 * Historisch ähnliche Situationen (F19): the pure domain layer. See README.md.
 *
 *   const r = findSimilar(candlesOfTf, "4h", now, { horizon: 12, unit: "r" });   // closed candles only
 *   r.status      // "ok" (≥ 20 hits) | "few" | "noCandles" | "noFeatures"
 *   r.hits        // nearest first, each with the real course after it
 *   r.summary     // shares, spread, counter-examples (only when status is "ok")
 */
export * from "./types";
export * from "./features";
export * from "./search";
export * from "./stats";
export * from "./text";
