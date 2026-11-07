/**
 * Android back for dialogs (decision 26): the system back button / back gesture closes the TOPMOST open dialog first,
 * like a native app; only with no dialog open does back switch the page (hash router).
 *
 * Every open modal session (`useDialogBehaviour` in `motion/a11y.ts`: sheets, morph dialogs, trade detail, command
 * navigation) owns one history entry above the page entry: same URL, state `{ tjBack: depth }`. The layer keeps the
 * number of those entries (`have`, read from `history.state`) equal to the number of open sessions (`want`):
 * - open → `pushState` (same URL, so no `hashchange`, nothing for the router to see);
 * - closed any other way (×, Escape, Speichern, swipe, backdrop, Löschen …) → `history.go(-n)`; the `popstate` of
 *   that own traversal is counted (`pendingBack`) and ignored – no session, no router reacts to it;
 * - back pressed (`popstate` to a smaller depth) → the topmost session's `onBack` runs = its normal close path, the
 *   same as Escape (including the "Änderungen verwerfen?" guard). If the session is still open `BACK_CHECK_MS` later
 *   (the guard kept it), its entry is pushed again, so the next back works again – one push per back press, never a loop;
 * - a page switch while dialog entries are on top (`pushPageEntry`, command navigation link, `Alle Trades →` in a morph
 *   dialog) takes their place: the page entry replaces a single dialog entry, or follows a traversal down to the page
 *   entry for nested ones – back from the new page lands on the page the dialog was opened on, not on a dead entry.
 * Changes are reconciled once per microtask, so a hand-off (detail → editor, navigation → editor: one closes, one
 * opens in the same commit) keeps the entry instead of popping and pushing, and StrictMode's effect replay is free.
 * While dialogs are open the page entry's scroll restoration is "manual" (`holdScroll`): returning to it never makes the
 * browser restore an older scroll position over the page the dialog was opened on.
 * The history never grows: every pushed entry is popped again by the user or by the layer.
 *
 * Inactive until `installBackStack()` (the router installs it): without it sessions are only counted, nothing touches
 * the history (component tests, a shell without the router).
 */

/** `history.state` key of a dialog entry; its value is the entry's depth above the page entry (1 = first dialog). */
export const BACK_STATE_KEY = "tjBack";
/** After a back press: a session still open this much later was kept by its guard → its entry is pushed again (ms). */
export const BACK_CHECK_MS = 50;
/** An own traversal whose `popstate` never arrives (ignored by the browser) stops being waited for after this (ms). */
export const BACK_LAND_TIMEOUT_MS = 1000;
/** The page entry gets its scroll restoration mode back this long after the last dialog entry is gone (ms, see `holdScroll`). */
export const SCROLL_MODE_RESTORE_MS = 100;

/** The parts of `window` the layer uses (tests pass a simulated session history). */
export interface BackEnv {
  history: Pick<History, "state" | "pushState" | "replaceState" | "go"> & { scrollRestoration?: ScrollRestoration };
  location: Pick<Location, "href">;
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
}

interface Entry {
  onBack: () => void;
  /** Its history entry is gone (back pressed, or a page entry took its place) while the session may still be open. */
  popped: boolean;
  released: boolean;
}

let env: BackEnv | null = null;
/** Open sessions in open order (the last one is the topmost dialog). */
const entries: Entry[] = [];
/** Dialog entries above the page entry, i.e. the depth of the current history entry. */
let have = 0;
/** Own traversals (`history.go`) whose `popstate` has not arrived yet. */
let pendingBack = 0;
/** A page URL to push once the own traversal has landed on the page entry (`pushPageEntry` with nested dialogs). */
let pendingPage: string | null = null;
/** URL of the page entry below the dialog entries (a back that lands there with another URL in between is not a page switch). */
let baseURL: string | null = null;
/** URL of the last traversal the layer handled: its `hashchange` (if any) belongs to closing a dialog, not to the router. */
let handledURL: string | null = null;
/** An own traversal did not move the history: no further automatic back until the sessions change (never a loop). */
let stalled = false;
let flushQueued = false;
let landTimer: ReturnType<typeof setTimeout> | null = null;
let checkTimer: ReturnType<typeof setTimeout> | null = null;
/** The page entry's own scroll restoration mode while it is held at "manual" under open dialogs (`holdScroll`). */
let savedMode: ScrollRestoration | null = null;
let modeTimer: ReturnType<typeof setTimeout> | null = null;

/** Depth of a history state (0 = a page entry or a foreign state). */
export function depthOf(state: unknown): number {
  if (!state || typeof state !== "object") return 0;
  const v = (state as Record<string, unknown>)[BACK_STATE_KEY];
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0;
}

function wanted(): number {
  let n = 0;
  for (const e of entries) if (!e.popped) n += 1;
  return n;
}

