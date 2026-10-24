/**
 * Opening a function of the register (`features.ts`): the one place that knows how. A function is
 *   - an ACTION (training, assistant, new trade, CSV import, shortcut sheet) – a sheet opens over the page you are on, or
 *   - a PLACE – navigate to its page, wait for the (lazy) page to show the anchor, scroll it under the header and sweep once
 *     across its card (`reveal.ts`, the same move the search makes for settings sections).
 * Nothing is dead-ended: a plan the user lacks, a card that appears only after a lab run, a path without anchor – each says so
 * in one honest toast instead of silently staying at the top of the page.
 *
 * Used by the page `Funktionen`, the search action `feature` and the assistant's "Wo finde ich …?". Opening counts as
 * "Zuletzt benutzt" through the search's own recent list (`rememberRecent`, local to this browser) – no extra tracker.
 */
import { featureSearchId } from "@/app/featureQuery";
import { PLAN_TIER_LABEL, featureById, tierOf, type FeatureAction, type FeatureAnchor, type FeatureEntry } from "@/app/features";
import { openShortcutSheet } from "@/app/shortcuts";
import { revealCard, whenShown } from "@/app/reveal";
import { openAssistant } from "@/assistant/open";
import { openScreenshotImport } from "@/journal/ocr/store";
import { entitledNow } from "@/billing/entitlements";
import { openUpgrade } from "@/billing/store";
import { rememberRecent } from "@/search/searchStore";
import { navigate } from "@/store/router";
import { pushToast, useUi } from "@/store/uiStore";
import { openTraining } from "@/views/ueben/trainingStore";

/** How long to wait for a lazy page and its card before saying that the place is not there (slow phones, cold chunks). */
export const ANCHOR_WAIT_MS = 5000;

const headingStart = (heading: string) => (layer: Element): HTMLElement | null =>
  Array.from(layer.querySelectorAll<HTMLElement>("h2, h3")).find((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim().startsWith(heading)) ?? null;

/** The element of an anchor inside a page layer: the test id first, else the card heading. */
export function findAnchor(layer: Element, a: FeatureAnchor): HTMLElement | null {
  const byId = a.testid ? layer.querySelector<HTMLElement>(`[data-testid="${a.testid}"]`) : null;
  return byId ?? (a.heading ? headingStart(a.heading)(layer) : null);
}

const ACTIONS: Record<FeatureAction, (f: FeatureEntry) => void> = {
  // the same gate as the trade detail's „Üben“ button
  training: () => (entitledNow("replay") ? openTraining() : openUpgrade("replay")),
  assistant: () => openAssistant(),
  newTrade: (f) => {
    useUi.getState().openEditor();
    if (f.path) pushToast({ kind: "info", title: f.name, detail: f.path });
  },
  csvImport: () => void import("@/exchanges/store").then((m) => m.openCsvImport()),
  shotImport: () => openScreenshotImport(),
  shortcuts: () => openShortcutSheet(),
};

function tell(f: FeatureEntry, detail: string): void {
  pushToast({ kind: "info", title: f.name, detail });
}

/**
 * Opens `id`. Returns false for an unknown id. `remember: false` skips the recent list (a preview, a test).
 */
export function openFeature(id: string, opts: { remember?: boolean } = {}): boolean {
  const f = featureById(id);
  if (!f) return false;
  if (opts.remember !== false) rememberRecent(featureSearchId(f.id));
  if (f.action) {
    ACTIONS[f.action](f);
    return true;
  }
  navigate(f.page);
  if (f.gate && !entitledNow(f.gate)) {
    // the page (or its card) shows the upgrade teaser – say why nothing is scrolled to
    tell(f, `Ab dem Tarif ${PLAN_TIER_LABEL[tierOf(f.gate)]}.`);
    return true;
  }
  if (!f.anchor) {
    if (f.path) tell(f, `So geht’s: ${f.path}`);
    return true;
  }
  const a = f.anchor;
  whenShown(f.page, (layer) => findAnchor(layer, a), revealCard, () => tell(f, f.needs ?? "Die Stelle ist gerade nicht sichtbar – die Seite ist offen."), ANCHOR_WAIT_MS);
  return true;
}
