/**
 * Android back (decision 26): the system back button / back gesture (`page.goBack()`) closes the topmost open dialog
 * first – trade editor (FAB + Bearbeiten), trade detail, navigation, setup editor, morph dialogs – like a native app;
 * unsaved input still asks "Änderungen verwerfen?"; only with no dialog open does back switch the page (hash router).
 * Every dialog owns one same-URL history entry while it is open (`src/store/backStack.ts`), so closing never changes
 * the URL and the history does not grow.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, isMobile, seed } from "./helpers";

const dock = (page: Page) => page.getByRole("toolbar", { name: "Navigation" });
const fab = (page: Page) => dock(page).getByRole("button", { name: "Trade eintragen" });
const current = (page: Page, name: string) => page.locator(`[data-page="${name}"][data-page-role="current"]`);
const depth = (page: Page) => page.evaluate(() => (history.state as { tjBack?: number } | null)?.tjBack ?? 0);
/** No dialog is open and the layer has consumed every dialog entry (the current entry is a page entry). */
async function expectNoDialog(page: Page) {
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
  await expect.poll(() => depth(page)).toBe(0);
}

/** First trade row: `<tr tabindex=0>` on ≥ md, a card button in `ul[aria-label=Trades]` below. */
function firstRow(page: Page, mobile: boolean) {
  return mobile ? page.getByRole("list", { name: "Trades" }).locator("li").first().getByRole("button").first() : page.locator("tbody tr[tabindex='0']").first();
}

/** Übersicht → Trades through the dock: a page entry to go back to. */
async function overviewThenTrades(page: Page) {
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  await dock(page).getByRole("button", { name: "Trades" }).click();
  await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
  await expect(current(page, "trades")).toHaveCount(1);
  await page.waitForTimeout(600); // the page switch has settled
}

/** Opens the FAB editor and waits until its body is usable (the open morph has lifted `inert`). */
async function openEditor(page: Page) {
  await fab(page).click();
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });
  await expect(editor.locator("#f-entry")).toBeVisible();
  await expect(editor.locator("[inert] #f-entry")).toHaveCount(0);
  await expect.poll(() => depth(page)).toBe(1);
  return editor;
}

test("FAB editor: back closes it and the page stays; the next back switches the page", async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page);
  await overviewThenTrades(page);
  const length = await page.evaluate(() => history.length);

  const editor = await openEditor(page);
  await page.goBack();
  await expect(editor).toBeHidden();
  await expectNoDialog(page);
  expect(page.url()).toMatch(/#trades$/);
  await expect(current(page, "trades")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
  // the normal close path: focus returns to the FAB, as after Escape
  await expect(fab(page)).toBeFocused();

  // many cycles, both close paths: the history does not grow
  for (let i = 0; i < 3; i += 1) {
    await openEditor(page);
    if (i % 2) await page.keyboard.press("Escape");
    else await page.goBack();
    await expect(editor).toBeHidden();
    await expectNoDialog(page);
  }
  expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(length + 1);

  await page.goBack();
  await expect(current(page, "overview")).toHaveCount(1);
  expect(page.url()).toMatch(/#overview$/);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("back keeps the scroll position of the page behind the dialog", async ({ page }) => {
  await seed(page);
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" as ScrollBehavior }));
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(300);
  await openEditor(page);
  await page.goBack();
  await expectNoDialog(page);
  await page.waitForTimeout(800);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(2);
  await expect(current(page, "overview")).toHaveCount(1);
});

for (const how of ["Escape", "back"] as const) {
  test(`content that grew above the viewport while the editor was open: closing by ${how} keeps the view (no older scroll restored)`, async ({ page }) => {
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.scrollTo({ top: 1200, behavior: "instant" as ScrollBehavior }));
    await page.waitForTimeout(300);
    const editor = await openEditor(page);
    // e.g. a saved trade adds a row above: scroll anchoring keeps the view, the window's offset grows
    await page.evaluate(() => {
      const grow = document.createElement("div");
      grow.style.height = "300px";
      document.querySelector('[data-page="overview"]')?.prepend(grow);
    });
    await page.waitForTimeout(300);
    const open = await page.evaluate(() => window.scrollY);
    if (how === "Escape") await page.keyboard.press("Escape");
    else await page.goBack();
    await expect(editor).toBeHidden();
    await expectNoDialog(page);
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => window.scrollY);
    expect(Math.abs(after - open), `scrolled from ${open} to ${after}`).toBeLessThanOrEqual(2);
  });
}

