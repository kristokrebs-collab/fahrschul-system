/**
 * Touch (CDP `Input.dispatchTouchEvent` with explicit timestamps, `helpers.touchKit`), on the touch projects:
 * - sheet swipe-to-dismiss (trade editor): a slow pull springs back, a flick closes, a dirty form resists and asks
 *   "Änderungen verwerfen?" instead;
 * - trade detail grabber: slow pull stays, flick closes;
 * - toast: a half swipe springs back, a sideways flick dismisses it before its timeout;
 * - dock: tapping the active tab again scrolls the page back to the top (all projects);
 * - everything tappable takes a tap in a 44 × 44 px square (touch tablets, pages + editor + detail + navigation);
 * - the Disziplin heat map takes a fat-finger tap beside a traded day.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { centre, collectErrors, hasTouch, isMobile, isTouchTablet, screenshot, scrollUntilVisible, seed, toast, touchKit } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR, type HitBoxMiss } from "./hitbox";

const dock = (page: Page) => page.getByRole("toolbar", { name: "Navigation" });

async function openEditor(page: Page) {
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });
  await dock(page).getByRole("button", { name: "Trade eintragen" }).tap();
  await expect(editor).toBeVisible();
  await expect(editor.locator("#f-entry")).toBeVisible();
  await page.waitForTimeout(900); // open morph settled (the handle is measured from its resting box)
  return editor;
}

const touchOnly = (info: TestInfo) => test.skip(!hasTouch(info), "touch gestures: touch projects only");

test.describe("swipe to dismiss", () => {
  test("trade editor: slow pull springs back, flick closes, a dirty form resists and asks", async ({ page }, info) => {
    touchOnly(info);
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.waitForTimeout(1200);
    const kit = await touchKit(page);

    // clean form: a flick down on the handle closes
    let editor = await openEditor(page);
    const handle = editor.locator("[data-sheet-handle]");
    await kit.flick(await centre(handle), 0, 130);
    await expect(editor).toBeHidden({ timeout: 3000 });

    // a slow pull (released at rest velocity, below the distance threshold) springs back to the same place
    editor = await openEditor(page);
    const y0 = (await handle.boundingBox())!.y;
    await kit.slowPull(await centre(handle), 0, 80);
    await page.waitForTimeout(900);
    await expect(editor).toBeVisible();
    expect(Math.abs((await handle.boundingBox())!.y - y0), "back at rest").toBeLessThan(2);

    // dirty: the flick is resisted, the sheet stays and asks
    await editor.locator("#f-entry").fill("80000");
    await kit.flick(await centre(handle), 0, 160);
    await page.waitForTimeout(800);
    await expect(editor).toBeVisible();
    const confirm = editor.getByTestId("discard-confirm");
    await expect(confirm).toBeVisible();
    expect(Math.abs((await handle.boundingBox())!.y - y0), "resisted: back at rest").toBeLessThan(2);
    await screenshot(page, info, "touch-sheet-dirty-resists");
    await confirm.getByRole("button", { name: "Weiter bearbeiten" }).tap();
    await expect(confirm).toHaveCount(0);
    await expect(editor.locator("#f-entry")).toHaveValue("80000");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("trade detail: slow pull on the grabber stays, a flick closes", async ({ page }, info) => {
    touchOnly(info);
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#trades");
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    await page.waitForTimeout(900);
    const row = isMobile(info) ? page.getByRole("list", { name: "Trades" }).locator("li").first().getByRole("button").first() : page.locator("tbody tr[tabindex='0']").first();
    await row.tap();
    const detail = page.getByRole("dialog", { name: "Trade-Details" });
    await expect(detail).toBeVisible();
    await page.waitForTimeout(900);
    const kit = await touchKit(page);
    const grab = detail.locator("[data-detail-grabber]");
    await expect(grab).toBeVisible();
    await kit.slowPull(await centre(grab), 0, 70);
    await page.waitForTimeout(900);
    await expect(detail).toBeVisible();
    await kit.flick(await centre(grab), 0, 140);
    await expect(detail).toBeHidden({ timeout: 3000 });
    // the page is usable right after the swipe: the next tap opens the detail again (no swallowed tap)
    await row.tap();
    await expect(detail).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test("toast: a half swipe springs back, a sideways flick dismisses it before its timeout", async ({ page }, info) => {
  touchOnly(info);
  await seed(page);
  await page.goto("/#settings");
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  await page.locator("#s-makro").fill("30000");
  await page.getByRole("button", { name: "Speichern", exact: true }).first().tap();
  const island = toast(page);
  await expect(island).toContainText("Einstellungen gespeichert");
  const card = island.getByRole("button").first();
  await page.waitForTimeout(450); // island grown to its full width
  const kit = await touchKit(page);
  const at = await centre(card);
  await kit.slowPull(at, 60, 0);
  await page.waitForTimeout(500);
  await expect(island).toContainText("Einstellungen gespeichert");
  expect(Math.abs((await centre(card)).x - at.x), "springs back").toBeLessThan(3);
  const t0 = Date.now();
  await kit.flick(await centre(card), 170, 0);
  await expect(island).not.toContainText("Einstellungen gespeichert", { timeout: 1500 });
  expect(Date.now() - t0, "dismissed by the flick, not by the 2.8 s timeout").toBeLessThan(1500);
});

test("dock: tapping the active tab again scrolls back to the top", async ({ page }, info) => {
  await seed(page);
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo({ top: 2400, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  const tab = dock(page).getByRole("button", { name: "Übersicht", exact: true });
  if (hasTouch(info)) await tab.tap();
  else await tab.click();
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 4000 }).toBeLessThan(2);
  await expect(page).toHaveURL(/#overview/);
});

test.describe("touch targets ≥ 44 px", () => {
  /**
   * Exempt by design: the Disziplin heat-map days (15–22 px `role=option` cells of ONE listbox; the grid's click handler
   * takes an exact hit or the nearest traded day within 24 px – tested below), see src/views/insights/README.md.
   */
  const exempt = (m: HitBoxMiss) => /^div#heat-\d{4}-\d{2}-\d{2}/.test(m.name);
  const report = (misses: HitBoxMiss[]) => misses.map((m) => `${m.where} · ${m.name} ${m.w}×${m.h} → tappable ${m.ew}×${m.eh} (taken by ${m.stolenBy})`).join("\n");

  async function scrollThrough(page: Page) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h + 1800; y += 600) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
      await page.waitForTimeout(60);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(400);
  }

  for (const p of ["overview", "trades", "setups", "settings"] as const) {
    test(`page ${p}`, async ({ page }, info) => {
      test.skip(!isTouchTablet(info), "touch tablets (the user's Galaxy Tab and 1280×800)");
      test.setTimeout(120_000);
      await seed(page);
      await page.goto(`/#${p}`);
      await page.waitForTimeout(1500);
      await scrollThrough(page);
      const misses = (await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR })).filter((m) => !exempt(m));
      expect(misses, report(misses)).toEqual([]);
    });
  }

  test("overlays: trade editor, trade detail, navigation", async ({ page }, info) => {
    test.skip(!isTouchTablet(info), "touch tablets (the user's Galaxy Tab and 1280×800)");
    test.setTimeout(120_000);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.waitForTimeout(1000);
    const editor = await openEditor(page);
    let misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[role="dialog"]' });
    expect(misses, `editor:\n${report(misses)}`).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();

    await page.goto("/#trades");
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    await page.waitForTimeout(900);
    await page.locator("tbody tr[tabindex='0']").first().tap();
    const detail = page.getByRole("dialog", { name: "Trade-Details" });
    await expect(detail).toBeVisible();
    await page.waitForTimeout(900);
    misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[role="dialog"]' });
    expect(misses, `detail:\n${report(misses)}`).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();

    await page.keyboard.press("Control+k");
    const nav = page.getByRole("dialog", { name: "Navigation" });
    await expect(nav).toBeVisible();
    await page.waitForTimeout(900);
    misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[role="dialog"]' });
    expect(misses, `navigation:\n${report(misses)}`).toEqual([]);
  });

  test("Disziplin heat map: a tap beside a traded day selects it (fat-finger radius)", async ({ page }, info) => {
    test.skip(!isTouchTablet(info), "touch tablets");
    await seed(page);
    await page.goto("/#overview");
    const card = page.getByTestId("insights-discipline");
    await scrollUntilVisible(page, card);
    await page.waitForTimeout(600);
    const traded = card.locator('[role="option"][data-key]').first();
    await expect(traded).toBeVisible();
    const box = (await traded.boundingBox())!;
    // 9 px right of the cell's edge: a gap / neighbouring empty day, inside the 24 px radius
    await page.touchscreen.tap(box.x + box.width + 9, box.y + box.height / 2);
    await expect(traded).toHaveAttribute("aria-selected", "true");
  });
});
