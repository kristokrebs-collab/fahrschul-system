/**
 * Page "Funktionen" end to end (mobile 390 + desktop): it opens by hash, from the command navigation and with the `g f`
 * chord (never as a dock tab); the large search answers in the user's own words; ten task tiles open a group whose rows open
 * the place (navigates and scrolls to its card); the command navigation finds functions and has the way to "Alle Funktionen";
 * the global search finds "Labor" among the functions; the assistant answers "Wo finde ich …?". No horizontal scroll at
 * 390 px, touch targets ≥ 44 px, no console errors. No clocks, nothing that depends on the market mock's time.
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

  test("opens by hash with the search and twelve task tiles, one column on a phone, no sideways scroll", async ({ page }, info) => {
    const errors = collectErrors(page);
    await openFunktionen(page);
    const tiles = layer(page, "funktionen").getByTestId("funktionen-tile");
    await expect(tiles).toHaveCount(12);
    for (const name of ["Heute vorbereiten", "Trade prüfen & Chart", "Aktien beobachten & bewerten", "Trade planen", "Risiko & Disziplin", "Strategie entwickeln & testen", "Aus Fehlern lernen", "Auswerten & Berichte", "Üben & Wachsen", "Trades eintragen & Daten", "Community & Teilen", "Konto, Einstellungen & Hilfe"]) {
      await expect(layer(page, "funktionen").getByRole("button", { name: `${name}: Funktionen anzeigen` })).toHaveCount(1);
    }
    await expect(layer(page, "funktionen").getByRole("searchbox", { name: "Was willst du tun?" })).toBeVisible();
    // always something to start with
    await expect(page.getByTestId("funktionen-picks")).toBeVisible();
    // the dock does not carry it
    await expect(page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Funktionen" })).toHaveCount(0);
    if (info.project.name === "mobile") {
      // a single column: every tile spans the content width
      const widths = await tiles.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
      expect(new Set(widths).size).toBe(1);
      expect(widths[0]).toBeGreaterThan(300);
    }
    await expectNoHorizontalScroll(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("touch targets are at least 44 px (search, tiles, rows, details, back)", async ({ page }, info) => {
    test.skip(!hasTouch(info), "touch projects");
    test.setTimeout(120_000);
    await openFunktionen(page);
    const root = '[data-page="funktionen"][data-page-role="current"]';
    const audit = async () => {
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < h + 1200; y += 600) {
        await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
        await page.waitForTimeout(60);
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForTimeout(400);
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root });
      return misses.map((m) => `${m.where} · ${m.name} ${m.w}×${m.h} → ${m.ew}×${m.eh} (taken by ${m.stolenBy})`);
    };
    expect(await audit()).toEqual([]);
    await page.getByTestId("funktionen-tile").nth(3).click();
    await expect(page.getByTestId("funktionen-group-view")).toBeVisible();
    await page.getByTestId("feature-details").first().click();
    expect(await audit()).toEqual([]);
  });

  test("is reached from the command navigation (finder + 'Alle Funktionen') and with g f", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/");
    await page.getByRole("button", { name: /Navigation öffnen|Menü/ }).first().click();
    const nav = page.getByRole("dialog", { name: "Navigation" });
    await expect(nav).toBeVisible();
    // a clear way to the whole list, above the page links
    await expect(nav.getByTestId("nav-all-functions")).toBeVisible();
    await nav.getByTestId("nav-all-functions").click();
    await expect(page).toHaveURL(/#funktionen$/);
    await expect(h1(page, "funktionen")).toHaveText("Funktionen", { timeout: 25_000 });

    await page.goto("/#settings");
    await expect(h1(page, "settings")).toBeVisible({ timeout: 25_000 });
    // the shortcut host mounts right after the first commit: press the chord until it is listening
    await expect(async () => {
      await page.locator("body").press("g");
      await page.locator("body").press("f");
      await expect(page).toHaveURL(/#funktionen$/, { timeout: 1500 });
    }).toPass({ timeout: 15_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the command navigation finds a function by what you want to do and opens its place", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(h1(page, "overview")).toBeAttached({ timeout: 25_000 });
    await page.getByRole("button", { name: /Navigation öffnen|Menü/ }).first().click();
    const nav = page.getByRole("dialog", { name: "Navigation" });
    await expect(nav).toBeVisible();
    const finder = nav.getByRole("searchbox", { name: "Was willst du tun?" });
    await finder.fill("Risiko berechnen");
    const hits = nav.getByTestId("nav-finder-results").getByRole("button");
    await expect(hits.first()).toBeVisible({ timeout: 15_000 });
    await expect(hits.first()).toHaveAttribute("data-feature", "positionsrechner");
    await expectNoHorizontalScroll(page);
    await hits.first().click();
    await expect(page).toHaveURL(/#risiko$/);
    await expect(h1(page, "risiko")).toHaveText("Risiko", { timeout: 25_000 });
    await expect(layer(page, "risiko").getByTestId("risk-calc")).toBeInViewport({ timeout: 15_000 });
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

  test("the search understands what you want to do, opens a function from its row and scrolls to its card; Zuletzt benutzt remembers it", async ({ page }) => {
    const errors = collectErrors(page);
    await openFunktionen(page);
    const search = page.getByRole("searchbox", { name: "Was willst du tun?" });
    await search.fill("Risiko berechnen");
    const rows = layer(page, "funktionen").getByTestId("feature-row");
    await expect(rows.first()).toHaveAttribute("data-feature", "positionsrechner");
    await expect(rows.first()).toContainText("Positionsgröße aus Risiko und Stop berechnen");
    await expectNoHorizontalScroll(page);
    // in the user's own words, with a typo
    await search.fill("warum verliere ich");
    await expect(rows.first()).toBeVisible();
    expect(await rows.evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute("data-feature")))).toContain("leaks-edges");
    await search.fill("Wochenbricht");
    expect(await rows.evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute("data-feature")))).toContain("berichte");

    // open: navigates and brings the card into view
    await search.fill("Positionsrechner");
    await rows.first().getByRole("button", { name: "Positionsrechner öffnen" }).click();
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

  test("a tile opens its group; a row opens the place; the system back button returns to the tiles", async ({ page }) => {
    const errors = collectErrors(page);
    await openFunktionen(page);
    await page.locator('[data-testid="funktionen-tile"][data-group="pruefen"]').click();
    const view = page.getByTestId("funktionen-group-view");
    await expect(view).toHaveAttribute("data-group", "pruefen");
    await expect(view.getByRole("heading", { level: 2, name: "Trade prüfen & Chart" })).toBeVisible();
    await expect(view.getByTestId("feature-row").first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    // the system back button (the history layer) goes back to the tiles, not away from the page
    await page.goBack();
    await expect(page.getByTestId("funktionen-tiles")).toBeVisible();
    await expect(page).toHaveURL(/#funktionen$/);
    await page.locator('[data-testid="funktionen-tile"][data-group="risiko"]').click();
    await expect(page.getByTestId("funktionen-group-view")).toHaveAttribute("data-group", "risiko");
    // details: the honest part and "Siehe auch"
    const row = page.locator('[data-testid="feature-row"][data-feature="verlustlimits"]');
    await row.getByTestId("feature-details").click();
    await expect(row.getByTestId("feature-detail-panel")).toContainText("Siehe auch");
    // open from the row
    await row.getByRole("button", { name: "Verlustlimits & Pause öffnen" }).click();
    await expect(page).toHaveURL(/#risiko$/);
    await expect(layer(page, "risiko").getByTestId("risk-limits")).toBeInViewport({ timeout: 15_000 });
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