function attempt(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

function clearLand(): void {
  if (landTimer !== null) clearTimeout(landTimer);
  landTimer = null;
}

/** The history API refused (a sandbox, an exotic URL scheme): stop managing it, dialogs work as before without entries. */
function disable(): void {
  const e = env;
  if (!e) return;
  e.removeEventListener("popstate", onPopState);
  reset();
  env = null;
}

function reset(): void {
  clearLand();
  if (checkTimer !== null) clearTimeout(checkTimer);
  checkTimer = null;
  if (modeTimer !== null) clearTimeout(modeTimer);
  modeTimer = null;
  if (savedMode !== null && env) {
    const h = env;
    const mode = savedMode;
    attempt(() => {
      h.history.scrollRestoration = mode;
    });
  }
  savedMode = null;
  have = 0;
  pendingBack = 0;
  pendingPage = null;
  baseURL = null;
  handledURL = null;
  stalled = false;
}

/** Own traversal by `delta` (< 0); its `popstate` is ignored (`pendingBack`). */
function traverse(delta: number): void {
  const h = env;
  if (!h) return;
  pendingBack += 1;
  clearLand();
  landTimer = setTimeout(onLandTimeout, BACK_LAND_TIMEOUT_MS);
  if (!attempt(() => h.history.go(delta))) {
    pendingBack -= 1;
    clearLand();
    stalled = true;
  }
}

function onLandTimeout(): void {
  landTimer = null;
  const h = env;
  if (!h || pendingBack === 0) return;
  // the browser dropped the traversal: carry on from where the history really stands, without another automatic back
  pendingBack = 0;
  stalled = true;
  landed(h);
}

/**
 * The page entry below the dialogs scrolls as "manual" while they are open: a traversal back to it (a back press, or the
 * layer's own back after ×) would otherwise make the browser restore the scroll position saved when the first dialog
 * entry was pushed – and the page did move meanwhile when content above the viewport changed (a saved trade adds a row,
 * scroll anchoring keeps the view): Übersicht at 1 500 px jumped back to 1 200 px on close. The mode is handed back
 * `SCROLL_MODE_RESTORE_MS` after the last dialog entry is gone (after that traversal's restore step), so page-level
 * back / forward keeps the browser's behaviour.
 */
function holdScroll(h: BackEnv): void {
  if (modeTimer !== null) clearTimeout(modeTimer);
  modeTimer = null;
  if (savedMode !== null) return;
  const mode = h.history.scrollRestoration ?? "auto";
  if (attempt(() => (h.history.scrollRestoration = "manual"))) savedMode = mode;
}

function releaseScroll(h: BackEnv): void {
  if (savedMode === null || modeTimer !== null) return;
  modeTimer = setTimeout(() => {
    modeTimer = null;
    if (env !== h || savedMode === null || have !== 0 || wanted() !== 0 || pendingBack > 0 || pendingPage !== null) return;
    const mode = savedMode;
    savedMode = null;
    attempt(() => {
      h.history.scrollRestoration = mode;
    });
  }, SCROLL_MODE_RESTORE_MS);
}

/** Brings the history depth to the number of open sessions (pushes now; pops via an own traversal). */
function reconcile(): void {
  const h = env;
  if (!h || pendingBack > 0) return;
  have = depthOf(h.history.state);
  const want = wanted();
  if (have === 0 && want === 0 && pendingPage === null) releaseScroll(h);
  if (have < want) {
    if (have === 0) {
      baseURL = h.location.href;
      holdScroll(h);
    }
    for (let k = have + 1; k <= want; k += 1) {
      if (!attempt(() => h.history.pushState({ [BACK_STATE_KEY]: k }, ""))) {
        disable();
        return;
      }
      have = k;
    }
    stalled = false;
  } else if (have > want && !stalled) {
    traverse(want - have);
  }
}

function queueFlush(): void {
  if (flushQueued) return;
  flushQueued = true;
  queueMicrotask(() => {
    flushQueued = false;
    reconcile();
  });
}

/**
 * Marks the top `n` sessions whose entries are gone as popped (topmost first) and – for a back press – runs their close
 * paths. `BACK_CHECK_MS` later every popped session that is still open gets its entry back.
 */
function popTop(n: number, back: boolean): void {
  const targets: Entry[] = [];
  for (let i = entries.length - 1; i >= 0 && targets.length < n; i -= 1) {
    const e = entries[i] as Entry;
    if (e.popped) continue;
    e.popped = true;
    targets.push(e);
  }
  if (back) {
    for (const e of targets) {
      try {
        e.onBack();
      } catch (err) {
        // one failing close never blocks the others or the re-push below
        console.error(err);
      }
    }
  }
  if (checkTimer !== null) clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    checkTimer = null;
    let reopened = false;
    for (const e of entries) {
      if (e.popped && !e.released) {
        e.popped = false;
        reopened = true;
      }
    }
    if (reopened) stalled = false;
    reconcile();
  }, BACK_CHECK_MS);
}

