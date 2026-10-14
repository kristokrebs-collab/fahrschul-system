/**
 * Starts the market provider right after the journal has hydrated and follows the two settings
 * that select the provider namespace: `settings.market.symbol` → `setSymbol`, `settings.hyblock.timeframe`
 * → `setPeriod` (Plan 4.1). Pure store wiring, no React – `main.tsx` calls it once.
 */
import { setPeriod, setSymbol, startMarket, stopMarket } from "@/market";
import { useJournal } from "@/store/journalStore";

export function bootMarket(): () => void {
  let { settings } = useJournal.getState();
  startMarket(settings);
  const unsubscribe = useJournal.subscribe((state) => {
    if (state.settings === settings) return;
    const prev = settings;
    settings = state.settings;
    const symbol = settings.market.symbol || "BINANCE:BTCUSDT";
    const period = settings.hyblock.timeframe || "1h";
    if (symbol !== (prev.market.symbol || "BINANCE:BTCUSDT")) setSymbol(symbol);
    else if (period !== (prev.hyblock.timeframe || "1h")) setPeriod(period);
  });
  return () => {
    unsubscribe();
    stopMarket();
  };
}
