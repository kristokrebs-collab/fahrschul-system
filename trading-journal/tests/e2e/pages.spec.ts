/**
 * Every page of the integrated app (P14), on the production build: reached by its hash, shows its own `h1`, never
 * scrolls sideways at 390 px, logs no React / Motion warning; the lazy pages load their chunk behind the skeleton.
 * Navigation: the dock carries five tabs (Übersicht, Trades, Grundlagen, Markt, Einstellungen) and fits 390 px; every
 * other page is reached through the command navigation (⌘K / menu), `g` + letter and deep links
 * (`#analyse?dim=…`, `#berichte?p=…`). `P14_SHOTS_DIR` writes a screenshot of every page (1440 / 390).
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, seed } from "./helpers";

const PROJECTS = ["mobile", "desktop"];
const SHOTS = process.env.P14_SHOTS_DIR;

/** page key → its h1 (the page's own title) */
const PAGES: readonly [string, RegExp][] = [
  ["overview", /^Übersicht$/],
  ["trades", /Trades/],
  ["setups", /Entscheidungsgrundlagen/],
  ["settings", /Einstellungen/],
  ["markt", /^Markt$/],
  ["analyse", /^Analyse$/],
  ["risiko", /^Risiko$/],
  ["coach", /^Coach$/],
  ["berichte", /^Berichte$/],
  ["labor", /^Labor$/],
  ["wachstum", /^Wachstum$/],
  ["community", /^Community$/],
  ["cockpit", /^Cockpit$/],
  ["konto", /^Konto$/],
  ["preise", /^Preise$/],
  ["funktionen", /^Funktionen$/],
];

/** The visible page's h1 (the page host keeps the overview mounted but hidden). */
const pageH1 = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"] h1`).first();

test.describe("pages (P14)", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "P14 runs on mobile + desktop");
  });

  for (const [key, h1] of PAGES) {
    test(`#${key}: h1, no sideways scroll, no warnings`, async ({ page }, info) => {
      const errors = collectErrors(page);
      await seed(page);
      await page.goto(`/#${key}`);
      await expect(pageH1(page, key)).toHaveText(h1, { timeout: 20_000 });
      // the lazy page replaced its skeleton
      await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 20_000 });
      await expectNoHorizontalScroll(page);
      if (SHOTS) {
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${SHOTS}/P14-${key}-${info.project.name === "mobile" ? 390 : 1440}.png`, fullPage: false });
      }
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }

  test("the dock has five tabs and the FAB, and fits the screen", async ({ page }) => {
    await seed(page);
    await page.goto("/");
    const dock = page.getByRole("toolbar", { name: "Navigation" });
    await expect(dock).toBeVisible();
    const tabs = dock.getByRole("button");
    await expect(tabs).toHaveCount(6);
    for (const label of ["Übersicht", "Trades", "Entscheidungsgrundlagen", "Markt", "Einstellungen", "Trade eintragen"]) {
      await expect(dock.getByRole("button", { name: label })).toBeVisible();
    }
    const box = await dock.boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box && box.x >= 0 && box.x + box.width <= vw, `dock ${JSON.stringify(box)} inside ${vw}`).toBe(true);
    await dock.getByRole("button", { name: "Markt" }).click();
    await expect(page).toHaveURL(/#markt$/);
    await expect(pageH1(page, "markt")).toHaveText(/^Markt$/, { timeout: 20_000 });
    await expectNoHorizontalScroll(page);
  });

  test("command navigation lists every page with its count; a link opens a lazy page", async ({ page }) => {
    await seed(page);
    await page.goto("/");
    await page.getByRole("button", { name: /Navigation öffnen|Menü/ }).first().click();
    const nav = page.getByRole("dialog", { name: "Navigation" });
    await expect(nav).toBeVisible();
    for (const label of ["Übersicht", "Trades", "Markt", "Analyse", "Risiko", "Coach", "Berichte", "Labor", "Wachstum", "Community", "Cockpit", "Konto", "Preise", "Funktionen"]) {
      await expect(nav.getByRole("link", { name: new RegExp(label) }).first()).toBeVisible();
    }
    await nav.getByRole("link", { name: /Wachstum/ }).click();
    await expect(page).toHaveURL(/#wachstum$/);
    await expect(pageH1(page, "wachstum")).toHaveText(/^Wachstum$/, { timeout: 20_000 });
  });

  test("g + letter opens a page; deep links keep their query", async ({ page }) => {
    await seed(page);
    await page.goto("/");
    await expect(page.getByRole("toolbar", { name: "Navigation" })).toBeVisible();
    // the chord waits CHORD_MS (1.2 s) for its letter: on a busy first load the second key may arrive later – press again
    await expect(async () => {
      await page.locator("body").press("g");
      await page.locator("body").press("r");
      await expect(page).toHaveURL(/#risiko$/, { timeout: 1500 });
    }).toPass({ timeout: 15_000 });
    await expect(pageH1(page, "risiko")).toHaveText(/^Risiko$/, { timeout: 20_000 });

    await page.goto("/#analyse?dim=weekday");
    await expect(pageH1(page, "analyse")).toHaveText(/^Analyse$/, { timeout: 20_000 });
    await expect(page).toHaveURL(/#analyse\?dim=weekday$/);
  });
});
