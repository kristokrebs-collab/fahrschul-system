/**
 * Motion & a11y: reduced motion, mobile layout (dock, bottom sheet, cards, hero, no horizontal scroll),
 * keyboard (Tab through the dock, Enter opens the editor, Escape closes, focus returns), build artefacts.
 */
import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { collectErrors, expectInViewport, expectNoHorizontalScroll, isMobile, screenshot, seed } from "./helpers";

test("reduced motion: every page and overlay renders, nothing stays invisible", async ({ page }, info) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seed(page);
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  await expect(page.getByTestId("hero-net")).toBeVisible();
  await page.waitForTimeout(800);
  await screenshot(page, info, "reduced-overview");

  const fab = page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Trade eintragen" });
  await fab.click();
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });
  await expect(editor).toBeVisible();
  await expect(editor.locator("#f-entry")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(fab).toBeVisible();

  for (const [hash, heading] of [
    ["trades", /Alle Trades/],
    ["setups", "Entscheidungsgrundlagen"],
    ["settings", "Einstellungen"],
  ] as const) {
    await page.goto(`/#${hash}`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    // no element of the page body is stuck at opacity 0 / visibility hidden
    const stuck = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("main h1, main h2, main h3, main table, main article, main button"))) {
        const cs = getComputedStyle(el);
        if (el.offsetParent === null && cs.position !== "fixed") continue; // display:none / detached: fine
        if (cs.opacity === "0" || cs.visibility === "hidden") out.push(`${el.tagName}: ${el.textContent?.slice(0, 30)}`);
      }
      return out;
    });
    expect(stuck, stuck.join("\n")).toEqual([]);
  }
  await screenshot(page, info, "reduced-settings", true);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("mobile 390×844: dock reachable, bottom sheet, cards, readable hero, no horizontal scroll", async ({ page }, info) => {
  test.skip(!isMobile(info), "mobile project only");
  const errors = collectErrors(page);
  await seed(page);
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  await page.waitForTimeout(1200);
  await expectNoHorizontalScroll(page);
  await screenshot(page, info, "mobile-overview");
  await screenshot(page, info, "mobile-overview-full", true);

  const dock = page.getByRole("toolbar", { name: "Navigation" });
  await expect(dock).toBeVisible();
  const box = await dock.boundingBox();
  expect(box && box.y + box.height <= 844, "dock inside the viewport").toBe(true);

  await dock.getByRole("button", { name: "Trade eintragen" }).click();
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });
  await expect(editor).toBeVisible();
  await page.waitForTimeout(500);
  const sheet = await editor.boundingBox();
  expect(sheet && sheet.y + sheet.height >= 840, "bottom sheet anchored to the bottom edge").toBe(true);
  await screenshot(page, info, "mobile-editor-sheet");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();

  await dock.getByRole("button", { name: "Trades" }).click();
  await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Trades" })).toBeVisible();
  await expect(page.locator("table")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await screenshot(page, info, "mobile-trades");

  await dock.getByRole("button", { name: "Entscheidungsgrundlagen" }).click();
  await expect(page.getByRole("heading", { name: "Entscheidungsgrundlagen" })).toBeVisible();
  await page.waitForTimeout(600);
  await expectNoHorizontalScroll(page);

  await dock.getByRole("button", { name: "Einstellungen" }).click();
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await screenshot(page, info, "mobile-settings");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("sheets keep header and footer on screen: morph (FAB editor) and slide-in (setup editor)", async ({ page }, info) => {
  const errors = collectErrors(page);
  await seed(page);
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  await page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Trade eintragen" }).click();
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });
  await expect(editor.locator("#f-entry")).toBeVisible();
  await page.waitForTimeout(700);
  await expectInViewport(page, editor.getByRole("button", { name: "Schließen", exact: true }), "editor close button");
  await expectInViewport(page, editor.getByRole("button", { name: "Speichern", exact: true }), "editor `Speichern`");
  await expectInViewport(page, editor.getByRole("button", { name: "Speichern & neu" }), "editor `Speichern & neu`");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();

  await page.goto("/#setups");
  await expect(page.getByRole("heading", { name: "Entscheidungsgrundlagen" })).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Neue Entscheidungsgrundlage" }).click();
  const setup = page.getByRole("dialog", { name: "Neue Entscheidungsgrundlage" });
  await expect(setup.locator("#sf-name")).toBeVisible();
  await page.waitForTimeout(700);
  await expectInViewport(page, setup.getByRole("button", { name: "Schließen", exact: true }), "setup editor close button");
  await expectInViewport(page, setup.getByRole("button", { name: "Speichern", exact: true }), "setup editor `Speichern`");
  await screenshot(page, info, "sheet-footer-on-screen");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("keyboard: Tab reaches the dock, Enter opens the editor, Escape closes it and focus returns to the FAB", async ({ page }, info) => {
  const errors = collectErrors(page);
  await seed(page);
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  const fab = page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Trade eintragen" });
  // Tab through the dock: focus the first dock tab, then Tab along the toolbar to the FAB
  await page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Übersicht" }).focus();
  const labels: string[] = [];
  for (let i = 0; i < 6; i++) {
    labels.push(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? ""));
    if (labels[labels.length - 1] === "Trade eintragen") break;
    await page.keyboard.press("Tab");
  }
  expect(labels).toEqual(["Übersicht", "Trades", "Entscheidungsgrundlagen", "Einstellungen", "Trade eintragen"]);
  await expect(fab).toBeFocused();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });
  await expect(editor).toBeVisible();
  // focus moved into the dialog
  expect(await page.evaluate(() => document.activeElement?.closest("[role=dialog]") !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(fab).toBeFocused();
  await screenshot(page, info, "keyboard-fab-focus");

  // detail dialog: Escape closes, focus returns to the row
  await page.goto("/#trades");
  await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
  // same document (hash change): let the page slide settle – `openDetail` is locked while `transitioning`
  await page.waitForTimeout(700);
  const row = isMobile(info) ? page.getByRole("list", { name: "Trades" }).locator("li").first().getByRole("button").first() : page.locator("tbody tr[tabindex='0']").first();
  await row.focus();
  await page.keyboard.press("Enter");
  const detail = page.getByRole("dialog", { name: "Trade-Details" });
  await expect(detail).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await expect(row).toBeFocused();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("build keeps dist/dashboard.html", async () => {
  expect(existsSync(new URL("../../dist/dashboard.html", import.meta.url))).toBe(true);
});
