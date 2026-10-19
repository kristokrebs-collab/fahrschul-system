/**
 * Page "Funktionen" end to end (mobile 390 + desktop): it opens by hash, from the command navigation and with the `g f`
 * chord (never as a dock tab); the global search finds "Labor" among the functions and a function hit navigates; the page
 * filters and opens a function (navigates and scrolls to its card); the assistant answers "Wo finde ich …?" by opening the
 * place. No horizontal scroll at 390 px, no console errors. No clocks, nothing that depends on the market mock's time.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";

const PROJECTS = ["mobile", "desktop"];

const layer = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"]`);
const h1 = (page: Page, key: string) => layer(page, key).locator("h1").first();

async function openFunktionen(page: Page) {
  await seed(page);
  await page.goto("/#funktionen");
  await expect(h1(page, "funktionen")).toHaveText("Funktionen", { timeout: 25_000 });
  await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 25_000 });
}

test.describe("Funktionen", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("opens by hash with every group, honest empty lists, no sideways scroll", async ({ page }) => {
    const errors = collectErrors(page);
    await openFunktionen(page);
    const groups = layer(page, "funktionen").getByTestId("funktionen-group");
    await expect(groups).toHaveCount(8);
    for (const name of ["Heute vorbereiten", "Beobachten & Alarme", "Einstieg prüfen", "Testen", "Auswerten & Lernen", "Daten & Import", "Community"]) {
      await expect(layer(page, "funktionen").getByRole("heading", { level: 2, name })).toBeVisible();
    }
    // nothing asked, nothing opened: an honest line instead of a placeholder
    await expect(page.getByTestId("funktionen-for-you")).toContainText("Noch nichts gelernt");
    await expect(page.getByTestId("funktionen-recent")).toContainText("Noch nichts geöffnet");
    // the dock does not carry it
    await expect(page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Funktionen" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("touch targets are at least 44 px (search, filters, open buttons, quick lists)", async ({ page }, info) => {
    test.skip(!hasTouch(info), "touch projects");
    test.setTimeout(120_000);
    await openFunktionen(page);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h + 1800; y += 600) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
      await page.waitForTimeout(60);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(400);
    const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-page="funktionen"][data-page-role="current"]' });
    expect(misses.map((m) => `${m.where} · ${m.name} ${m.w}×${m.h} → ${m.ew}×${m.eh} (taken by ${m.stolenBy})`)).toEqual([]);
  });

  test("is reached from the command navigation and with g f", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/");
    await page.getByRole("button", { name: /Navigation öffnen|Menü/ }).first().click();
    const nav = page.getByRole("dialog", { name: "Navigation" });
    await expect(nav).toBeVisible();
    await nav.getByRole("link", { name: /Funktionen/ }).click();
    await expect(page).toHaveURL(/#funktionen$/);
    await expect(h1(page, "funktionen")).toHaveText("Funktionen", { timeout: 25_000 });

    await page.goto("/#settings");
    await expect(h1(page, "settings")).toBeVisible({ timeout: 25_000 });
    await page.locator("body").press("g");
    await page.locator("body").press("f");
    await expect(page).toHaveURL(/#funktionen$/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the search finds 'Labor' among the functions, and a function hit navigates", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(h1(page, "overview")).toBeAttached({ timeout: 25_000 });
    await page.locator("body").press("/");
    const dialog = page.getByRole("dialog", { name: "Suche" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("combobox", { name: "Suche" }).fill("Labor");
    const options = dialog.getByRole("option");
    await expect(options.first()).toBeVisible();
    const kinds = await options.evaluateAll((els) => els.map((e) => e.getAttribute("data-search-kind")));
    expect(kinds).toContain("page");
    expect(kinds).toContain("feature");
    await expectNoHorizontalScroll(page);
    // a function hit (not the page itself) – its page opens
    await dialog.locator('[role="option"][data-search-kind="feature"]').first().click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/#labor$/);
    await expect(h1(page, "labor")).toHaveText("Labor", { timeout: 25_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("filters, opens a function and scrolls to its card; Zuletzt benutzt remembers it", async ({ page }) => {
    const errors = collectErrors(page);
    await openFunktionen(page);
    const search = page.getByRole("searchbox", { name: "Funktionen durchsuchen" });
    await search.fill("Positionsrechner");
    const cards = layer(page, "funktionen").getByTestId("feature-card");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute("data-feature", "positionsrechner");
    await expect(cards.first()).toContainText("Fertig");
    await expectNoHorizontalScroll(page);

    // the status filter is exact
    await search.fill("");
    await layer(page, "funktionen").getByRole("radio", { name: "Teilweise" }).click();
    const partial = await cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
    expect(partial.length).toBeGreaterThan(5);
    expect(new Set(partial)).toEqual(new Set(["teilweise"]));
    await layer(page, "funktionen").getByRole("radio", { name: "Alle", exact: true }).first().click();

    // open: navigates and brings the card into view
    await search.fill("Positionsrechner");
    await cards.first().getByRole("button", { name: "Positionsrechner öffnen" }).click();
    await expect(page).toHaveURL(/#risiko$/);
    await expect(h1(page, "risiko")).toHaveText("Risiko", { timeout: 25_000 });
    const calc = layer(page, "risiko").getByTestId("risk-calc");
    await expect(calc).toBeVisible({ timeout: 15_000 });
    await expect(calc).toBeInViewport({ timeout: 15_000 });

    // and it shows up as recently used when coming back
    await page.goto("/#funktionen");
    await expect(h1(page, "funktionen")).toHaveText("Funktionen", { timeout: 25_000 });
    await expect(page.getByTestId("funktionen-recent")).toHaveAttribute("data-n", "1");
    await expect(page.getByTestId("funktionen-recent").getByTestId("feature-quick")).toHaveAttribute("data-feature", "positionsrechner");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the assistant answers 'Wo finde ich …?' by opening the place", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(h1(page, "overview")).toBeAttached({ timeout: 25_000 });
    await page.getByTestId("assistant-button").click();
    const sheet = page.getByRole("dialog", { name: "Assistent" });
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    // the quiet link to the whole list sits in the empty state
    await expect(sheet.getByTestId("assistant-all-features")).toBeVisible();
    await sheet.getByTestId("assistant-input").fill("Wo finde ich den Positionsrechner?");
    await sheet.getByTestId("assistant-send").click();
    await expect(page).toHaveURL(/#risiko$/, { timeout: 15_000 });
    await expect(h1(page, "risiko")).toHaveText("Risiko", { timeout: 25_000 });
    await expect(layer(page, "risiko").getByTestId("risk-calc")).toBeInViewport({ timeout: 15_000 });
    await expectNoHorizontalScroll(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
