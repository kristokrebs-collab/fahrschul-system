/**
 * Samsung-Internet-safe effects (decision 7): `data-safe-fx` on `<html>`, set by `@/app/pwa` on import – before the
 * first paint – for Samsung Internet or `?safefx=1`, toggled live by the layer diagnostics. Under it, effects fall back
 * to opacity / transform only: base.css drops backdrop filters, masks and the noise film of the fixed layers, and the
 * motion primitives drop their blur filters – a `filter: blur()` animated over a large layer (a card revealed while the
 * page scrolls, a page or sheet section fading in) is the most expensive thing that compositor runs.
 */
export const SAFE_FX_ATTR = "data-safe-fx";

/** Whether the safe effects apply right now (read at render / animation start; false outside a browser). */
export function isSafeFx(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute(SAFE_FX_ATTR);
}
