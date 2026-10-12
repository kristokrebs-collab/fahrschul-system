/**
 * Shared opener for the P13 specs (theme, search, a11y, cockpit, onboarding). Until P14 wires the hosts into `App`
 * the specs run against the dev harness `/dev/ux.html` (Vite dev server + `PW_BASE_URL`): `?view=app` (default) is the
 * real app plus GlobalSearchHost / ShortcutHost / OnboardingHost, `?view=cockpit|cards|crash|crash-widget` the single
 * pieces. Without the harness (production preview) `openUx` returns false and the spec skips itself.
 * `PW_UX_URL=/` points the app view at the integrated build once the hosts are mounted there.
 */
import type { Page } from "@playwright/test";
import { seed, type SeedOptions } from "./helpers";

export const UX_PROJECTS = ["mobile", "desktop"];
export const UX_SKIP = "the P13 shell is served by the dev harness /dev/ux.html (Vite dev server) until P14 wires it";

/** The tour is finished: specs that are not about the onboarding never see it start by itself. */
export const ONBOARDING_DONE = {
  "tj2-onboarding": JSON.stringify({ status: "done", at: "", v: 1 }),
};

export interface UxOptions extends SeedOptions {
  /** `tj2-theme` before the first render ("light", "system" or `{ pref, accent }`) */
  theme?: string | { pref: string; accent?: string };
  /** leave the onboarding marker out (first run) */
  firstRun?: boolean;
}

export function uxUrl(view = "app", hash = ""): string {
  const base = view === "app" ? (process.env.PW_UX_URL ?? "/dev/ux.html") : `/dev/ux.html?view=${view}`;
  return `${base}${hash ? `#${hash}` : ""}`;
}

/** Seeds, opens the harness view and waits for its landmark; false when the harness is not served. */
export async function openUx(page: Page, view = "app", hash = "", opts: UxOptions = {}): Promise<boolean> {
  const { theme, firstRun, ...seedOpts } = opts;
  const extra: Record<string, unknown> = {
    ...(firstRun ? {} : ONBOARDING_DONE),
    ...(seedOpts.extra ?? {}),
  };
  if (theme) extra["tj2-theme"] = JSON.stringify(theme);
  await seed(page, { ...seedOpts, extra });
  const res = await page.goto(uxUrl(view, hash));
  if (!res || !res.ok()) return false;
  const landmark =
    view === "cockpit"
      ? page.getByRole("heading", { level: 1, name: "Cockpit" })
      : view === "cards"
        ? page.getByRole("radiogroup", { name: "Modus" })
        : view.startsWith("crash")
          ? page.getByRole("alert")
          : page.locator("main");
  const ok = await landmark
    .first()
    .waitFor({ timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  if (!ok || (view === "app" && process.env.PW_UX_URL)) return ok;
  // a production preview answers every path with the app itself: only the harness sets its e2e hooks
  return page
    .waitForFunction(() => "__tjTheme" in window, null, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
}

/** Resolves once no theme switch is running (the reveal drops `data-theme-switching` at its end). */
export async function themeSettled(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-theme-switching"), null, { timeout: 5_000 });
}
