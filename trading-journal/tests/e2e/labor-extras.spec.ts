/**
 * F20 / F18 / F17 Labor · Belastung, Bericht, Filter end to end against the market mock with REAL Binance BTCUSDT 4h / 1D
 * bars (`boxes: true`, no network): after a run the three cards sit closed under the diagnosis; opening each loads its own
 * chunk; the stress scenarios and the filter comparison are extra jobs started on request (worker), the Prüfbericht reads
 * the shown run. Nothing here depends on the clock (the data are fixed bars, the figures are compared with the run above).
 *
 * Runs on the routed page `/#labor` of the production build (`PW_LABOR_URL` overrides it).
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, seed, stored } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";

const LABOR_URL = process.env.PW_LABOR_URL ?? "/#labor";
const PROJECTS = ["mobile", "desktop"];

async function openAndRun(page: Page, info: TestInfo): Promise<string[]> {
  test.skip(!PROJECTS.includes(info.project.name), "Labor runs on mobile + desktop");
  const errors = collectErrors(page);
  await seed(page, { boxes: true, extra: { "tj2-labor": { strategy: "custom", symbol: "BTCUSDT", period: "6m" } } });
  await openRoute(page, LABOR_URL, "Labor");
  await page.getByTestId("labor-start").click();
  await expect(page.getByTestId("labor-run")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  return errors;
}

test.describe("Labor · Belastung, Bericht, Filter", () => {
  test.setTimeout(180_000);

  test("Karten zugeklappt; Szenarien rechnen; Prüfbericht; Filter vergleichen", async ({ page }, info) => {
    const errors = await openAndRun(page, info);
    const extras = page.getByTestId("labor-extras");
    await extras.scrollIntoViewIfNeeded();
    for (const id of ["stress", "report", "filters"]) await expect(page.getByTestId(`labor-extra-toggle-${id}`)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("labor-stress")).toHaveCount(0);

    // Belastungstest: the loss series come at once, the scenarios on request
    await page.getByTestId("labor-extra-toggle-stress").click();
    const stress = page.getByTestId("labor-stress");
    await expect(stress).toBeVisible();
    await expect(page.getByTestId("labor-streaks")).toBeVisible();
    await expect(page.getByTestId("labor-stress-table")).toHaveCount(0);
    await page.getByTestId("labor-stress-run").click();
    await expect(page.getByTestId("labor-stress-runbar")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    const rows = page.getByTestId("labor-stress-row");
    await expect(rows).toHaveCount(10);
    expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-scenario")))).toEqual(["base", "fees2", "slip2", "fundOff", "fundOn", "fund2", "delay1", "stopTight", "stopWide", "combined"]);
    // the base scenario shows a number of trades (the same run, computed again)
    await expect(rows.first().locator("td").first()).toHaveText(/^\d+$/);
    await expectNoHorizontalScroll(page);

    // Prüfbericht: instant, with the sample size and the honest note on late signals
    await page.getByTestId("labor-extra-toggle-report").click();
    const report = page.getByTestId("labor-report");
    await expect(report).toBeVisible();
    await expect(page.getByTestId("labor-outlier-text")).toContainText(/\d/);
    await expect(page.getByTestId("labor-late-text")).toContainText("durch seinen Aufbau");
    await expect(page.getByTestId("labor-thirds").locator("dt")).toHaveCount(3);
    await expectNoHorizontalScroll(page);

    // Filter: the locked ones keep their reason, two chosen ones are compared with and without
    await page.getByTestId("labor-extra-toggle-filters").click();
    const filters = page.getByTestId("labor-filters");
    await expect(filters).toBeVisible();
    await expect(filters.locator('[data-filter="topTrader"]').getByTestId("labor-filter-reason")).toContainText("30 Tage");
    await expect(filters.locator('[data-filter="retest"]').getByTestId("labor-filter-reason")).toContainText("Ausbruchsniveau");
    await expect(page.getByTestId("labor-filters-run")).toBeDisabled();
    await page.getByTestId("labor-filter-switch-rsi").click();
    await page.getByTestId("labor-filter-switch-trend").click();
    await expect(page.getByTestId("labor-filters-run")).toBeEnabled();
    await page.getByTestId("labor-filters-run").click();
    await expect(page.getByTestId("labor-filters-runbar")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    expect(await page.getByTestId("labor-filter-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-variant")))).toEqual(["base", "only:rsi", "only:trend", "all"]);
    await expect(page.getByTestId("labor-filter-overlap")).toContainText("addieren sich");
    await expectNoHorizontalScroll(page);

    // the choice is remembered in this browser (versioned)
    expect(await stored<{ v: number; on: string[] }>(page, "tj2-labor-filters")).toMatchObject({ v: 1, on: ["rsi", "trend"] });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Labor" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Touch-Ziele der Karten sind mindestens 44 px", async ({ page }, info) => {
    test.skip(!hasTouch(info), "touch project only");
    await openAndRun(page, info);
    for (const id of ["stress", "report", "filters"]) await page.getByTestId(`labor-extra-toggle-${id}`).click();
    await expect(page.getByTestId("labor-filters")).toBeVisible();
    await page.getByTestId("labor-filter-switch-trend").click();
    const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="labor-extras"]' });
    expect(misses, JSON.stringify(misses)).toEqual([]);
  });
});
