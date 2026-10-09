import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { collectErrors } from "./helpers";
import { mockMarket } from "./mocks/market";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/tj2-v0.json", import.meta.url), "utf8"));

test.beforeEach(async ({ page }) => {
  await mockMarket(page, "live");
  await page.addInitScript((fx) => {
    for (const [k, v] of Object.entries(fx as Record<string, unknown>)) {
      localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    sessionStorage.setItem("tj2-intro", "1");
  }, fixture);
});

test("overview renders without console errors", async ({ page }, info) => {
  const errors = collectErrors(page);
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/shots/${info.project.name}-overview.png`, fullPage: true });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("pages", async ({ page }, info) => {
  await page.goto("/#trades");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `/tmp/shots/${info.project.name}-trades.png`, fullPage: true });
  await page.goto("/#setups");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `/tmp/shots/${info.project.name}-setups.png`, fullPage: true });
  await page.goto("/#settings");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `/tmp/shots/${info.project.name}-settings.png`, fullPage: true });
});

test("back to the kept-alive overview from every page without console warnings (charts below the fold re-measure)", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  await page.waitForTimeout(1500);
  for (const other of ["#trades", "#setups", "#settings"]) {
    await page.evaluate((h) => (location.hash = h), other);
    await page.waitForTimeout(900);
    await page.evaluate(() => (location.hash = "#overview"));
    await expect(page.locator('[data-page="overview"][data-page-role="current"]')).toBeVisible();
    await page.waitForTimeout(900);
  }
  // the monthly bars (a content-visibility cell below the fold) still draw once scrolled to
  const monthly = page.getByLabel("P&L pro Monat");
  await monthly.scrollIntoViewIfNeeded();
  await expect(monthly.locator(".recharts-bar-rectangle").first()).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});
