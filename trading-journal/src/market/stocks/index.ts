/**
 * Stock data (F67/F68): the contract, its client, the cache, the throttle, the New York calendar and the news sources.
 * Import from `@/market/stocks`.
 */
export { createStockData, failFrom, resetStockDataForTests, stockData, RATE_BACKOFF_MS, type StockDataDeps } from "./client";
export { createStockCache, BARS_AGES, NEWS_AGES, QUOTE_AGES, SYMBOLS_AGES, type StockCache } from "./cache";
export { createLimiter, type Limiter } from "./throttle";
export { dataOf, ok, REASON_TEXT, stale, stampOf, unavailable } from "./result";
export { loadNews, newsSources, registerNewsSource, summarize, type NewsBatch, type NewsSource, type SourceStatus } from "./news";
export * from "./session";
export * from "./types";
