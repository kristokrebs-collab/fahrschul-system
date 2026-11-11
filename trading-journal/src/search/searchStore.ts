/**
 * Open state of the global search (P13) + the items opened recently (`storageKey("search-recent")`, ids only, newest
 * first, at most 8 – local to this browser, never synced). `pending` is an action chosen in the overlay; the host runs
 * it once the overlay's exit has finished, so the next dialog (trade detail, editor) never stacks on a closing one.
 */
import { create } from "zustand";
import { storageKey } from "@/store/storage";
import type { SearchAction } from "./sources";

export const SEARCH_RECENT_KEY = storageKey("search-recent");
export const RECENT_MAX = 8;

interface SearchState {
  open: boolean;
  /** query to start with (a shortcut may pre-fill it) */
  seed: string;
  pending: SearchAction | null;
  recent: string[];
}

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SEARCH_RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export const useSearch = create<SearchState>(() => ({ open: false, seed: "", pending: null, recent: readRecent() }));

export function openSearch(seed = ""): void {
  useSearch.setState({ open: true, seed, pending: null });
}

export function closeSearch(pending: SearchAction | null = null): void {
  if (!useSearch.getState().open) return;
  useSearch.setState({ open: false, pending });
}

export function toggleSearch(): void {
  if (useSearch.getState().open) closeSearch();
  else openSearch();
}

export const useSearchOpen = (): boolean => useSearch((s) => s.open);

/** Takes the action chosen on close (once). */
export function takePending(): SearchAction | null {
  const p = useSearch.getState().pending;
  if (p) useSearch.setState({ pending: null });
  return p;
}

export function rememberRecent(id: string): void {
  const next = [id, ...useSearch.getState().recent.filter((x) => x !== id)].slice(0, RECENT_MAX);
  useSearch.setState({ recent: next });
  try {
    localStorage.setItem(SEARCH_RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: recent items last for this session
  }
}
