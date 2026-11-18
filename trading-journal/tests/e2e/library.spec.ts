/**
 * F06 / F14 / F15 / F64 end to end (production build, market mock): the strategy library of the Labor page – search, details with
 * typical values, loading a card fills "Eigene Idee" as a DRAFT without starting a run – and the Pine card with its honest
 * statements and the TradingView link. No clock jumps, no time-dependent expectations: end states only.
 *
 * Runs on the routed page `/#labor` of the production build (`PW_LABOR_URL` overrides it), mobile + desktop.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, seed } from "./helpers";

const LABOR_URL = process.env.PW_LABOR_URL ?? "/#labor";
const PROJECTS = ["mobile", "desktop"];

async function open(page: Page, info: TestInfo): Promise<string[]> {
  test.skip(!PROJECTS.includes(info.project.name), "Labor runs on mobile + desktop");
  const errors = collectErrors(page);
  await seed(page, { boxes: true, extra: { "tj2-labor": { strategy: "custom", symbol: "BTCUSDT", period: "6m" } } });
  await openRoute(page, LABOR_URL, "Labor");
  return errors;
}

test.describe("Labor · Strategie-Bibliothek und Pine", () => {
  test.setTimeout(120_000);

  test("Vorlage laden → Entwurf gefüllt, nichts gestartet", async ({ page }, info) => {
    const errors = await open(page, info);
    await page.getByTestId("labor-lib-open").click();
    const lib = page.getByTestId("labor-lib");
    await expect(lib).toBeVisible({ timeout: 25_000 });
    await expect(lib.getByTestId("labor-lib-honest")).toContainText("Bekannt heißt nicht wirksam");
    expect(await lib.getByTestId("labor-lib-card").count()).toBeGreaterThanOrEqual(25);

    // search → one card; details show the typical values in three settings
    await lib.getByTestId("labor-lib-search").fill("Connors");
    const card = lib.getByTestId("labor-lib-card");
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("data-card", "connors-rsi2");
    await card.getByRole("button", { name: /Details zeigen/ }).click();
    const values = card.getByTestId("labor-lib-values");
    await expect(values).toBeVisible();
    await expect(values.locator('[data-param="level"]')).toContainText("5");
    await expect(values.locator('[data-param="level"] dd')).toHaveText(["5", "10", "15"]);
    await expect(card.getByTestId("labor-lib-details")).toContainText("Typische Schwächen");
    await expectNoHorizontalScroll(page);

    // load the standard setting: the draft is filled, the sheet closes, no run starts
    await card.getByTestId("labor-lib-load-connors-rsi2-standard").click();
    await expect(page.getByTestId("labor-lib")).toHaveCount(0);
    await expect(page.getByTestId("labor-idea-name")).toHaveValue("Connors RSI(2)");
    await expect(page.getByTestId("labor-idea-summary")).toContainText("Long wenn RSI(2) unter 10 UND Schluss über SMA 200");
    await expect(page.getByTestId("labor-view")).toHaveAttribute("data-status", "idle");
    await expect(page.getByTestId("labor-check")).toContainText("Keine Fehler");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("Pine-Skript erzeugen, Lücken benennen, Link auf den Chart", async ({ page }, info) => {
    const errors = await open(page, info);
    const card = page.getByTestId("labor-pine");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toContainText("Kein Login und kein Zugriff auf dein TradingView-Konto");
    await expect(card.getByTestId("labor-pine-steps")).toContainText("Export hier vergleichen");
    await expect(card.getByTestId("labor-pine-open")).toHaveAttribute("href", "https://www.tradingview.com/chart/?symbol=BINANCE%3ABTCUSDT.P&interval=240");
    await expect(card.getByTestId("labor-pine-code")).toHaveCount(0);

    await card.getByTestId("labor-pine-make").click();
    const code = card.getByTestId("labor-pine-code");
    await expect(code).toBeVisible();
    await expect(code).toHaveValue(/^\/\/@version=6/);
    await expect(code).toHaveValue(/Ergebnisse in TradingView weichen vom Labor ab/);
    await expect(card.getByTestId("labor-pine-summary")).toContainText("Alle 2 Bausteine sind übersetzt");
    await expectNoHorizontalScroll(page);

    // add a block with no Pine counterpart: it is named, never dropped
    await page.getByTestId("labor-add-cond").click();
    await page.getByTestId("labor-block-zone").click();
    await expect(card.getByTestId("labor-pine-gaps")).toContainText("Premium / Discount");
    await expect(code).toHaveValue(/allow_n\d+ = input\.bool\(false/);
    await expect(card.getByTestId("labor-pine-summary")).toContainText("2 von 3 Bausteinen sind übersetzt");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});
