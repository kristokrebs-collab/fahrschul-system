/**
 * pulse-motion contracts: command navigation (⌘K / Ctrl+K), curtain footer reveal, MorphSelect / Autocomplete fields,
 * equity replay slider keyboard, market tile order persistence.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, isMobile, seed } from "./helpers";

async function gotoOverview(page: Page) {
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
}

async function gotoSettings(page: Page) {
  await page.goto("/#settings");
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
}

test("command navigation: Ctrl+K opens, Escape closes, the menu button opens it and gets focus back", async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page);
  await gotoOverview(page);
  const nav = page.getByRole("dialog", { name: "Navigation" });
  await page.keyboard.press("Control+k");
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: /Trades/ }).or(nav.getByRole("button", { name: /Trades/ })).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(nav).toHaveCount(0);

  const menu = page.getByRole("button", { name: "Navigation öffnen" });
  await menu.click();
  await expect(nav).toBeVisible();
  // focus is inside the dialog
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(nav).toHaveCount(0);
  await expect(menu).toBeFocused();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("command navigation: a page link navigates and closes the panel", async ({ page }) => {
  await seed(page);
  await gotoOverview(page);
  await page.keyboard.press("Control+k");
  const nav = page.getByRole("dialog", { name: "Navigation" });
  await expect(nav).toBeVisible();
  await nav.getByRole("navigation").getByText("Einstellungen", { exact: true }).click();
  await expect(page).toHaveURL(/#settings/);
  await expect(nav).toHaveCount(0);
});

test("footer: revealed (data-shown) after scrolling to the end of the page", async ({ page }) => {
  await seed(page);
  await gotoOverview(page);
  const footer = page.locator("footer");
  await expect(footer).not.toHaveAttribute("data-shown", /.*/);
  // deferred overview cells mount while scrolling (the page grows): keep going to the end like a reader would
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
        return footer.getAttribute("data-shown");
      },
      { timeout: 8000 },
    )
    .toBe("true");
  await expect(page.getByRole("marquee", { name: /./ })).toBeAttached();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(footer).not.toHaveAttribute("data-shown", /.*/, { timeout: 5000 });
});

test("settings: currency MorphSelect picks EUR; symbol autocomplete stores BINANCE:SOLUSDT", async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page);
  await gotoSettings(page);
  const currency = page.locator("#s-currency");
  await currency.click();
  await page.getByRole("listbox").getByRole("option", { name: "EUR", exact: true }).click();
  await expect(currency).toHaveAttribute("data-value", "EUR");
  await expect(page.getByRole("listbox")).toHaveCount(0);

  const symbol = page.locator("#s-symbol");
  await symbol.fill("sol");
  await page.getByRole("option", { name: "SOLUSDT", exact: true }).click();
  await expect(symbol).toHaveValue("BINANCE:SOLUSDT");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("equity replay slider: arrow keys step one trade back, Escape returns to now", async ({ page }) => {
  await seed(page);
  await gotoOverview(page);
  const slider = page.getByRole("slider", { name: /Kontostand-Verlauf/ });
  await slider.scrollIntoViewIfNeeded();
  await expect(slider).toBeVisible();
  const max = Number(await slider.getAttribute("aria-valuemax"));
  await expect(slider).toHaveAttribute("aria-valuenow", String(max));
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuenow", String(max - 1));
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuenow", String(max - 2));
  await page.keyboard.press("Escape");
  await expect(slider).toHaveAttribute("aria-valuenow", String(max));
});

test("market tiles: keyboard reorder persists across a reload", async ({ page }, info) => {
  test.skip(isMobile(info), "tiles are hidden below sm");
  await seed(page);
  await gotoOverview(page);
  const grid = page.getByRole("list", { name: "Markt-Kacheln" });
  await grid.scrollIntoViewIfNeeded();
  const first = grid.getByRole("listitem").first();
  const firstText = ((await first.textContent()) ?? "").slice(0, 6);
  await first.focus();
  await page.keyboard.press(" ");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press(" ");
  await expect
    .poll(async () => JSON.parse((await page.evaluate(() => localStorage.getItem("tj2-ui-market-tiles"))) ?? "[]"))
    .toEqual(["oi", "funding", "taker", "book"]);
  await page.reload();
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  const second = page.getByRole("list", { name: "Markt-Kacheln" }).getByRole("listitem").nth(1);
  await expect(second).toContainText(firstText);
});

test("page end: the last overview card and the footer's back-to-top sit fully above the dock", async ({ page }) => {
  await seed(page);
  await gotoOverview(page);
  const footer = page.locator("footer");
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
        return footer.getAttribute("data-shown");
      },
      { timeout: 8000 },
    )
    .toBe("true");
  await page.waitForTimeout(400);
  const geo = await page.evaluate(() => {
    const dock = document.querySelector('[role="toolbar"][aria-label="Navigation"]')!.getBoundingClientRect();
    const cells = Array.from(document.querySelectorAll("[data-intro-cell]")).map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0);
    const last = cells.reduce((a, b) => (b.bottom > a.bottom ? b : a));
    const top = document.querySelector('footer button[aria-label="Nach oben"]')!.getBoundingClientRect();
    return { dockTop: dock.top, lastBottom: last.bottom, topBtnBottom: top.bottom, atEnd: Math.abs(window.scrollY + innerHeight - document.documentElement.scrollHeight) < 2 };
  });
  expect(geo.atEnd).toBe(true);
  expect(geo.lastBottom, JSON.stringify(geo)).toBeLessThanOrEqual(geo.dockTop);
  expect(geo.topBtnBottom, JSON.stringify(geo)).toBeLessThanOrEqual(geo.dockTop);
});
