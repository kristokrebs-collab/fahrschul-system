/**
 * Editions and installability:
 * - the share edition (`npm run build:share` → dist/teilen, served at /teilen/) opens EMPTY next to a full personal
 *   journal in the same browser, with neutral setups and its own storage (`tj2share-*`); its writes never touch `tj2-*`;
 * - each edition links its own web manifest (standalone display, icons that load); the share one has its own name;
 * - the fullscreen toggle (header from lg, ⌘K navigation everywhere the API exists) enters and leaves fullscreen.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, openTradeEditor, seed, stored, toast } from "./helpers";

/** Strategy names of the personal edition (never in the share build). */
const PERSONAL_SETUPS = ["4H-Breakout über 85.900", "4H-Neckline-Short unter 84.500", "BSL/EQL Liquidity Sweep"];

/** The share edition keeps its session flags under its own prefix: no intro either. */
async function seedBoth(page: Page) {
  await seed(page);
  await page.addInitScript(() => sessionStorage.setItem("tj2share-intro", "1"));
}

interface Manifest {
  name: string;
  short_name: string;
  display: string;
  start_url: string;
  icons: { src: string; sizes: string }[];
}

async function manifestOf(page: Page): Promise<{ href: string; json: Manifest }> {
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href, "manifest link").toBeTruthy();
  const url = new URL(href!, page.url()).toString();
  const res = await page.request.get(url);
  expect(res.ok(), `${url} → ${res.status()}`).toBe(true);
  return { href: url, json: (await res.json()) as Manifest };
}

test("share edition at /teilen/: empty journal, neutral setups, own storage; the personal journal is untouched", async ({ page }) => {
  const errors = collectErrors(page);
  await seedBoth(page);
  await page.goto("/teilen/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  await expect(page.getByText("Noch keine abgeschlossenen Trades. Alle Werte starten bei null.")).toBeVisible();
  // neutral starting capital (10.000 + 1.000), not the personal 25.000
  await expect(page.getByText("Startkapital 11.000 USDT")).toBeVisible();
  await expect(page.getByText("Startkapital 25.000 USDT")).toHaveCount(0);

  await page.goto("/teilen/#trades");
  await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
  await expect(page.locator("tbody tr[data-trade-id], [data-trade-id]")).toHaveCount(0);

  await page.goto("/teilen/#setups");
  await expect(page.getByRole("heading", { name: "Entscheidungsgrundlagen" })).toBeVisible();
  // none of the personal strategy names (they are on the personal setups page)
  for (const name of PERSONAL_SETUPS) await expect(page.getByText(name, { exact: true })).toHaveCount(0);

  // a trade saved here lands in the share storage only
  const editor = await openTradeEditor(page);
  await editor.locator("#f-entry").fill("70000");
  await editor.locator("#f-exit").fill("71000");
  await editor.locator("#f-size").fill("1000");
  await editor.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(toast(page)).toContainText("Trade gespeichert");
  expect(((await stored<unknown[]>(page, "tj2share-trades")) ?? []).length).toBe(1);
  expect(((await stored<unknown[]>(page, "tj2-trades")) ?? []).length).toBe(13);

  // own manifest and app name
  const { href, json } = await manifestOf(page);
  expect(href).toMatch(/\/teilen\/manifest\.webmanifest$/);
  expect(json.name).toBe("Trade Journal (Teilen)");

  // the personal edition still shows its 13 trades
  await page.goto("/#trades");
  await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
  await expect(page.getByText("13 Trades", { exact: true })).toBeVisible();
  await page.goto("/#setups");
  // scoped to the setups page: the kept-alive overview is pre-rendered hidden at idle priority and carries the setup
  // names too (its hidden copy came first in document order whenever the pre-render had already run)
  await expect(page.locator('[data-page="setups"]').getByText(PERSONAL_SETUPS[0]!, { exact: true }).first()).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("PWA: manifest (standalone, icons load), theme colour, dark-only colour scheme", async ({ page }) => {
  await seed(page);
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  const { json, href } = await manifestOf(page);
  expect(json.name).toBe("BTC Trade Journal");
  expect(json.display).toBe("standalone");
  expect(json.start_url).toBe("./");
  for (const size of ["192x192", "512x512"]) {
    const icon = json.icons.find((i) => i.sizes === size);
    expect(icon, `icon ${size}`).toBeTruthy();
    const res = await page.request.get(new URL(icon!.src, href).toString());
    expect(res.ok(), `icon ${icon!.src}`).toBe(true);
    expect(res.headers()["content-type"]).toContain("image/png");
  }
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0a0a0a");
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute("content", "only dark");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});

test("fullscreen: the toggle enters and leaves fullscreen", async ({ page }) => {
  await seed(page);
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  const header = page.locator("header").getByRole("button", { name: "Vollbild", exact: true });
  const isFs = () => page.evaluate(() => document.fullscreenElement !== null);
  if (await header.isVisible()) {
    await header.click();
    await expect.poll(isFs).toBe(true);
    const exit = page.locator("header").getByRole("button", { name: "Vollbild beenden" });
    await expect(exit).toHaveAttribute("aria-pressed", "true");
    await exit.click();
    await expect.poll(isFs).toBe(false);
    await expect(header).toHaveAttribute("aria-pressed", "false");
  } else {
    // below lg: the ⌘K navigation carries the action
    await page.getByRole("button", { name: "Navigation öffnen" }).click();
    const nav = page.getByRole("dialog", { name: "Navigation" });
    await expect(nav).toBeVisible();
    await nav.getByRole("button", { name: "Vollbild", exact: true }).click();
    await expect.poll(isFs).toBe(true);
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(isFs).toBe(false);
  }
});
