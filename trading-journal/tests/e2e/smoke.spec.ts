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
