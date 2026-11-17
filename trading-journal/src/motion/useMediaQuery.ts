import { useSyncExternalStore } from "react";

interface QueryEntry {
  /** The `matchMedia` implementation the list came from (tests swap it; a new one starts a fresh cache). */
  source: typeof window.matchMedia;
  mql: MediaQueryList;
  /** Stable for the query: `useSyncExternalStore` re-subscribes whenever this identity changes. */
  subscribe: (cb: () => void) => () => void;
  get: () => boolean;
}

/**
 * One `MediaQueryList` and one `change` listener per query string, shared by every component that asks. The previous
 * hook passed a new `subscribe` closure on every render, so React unsubscribed and re-subscribed (a fresh
 * `matchMedia()` list plus listener churn) on EVERY render of every Card, tile, sheet and pressable, and each snapshot
 * read created another list – ≈ 15 ms of `matchMedia` per large commit (saving a trade re-renders the overview).
 */
const entries = new Map<string, QueryEntry>();

function entryFor(query: string): QueryEntry | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  const source = window.matchMedia;
  const hit = entries.get(query);
  if (hit && hit.source === source) return hit;
  const mql = window.matchMedia(query);
  const listeners = new Set<() => void>();
  const onChange = () => {
    for (const l of [...listeners]) l();
  };
  const entry: QueryEntry = {
    source,
    mql,
    subscribe: (cb) => {
      listeners.add(cb);
      if (listeners.size === 1) mql.addEventListener?.("change", onChange);
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0) mql.removeEventListener?.("change", onChange);
      };
    },
    get: () => mql.matches,
  };
  entries.set(query, entry);
  return entry;
}

const noSubscribe = () => () => {};

/** Subscribes to a media query; `fallback` is used where `matchMedia` is unavailable (jsdom, SSR). */
export function useMediaQuery(query: string, fallback = false): boolean {
  const entry = entryFor(query);
  const server = () => fallback;
  return useSyncExternalStore(entry ? entry.subscribe : noSubscribe, entry ? entry.get : server, server);
}

/** `@media (hover: hover)` – pointer effects (Magnetic, Tilt, hover pills) only run here. */
export function useCanHover(): boolean {
  return useMediaQuery("(hover: hover)", false);
}

/** Tailwind `sm` breakpoint (640px). Sheets are centred from here, bottom sheets below. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 640px)", true);
}
