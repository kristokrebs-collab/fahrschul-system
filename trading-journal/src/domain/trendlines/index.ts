/**
 * Preis- und RSI-Struktur über Zeiteinheiten (F05): diagonal trendlines on the price and on the RSI, approach, break and
 * retest apart. Pure; see README.md.
 *
 *   const a = analyzeTrendlines(candlesOfTf, "4h", now);   // closed candles only
 *   a.price.down.active / .broken, a.rsi.up.active …       // TrendLineView with distances, break, retest
 *   const t = describeLine(view);                          // German phase + title + detail
 */
export * from "./types";
export * from "./engine";
export * from "./analyze";
export * from "./text";
export * from "./config";