/** An own traversal has landed: push a waiting page entry, then settle the depth again. */
function landed(h: BackEnv): void {
  clearLand();
  const before = have;
  have = depthOf(h.history.state);
  if (have === before) stalled = true;
  handledURL = h.location.href;
  if (pendingPage !== null) {
    const url = pendingPage;
    pendingPage = null;
    if (!attempt(() => h.history.pushState(null, "", url))) {
      disable();
      return;
    }
    have = 0;
  }
  reconcile();
}

function onPopState(): void {
  const h = env;
  if (!h) return;
  handledURL = null;
  if (pendingBack > 0) {
    pendingBack -= 1;
    if (pendingBack === 0) landed(h);
    return;
  }
  const d = depthOf(h.history.state);
  if (d < have) {
    // back: close the topmost dialog(s) – never a page switch, unless the traversal went past the dialogs' page entry
    const n = have - d;
    have = d;
    if (d > 0 || h.location.href === baseURL) handledURL = h.location.href;
    popTop(n, true);
    return;
  }
  if (d > have) {
    // forward into the entries of dialogs that are closed by now: nothing to reopen, step back to the open ones
    have = d;
    handledURL = h.location.href;
    stalled = false;
    queueFlush();
  }
  // same depth: a traversal between page entries – the router's `hashchange`
}

/**
 * Registers an open dialog session; `onBack` is its normal close path (the same as Escape, guard included). Returns
 * the release, called when the session closes by any path (its entry is consumed unless back already took it).
 */
export function openBackEntry(onBack: () => void): () => void {
  const e: Entry = { onBack, popped: false, released: false };
  entries.push(e);
  stalled = false;
  queueFlush();
  return () => {
    if (e.released) return;
    e.released = true;
    const i = entries.indexOf(e);
    if (i >= 0) entries.splice(i, 1);
    stalled = false;
    queueFlush();
  };
}

/**
 * Router: a new page entry (`navigate` to another tab). With dialog entries on top, the page entry takes their place
 * (see the module comment); otherwise a plain `pushState`.
 */
export function pushPageEntry(url: string): void {
  const h = env;
  if (!h) {
    history.pushState(null, "", url);
    return;
  }
  // a later hashchange is never the one of a traversal handled before this page switch
  handledURL = null;
  if (pendingBack > 0 || pendingPage !== null) {
    pendingPage = url;
    return;
  }
  have = depthOf(h.history.state);
  if (have === 0) {
    h.history.pushState(null, "", url);
    return;
  }
  const dropped = have;
  popTop(dropped, false);
  if (dropped === 1) {
    h.history.replaceState(null, "", url);
    have = 0;
    baseURL = null;
    return;
  }
  pendingPage = url;
  traverse(-dropped);
}

/** Router: replaces the current entry's URL (filter mirror), keeping a dialog entry's marker. */
export function replaceEntryURL(url: string): void {
  const h = env;
  if (h && pendingPage !== null) {
    pendingPage = url;
    return;
  }
  const hist = h ? h.history : history;
  hist.replaceState(hist.state, "", url);
}

/**
 * Router: whether a `hashchange` to `newURL` belongs to a traversal the layer handled (a back that closed a dialog whose
 * entry carried a newer URL, an own traversal) – then it is no page switch. Answers once.
 */
export function consumeHandledHashChange(newURL: string): boolean {
  if (handledURL === null || newURL !== handledURL) return false;
  handledURL = null;
  return true;
}

/** Depth of the current history entry as the layer sees it, and the open sessions (diagnostics, tests). */
export function backStackState(): { have: number; want: number; pending: number } {
  return { have, want: wanted(), pending: pendingBack };
}

/**
 * Starts managing the history (`installRouter` calls it). A reload while a dialog was open leaves the current entry
 * a dialog entry: the layer steps back to the page entry. Returns the uninstall.
 */
export function installBackStack(e?: BackEnv): () => void {
  const target = e ?? (typeof window === "undefined" ? null : (window as unknown as BackEnv));
  if (!target) return () => {};
  if (env) env.removeEventListener("popstate", onPopState);
  reset();
  env = target;
  target.addEventListener("popstate", onPopState);
  // a reload on a dialog entry: its page entry was held at "manual" by the previous load (the app's default is "auto")
  if (depthOf(target.history.state) > 0) savedMode = "auto";
  reconcile();
  return () => {
    if (env !== target) return;
    target.removeEventListener("popstate", onPopState);
    reset();
    env = null;
  };
}
