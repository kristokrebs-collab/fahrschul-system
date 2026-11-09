/**
 * Writes of the watchlist: `settings.watchlist` is saved at once (no draft, no Speichern button – the settings page's own
 * draft does not hold this key, so its save keeps it). Always from the LATEST settings; unknown keys and entries this
 * version cannot read survive (`withWatchlist`).
 */
import { addToWatchlist, removeFromWatchlist, watchlistOfSettings, withWatchlist, type WatchItem, type WatchKind } from "@/domain/watchlist";
import { useJournal } from "@/store/journalStore";

export type WatchWrite = "ok" | "invalid" | "duplicate" | "limit" | "failed";

async function save(items: readonly WatchItem[]): Promise<boolean> {
  const { settings, saveSettings } = useJournal.getState();
  const watchlist = withWatchlist(settings.watchlist, items);
  if (watchlist === settings.watchlist) return true;
  try {
    await saveSettings({ ...settings, watchlist });
    return true;
  } catch {
    return false;
  }
}

export async function watch(kind: WatchKind, symbol: string, name?: string | null, now: number = Date.now()): Promise<WatchWrite> {
  const cur = watchlistOfSettings(useJournal.getState().settings).items;
  const r = addToWatchlist(cur, { kind, symbol, ...(name !== undefined ? { name } : {}) }, now);
  if (!r.ok) return r.reason;
  return (await save(r.items)) ? "ok" : "failed";
}

export async function unwatch(id: string): Promise<WatchWrite> {
  const cur = watchlistOfSettings(useJournal.getState().settings).items;
  if (!cur.some((i) => i.id === id)) return "ok";
  return (await save(removeFromWatchlist(cur, id))) ? "ok" : "failed";
}

export const WRITE_TEXT: Readonly<Record<Exclude<WatchWrite, "ok">, string>> = {
  invalid: "Das ist kein gültiges Kürzel.",
  duplicate: "Steht schon auf der Watchlist.",
  limit: "Die Watchlist ist voll (50 Einträge).",
  failed: "Das Speichern hat nicht geklappt. Bitte noch einmal versuchen.",
};
