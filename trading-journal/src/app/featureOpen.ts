/**
 * Opening a target of the finders: a function of the register (`features.ts`) or a page (`page:<page>`, `pageTargets.ts`).
 * A function is
 *   - an ACTION (training, assistant, new trade, CSV import, shortcut sheet) – a sheet opens over the page you are on, or
 *   - a PLACE – navigate to its page, wait for the (lazy) page to show the anchor, OPEN what covers it (fold, toggle, tab, the
 *     named choice – `featureReveal.ts`), scroll it under the header, sweep once across its card (`reveal.ts`) and give it the
 *     keyboard focus, so a screen reader starts reading there.
 *
 * No dead end, and no toast: when the card is not there – it appears only after a test run, needs an account, needs a higher
 * plan – the finder still lands on the right page (on the nearest card, else on the page's heading) and the ARRIVAL NOTE
 * (`arrival.ts`) says why and offers the next step as a button (a plan, a login, the assistant). A step that leaves the page
 * (login, plan) notes the original task first (`returnTo.ts`); `ReturnHost` brings the person back when the condition is met.
 * The reveal itself waits until no modal dialog is open (`afterModals`): the person who is brought back after a login still has the
 * welcome sheet over the page, and a target revealed behind a dialog is not reached (isolated page, locked scroll).
 *
 * Used by the command navigation's finder, the page `Funktionen`, the search action `feature` and the assistant's "Wo finde ich …?".
 * Opening counts as "Zuletzt benutzt" through the search's own recent list (`rememberRecent`, local to this browser).
 */
import { showArrival, dismissArrival, type ArrivalAction } from "@/app/arrival";
import { featureSearchId } from "@/app/featureQuery";
import { PLAN_TIER_LABEL, featureById, tierOf, type FeatureAction, type FeatureAnchor, type FeatureEntry } from "@/app/features";
import { NEAR_ANCHOR, focusTarget, isShown, openAround, pageHeading, runSteps } from "@/app/featureReveal";
import { PAGE_LABELS } from "@/app/navGroups";
import { pageOfTargetId } from "@/app/pageTargets";
import { openShortcutSheet } from "@/app/shortcuts";
import { keepAligned, revealCard, whenShown } from "@/app/reveal";
import { openAssistant } from "@/assistant/open";
import { openScreenshotImport } from "@/journal/ocr/store";
import { entitledNow } from "@/billing/entitlements";
import { openUpgrade } from "@/billing/store";
import { cloudEnabled } from "@/cloud/env";
import { openAuthSheet, useCloudSession } from "@/cloud/session";
import { rememberRecent } from "@/search/searchStore";
import { navigate } from "@/store/router";
import { setReturnTo } from "@/store/returnTo";
import { useUi } from "@/store/uiStore";
import { openTraining } from "@/views/ueben/trainingStore";

/** How long to wait for a lazy page and its card before saying that the place is not there (slow phones, cold chunks). */
export const ANCHOR_WAIT_MS = 5000;
/** After the "noch nicht zu sehen" note the finder keeps looking this long (ms): a slow page may still bring the card (stopped by any input). */
export const LATE_WAIT_MS = 25_000;
/** How long to wait for a concealed target to show after its cover was opened (ms). */
export const SETTLE_MS = 1500;
/** How long a reveal waits for an open dialog (the welcome sheet after a login) to go before it scrolls anyway (ms). */
export const MODAL_WAIT_MS = 30_000;
/** When the finder checks that the focus did not get lost with a replaced placeholder (ms). */
export const REFOCUS_MS = 1600;
/** How long the finder keeps the target on its line while the page above it still grows (ms; any touch / key / wheel ends it). */
export const ALIGN_HOLD_MS = 7000;
/** The "So geht's" note closes by itself after this long (ms); a note that explains a missing card stays. */
export const PATH_NOTE_MS = 12_000;

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
    if (f.path) pathNote(f);
  },
  csvImport: () => void import("@/exchanges/store").then((m) => m.openCsvImport()),
  shotImport: () => openScreenshotImport(),
  shortcuts: () => openShortcutSheet(),
  // the demo (F58): its chunk is fetched here, on the first click
  demo: () => void import("@/views/demo/demoStore").then((m) => m.openDemo()),
};

const askAssistant: ArrivalAction = { id: "assistant", label: "Assistent fragen", run: () => openAssistant() };

/** „So geht’s“: the way to a place that has no card to scroll to – shown where the person is, closes by itself. */
function pathNote(f: FeatureEntry): void {
  showArrival({ featureId: f.id, page: useUi.getState().page, title: f.name, text: `So geht’s: ${f.path}`, tone: "info", actions: [], autoCloseMs: PATH_NOTE_MS });
}

