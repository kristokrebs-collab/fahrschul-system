/**
 * Runde 10: the richer chart / number / list motion is scoped to the pages that carry `data-rich` (`PageHost.tsx`: every
 * page layer except the Übersicht and the Cockpit). Components that stand on both kinds of page (the Analyse / Risiko /
 * Wachstum cards are also Cockpit widgets, `Stat` and `TradeRows` are also on the Übersicht) ask the DOM where they are –
 * in an EFFECT, never during render, so the first render is identical everywhere and only the rich pages gain the extra.
 */
export const RICH_SELECTOR = "[data-rich]";

/** `true` when `el` stands inside a rich page layer (`data-rich`). `false` for null, outside the DOM and in jsdom without the attribute. */
export function isRich(el: Element | null | undefined): boolean {
  return !!el && typeof el.closest === "function" && el.closest(RICH_SELECTOR) !== null;
}