test("trade detail: back closes it; Bearbeiten hands off to the editor, back closes that, the next back switches the page", async ({ page }, info) => {
  const errors = collectErrors(page);
  await seed(page);
  await overviewThenTrades(page);
  const detail = page.getByRole("dialog", { name: "Trade-Details" });

  await firstRow(page, isMobile(info)).click();
  await expect(detail).toBeVisible();
  await expect.poll(() => depth(page)).toBe(1);
  await page.waitForTimeout(500); // open morph settled
  await page.goBack();
  await expect(detail).toBeHidden();
  await expectNoDialog(page);
  await expect(current(page, "trades")).toHaveCount(1);
  // focus returns to the row that opened the detail, never <body>
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? "BODY")).not.toBe("BODY");

  await page.waitForTimeout(500);
  await firstRow(page, isMobile(info)).click();
  await expect(detail).toBeVisible();
  await page.waitForTimeout(500);
  await detail.getByRole("button", { name: "Bearbeiten" }).click();
  const editor = page.getByRole("dialog", { name: "Trade bearbeiten" });
  await expect(editor).toBeVisible();
  await expect(detail).toBeHidden();
  // the editor took over the detail's entry (one dialog open → one entry)
  await expect.poll(() => depth(page)).toBe(1);
  await page.waitForTimeout(500);
  await page.goBack();
  await expect(editor).toBeHidden();
  await expect(detail).toBeHidden();
  await expectNoDialog(page);
  await expect(current(page, "trades")).toHaveCount(1);

  await page.goBack();
  await expect(current(page, "overview")).toHaveCount(1);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("nested: editor → + Neue Grundlage → setup editor; back closes the setup editor, then the trade editor", async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page);
  await overviewThenTrades(page);
  const editor = await openEditor(page);
  await editor.getByRole("button", { name: "+ Neue Grundlage" }).click();
  const setup = page.getByRole("dialog", { name: "Neue Entscheidungsgrundlage" });
  await expect(setup.locator("#sf-name")).toBeVisible();
  await expect.poll(() => depth(page)).toBe(2);
  await page.waitForTimeout(500);

  await page.goBack();
  await expect(setup).toBeHidden();
  await expect(editor).toBeVisible();
  await expect.poll(() => depth(page)).toBe(1);

  await page.goBack();
  await expect(editor).toBeHidden();
  await expectNoDialog(page);
  await expect(current(page, "trades")).toHaveCount(1);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("navigation: back closes it on the same page; a page link replaces its entry, back returns to the page it was opened on", async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page);
  await overviewThenTrades(page);
  const nav = page.getByRole("dialog", { name: "Navigation" });

  await page.getByRole("button", { name: "Navigation öffnen" }).click();
  await expect(nav).toBeVisible();
  await expect.poll(() => depth(page)).toBe(1);
  await page.waitForTimeout(900); // open wipe
  await page.goBack();
  await expect(nav).toBeHidden();
  await expectNoDialog(page);
  await expect(current(page, "trades")).toHaveCount(1);

  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Navigation öffnen" }).click();
  await expect(nav).toBeVisible();
  await page.waitForTimeout(1200); // links faded in
  await nav.getByRole("link", { name: /Einstellungen/ }).click();
  await expect(nav).toBeHidden();
  await expect(current(page, "settings")).toHaveCount(1);
  await expectNoDialog(page);
  expect(page.url()).toMatch(/#settings$/);

  await page.goBack();
  await expect(current(page, "trades")).toHaveCount(1);
  expect(page.url()).toMatch(/#trades$/);
  await page.goBack();
  await expect(current(page, "overview")).toHaveCount(1);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("unsaved editor: back asks `Änderungen verwerfen?`; Weiter bearbeiten keeps it, back asks again, Verwerfen closes", async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page);
  await overviewThenTrades(page);
  const editor = await openEditor(page);
  await editor.locator("#f-entry").click();
  await editor.locator("#f-entry").fill("80123");

  await page.goBack();
  const confirm = editor.getByTestId("discard-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Änderungen verwerfen?");
  await expect(editor).toBeVisible();
  // the dialog keeps an entry, so the next back works again
  await expect.poll(() => depth(page)).toBe(1);
  await expect(current(page, "trades")).toHaveCount(1);

  await confirm.getByRole("button", { name: "Weiter bearbeiten" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(editor.locator("#f-entry")).toHaveValue("80123");

  await page.goBack();
  await expect(editor.getByTestId("discard-confirm")).toBeVisible();
  await expect(editor).toBeVisible();
  await expect.poll(() => depth(page)).toBe(1);
  await editor.getByTestId("discard-confirm").getByRole("button", { name: "Verwerfen" }).click();
  await expect(editor).toBeHidden();
  await expectNoDialog(page);
  await expect(current(page, "trades")).toHaveCount(1);
  expect(page.url()).toMatch(/#trades$/);

  // nothing was saved, and back now switches the page
  const trades = await page.evaluate(() => JSON.parse(localStorage.getItem("tj2-trades") ?? "[]") as { entry: number }[]);
  expect(trades.some((t) => t.entry === 80123)).toBe(false);
  await page.goBack();
  await expect(current(page, "overview")).toHaveCount(1);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("`Speichern & neu` keeps the editor and its one entry; Speichern closes it without a page switch", async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page);
  await overviewThenTrades(page);
  const length = await page.evaluate(() => history.length);
  const editor = await openEditor(page);
  await editor.locator("#f-entry").fill("80000");
  await editor.locator("#f-exit").fill("82000");
  await editor.locator("#f-size").fill("5000");
  await editor.locator("#f-reason").fill("E2E Back 1");
  await editor.getByRole("button", { name: "Speichern & neu" }).click();
  await expect(editor.locator("#f-reason")).toHaveValue("");
  await expect(editor).toBeVisible();
  await page.waitForTimeout(300);
  expect(await depth(page)).toBe(1);

  await editor.locator("#f-entry").fill("81000");
  await editor.locator("#f-exit").fill("80000");
  await editor.locator("#f-size").fill("4000");
  await editor.locator("#f-reason").fill("E2E Back 2");
  await editor.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(editor).toBeHidden();
  await expectNoDialog(page);
  await expect(current(page, "trades")).toHaveCount(1);
  expect(page.url()).toMatch(/#trades$/);
  expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(length + 1);
  const reasons = await page.evaluate(() => (JSON.parse(localStorage.getItem("tj2-trades") ?? "[]") as { reason?: string }[]).map((t) => t.reason));
  expect(reasons).toEqual(expect.arrayContaining(["E2E Back 1", "E2E Back 2"]));
  await page.goBack();
  await expect(current(page, "overview")).toHaveCount(1);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("morph dialog: back closes a fact dialog and its card takes the panel back", async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page);
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  const tile = page.locator('dl [aria-haspopup="dialog"]', { has: page.locator("dt", { hasText: "Win-Rate" }) }).first();
  await tile.click();
  const dialog = page.getByRole("dialog", { name: "Win-Rate" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => depth(page)).toBe(1);
  await page.waitForTimeout(600);
  await page.goBack();
  await expect(dialog).toBeHidden();
  await expectNoDialog(page);
  await expect(tile).toBeVisible();
  await expect(current(page, "overview")).toHaveCount(1);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("reduced motion: back closes the editor (guard included) and the navigation, then switches the page", async ({ page }) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seed(page);
  await overviewThenTrades(page);

  const editor = await openEditor(page);
  await editor.locator("#f-entry").fill("80123");
  await page.goBack();
  await expect(editor.getByTestId("discard-confirm")).toBeVisible();
  await expect.poll(() => depth(page)).toBe(1);
  await editor.getByTestId("discard-confirm").getByRole("button", { name: "Verwerfen" }).click();
  await expect(editor).toBeHidden();
  await expectNoDialog(page);

  const nav = page.getByRole("dialog", { name: "Navigation" });
  await page.getByRole("button", { name: "Navigation öffnen" }).click();
  await expect(nav).toBeVisible();
  await expect.poll(() => depth(page)).toBe(1);
  await page.goBack();
  await expect(nav).toBeHidden();
  await expectNoDialog(page);
  await expect(current(page, "trades")).toHaveCount(1);

  await page.goBack();
  await expect(current(page, "overview")).toHaveCount(1);
  expect(errors, errors.join("\n")).toEqual([]);
});
