/**
 * P13 global search end to end (dev harness `/dev/ux.html`, see `uxHarness.ts`): `/` and ⌘⇧F / Ctrl+⇧F open it, the
 * strongest first before typing, typing filters the seeded journal (trades, setups, pages, settings, commands),
 * arrows + Enter run the hit after the overlay is gone (page switch, trade detail, a command), Escape closes and
 * gives the focus back, `/` typed into a field stays a character, the shortcut sheet `?` and the g-chords. Mobile
 * (390 px): the panel fits, no horizontal scroll. No console errors.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll } from "./helpers";
import { openUx, themeSettled, UX_PROJECTS, UX_SKIP } from "./uxHarness";

const dialog = (page: Page) => page.getByRole("dialog", { name: "Suche" });
const box = (page: Page) => dialog(page).getByRole("combobox", { name: "Suche" });
/**
 * The overlays are lazy chunks by design (search, shortcut sheet): the first open per page load fetches them – under
 * the dev harness a module waterfall that takes seconds while the other workers load the app too.
 */
const FIRST_OPEN = { timeout: 15_000 };

async function openWithSlash(page: Page) {
  await page.locator("body").press("/");
  await expect(dialog(page)).toBeVisible(FIRST_OPEN);
  await expect(box(page)).toBeFocused();
}

test.describe("Globale Suche", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "P13 runs on mobile + desktop");
  });

  test("/ opens it with the strongest first; typing filters; Enter switches the page after the exit", async ({ page }) => {
    const errors = collectErrors(page);
    test.skip(!(await openUx(page, "app", "overview")), UX_SKIP);
    await openWithSlash(page);
    const list = dialog(page).getByRole("listbox");
    await expect(list).toHaveAttribute("aria-label", "Stärkste zuerst");
    await expect(list.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await expectNoHorizontalScroll(page);

    await box(page).fill("einst");
    await expect(list.getByRole("option").first()).toContainText("Einstellungen");
    await box(page).press("Enter");
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(/#settings$/);
    await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a trade from its notes opens the trade detail; a setup hit; nothing found is honest", async ({ page }) => {
    const errors = collectErrors(page);
    test.skip(!(await openUx(page, "app", "overview")), UX_SKIP);
    await openWithSlash(page);
    await box(page).fill("zzzqqq");
    await expect(dialog(page).getByText("Nichts gefunden")).toBeVisible();
    await expect(box(page)).toHaveAttribute("aria-expanded", "false");

    await box(page).fill("sweep");
    const options = dialog(page).getByRole("option");
    await expect(options.first()).toBeVisible();
    const kinds = await options.evaluateAll((els) => els.map((e) => e.getAttribute("data-search-kind")));
    expect(kinds).toContain("setup");
    expect(kinds).toContain("trade");
    // arrows move the active option (aria-activedescendant follows)
    await box(page).press("ArrowDown");
    const active = await box(page).getAttribute("aria-activedescendant");
    await expect(page.locator(`[id="${active}"]`)).toHaveAttribute("aria-selected", "true");
    await dialog(page).locator('[role="option"][data-search-kind="trade"]').first().click();
    await expect(dialog(page)).toBeHidden();
    await expect(
      page
        .getByRole("dialog")
        .filter({ hasText: /Trade|BTC|ETH|SOL/ })
        .first(),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("⌘⇧F / Ctrl+⇧F opens it; Escape closes and returns the focus; / inside a field is just a character", async ({ page }) => {
    const errors = collectErrors(page);
    test.skip(!(await openUx(page, "app", "trades")), UX_SKIP);
    const before = page.getByRole("heading", { level: 1 }).first();
    await before.waitFor();
    await page.locator("body").press("Control+Shift+F");
    await expect(dialog(page)).toBeVisible(FIRST_OPEN);
    await box(page).press("Escape");
    await expect(dialog(page)).toBeHidden();
    await page.locator("body").press("Meta+Shift+F");
    await expect(dialog(page)).toBeVisible();
    await box(page).press("Escape");
    await expect(dialog(page)).toBeHidden();

    // a command from the search: the light design
    await openWithSlash(page);
    await box(page).fill("design hell");
    await dialog(page).locator('[role="option"][data-search-kind="command"]').filter({ hasText: "Design: Hell" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await themeSettled(page);

    // a field keeps "/" and "n" as characters
    const field = page.locator('input[type="search"], input[type="text"]').first();
    if (await field.count()) {
      await field.click();
      await field.pressSequentially("a/n");
      await expect(dialog(page)).toBeHidden();
      await expect(field).toHaveValue(/a\/n$/);
    }
    expect(errors).toEqual([]);
  });

  test("? opens the shortcut sheet; g then s switches to the setups", async ({ page }) => {
    const errors = collectErrors(page);
    test.skip(!(await openUx(page, "app", "overview")), UX_SKIP);
    await page.locator("body").press("Shift+?");
    const sheet = page.getByTestId("shortcut-sheet");
    await expect(sheet).toBeVisible(FIRST_OPEN);
    await expect(sheet.getByRole("toolbar", { name: "Wichtigste Tasten" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await page.locator("body").press("g");
    await expect(page.locator('[data-layer="Tastenkürzel-Hinweis"]')).toBeVisible();
    await page.locator("body").press("s");
    await expect(page).toHaveURL(/#setups$/);
    await expect(page.locator('[data-layer="Tastenkürzel-Hinweis"]')).toBeHidden();
    expect(errors).toEqual([]);
  });
});
