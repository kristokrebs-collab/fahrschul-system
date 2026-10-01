/**
 * `Einstellungen` page wired to the market provider (Plan 6.4 "Live-Daten"): the health snapshot and the
 * per-feed status labels come from `@/market`, `Jetzt aktualisieren` forces a REST refresh of every feed,
 * `Jetzt neu verbinden` restarts the provider (stop → start, new WebSocket) and `Cache leeren` empties the
 * IndexedDB cache of the current symbol.
 */
import { useCallback, useMemo } from "react";
import { FEED_IDS, getProvider, startMarket, stopMarket, useHealth, type FeedId, type StatusLabel } from "@/market";
import { useJournal } from "@/store/journalStore";
import { SettingsView } from "@/views/settings";

export function SettingsPage() {
  const health = useHealth();

  // A label depends on the feed's health and on its data's `HH:mm` only (never on the clock), and every datum that
  // moves `asOf` also moves the health snapshot (WS feeds ≥ 1 s apart) – so the labels follow `health` alone. The
  // form itself is memoised in `SettingsView`, so these updates re-render the Live-Daten card, not the page.
  const statusLabels = useMemo(() => {
    const p = getProvider();
    const labels: Partial<Record<FeedId, StatusLabel>> = {};
    if (!p) return labels;
    for (const f of FEED_IDS) labels[f] = p.statusLabel(f);
    return labels;
    // the provider is read fresh; the snapshot identity is the trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health]);

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
