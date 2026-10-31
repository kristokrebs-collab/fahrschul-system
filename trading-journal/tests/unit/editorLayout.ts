/**
 * The trade form shows only its core by default (Etappe 1b); the older editor specs test the data paths of every field
 * (save, validation, live check …), not where a field is shown. They call `allFieldsInCore()` in a `beforeEach` so each
 * field is on screen as before; the layout itself is tested in `tradeFormLayout.test.ts` / `overlays.tradeForm.test.tsx`.
 */
import { afterEach, beforeEach } from "vitest";
import { FIELD_IDS, layoutKey } from "@/overlays/tradeFormLayout";

export function allFieldsInCore(): void {
  localStorage.setItem(layoutKey(), JSON.stringify({ v: 1, moved: Object.fromEntries(FIELD_IDS.map((id) => [id, "core"])) }));
}

export function clearLayout(): void {
  localStorage.removeItem(layoutKey());
}

/** Registers the `beforeEach` / `afterEach` pair for a whole spec file. */
export function registerFlatForm(): void {
  beforeEach(allFieldsInCore);
  afterEach(clearLayout);
}
