import { useLayoutEffect } from "react";
import { create } from "zustand";

export type ToastKind = "ok" | "warn" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  /** `.dot-num text-[15px]` value (e.g. `+120,50 USDT`). */
  value?: string;
  valueTone?: "win" | "loss" | "mute";
  /** Secondary line under the title. */
  detail?: string;
}

export type ToastInput = Omit<Toast, "id"> & { id?: number };

interface ToastState {
  toasts: Toast[];
  push: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let seq = 0;

/** Zustand store behind `useToasts()`; the island renders `toasts[0]` and pops it after its timeout. */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = t.id ?? ++seq + Date.now();
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Hook contract: `useToasts()` → `{ id, kind: "ok"|"warn"|"error", title, value?, detail? }[]`. */
export function useToasts(): Toast[] {
  return useToastStore((s) => s.toasts);
}

/** Imperative API for non-React code (stores, effects). */
export const toast = {
  push: (t: ToastInput) => useToastStore.getState().push(t),
  ok: (title: string, extra: Omit<ToastInput, "kind" | "title"> = {}) => useToastStore.getState().push({ kind: "ok", title, ...extra }),
  warn: (title: string, extra: Omit<ToastInput, "kind" | "title"> = {}) => useToastStore.getState().push({ kind: "warn", title, ...extra }),
  error: (title: string, extra: Omit<ToastInput, "kind" | "title"> = {}) => useToastStore.getState().push({ kind: "error", title, ...extra }),
  dismiss: (id: number) => useToastStore.getState().dismiss(id),
  clear: () => useToastStore.getState().clear(),
};

/** Auto-dismiss: 2800 ms, `warn` (scenario signals) 5200 ms (Bundle). */
export function toastDuration(kind: ToastKind): number {
  return kind === "warn" ? 5200 : 2800;
}

/* ------------------------------------------------------------ overlay lane */

/**
 * Where the toast island sits: `dock` (above the dock, default) or `top` (under the top edge) while a modal overlay
 * is open – a bottom sheet's footer or a tall dialog would otherwise sit under / over the island. Overlays register
 * from a layout effect, so an overlay that closes in the same commit a toast is pushed (e.g. `Speichern`) has already
 * left when the island reads the lane in its own layout effect.
 */
export type ToastLane = "dock" | "top";

let overlayCount = 0;
const laneListeners = new Set<() => void>();

export function toastLane(): ToastLane {
  return overlayCount > 0 ? "top" : "dock";
}

/** Registers one open modal overlay; returns the release. */
export function registerOverlay(): () => void {
  overlayCount += 1;
  laneListeners.forEach((l) => l());
  let done = false;
  return () => {
    if (done) return;
    done = true;
    overlayCount = Math.max(0, overlayCount - 1);
    laneListeners.forEach((l) => l());
  };
}

export function subscribeToastLane(listener: () => void): () => void {
  laneListeners.add(listener);
  return () => laneListeners.delete(listener);
}

/** Keeps the island in the `top` lane while `active` (Sheet, MorphDialog, TradeDetail). */
export function useOverlayLane(active: boolean): void {
  useLayoutEffect(() => (active ? registerOverlay() : undefined), [active]);
}