/** An open modal dialog (sheet, menu, welcome): while it is there the page behind it is isolated and its scroll is locked. */
const modalOpen = (): boolean => !!document.querySelector('[role="dialog"][aria-modal="true"]');

/**
 * Runs `run` once no modal dialog is open. A target revealed behind a dialog is not reached: the page is `aria-hidden`, the scroll is
 * locked and released to the old position when the dialog goes (the welcome sheet after a login, the menu that is still closing).
 * Immediately when there is none; else it follows the dialog out (rAF, at most `MODAL_WAIT_MS`, then it goes anyway) plus two frames
 * for the lock to be released.
 */
function afterModals(run: () => void): void {
  if (typeof document === "undefined" || !modalOpen()) return run();
  const until = performance.now() + MODAL_WAIT_MS;
  let frames = 0;
  const tick = (): void => {
    if (modalOpen() && performance.now() < until) {
      frames = 0;
      return void requestAnimationFrame(tick);
    }
    if (++frames < 3) return void requestAnimationFrame(tick);
    run();
  };
  requestAnimationFrame(tick);
}

/** Moves the keyboard focus to the page's heading (the landing place when there is no card), once the page shows it. */
function landOnPage(page: string): void {
  whenShown(page, (layer) => layer.querySelector<HTMLElement>("h1"), (h) => focusTarget(h), undefined, ANCHOR_WAIT_MS);
}

/** Is a login what stands between the person and the card? (the register says "Nur in der Cloud-Version mit Konto …"). */
const needsAccount = (f: FeatureEntry): boolean => !!f.needs && /Konto/.test(f.needs);

/** The card is not there (yet): the person stands on the nearest card of the page and is told why. Returns the note's `seq`. */
function plainMiss(f: FeatureEntry): number {
  const reason = f.needs ?? "Die Stelle ist gerade nicht zu sehen – die Seite ist offen.";
  return showArrival({ featureId: f.id, page: f.page, title: `${f.name}: noch nicht zu sehen`, text: reason, tone: "warn", actions: [askAssistant] });
}

/** Scrolls to the nearest always-present card of a function whose own card is missing, else to the page heading. */
function landNear(f: FeatureEntry): void {
  const near = NEAR_ANCHOR[f.id];
  const layer = document.querySelector(`[data-page="${f.page}"][data-page-role="current"]`);
  const el = near && layer ? findAnchor(layer, near) : null;
  if (el) {
    openAround(el, layer ?? document);
    revealCard(el);
    focusTarget(el);
    return;
  }
  const h = pageHeading(f.page);
  if (h) {
    h.scrollIntoView({ block: "start" });
    focusTarget(h);
  }
}

function missNeedsAccount(f: FeatureEntry): number {
  const session = useCloudSession.getState();
  if (!cloudEnabled()) {
    // an honest end: this build has no account at all
    return showArrival({ featureId: f.id, page: f.page, title: `${f.name}: hier nicht verfügbar`, text: f.needs ?? "Dafür braucht die App ein Konto – in dieser Version gibt es keins.", tone: "warn", actions: [askAssistant] });
  }
  if (session.phase === "signedIn") return plainMiss(f);
  return showArrival({
    featureId: f.id,
    page: f.page,
    title: `${f.name}: dafür brauchst du ein Konto`,
    text: "Melde dich an – danach geht es genau hier weiter.",
    tone: "warn",
    actions: [
      {
        id: "login",
        label: "Anmelden",
        run: () => {
          setReturnTo({ kind: "feature", id: f.id }, { on: "signedIn" }, f.name);
          openAuthSheet();
        },
      },
      askAssistant,
    ],
  });
}

/** Waits (rAF) until a concealed target shows after its cover was opened, then runs `done` (also when it never does – the reveal still scrolls). */
function settle(el: HTMLElement, layer: ParentNode, done: () => void): void {
  if (isShown(el)) return done();
  openAround(el, layer);
  const until = performance.now() + SETTLE_MS;
  const tick = (): void => (isShown(el) || performance.now() > until ? done() : void requestAnimationFrame(tick));
  requestAnimationFrame(tick);
}

/**
 * Opens `id` (a register id or `page:<page>`). Returns false for an unknown id. `remember: false` skips the recent list (a
 * preview, a test, the return after a login).
 */
