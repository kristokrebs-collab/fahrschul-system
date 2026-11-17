/**
 * P13 accessibility (axe-core, WCAG 2.1 A + AA) on everything the package adds, in the dark AND the light theme:
 * the Cockpit page (view + "Anordnen" + the catalog), the search dialog (open + with hits), the shortcut sheet, the
 * onboarding tour, the two settings cards and the error states. Each scan is scoped to the P13 surface (the pages
 * underneath belong to their packages); colour contrast included. Real routes of the production build (`uxHarness.ts`):
 * the page error state is a lazy chunk that cannot be loaded, the widget error state a throwing cockpit widget.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openUx, themeSettled, UX_PROJECTS } from "./uxHarness";

const THEMES = ["dark", "light"] as const;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Scrolls through the page once, so the deferred cells (`content-visibility`) and revealed cards exist when axe looks. */
async function mountEverything(page: Page): Promise<void> {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h + 1200; y += 600) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(500);
}

/** Runs axe on `include` (one selector or several) and fails with a readable list (rule, impact, the first targets). */
async function expectAccessible(page: Page, include: string | string[], what: string, disable: string[] = []): Promise<void> {
  // let entrance animations settle (contrast is measured on the final colours)
  await page.waitForTimeout(900);
  let builder = new AxeBuilder({ page });
  for (const sel of Array.isArray(include) ? include : [include]) builder = builder.include(sel);
  const res = await builder.withTags(TAGS).disableRules(disable).analyze();
  const lines = res.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} → ${v.nodes
        .slice(0, 4)
        .map((n) => n.target.join(" "))
        .join(" | ")}`,
  );
  expect(lines, `${what}: axe violations`).toEqual([]);
}

test.describe("Barrierefreiheit (axe)", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "P13 runs on mobile + desktop");
  });

  for (const theme of THEMES) {
    // Round 5: the start page and the cockpit are scanned like every other page – with the header and the footer around them
    // (the header carried a 3,1 : 1 text in the dark and a 3,9 : 1 status pill in the light theme)
    test(`Startseite mit Kopf- und Fußzeile (${theme})`, async ({ page }) => {
      await openUx(page, "app", "overview", { theme });
      await themeSettled(page);
      await expect(page.locator('[data-page="overview"][data-page-role="current"] h1').first()).toBeAttached({ timeout: 30_000 });
      await mountEverything(page);
      await expectAccessible(page, ['[data-page="overview"][data-page-role="current"]', "header", "footer"], "Startseite");
    });

    test(`Cockpit, Anordnen und Katalog (${theme})`, async ({ page }) => {
      await openUx(page, "cockpit", "", { theme });
      await mountEverything(page);
      await expectAccessible(page, ['[data-testid="cockpit"]', "header", "footer"], "Cockpit");
      await page.getByTestId("cockpit-arrange").click();
      await expectAccessible(page, ['[data-testid="cockpit"]', "header"], "Cockpit – Anordnen");
      await page.getByTestId("cockpit-arrange").click();
      await page.getByTestId("cockpit-add").click();
      await page.getByTestId("widget-catalog").waitFor();
      await expectAccessible(page, '[role="dialog"]', "Widget-Katalog");
    });

    test(`Suche und Tastenkürzel (${theme})`, async ({ page }) => {
      await openUx(page, "app", "overview", { theme });
      await page.locator("body").press("/");
      const dialog = page.getByRole("dialog", { name: "Suche" });
      await dialog.waitFor();
      // The result list scrolls through the combobox (aria-activedescendant; the active option is scrolled into view on
      // every arrow key) – the ARIA combobox pattern keeps the focus in the field, so the scroller has no tab stop of
      // its own by design. axe cannot see that and reports `scrollable-region-focusable`; that one rule is off here.
      const comboboxScroll = ["scrollable-region-focusable"];
      await expectAccessible(page, '[role="dialog"][aria-label="Suche"]', "Suche (leer)", comboboxScroll);
      await dialog.getByRole("combobox").fill("sweep");
      await expectAccessible(page, '[role="dialog"][aria-label="Suche"]', "Suche (Treffer)", comboboxScroll);
      await dialog.getByRole("combobox").press("Escape");
      await expect(dialog).toBeHidden();
      await page.locator("body").press("Shift+?");
      await page.getByTestId("shortcut-sheet").waitFor();
      await expectAccessible(page, '[role="dialog"]:has([data-testid="shortcut-sheet"])', "Tastenkürzel");
    });

    test(`Einführung (${theme})`, async ({ page }) => {
      await openUx(page, "app", "settings", {
          theme,
          empty: true,
          firstRun: true,
        });
      // the tour no longer opens by itself (Etappe 1a): started from its card
      await page.getByRole("button", { name: "Einführung starten" }).click();
      const tour = page.getByRole("dialog", { name: "Einführung" });
      await tour.waitFor({ timeout: 20_000 });
      await expectAccessible(page, '[role="dialog"]:has([data-testid="onboarding"])', "Einführung – Start");
      for (const step of ["konten", "setups", "boerse", "mehr", "ziel"]) {
        await page.getByTestId("tour-next").click();
        await expect(page.getByTestId("onboarding")).toHaveAttribute("data-step", step);
        await expectAccessible(page, '[role="dialog"]:has([data-testid="onboarding"])', `Einführung – ${step}`);
      }
    });

    test(`Einstellungskarten und Fehlerzustände (${theme})`, async ({ page }) => {
      await openUx(page, "cards", "", { theme });
      await themeSettled(page);
      await expectAccessible(page, "main", "Darstellung + Einführung & Hilfe");
      await openUx(page, "crash", "", { theme });
      await expectAccessible(page, '[data-page="analyse"][data-page-role="current"]', "Fehler (Seite)");
      await openUx(page, "crash-widget", "", { theme });
      await expectAccessible(page, '[data-widget="e2e-crash"]', "Fehler (Widget)");
    });
  }
});
