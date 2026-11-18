/**
 * Reaching a CONCEALED target (A4). A function's anchor is not always on the screen when the page is: it can sit in a folded card
 * (`Fold`, a `details`), behind a closed toggle (`aria-expanded="false"` + `aria-controls`), in a tab panel that is not the
 * selected one, or appear only after a choice on the page ("Eigene Idee" in the lab). Before the finder scrolls, it OPENS the
 * way: folds, toggles and tabs around the target, and – for the few targets that need a choice first – the click the register
 * names in `REVEAL_STEPS`. Then the target takes the keyboard focus (`focusTarget`), so a screen reader starts reading there.
 *
 * Nothing here guesses: it only presses controls that say they control an ancestor of the target (or are named below), once,
 * and never anything with a consequence (no save, no delete, no start).
 */
import { openFoldsAround } from "@/app/reveal";
import type { FeatureAnchor } from "@/app/features";

/** A control to press, by its test id, when the anchor is not there (yet). */
export interface RevealStep {
  click: string;
}

/**
 * Targets that exist only after a choice on the page. The click is a plain selection (a radio tile, a tab) – it changes what the
 * page shows, never what it stores beyond the page's own remembered choice.
 */
export const REVEAL_STEPS: Readonly<Record<string, readonly RevealStep[]>> = {
  // the rule builder and its library button live under the strategy tile "Eigene Idee"
  "indikator-bausteine": [{ click: "labor-strategy-custom" }],
  "strategie-bibliothek": [{ click: "labor-strategy-custom" }],
};

/**
 * Where the finder lands when the anchor itself is not there (a card that appears after a run, needs an account …): the
 * nearest card that is always there, so the person ends in the right area of the page and not at its top.
 */
export const NEAR_ANCHOR: Readonly<Record<string, FeatureAnchor>> = {
  diagnose: { testid: "labor-config" },
  "lauf-vergleich": { testid: "labor-config" },
  "passt-zu-dir": { testid: "labor-config" },
  belastungstest: { testid: "labor-config" },
  pruefbericht: { testid: "labor-config" },
  robustheit: { testid: "labor-config" },
  "parameter-raster": { testid: "labor-config" },
  filtervergleich: { testid: "labor-config" },
  "verwaltung-vergleich": { testid: "labor-config" },
  "hintergrund-optimierer": { testid: "labor-config" },
  "muster-entdecker": { testid: "labor-view" },
  "bias-test": { testid: "markt-chart" },
  "ausfuehrbarkeit-live": { testid: "hplan-ticket" },
  "monte-carlo-faecher": { testid: "ana-mc" },
  "signal-ausgang": { testid: "missed-card" },
  "monatsnutzen": { testid: "berichte-view" },
  wochenexperiment: { testid: "week-review" },
};

const esc = (s: string): string => (typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(s) : s.replace(/[^\w-]/g, "\\$&"));

/**
 * Is `el` uncovered: no closed fold, no `hidden` / `inert` / `aria-hidden` ancestor, nothing `display: none` or
 * `visibility: hidden` on the way up. Structural on purpose (no layout read), so it answers the same in a browser and in jsdom.
 */
export function isShown(el: Element): boolean {
  if (!el.isConnected) return false;
  if (el.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  if (el.closest("details:not([open])") && !el.closest("summary")) return false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
  }
  return true;
}

const click = (el: HTMLElement | null | undefined): boolean => {
  if (!el || (el as HTMLButtonElement).disabled) return false;
  el.click();
  return true;
};

/**
 * Opens what covers `el`: its folds, and for every ancestor that has an id the closed toggle or the unselected tab that
 * controls it. Returns true when something was pressed (the caller waits a frame for the DOM to follow).
 */
export function openAround(el: HTMLElement, layer: ParentNode = document): boolean {
  let pressed = false;
  const wasOpen = (d: HTMLDetailsElement | null) => d?.open ?? true;
  const before = wasOpen(el.closest<HTMLDetailsElement>("details[data-fold]"));
  openFoldsAround(el);
  if (!before) pressed = true;
  for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
    if (!a.id) continue;
    const ctl = layer.querySelector<HTMLElement>(`[aria-controls~="${esc(a.id)}"]:is([aria-expanded="false"], [role="tab"][aria-selected="false"])`);
    if (click(ctl)) pressed = true;
  }
  return pressed;
}

/** The steps of a register id, run once each: presses the named controls that exist on the page layer. Returns true when one was pressed. */
export function runSteps(id: string, layer: ParentNode, done: Set<string>): boolean {
  let pressed = false;
  for (const s of REVEAL_STEPS[id] ?? []) {
    if (done.has(s.click)) continue;
    const el = layer.querySelector<HTMLElement>(`[data-testid="${esc(s.click)}"]`);
    if (!el) continue;
    done.add(s.click);
    // a radio tile that is already selected needs no press
    if (el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true") continue;
    if (click(el)) pressed = true;
  }
  return pressed;
}

/**
 * The target takes the focus without scrolling (the reveal scrolls): a non-interactive card gets `tabindex="-1"` for that and
 * no outline (it is a landing place, not a control). The ring of a real control (button, link, field) stays.
 */
export function focusTarget(el: HTMLElement): void {
  if (typeof el.focus !== "function") return;
  const interactive = el.matches("a[href], button, input, select, textarea, summary, [tabindex]");
  if (!interactive) {
    el.setAttribute("tabindex", "-1");
    el.style.outline = "none";
    el.addEventListener("blur", () => el.style.removeProperty("outline"), { once: true });
  }
  el.focus({ preventScroll: true });
}

/** The page's own heading, the landing place when there is no card to go to. */
export function pageHeading(page: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-page="${page}"][data-page-role="current"] h1`);
}
