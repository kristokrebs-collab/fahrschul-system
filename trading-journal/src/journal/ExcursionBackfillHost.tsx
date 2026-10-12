import { useEffect } from "react";
import { useProvider } from "@/market";
import { startExcursionBackfill } from "@/market/excursion";
import { useJournal } from "@/store/journalStore";

/**
 * Leaf host of the MAE / MFE backfill (Journal v3, P06): once the journal is loaded and a market provider runs, an idle
 * queue measures closed trades that have an exit time but no excursion yet (`startExcursionBackfill`: one trade every
 * 1.5 s, at most 40 per session, paused while the tab is hidden, budget class `bulk`). Renders nothing. Mounted by
 * `TradeDetail` (always mounted at app level), so it needs no extra wiring.
 */
export function ExcursionBackfillHost() {
  const loaded = useJournal((s) => s.loaded);
  const provider = useProvider();
  useEffect(() => {
    if (!loaded || !provider) return;
    const job = startExcursionBackfill(
      {
        trades: () => useJournal.getState().trades,
        latest: (id) => useJournal.getState().trades.find((t) => t.id === id),
        save: (t) => useJournal.getState().saveTrade(t),
      },
      { provider: () => provider },
    );
    return () => job.stop();
  }, [loaded, provider]);
  return null;
}
