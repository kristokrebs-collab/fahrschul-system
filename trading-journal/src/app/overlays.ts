/**
 * App-level overlays owned by other waves (Plan 6.6: mounted once at app level, no portal, inside
 * `MotionRoot`, no layout group). One seam for the shell and for tests (`vi.mock("@/app/overlays")`).
 * Contracts: `src/overlays/README.md`.
 *
 * - `TradeDetail { candles?, onEdit?, className? }` – reads `uiStore.detail`; the shell passes the 1h slice (`useDetailCandles`).
 * - `TradeEditor { livePrice?, livePriceLabel?, onNewSetup? }` – reads `uiStore.editor`; the shell passes the last price.
 * - `SetupEditor` – reads `uiStore.setupEditor`.
 * - `HyblockForm { last?, live?, onClose?, onSave? }` – rendered inside the `hyblock-new` MorphDialog by the Top-Trader card.
 * Budget-Schnitt (Runde 11): the three overlays below are chunks of their own (`@/app/overlayLoad`: fetched at idle, on
 * intent or when they open; the shell mounts them through `ArmedOverlay`), so the first load carries none of their form
 * code. They are `React.lazy` components behind `Suspense` – a failed download is tried again on the next render.
 * `ImportDialog` is mounted by the settings page itself (`DataCard` → `ImportDialog`), not here.
 */
import { createElement, lazy, type ComponentType, type LazyExoticComponent } from "react";
import { loadOverlay } from "@/app/overlayLoad";
import type { SetupEditorProps } from "@/overlays/SetupEditor";
import type { TradeDetailProps } from "@/overlays/TradeDetail";
import type { TradeEditorProps } from "@/overlays/TradeEditor";

export { HyblockForm } from "@/overlays/HyblockForm";

/** A lazy overlay that forgets a failed download (a deploy replaced the chunk): the next render fetches it again. */
function deferred<P extends object>(pick: () => Promise<ComponentType<P>>): ComponentType<P> {
  let current: LazyExoticComponent<ComponentType<P>> | null = null;
  const get = (): LazyExoticComponent<ComponentType<P>> => {
    if (!current) {
      const next = lazy(() =>
        pick().then(
          (component) => ({ default: component }),
          (err: unknown) => {
            if (current === next) current = null;
            throw err;
          },
        ),
      );
      current = next;
    }
    return current;
  };
  return function Deferred(props: P) {
    return createElement(get() as ComponentType<P>, props);
  };
}

const TradeDetail = deferred<TradeDetailProps>(() => loadOverlay("detail").then((m) => m.TradeDetail));
const TradeEditor = deferred<TradeEditorProps>(() => loadOverlay("editor").then((m) => m.TradeEditor));
const SetupEditor = deferred<SetupEditorProps>(() => loadOverlay("setup").then((m) => m.SetupEditor));

export { TradeDetail, TradeEditor, SetupEditor };
