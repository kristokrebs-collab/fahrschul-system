/**
 * App-level overlays owned by other waves (Plan 6.6: mounted once at app level, no portal, inside
 * `MotionRoot`, no layout group). One seam for the shell and for tests (`vi.mock("@/app/overlays")`).
 * Contracts: `src/overlays/README.md`.
 *
 * - `TradeDetail { candles?, onEdit?, className? }` – reads `uiStore.detail`; the shell passes the 1h slice (`useDetailCandles`).
 * - `TradeEditor { livePrice?, livePriceLabel?, onNewSetup? }` – reads `uiStore.editor`; the shell passes the last price.
 * - `SetupEditor` – reads `uiStore.setupEditor`.
 * - `HyblockForm { last?, live?, onClose?, onSave? }` – rendered inside the `hyblock-new` MorphDialog by the Top-Trader card.
 * `ImportDialog` is mounted by the settings page itself (`DataCard` → `ImportDialog`), not here.
 */
export { TradeDetail } from "@/overlays/TradeDetail";
export { TradeEditor } from "@/overlays/TradeEditor";
export { SetupEditor } from "@/overlays/SetupEditor";
export { HyblockForm } from "@/overlays/HyblockForm";
