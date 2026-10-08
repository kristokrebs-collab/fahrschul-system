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
  const island = toast(page);
  const card = island.getByRole("button").first();
  const kit = await touchKit(page);
  const saveWith = async (makro: string) => {
    await page.locator("#s-makro").fill(makro);
    await page.getByRole("button", { name: "Speichern", exact: true }).first().tap();
    await expect(island).toContainText("Einstellungen gespeichert");
  };

  // a slow half swipe springs back (the toast's 2.8 s countdown pauses from the moment the finger lands)
  await saveWith("30000");
  const at = await centre(card);
  await kit.slowPull(at, 60, 0);
  await page.waitForTimeout(350);
  await expect(island).toContainText("Einstellungen gespeichert");
  expect(Math.abs((await centre(card)).x - at.x), "springs back").toBeLessThan(3);

  // a fresh toast, thrown sideways: it rides the finger and flies out that way (a timed-out toast shrinks in place)
  await expect(island).not.toContainText("Einstellungen gespeichert", { timeout: 6000 });
  await saveWith("31000");
  const from = await centre(card);
  await kit.flick(from, 170, 0);
  const offsets = await page.evaluate(async (x0) => {
    const out: number[] = [];
    for (let i = 0; i < 16; i++) {
      const b = document.querySelector("[data-toast-island] button");
      if (!b) break;
      const r = b.getBoundingClientRect();
      out.push(r.left + r.width / 2 - x0);
      await new Promise((res) => setTimeout(res, 25));
    }
    return out;
  }, from.x);
  // flung: the offset keeps growing until the island is gone (a half swipe would spring back towards 0)
  const last = offsets[offsets.length - 1] ?? Infinity;
  expect(last > 100 && last >= (offsets[0] ?? 0) - 5, `island x offsets after the flick: ${offsets.map(Math.round).join(", ")}`).toBe(true);
  await expect(island).not.toContainText("Einstellungen gespeichert", { timeout: 3000 });
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
    // a traded day whose right neighbour (the same weekday a week later) has no trades: the tap lands on an empty day
    // (the number of weeks follows the card width, so which day that is depends on the layout)
    const id = await card.evaluate((root) => {
      const cells = Array.from(root.querySelectorAll<HTMLElement>('[role="option"][data-key]'));
      const next = (key: string) => {
        const d = new Date(key + "T12:00");
        d.setDate(d.getDate() + 7);
        return `heat-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      };
      const free = cells.find((c) => {
        const n = root.querySelector<HTMLElement>(`#${next(c.dataset.key!)}`);
        return n && !n.dataset.key;
      });
      return free?.id ?? null;
    });
    expect(id).not.toBeNull();
    const traded = card.locator(`#${id}`);
    await expect(traded).toBeVisible();
    const box = (await traded.boundingBox())!;
    // 9 px right of the cell's edge: a gap / neighbouring empty day, inside the 24 px radius
    await page.touchscreen.tap(box.x + box.width + 9, box.y + box.height / 2);
    await expect(traded).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("touch review fixes", () => {
  test("candle chart: a vertical swipe scrolls the page, the chart keeps horizontal panning", async ({ page }, info) => {
    touchOnly(info);
    await seed(page, { synth: { ratios: "whale-long", anchor: Date.now() } });
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const card = page.locator("#chart-card");
    await card.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    const canvas = card.locator("canvas").first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    const b = (await canvas.boundingBox())!;
    const kit = await touchKit(page);
    const at = { x: b.x + b.width * 0.45, y: b.y + b.height * 0.6 };
    const y0 = await page.evaluate(() => window.scrollY);
    await kit.drag(at, { x: at.x, y: at.y - 220 }, 280);
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 3000 }).toBeGreaterThan(y0 + 100);
  });

  test("morph dialog: once the card took the panel back, it never flashes up again empty nor catches taps", async ({ page }, info) => {
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const tile = page.locator('dl [aria-haspopup="dialog"]').nth(1);
    await tile.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await page.waitForTimeout(700);
    if (hasTouch(info)) await tile.tap();
    else await tile.click();
    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(1400);
    const box = (await dialog.boundingBox())!;
    // per frame after the close: the dialog box, its effective opacity and what a tap at its centre would hit
    await page.evaluate((bx) => {
      const w = window as unknown as { __ghost: { t: number; w: number; op: number; inOverlay: boolean }[] };
      w.__ghost = [];
      const t0 = performance.now();
      const step = () => {
        const t = performance.now() - t0;
        const d = document.querySelector<HTMLElement>('[role="dialog"]');
        if (d) {
          const r = d.getBoundingClientRect();
          let op = 1;
          for (let n: HTMLElement | null = d; n && n !== document.documentElement; n = n.parentElement) {
            const cs = getComputedStyle(n);
            op *= Number(cs.opacity);
            if (cs.visibility === "hidden") op = 0;
          }
          const hit = document.elementFromPoint(bx.x + bx.width / 2, bx.y + bx.height / 2);
          w.__ghost.push({ t, w: r.width, op, inOverlay: !!hit?.closest(".z-\\[70\\]") });
        }
        if (t < 2400) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, box);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(2600);
    const log = await page.evaluate(() => (window as unknown as { __ghost: { t: number; w: number; op: number; inOverlay: boolean }[] }).__ghost);
    let shrunk = false;
    const ghosts: number[] = [];
    for (const s of log) {
      if (s.op < 0.05 || s.w < box.width * 0.8) shrunk = true;
      if (shrunk && Math.abs(s.w - box.width) < box.width * 0.05 && (s.op > 0.05 || s.inOverlay)) ghosts.push(Math.round(s.t));
    }
    expect(ghosts, `frames with the empty panel back at full size: ${ghosts.join(", ")} ms`).toEqual([]);
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });

  test("hero tile: after a tap and closing its dialog no verdict popover stays open", async ({ page }, info) => {
    test.skip(!isTouchTablet(info), "touch tablets (the phone has no popover)");
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const tile = page.locator('dl [aria-haspopup="dialog"]').nth(1);
    await tile.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await page.waitForTimeout(600);
    await tile.tap();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(1200);
    await dialog.getByRole("button", { name: "Schließen" }).tap();
    await expect(dialog).toHaveCount(0, { timeout: 4000 });
    await page.waitForTimeout(1200);
    await expect(page.locator("dl p")).toHaveCount(0);
  });

  test("phone: a tap just below the range pills never collapses the chart", async ({ page }, info) => {
    test.skip(!isMobile(info), "phone layout (the chart header wraps)");
    await seed(page, { synth: { ratios: "whale-long", anchor: Date.now() } });
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const card = page.locator("#chart-card");
    await card.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
    await page.waitForTimeout(800);
    const expander = card.getByRole("button", { name: /Details (schließen|zeigen): Chart/ });
    await expect(expander).toHaveAccessibleName("Details schließen: Chart");
    const pill = card.getByRole("radio", { name: "1W", exact: true });
    const b = (await pill.boundingBox())!;
    // inside the pill's own coarse tap band (10 px below its box)
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height + 7);
    await expect(pill).toHaveAttribute("aria-checked", "true");
    await expect(expander).toHaveAccessibleName("Details schließen: Chart");
  });
});
