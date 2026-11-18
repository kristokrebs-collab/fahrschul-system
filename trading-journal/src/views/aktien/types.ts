/**
 * Types the sections of `#aktien` that other parts of the project build share (`Slots.tsx`): the analyst section
 * (Quartalszahlen · DCF · Kaufthese) and the Congress tracker. Both get the same props: which tickers the trader watches,
 * which one is selected right now, and the stock data contract (`@/market/stocks`) so they fetch with the same cache,
 * throttle and typed failures as the scanner. A slot only READS and shows; saving something of its own goes through its own
 * settings key, never through the watchlist's.
 */
import type { WatchItem } from "@/domain/watchlist";
import type { StockDataContract } from "@/market/stocks/types";

export interface AktienSlotProps {
  /** the stocks of the watchlist (crypto pairs are not in it) */
  watchlist: readonly WatchItem[];
  /** the ticker the trader picked on this page (a watchlist row or a scan hit), `null` = none */
  symbol: string | null;
  /** the app's stock data (cache, throttle, `ok | stale | unavailable`) */
  data: StockDataContract;
  /** puts a ticker on the watchlist (the same write as the button in the list) – resolves `false` when it could not */
  onWatch?: (symbol: string, name?: string | null) => Promise<boolean>;
}
