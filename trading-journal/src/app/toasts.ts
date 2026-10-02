/**
 * Adapter between `uiStore.toasts` (bundle kinds `success | error | signal | info`) and the
 * `ToastIsland` primitive (`ok | warn | error`). `signal` (scenario toast, 5200 ms) and `info` share the
 * info glyph. The lifetime comes from the ui store (`TOAST_MS` or the toast's own `duration`) and is passed on, so
 * the island's remaining-time bar runs exactly as long as the toast lives (an `info` toast is a 2.8 s toast even
 * though it shares the 5.2 s `warn` look).
 */
import type { IslandToast } from "@/primitives/Toast";
import { TOAST_MS, type Toast as UiToast, type ToastKind as UiToastKind } from "@/store/uiStore";

const KIND: Record<UiToastKind, IslandToast["kind"]> = { success: "ok", error: "error", signal: "warn", info: "warn" };

/** Visible time of a ui-store toast in ms (`0` = until dismissed); the island counts it down while the toast is in front. */
export function toastLifetime(t: Pick<UiToast, "kind" | "duration">): number {
  return t.duration ?? (t.kind === "signal" ? TOAST_MS.signal : TOAST_MS.default);
}

export function toIslandToast(t: UiToast): IslandToast {
  return { id: t.id, kind: KIND[t.kind], title: t.title, value: t.value, valueTone: t.valueTone, detail: t.detail, duration: toastLifetime(t) };
}
