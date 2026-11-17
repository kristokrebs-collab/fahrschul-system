/** Live structure layer (F05): the store of the trendlines per timeframe. See `src/market/README.md` → "Preis- und RSI-Struktur". */
export { buildTrendView, computeTrendlines, getTrendlines, retainTrendlines, subscribeTrendlines, useTrendlines, type TrendTfItem, type TrendView } from "./store";
export { useTrendView } from "./useTrendView";
export { toggledTfs, writeTrendlines } from "./write";
