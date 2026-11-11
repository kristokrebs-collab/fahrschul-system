/**
 * Shared opener for the P13 specs (theme, search, a11y, cockpit, onboarding) – on the real routes of the production
 * build since P14 (the dev harness `/dev/ux.html` stays for manual work under `npm run dev`):
 *   - `app` + hash   → `/#<hash>`: the integrated app with its hosts (search, shortcuts, onboarding, cloud)
 *   - `cockpit`      → `/#cockpit` (h1 Cockpit)
 *   - `cards`        → `/#settings` (the Darstellung card with its "Modus" radio group, Einführung & Hilfe)
 *   - `crash`        → the page error state: the Analyse chunk cannot be loaded (offline / a deploy replaced it), the
 *                      page boundary shows "ERR" with "Erneut versuchen"
 *   - `crash-widget` → the widget error state: a throwing widget on the cockpit board (registered through the e2e hook
 *                      `__tjCockpitRegistry`, `src/app/e2eHooks.ts`) – the card shows its error, the board stays
 * Every view must come up – there is no skip any more.
 */
import { expect, type Page } from "@playwright/test";
import { seed, type SeedOptions } from "./helpers";

export const UX_PROJECTS = ["mobile", "desktop"];

export interface UxOptions extends SeedOptions {
  /** `tj2-theme` before the first render ("light", "system" or `{ pref, accent }`) */
  theme?: string | { pref: string; accent?: string };
}

/** Id and catalog title of the throwing widget of the `crash-widget` view. */
export const CRASH_WIDGET = { id: "e2e-crash", title: "Monte Carlo" } as const;

export function uxUrl(view = "app", hash = ""): string {
  switch (view) {
    case "cockpit":
    case "crash-widget":
      return "/#cockpit";
    case "cards":
      return "/#settings";
    case "crash":
      return "/#analyse";
    default:
      return hash ? `/#${hash}` : "/";
  }
}

/** Seeds, opens the view and waits for its landmark (fails the test when it does not come up). */
export async function openUx(page: Page, view = "app", hash = "", opts: UxOptions = {}): Promise<void> {
  const { theme, ...seedOpts } = opts;
  const extra: Record<string, unknown> = { ...(seedOpts.extra ?? {}) };
  if (theme) extra["tj2-theme"] = JSON.stringify(theme);
  await seed(page, { ...seedOpts, extra });
  if (view === "crash-widget") {
    // a board with one real card and one whose widget throws (an unknown id stays invisible until it is registered);
    // written on every load – the view may follow another one in the same test, after the seed already ran
    const layout = { v: 1, active: "main", boards: [{ id: "main", name: "Mein Cockpit", items: [{ id: "ov-winrate", span: 4 }, { id: CRASH_WIDGET.id, span: 5 }] }] };
    await page.addInitScript((json) => localStorage.setItem("tj2-cockpit", json), JSON.stringify(layout));
  }
  // a lazy page chunk that cannot be loaded – what a visitor sees offline or after a deploy replaced the chunk
  if (view === "crash") await page.route(/\/assets\/AnalyseView-[^/]+\.js$/, (route) => route.abort("failed"));
  // a full document load every time: a second view in the same test would otherwise be a same-document hash change
  if (page.url() !== "about:blank") await page.goto("about:blank");
  const res = await page.goto(uxUrl(view, hash));
  expect(res?.ok(), `${uxUrl(view, hash)} answers`).toBe(true);
  const timeout = 25_000;
  switch (view) {
    case "cockpit":
      await expect(page.getByRole("heading", { level: 1, name: "Cockpit" })).toBeVisible({ timeout });
      return;
    case "cards":
      await expect(page.getByRole("radiogroup", { name: "Modus" })).toBeVisible({ timeout });
      return;
    case "crash":
      await expect(page.getByRole("alert").first()).toBeVisible({ timeout });
      return;
    case "crash-widget":
      await expect(page.getByRole("heading", { level: 1, name: "Cockpit" })).toBeVisible({ timeout });
      await page.waitForFunction(() => "__tjCockpitRegistry" in window, null, { timeout });
      await page.evaluate(({ id, title }) => {
        const register = (window as unknown as { __tjCockpitRegistry: (w: unknown) => void }).__tjCockpitRegistry;
        register({
          id,
          title,
          defaultSpan: 5,
          component: () => {
            throw new Error("Testfehler im Widget");
          },
        });
      }, CRASH_WIDGET);
      await expect(page.getByRole("alert").first()).toBeVisible({ timeout });
      return;
    default:
      await expect(page.locator("main")).toBeVisible({ timeout });
      if (hash) await expect(page.locator(`[data-page="${hash.split("?")[0]}"][data-page-role="current"]`)).toBeVisible({ timeout });
  }
}

/** Resolves once no theme switch is running (the reveal drops `data-theme-switching` at its end). */
export async function themeSettled(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-theme-switching"), null, { timeout: 5_000 });
}
