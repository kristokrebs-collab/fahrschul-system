/**
 * P13 accessibility (axe-core, WCAG 2.1 A + AA) on everything the package adds, in the dark AND the light theme:
 * the Cockpit page (view + "Anordnen" + the catalog), the search dialog (open + with hits), the shortcut sheet, the
 * onboarding tour, the two settings cards and the error states. Each scan is scoped to the P13 surface (the pages
 * underneath belong to their packages); colour contrast included. Dev harness `/dev/ux.html` (see `uxHarness.ts`).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openUx, themeSettled, UX_PROJECTS, UX_SKIP } from "./uxHarness";

const THEMES = ["dark", "light"] as const;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Runs axe on `include` and fails with a readable list (rule, impact, the first targets). */
async function expectAccessible(page: Page, include: string, what: string, disable: string[] = []): Promise<void> {
  // let entrance animations settle (contrast is measured on the final colours)
  await page.waitForTimeout(900);
  const res = await new AxeBuilder({ page }).include(include).withTags(TAGS).disableRules(disable).analyze();
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
    test(`Cockpit, Anordnen und Katalog (${theme})`, async ({ page }) => {
      test.skip(!(await openUx(page, "cockpit", "", { theme })), UX_SKIP);
      await expectAccessible(page, '[data-testid="cockpit"]', "Cockpit");
      await page.getByTestId("cockpit-arrange").click();
      await expectAccessible(page, '[data-testid="cockpit"]', "Cockpit – Anordnen");
      await page.getByTestId("cockpit-arrange").click();
      await page.getByTestId("cockpit-add").click();
      await page.getByTestId("widget-catalog").waitFor();
      await expectAccessible(page, '[role="dialog"]', "Widget-Katalog");
    });

    test(`Suche und Tastenkürzel (${theme})`, async ({ page }) => {
      test.skip(!(await openUx(page, "app", "overview", { theme })), UX_SKIP);
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
      test.skip(
        !(await openUx(page, "app", "settings", {
          theme,
          empty: true,
          firstRun: true,
        })),
        UX_SKIP,
      );
      const tour = page.getByRole("dialog", { name: "Einführung" });
      await tour.waitFor({ timeout: 20_000 });
      await expectAccessible(page, '[role="dialog"]:has([data-testid="onboarding"])', "Einführung – Start");
      for (const step of ["konten", "setups", "boerse", "ziel"]) {
        await page.getByTestId("tour-next").click();
        await expect(page.getByTestId("onboarding")).toHaveAttribute("data-step", step);
        await expectAccessible(page, '[role="dialog"]:has([data-testid="onboarding"])', `Einführung – ${step}`);
      }
    });

    test(`Einstellungskarten und Fehlerzustände (${theme})`, async ({ page }) => {
      test.skip(!(await openUx(page, "cards", "", { theme })), UX_SKIP);
      await themeSettled(page);
      await expectAccessible(page, "main", "Darstellung + Einführung & Hilfe");
      await page.goto(`/dev/ux.html?view=crash`);
      await page.getByRole("alert").waitFor();
      await expectAccessible(page, "main", "Fehler (Seite)");
      await page.goto(`/dev/ux.html?view=crash-widget`);
      await page.getByRole("alert").waitFor();
      await expectAccessible(page, "main", "Fehler (Widget)");
    });
  }
});
