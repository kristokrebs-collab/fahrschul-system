/**
 * Adapter between `uiStore.toasts` (bundle kinds `success | error | signal | info`) and the
 * `ToastIsland` primitive (`ok | warn | error`). `signal` (scenario toast, 5200 ms) and `info` share the
 * info glyph; durations stay in the ui store (`TOAST_MS`).
 */
import type { Toast as IslandToast } from "@/primitives/toastStore";
import type { Toast as UiToast, ToastKind as UiToastKind } from "@/store/uiStore";

const KIND: Record<UiToastKind, IslandToast["kind"]> = { success: "ok", error: "error", signal: "warn", info: "warn" };

export function toIslandToast(t: UiToast): IslandToast {
  return { id: t.id, kind: KIND[t.kind], title: t.title, value: t.value, valueTone: t.valueTone, detail: t.detail };
}
