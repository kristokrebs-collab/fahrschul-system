import { useSyncExternalStore } from "react";

function subscribe(query: string, cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(query);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function read(query: string, fallback: boolean): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return fallback;
  return window.matchMedia(query).matches;
}

/** Subscribes to a media query; `fallback` is used where `matchMedia` is unavailable (jsdom, SSR). */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (cb) => subscribe(query, cb),
    () => read(query, fallback),
    () => fallback,
  );
}

/** `@media (hover: hover)` – pointer effects (Magnetic, Tilt, hover pills) only run here. */
export function useCanHover(): boolean {
  return useMediaQuery("(hover: hover)", false);
}

/** Tailwind `sm` breakpoint (640px). Sheets are centred from here, bottom sheets below. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 640px)", true);
}
