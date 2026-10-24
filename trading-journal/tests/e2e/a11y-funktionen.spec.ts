/**
 * Accessibility (axe-core, WCAG 2.1 A + AA, colour contrast included) of what the function overview adds: the page
 * "Funktionen" (tiles, a group with an unfolded detail, search results), the "Inhalt" strip of a long page and the finder of the
 * command navigation – in the dark AND the light theme, on phone and desktop. Each scan is scoped to the surface.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openUx, themeSettled, UX_PROJECTS } from "./uxHarness";

const THEMES = ["dark", "light"] as const;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function expectAccessible(page: Page, include: string, what: string): Promise<void> {
  // let entrance animations settle (contrast is measured on the final colours)
  await page.waitForTimeout(1200);
  const res = await new AxeBuilder({ page }).include(include).withTags(TAGS).analyze();
  const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(lines, `${what}: axe violations`).toEqual([]);
}

test.describe("Barrierefreiheit: Funktionen (axe)", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  for (const theme of THEMES) {
    test(`Seite Funktionen: Kacheln, Gruppe mit Details, Treffer (${theme})`, async ({ page }) => {
      await openUx(page, "app", "funktionen", { theme });
      await themeSettled(page);
      const view = page.getByTestId("funktionen-view");
      await expect(view).toBeVisible({ timeout: 25_000 });
      await expectAccessible(page, '[data-testid="funktionen-view"]', "Kacheln");
      await page.locator('[data-testid="funktionen-tile"][data-group="testen"]').click();
      await expect(page.getByTestId("funktionen-group-view")).toBeVisible();
      await page.getByTestId("feature-details").first().click();
      await expect(page.getByTestId("feature-detail-panel")).toBeVisible();
      await expectAccessible(page, '[data-testid="funktionen-view"]', "Gruppe mit Details");
      await page.getByTestId("funktionen-back").click();
      await page.getByRole("searchbox", { name: "Was willst du tun?" }).fill("warum verliere ich");
      await expect(page.getByTestId("funktionen-results")).toBeVisible();
      await expectAccessible(page, '[data-testid="funktionen-view"]', "Treffer");
    });

    test(`Inhalt-Leiste einer langen Seite (${theme})`, async ({ page }) => {
      await openUx(page, "app", "labor", { theme });
      await themeSettled(page);
      await expect(page.getByTestId("section-nav")).toBeVisible({ timeout: 25_000 });
      await expectAccessible(page, '[data-testid="section-nav"]', "Inhalt-Leiste");
    });

    test(`Finder in der Navigation (${theme})`, async ({ page }) => {
      await openUx(page, "app", "overview", { theme });
      await themeSettled(page);
      await page.getByRole("button", { name: /Navigation öffnen|Menü/ }).first().click();
      const nav = page.getByRole("dialog", { name: "Navigation" });
      await expect(nav).toBeVisible();
      await nav.getByRole("searchbox", { name: "Was willst du tun?" }).fill("Wochenbericht");
      await expect(nav.getByTestId("nav-finder-results")).toBeVisible({ timeout: 15_000 });
      await expectAccessible(page, '[data-testid="nav-finder"]', "Finder");
    });
  }
});
