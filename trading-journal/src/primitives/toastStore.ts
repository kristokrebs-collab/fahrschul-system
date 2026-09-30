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
