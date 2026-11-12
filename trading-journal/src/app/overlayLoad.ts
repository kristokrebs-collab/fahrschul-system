/**
 * Loading of the three app-level overlays that are NOT part of the first load (Budget-Schnitt, Runde 11): the trade
 * editor, the trade detail and the setup editor. Each one is a chunk of its own, fetched at idle after the first
 * paint, on intent (hover / focus / press of „Trade eintragen“) or at the latest when its state opens.
 *
 * - `loadOverlay(id)`: ONE download per overlay (a failed one may be tried again); the `lazy` components of
 *   `@/app/overlays` and `preloadOverlay` share it.
 * - Arming (`useOverlayArmed`): an overlay is mounted – closed, as before – only once its chunk has arrived (idle /
 *   intent) or its state is open. Once armed it stays mounted for good, so the exit animation always plays and the
 *   next opening is as instant as it ever was (the sheet is already in the tree).
 * - `openEditorWarm`: the main „Trade eintragen“ entry points wait for the chunk (only when it is still missing, i.e.
 *   before the first idle) and open the editor in the SAME commit that mounts it, so the dock disc → sheet morph and
 *   the form's entrance run exactly as with a warm chunk.
 *
 * `@/app/overlays` stays the seam that tests mock (`vi.mock("@/app/overlays")`); this module is deliberately separate,
 * so a mock of the seam does not need to know about loading.
 */
import { useSyncExternalStore } from "react";
import { isOffline, loadChunk } from "@/lib/chunkLoad";
import { pushToast, useUi } from "@/store/uiStore";

export type OverlayId = "editor" | "detail" | "setup";

// every download waits for the network and is retried once (`loadChunk`): the idle chain never fires into a dead connection
const LOADERS = {
  editor: () => loadChunk(() => import("@/overlays/TradeEditor")),
  detail: () => loadChunk(() => import("@/overlays/TradeDetail")),
  setup: () => loadChunk(() => import("@/overlays/SetupEditor")),
} as const;

/** The module of an overlay chunk (`import("@/overlays/TradeEditor")` …). */
export type OverlayModule<K extends OverlayId> = Awaited<ReturnType<(typeof LOADERS)[K]>>;
type Loaded<K extends OverlayId> = OverlayModule<K>;

const started = new Map<OverlayId, Promise<unknown>>();
const loaded = new Map<OverlayId, unknown>();

/** The module once its download has finished, else `undefined` – lets the lazy components render without suspending. */
export function getLoadedOverlay<K extends OverlayId>(id: K): OverlayModule<K> | undefined {
  return loaded.get(id) as OverlayModule<K> | undefined;
}

/** The overlay's module; one download per overlay (shared by the lazy component and every preload). */
export function loadOverlay<K extends OverlayId>(id: K): Promise<Loaded<K>> {
  let p = started.get(id) as Promise<Loaded<K>> | undefined;
  if (!p) {
    p = LOADERS[id]() as Promise<Loaded<K>>;
    // registered first, so every later `.then` (arming, the lazy component) already finds the module
    p.then(
      (m) => void loaded.set(id, m),
      () => undefined, // the rejection itself is handled below and by the callers – this derived promise must not leak it
    );
    // a failed download (offline, a deploy replaced the chunk) may be tried again
    p.catch(() => started.delete(id));
    started.set(id, p);
  }
  return p;
}

/* ------------------------------------------------------------------ arming */

let armed: ReadonlySet<OverlayId> = new Set();
const listeners = new Set<() => void>();

/** Mounts the overlay (closed) from now on; idempotent. */
export function armOverlay(id: OverlayId): void {
  if (armed.has(id)) return;
  armed = new Set(armed).add(id);
  for (const l of listeners) l();
}

export function isOverlayArmed(id: OverlayId): boolean {
  return armed.has(id);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** `true` once the overlay's chunk was fetched on purpose (idle / intent) or its state has opened it. */
export function useOverlayArmed(id: OverlayId): boolean {
  return useSyncExternalStore(
    subscribe,
    () => armed.has(id),
    () => false,
  );
}

/** Test seam: forget the arming state. */
export function resetOverlayArming(): void {
  armed = new Set();
}

/* ----------------------------------------------------------------- preload */

/** Fetches the overlay's chunk and mounts it closed. Never rejects (a failure is retried on the next intent). */
export function preloadOverlay(id: OverlayId): Promise<void> {
  return loadOverlay(id).then(
    () => armOverlay(id),
    () => undefined,
  );
}

/**
 * Opens the editor like `openEditor`, but when its chunk has not arrived yet (before the first idle) only after it did.
 * A failed download says so instead of leaving a tap without an answer.
 */
export function openEditorWarm(opts?: Parameters<ReturnType<typeof useUi.getState>["openEditor"]>[0]): void {
  const open = () => useUi.getState().openEditor(opts);
  if (isOverlayArmed("editor")) return open();
  // offline the chunk cannot come: the tap is answered honestly, the editor opens by itself once the connection is back
  if (isOffline()) pushToast({ kind: "info", title: "Du bist offline", detail: "Der Editor öffnet sich, sobald du wieder verbunden bist." });
  void loadOverlay("editor").then(
    () => {
      armOverlay("editor");
      open();
    },
    () => pushToast({ kind: "error", title: "Der Editor konnte nicht geladen werden", detail: "Prüfe die Verbindung und versuche es noch einmal." }),
  );
}
