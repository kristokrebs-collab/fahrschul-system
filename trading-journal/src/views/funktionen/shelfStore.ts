/**
 * The writers of the shelf (`shelf.ts`): favourites and "zuletzt verwendet" live in `settings.funktionen`, so they travel with
 * the backup and the cloud sync. Every write reads the CURRENT settings (never a copy from render time), changes only its own
 * key and does nothing when nothing changed. A failing save is swallowed – a missing favourite must never break opening a function.
 */
import { useJournal } from "@/store/journalStore";
import { markUsed, shelfOf, toggleFavorite, withShelf, type Shelf } from "./shelf";

function update(fn: (s: Shelf) => Shelf): boolean {
  const state = useJournal.getState();
  const before = shelfOf(state.settings);
  const after = fn(before);
  if (after === before) return false;
  try {
    void Promise.resolve(state.saveSettings(withShelf(state.settings, after))).catch(() => undefined);
  } catch {
    return false;
  }
  return true;
}

/** Counts `id` as used just now (called when a function is opened from anywhere: this page, the search, the assistant). */
export function rememberFunction(id: string, now = Date.now()): boolean {
  return update((s) => markUsed(s, id, now));
}

/** Sets or removes the favourite star of `id`. */
export function toggleFavoriteFunction(id: string, now = Date.now()): boolean {
  return update((s) => toggleFavorite(s, id, now));
}
