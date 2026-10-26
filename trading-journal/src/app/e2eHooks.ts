/**
 * Test hooks of the end-to-end suite (P14). The Playwright specs run against the production build and sometimes
 * have to read or write a store the way the app itself does (a trade saved "from another tab", the risk guard's
 * override, a throwing cockpit widget for the error state). The hooks are put on `window` ONLY when the e2e seed set
 * the flag `localStorage["__e2e-hooks"] = "1"` before the first script ran (`tests/e2e/helpers.ts` `seed`) – a normal
 * visit never gets them. They expose nothing a visitor could not already reach through the dev tools of their own
 * browser (the journal lives in this browser), so the flag is a tidiness rule, not a security boundary.
 *
 *   __tjJournal  journal store (App)            __tjUi     ui store (App)          __tjTheme  theme store (App)
 *   __tjGuard    risk guard store (feature hosts chunk)
 *   __tjCockpitRegistry  `registerWidget` of the cockpit (Cockpit chunk)
 */
export const E2E_HOOKS_FLAG = "__e2e-hooks";

/** Whether the e2e seed asked for the hooks (false on every error: private mode, blocked storage, no window). */
export function e2eHooksEnabled(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(E2E_HOOKS_FLAG) === "1";
  } catch {
    return false;
  }
}

/** Puts `hooks` on `window` when the flag is set; a no-op otherwise. */
export function installE2eHooks(hooks: Record<string, unknown>): void {
  if (!e2eHooksEnabled()) return;
  Object.assign(window as unknown as Record<string, unknown>, hooks);
}