export function openFeature(id: string, opts: { remember?: boolean } = {}): boolean {
  const target = pageOfTargetId(id);
  if (target) {
    if (opts.remember !== false) rememberRecent(id);
    dismissArrival();
    navigate(target);
    landOnPage(target);
    return true;
  }
  const f = featureById(id);
  if (!f) return false;
  if (opts.remember !== false) rememberRecent(featureSearchId(f.id));
  dismissArrival();
  if (f.action) {
    ACTIONS[f.action](f);
    return true;
  }
  navigate(f.page);
  if (f.gate && !entitledNow(f.gate)) {
    // the page (or its card) shows the upgrade teaser – the note says why nothing is scrolled to and leads to the plan; after the
    // plan is booked `ReturnHost` brings the person back here
    const gate = f.gate;
    showArrival({
      featureId: f.id,
      page: f.page,
      title: `${f.name}: ab dem Tarif ${PLAN_TIER_LABEL[tierOf(gate)]}`,
      text: `Das steckt im Tarif ${PLAN_TIER_LABEL[tierOf(gate)]}. Nach dem Tarifwechsel geht es genau hier weiter.`,
      tone: "warn",
      actions: [
        {
          id: "plan",
          label: "Tarif ansehen",
          run: () => {
            setReturnTo({ kind: "feature", id: f.id }, { on: "entitled", feature: gate }, f.name);
            openUpgrade(gate);
          },
        },
        askAssistant,
      ],
    });
    landOnPage(f.page);
    return true;
  }
  if (!f.anchor) {
    landOnPage(f.page);
    if (f.path) pathNote(f);
    return true;
  }
  const a = f.anchor;
  const done = new Set<string>();
  const found = (el: HTMLElement): void => {
    const layer = el.closest("[data-page]") ?? document;
    settle(el, layer, () => {
      revealCard(el);
      // a long page mounts its cards for a while on a slow phone: follow its height longer than the search does
      keepAligned(el, ALIGN_HOLD_MS);
      focusTarget(el);
      // the target may be a placeholder that is replaced a moment later (the alignment follows it, `keepAligned`): the focus follows too,
      // but only if it was lost with the placeholder
      setTimeout(() => {
        if (el.isConnected) return;
        const l = document.querySelector(`[data-page="${f.page}"][data-page-role="current"]`);
        const next = l ? findAnchor(l, a) : null;
        if (next && (!document.activeElement || document.activeElement === document.body)) focusTarget(next);
      }, REFOCUS_MS);
      // the place is only the start: what to tap next ("Beste Setups → Setup öffnen → Diese Idee testen") is said once
      if (f.path) pathNote(f);
    });
  };
  // the page is open; the reveal (scroll, focus) waits until no dialog covers it – the person who is brought back after a login still has the welcome sheet up
  afterModals(() =>
    whenShown(
      f.page,
      (layer) => {
        const el = findAnchor(layer, a);
        // a target that exists only after a choice on the page: press the named control once, keep looking
        if (!el) runSteps(f.id, layer, done);
        return el;
      },
      found,
      () => {
        landNear(f);
        const seq = needsAccount(f) ? missNeedsAccount(f) : plainMiss(f);
        // the card may only be slow (a long page mounts its cards one after another, a cold chunk on a slow phone): when it still
        // arrives, the note is taken back and the card is shown – unless the person has started to do something else
        lateReveal(f.page, (layer) => findAnchor(layer, a), (el) => {
          dismissArrival(seq);
          found(el);
        });
      },
      ANCHOR_WAIT_MS,
    ),
  );
  return true;
}

/**
 * After the "not there" note: keeps looking for the card for `LATE_WAIT_MS` more and calls `then` when it appears – but never against
 * the person: a wheel, touch, key or press, leaving the page, or the end of the time stops it (a card that appears because the person
 * started a test run must not pull the page away from them).
 */
function lateReveal(page: string, find: (layer: Element) => HTMLElement | null, then: (el: HTMLElement) => void): void {
  if (typeof window === "undefined") return;
  const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  const until = performance.now() + LATE_WAIT_MS;
  let over = false;
  const stop = (): void => {
    over = true;
    events.forEach((e) => window.removeEventListener(e, stop));
  };
  events.forEach((e) => window.addEventListener(e, stop, { passive: true }));
  const tick = (): void => {
    if (over) return;
    if (useUi.getState().page !== page || performance.now() > until) return stop();
    const layer = document.querySelector(`[data-page="${page}"][data-page-role="current"]`);
    const el = layer ? find(layer) : null;
    if (el) {
      stop();
      then(el);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Human name of a target for the notes and the status line ("Einstellungen", "Positionsrechner"). */
export function targetName(id: string): string {
  const p = pageOfTargetId(id);
  return p ? PAGE_LABELS[p] : (featureById(id)?.name ?? id);
}
