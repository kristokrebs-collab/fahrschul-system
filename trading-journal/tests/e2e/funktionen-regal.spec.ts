/**
 * Page "Funktionen" – the shelf and the status (A7), mobile 390 + desktop: a star keeps a function in "Favoriten" (survives a reload:
 * it lives in `settings.funktionen`), opening a function counts as "Zuletzt benutzt", every row says what can be done with it now
 * (verfügbar / Einrichtung nötig …) and has a symbol, touch targets stay ≥ 44 px, nothing scrolls sideways, no console errors.
 * Local-only build (no payments → nothing is "im höheren Tarif"; that state is covered by the unit test against the real gates).
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";

const layer = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"]`);
const h1 = (page: Page, key: string) => layer(page, key).locator("h1").first();

async function openFunktionen(page: Page) {
  await seed(page);
  await page.goto("/#funktionen");
  await expect(h1(page, "funktionen")).toHaveText("Funktionen", { timeout: 25_000 });
  await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 25_000 });
}

test.describe("Funktionen: Favoriten, Status, Symbol", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!["mobile", "desktop"].includes(info.project.name), "runs on mobile + desktop");
  });

  test("a star keeps a function among the favourites – also after a reload – and takes it out again", async ({ page }) => {
    const errors = collectErrors(page);
    await openFunktionen(page);
    await expect(page.getByTestId("funktionen-favorites")).toHaveCount(0);
    await page.locator('[data-testid="funktionen-tile"][data-group="heute"]').click();
    const row = page.locator('[data-testid="feature-row"][data-feature="tagesplan"]');
    await expect(row.getByTestId("feature-star")).toHaveAttribute("aria-pressed", "false");
    await row.getByTestId("feature-star").click();
    await expect(row.getByTestId("feature-star")).toHaveAttribute("aria-pressed", "true");
    await expectNoHorizontalScroll(page);

    // the settings are saved asynchronously – a reload shows the favourite box on the tiles
    await expect(async () => {
      await page.reload();
      await expect(h1(page, "funktionen")).toHaveText("Funktionen", { timeout: 25_000 });
      await expect(page.getByTestId("funktionen-favorites")).toHaveAttribute("data-n", "1", { timeout: 3000 });
    }).toPass({ timeout: 25_000 });
    const fav = page.getByTestId("funktionen-favorites").getByTestId("feature-favorite");
    await expect(fav).toHaveAttribute("data-feature", "tagesplan");
    await expectNoHorizontalScroll(page);

    await fav.getByTestId("feature-star").click();
    await expect(page.getByTestId("funktionen-favorites")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("opening a function lists it under 'Zuletzt benutzt' (settings), every row says what can be done now and shows a symbol", async ({ page }) => {
    const errors = collectErrors(page);
    await openFunktionen(page);
    await page.locator('[data-testid="funktionen-tile"][data-group="risiko"]').click();
    const rows = page.getByTestId("funktionen-group-view").getByTestId("feature-row");
    await expect(rows.first()).toBeVisible();
    const kinds = await rows.evaluateAll((els) => els.map((e) => [e.getAttribute("data-availability"), e.querySelector('[data-testid="feature-glyph"] svg') !== null]));
    for (const [kind, glyph] of kinds) {
      expect(["verfuegbar", "einrichtung", "tarif"]).toContain(kind);
      expect(glyph).toBe(true);
    }
    await expect(rows.first().getByTestId("feature-availability")).toHaveText(/Verfügbar|Einrichtung nötig|Im höheren Tarif/);
    await page.locator('[data-testid="feature-row"][data-feature="verlustlimits"]').getByRole("button", { name: "Verlustlimits & Pause öffnen" }).click();
    await expect(page).toHaveURL(/#risiko$/);
    await expect(h1(page, "risiko")).toHaveText("Risiko", { timeout: 25_000 });
    await page.goto("/#funktionen");
    await expect(h1(page, "funktionen")).toHaveText("Funktionen", { timeout: 25_000 });
    await expect(page.getByTestId("funktionen-recent").getByTestId("feature-quick").first()).toHaveAttribute("data-feature", "verlustlimits");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("touch targets of the new parts (star, availability, rows) are at least 44 px", async ({ page }, info) => {
    test.skip(!hasTouch(info), "touch projects");
    test.setTimeout(120_000);
    await openFunktionen(page);
    await page.locator('[data-testid="funktionen-tile"][data-group="heute"]').click();
    await page.locator('[data-testid="feature-row"][data-feature="tagesplan"]').getByTestId("feature-star").click();
    await page.getByRole("button", { name: "Zurück zu allen Aufgaben" }).click();
    await page.waitForTimeout(500);
    const root = '[data-page="funktionen"][data-page-role="current"]';
    const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root });
    expect(misses.map((m) => `${m.where} · ${m.name} ${m.w}×${m.h}`)).toEqual([]);
  });
});
