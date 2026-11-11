/**
 * Accessibility (axe-core, WCAG 2.1 A + AA, colour contrast included) of the demo (F58): the sheet at each of its five steps – the
 * import with its preview and trades, the rule draft in words and as a kit, the test with its figures, the paper trade at the end of
 * the game, the alarm with its messages – in the dark AND the light theme, on phone and desktop.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openUx, themeSettled, UX_PROJECTS } from "./uxHarness";

const THEMES = ["dark", "light"] as const;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const dialog = (page: Page) => page.getByRole("dialog", { name: "Demo mit Beispieldaten" });
const tid = (page: Page, id: string) => dialog(page).getByTestId(id);

async function expectAccessible(page: Page, what: string): Promise<void> {
  // let entrance animations settle (contrast is measured on the final colours)
  await page.waitForTimeout(1200);
  const res = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(TAGS).analyze();
  const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(lines, `${what}: axe violations`).toEqual([]);
}

test.describe("Barrierefreiheit: Demo (axe)", () => {
  test.setTimeout(240_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  for (const theme of THEMES) {
    test(`alle fünf Schritte (${theme})`, async ({ page }) => {
      await openUx(page, "app", "funktionen", { theme });
      await themeSettled(page);
      await page.getByTestId("funktionen-demo-open").click();
      await expect(dialog(page)).toBeVisible({ timeout: 25_000 });

      await tid(page, "demo-import-preview").click();
      await tid(page, "demo-import-trades").click();
      await tid(page, "demo-raw-toggle").click();
      await expectAccessible(page, "Import");

      await tid(page, "demo-next").click();
      await expect(tid(page, "demo-parse")).toBeVisible();
      await expectAccessible(page, "Regelentwurf in Worten");
      await page.getByRole("radio", { name: "Baukasten" }).click();
      await expect(tid(page, "demo-kit")).toBeVisible();
      await expectAccessible(page, "Regelentwurf Baukasten");

      await tid(page, "demo-next").click();
      await tid(page, "demo-test-run").click();
      await expect(tid(page, "demo-test-result")).toBeVisible({ timeout: 30_000 });
      await expectAccessible(page, "Test");

      await tid(page, "demo-next").click();
      await tid(page, "demo-paper-open").click();
      await tid(page, "demo-paper-run").click();
      await expect(tid(page, "demo-paper-result")).toHaveAttribute("data-state", "closed");
      await expectAccessible(page, "Demokonto");

      await tid(page, "demo-next").click();
      await expect(tid(page, "demo-alarm-events")).toHaveAttribute("data-n", "4");
      await expectAccessible(page, "Alarm");
    });
  }
});
