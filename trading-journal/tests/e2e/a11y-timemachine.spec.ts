/**
 * Accessibility (axe-core, WCAG 2.1 A + AA, colour contrast included) of the Zeitmaschine: the Labor section with its form, the
 * finished card (odds, fan chart, histogram, cases, earlier occasions, comparison with its warning) and the sheet of the trade
 * detail – in the dark AND the light theme, on phone and desktop. Each scan is scoped to the surface. The market is the mock with
 * real BTCUSDT 4h bars (no network, no clock).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openRoute, seed } from "./helpers";
import { themeSettled, UX_PROJECTS } from "./uxHarness";

const THEMES = ["dark", "light"] as const;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function expectAccessible(page: Page, include: string, what: string): Promise<void> {
  // let the entrance motion settle (contrast is measured on the final colours)
  await page.waitForTimeout(1500);
  const res = await new AxeBuilder({ page }).include(include).withTags(TAGS).analyze();
  const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(lines, `${what}: axe violations`).toEqual([]);
}

test.describe("Barrierefreiheit: Zeitmaschine (axe)", () => {
  test.setTimeout(180_000);

  for (const theme of THEMES) {
    test(`Labor-Abschnitt: Formular, fertige Karte, Vorfälle aufgeklappt (${theme})`, async ({ page }, info) => {
      test.skip(!UX_PROJECTS.includes(info.project.name), "runs on mobile + desktop");
      await seed(page, { boxes: true, extra: { "tj2-theme": JSON.stringify({ pref: theme, accent: "signal" }) } });
      await openRoute(page, "/#labor", "Labor");
      await themeSettled(page);
      await page.getByTestId("tm-section").scrollIntoViewIfNeeded();
      await expectAccessible(page, '[data-testid="tm-section"]', "Formular");

      await page.getByTestId("tm-entry").fill("82.900");
      await page.getByTestId("tm-stop").fill("80.500");
      await page.getByTestId("tm-target").fill("87.700");
      await page.getByTestId("tm-load-start").click();
      await expect(page.getByTestId("tm-card")).toHaveAttribute("data-status", "done", { timeout: 120_000 });
      // the pictures draw once they have been in view
      await page.getByTestId("tm-fan").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("tm-fan")).toHaveAttribute("data-drawn", "true");
      await page.getByTestId("tm-hist").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("tm-hist")).toHaveAttribute("data-drawn", "true");
      await expectAccessible(page, '[data-testid="tm-card"]', "fertige Karte");

      await page.getByTestId("tm-events-toggle").click();
      await page.getByTestId("tm-assumptions").locator("summary").click();
      await expectAccessible(page, '[data-testid="tm-card"]', "Vorfälle und Annahmen aufgeklappt");
    });
  }
});
