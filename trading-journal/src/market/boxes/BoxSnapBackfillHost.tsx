import { useEffect } from "react";
import { useJournal } from "@/store/journalStore";
import { startBoxSnapBackfill } from "./backfill";

/**
 * Leaf host of the box-snapshot backfill (review F02): once the journal is loaded, an idle queue gives synced and
 * imported trades (Bitunix auto-sync, CSV, TradingView, REST) and trades on other pairs the Box-zu-Box context at
 * entry of their OWN pair (`startBoxSnapBackfill`, `./backfill.ts`). Renders nothing; mounted in `DeferredHosts`.
 */
export function BoxSnapBackfillHost() {
  const loaded = useJournal((s) => s.loaded);
  useEffect(() => {
    if (!loaded) return;
    const job = startBoxSnapBackfill({
      trades: () => useJournal.getState().trades,
      latest: (id) => useJournal.getState().trades.find((t) => t.id === id),
      save: (t) => useJournal.getState().saveTrade(t),
    });
    return () => job.stop();
  }, [loaded]);
  return null;
}
