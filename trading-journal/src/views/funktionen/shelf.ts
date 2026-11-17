/**
 * What the page "Funktionen" remembers for you: your favourites and what you used last. A passthrough settings key, like
 * `settings.assistant` – it survives `normalizeSettings`, the backup and the cloud `merge3`, and every writer returns a NEW
 * settings object with all other keys untouched (also unknown keys inside `funktionen`):
 *
 *   settings.funktionen = { v: 1, favorites: [{ id, at }], recent: [{ id, at }] }
 *
 * Both lists are arrays of objects with a string `id`, so two devices merge per id (`merge3`): a favourite set on the phone
 * and one set on the desktop both stay; an edit beats a delete. `id` is a register id (`src/app/features.ts`), `at` the time
 * (ms) it was set / last used. The reader sorts: favourites by the time they were set (newest first), recent by last use.
 * Ids of functions that no longer exist are simply not shown (the caller filters against the register) – nothing is rewritten.
 * Pure; the one effectful writer is `rememberFunction` in `shelfStore.ts`.
 */
import type { Settings } from "@/domain/types";

export const SHELF_VERSION = 1;
export const FAVORITES_MAX = 24;
export const RECENT_MAX = 12;
/** A register id is a lower-case slug; anything else in a stored row is dropped. */
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface ShelfItem {
  id: string;
  /** ms */
  at: number;
}

export interface Shelf {
  v: 1;
  /** newest first */
  favorites: ShelfItem[];
  /** last used first */
  recent: ShelfItem[];
}

export const EMPTY_SHELF: Readonly<Shelf> = Object.freeze({ v: 1, favorites: [], recent: [] });

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function itemsOf(raw: unknown, max: number): ShelfItem[] {
  const seen = new Set<string>();
  const out: ShelfItem[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const o = obj(x);
    if (typeof o.id !== "string" || !ID.test(o.id) || o.id.length > 60 || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({ id: o.id, at: typeof o.at === "number" && Number.isFinite(o.at) && o.at > 0 ? Math.floor(o.at) : 0 });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, max);
}

/** The stored shelf of `settings` (sanitised; a broken key reads as empty). */
export function shelfOf(settings: object): Shelf {
  const s = obj((settings as { funktionen?: unknown }).funktionen);
  return { v: 1, favorites: itemsOf(s.favorites, FAVORITES_MAX), recent: itemsOf(s.recent, RECENT_MAX) };
}

/** `settings` with `shelf` stored under `funktionen` (all other keys untouched, also unknown keys inside `funktionen`). */
export function withShelf(settings: Settings, shelf: Shelf): Settings {
  const prev = obj((settings as { funktionen?: unknown }).funktionen);
  return { ...(settings as Settings & { funktionen?: unknown }), funktionen: { ...prev, v: SHELF_VERSION, favorites: shelf.favorites, recent: shelf.recent } } as Settings;
}

export const isFavorite = (shelf: Shelf, id: string): boolean => shelf.favorites.some((f) => f.id === id);

/** Adds or removes a favourite (the oldest falls out beyond `FAVORITES_MAX`). */
export function toggleFavorite(shelf: Shelf, id: string, now: number): Shelf {
  if (!ID.test(id)) return shelf;
  if (isFavorite(shelf, id)) return { ...shelf, favorites: shelf.favorites.filter((f) => f.id !== id) };
  return { ...shelf, favorites: [{ id, at: now }, ...shelf.favorites].slice(0, FAVORITES_MAX) };
}

/** Marks `id` as used now (moves it to the front; the oldest falls out beyond `RECENT_MAX`). Unchanged when it already leads. */
export function markUsed(shelf: Shelf, id: string, now: number): Shelf {
  if (!ID.test(id) || shelf.recent[0]?.id === id) return shelf;
  return { ...shelf, recent: [{ id, at: now }, ...shelf.recent.filter((r) => r.id !== id)].slice(0, RECENT_MAX) };
}
