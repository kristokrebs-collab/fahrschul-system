/**
 * Opens a card of a page for the assistant's „Öffnen“ buttons: navigate, wait for the (lazy) page to show the card, scroll it
 * under the header and sweep once across it – the same move the function register makes (`@/app/featureOpen`), for cards that
 * have no register entry (Forward-Test, Posteingang, Signalbilanz …). It only opens; if the card does not appear in time, one
 * honest toast says so and the page stays open. Lazy: imported by the host on the first button press.
 */
import { ANCHOR_WAIT_MS, findAnchor } from "@/app/featureOpen";
import { revealCard, whenShown } from "@/app/reveal";
import { navigate } from "@/store/router";
import { pushToast, type Page } from "@/store/uiStore";

export function openSpot(page: Page, testid: string): void {
  navigate(page);
  whenShown(page, (layer) => findAnchor(layer, { testid }), revealCard, () => pushToast({ kind: "info", title: "Die Stelle ist gerade nicht sichtbar", detail: "Die Seite ist offen – die Karte erscheint dort, sobald es Daten dafür gibt." }), ANCHOR_WAIT_MS);
}
