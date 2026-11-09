/**
 * Chunk loading that survives a lost connection (Budget-Schnitt follow-up). Every lazy chunk the shell fetches by itself
 * – the idle preload chain, the overlays, the pages – goes through `loadChunk`:
 *
 * - Offline (`navigator.onLine === false`) a load does not start: it waits for the `online` event (`whenOnline`), so the
 *   idle chain never fires requests into a dead network and no page error appears.
 * - A load that fails (the network went away while it was in flight, a flaky host) is tried once more after a short
 *   pause – after `online` when the browser says it is offline. Only then it rejects, and the caller decides (a preload
 *   swallows it, a page shows its error boundary with „Erneut versuchen“).
 * - A stylesheet of a chunk that failed stays failed for good: Vite's preload helper remembers the URL and never adds the
 *   `<link>` again, so the retry would run an unstyled page. The window's capture-phase `error` listener remembers every
 *   `<link rel=stylesheet>` that failed; before a retry (and on `online`) each one is replaced by a fresh link.
 *
 * `vite:preloadError` is deliberately NOT cancelled: with `preventDefault` the helper resolves the import with
 * `undefined` (or without its CSS) instead of rejecting, which would hide the failure from the retry above.
 *
 * `useOffline` feeds the honest placeholder of a page that cannot load yet (`PageSkeleton`); `retryChunksNow` is its
 * „Wiederholen“: it lets every waiting load try at once, whatever the browser believes about the connection.
 */
import { useSyncExternalStore } from "react";

export const isOffline = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;

const waiters = new Set<() => void>();
const listeners = new Set<() => void>();
const failedLinks = new Set<HTMLLinkElement>();
/** `retryChunksNow` pressed: the next waiting loads go ahead although `navigator.onLine` still says offline. */
let forced = false;

const emit = (): void => {
  for (const l of listeners) l();
};

/** Lets every load that waits for the network go ahead now. */
function release(): void {
  const all = [...waiters];
  waiters.clear();
  for (const w of all) w();
}

/** Resolves at once while online, else with the next `online` event (or `retryChunksNow`). */
export function whenOnline(): Promise<void> {
  if (!isOffline() || forced) return Promise.resolve();
  return new Promise((resolve) => waiters.add(resolve));
}

/** „Wiederholen“: every waiting load tries now; a load that fails again rejects into its error boundary. */
export function retryChunksNow(): void {
  forced = true;
  release();
  // the override ends with the loads it released
  setTimeout(() => {
    forced = false;
    emit();
  }, 0);
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** `true` while the browser reports no connection. */
export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, isOffline, () => false);
}

/* ------------------------------------------------------------- stylesheets */

/** Replaces every stylesheet link that failed by a fresh one and resolves once they settled (≤ 4 s). */
export function repairStylesheets(): Promise<void> {
  if (typeof document === "undefined" || failedLinks.size === 0) return Promise.resolve();
  const fresh: Promise<void>[] = [];
  for (const old of [...failedLinks]) {
    failedLinks.delete(old);
    const href = old.href;
    if (!href) continue;
    old.remove();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.crossOrigin = old.crossOrigin;
    link.href = href;
    fresh.push(
      new Promise<void>((resolve) => {
        const done = (): void => resolve();
        link.addEventListener("load", done);
        link.addEventListener("error", () => {
          failedLinks.add(link);
          done();
        });
        setTimeout(done, 4000);
      }),
    );
    document.head.appendChild(link);
  }
  return Promise.all(fresh).then(() => undefined);
}

/** The links that failed, for tests. */
export function failedStylesheetCount(): number {
  return failedLinks.size;
}

if (typeof window !== "undefined") {
  // resource errors do not bubble – the capture phase of the window sees them all
  window.addEventListener(
    "error",
    (e) => {
      const t = e.target;
      if (t instanceof HTMLLinkElement && t.rel === "stylesheet") failedLinks.add(t);
    },
    true,
  );
  window.addEventListener("online", () => {
    forced = false;
    release();
    void repairStylesheets();
    emit();
  });
  window.addEventListener("offline", emit);
}

/* -------------------------------------------------------------------- load */

export interface LoadChunkOptions {
  /** further attempts after a failure (default 1) */
  retries?: number;
  /** pause before a further attempt (default 1500 ms) */
  backoffMs?: number;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `load` (an `import()`), waiting for the network first. A failure is retried `retries` times (once by default)
 * after `backoffMs` and – offline – after `online`; the last failure is thrown.
 */
export async function loadChunk<T>(load: () => Promise<T>, opts: LoadChunkOptions = {}): Promise<T> {
  const retries = opts.retries ?? 1;
  const backoff = opts.backoffMs ?? 1500;
  for (let attempt = 0; ; attempt++) {
    await whenOnline();
    try {
      return await load();
    } catch (err) {
      if (attempt >= retries) throw err;
      await pause(backoff);
      await whenOnline();
      await repairStylesheets();
    }
  }
}
