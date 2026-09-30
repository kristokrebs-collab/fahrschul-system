/**
 * `Einstellungen` page wired to the market provider (Plan 6.4 "Live-Daten"): the health snapshot and the
 * per-feed status labels come from `@/market`, `Jetzt aktualisieren` forces a REST refresh of every feed,
 * `Jetzt neu verbinden` restarts the provider (stop → start, new WebSocket) and `Cache leeren` empties the
 * IndexedDB cache of the current symbol.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { FEED_IDS, getProvider, startMarket, stopMarket, useHealth, type FeedId, type StatusLabel } from "@/market";
import { useJournal } from "@/store/journalStore";
import { SettingsView } from "@/views/settings";

export function SettingsPage() {
  const health = useHealth();
  // The `Stand` column and the `Zuletzt HH:mm` labels move with the clock, not with every datum: a 1-s tick
  // instead of the market version counter (aggTrade would otherwise recompute 15 labels at 10 Hz).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const statusLabels = useMemo(() => {
    const p = getProvider();
    const labels: Partial<Record<FeedId, StatusLabel>> = {};
    if (!p) return labels;
    for (const f of FEED_IDS) labels[f] = p.statusLabel(f);
    return labels;
    // the label of a feed changes with the health snapshot and with the clock (`tick`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health, tick]);

  const onRefresh = useCallback(async () => {
    const p = getProvider();
    if (!p) return;
    await Promise.allSettled(FEED_IDS.map((f) => p.refresh(f, { force: true })));
  }, []);

  const onReconnect = useCallback(() => {
    stopMarket();
    startMarket(useJournal.getState().settings);
  }, []);

  const onClearCache = useCallback(async () => {
    await getProvider()?.clearCache();
  }, []);

  return <SettingsView health={health} statusLabels={statusLabels} onRefresh={onRefresh} onReconnect={onReconnect} onClearCache={onClearCache} />;
}
