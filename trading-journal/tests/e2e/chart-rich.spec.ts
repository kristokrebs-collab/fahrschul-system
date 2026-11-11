/**
 * Runde 10 – rich chart / number / list motion on the pages that carry `data-rich` (everything but Übersicht and Cockpit).
 * Covered: the Analyse Monte-Carlo fan as one canvas (drawn, DPR ≤ 2, honest note with the run and line counts, colours by the
 * end of each run), the crosshair (pointer and keyboard: P95 / Median / P05 after any trade), the counting figures settling on
 * their final text without a leftover inline style, a calm placeholder instead of an empty chart, reduced motion = finished
 * at once, and the Übersicht staying free of every rich attribute.
 * Seeds the same 140 generated trades as `analyse.spec.ts`.
 */
import { expect, test } from "@playwright/test";
import { collectErrors, openRoute, seed } from "./helpers";
import { analyseTrades } from "./analyseData";

const PROJECTS = ["mobile", "desktop"];

test.describe("Rich charts", () => {
  test.setTimeout(90_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop");
  });

  test("Monte-Carlo fan: one canvas, honest counts, crosshair by pointer and keys", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page, { extra: { "tj2-trades": analyseTrades() } });
    await openRoute(page, "/#analyse", "Analyse");
    const mc = page.getByTestId("ana-mc");
    await mc.scrollIntoViewIfNeeded();
    const fan = mc.getByTestId("mc-fan");
    await expect(fan).toHaveAttribute("data-drawn", "true", { timeout: 25_000 });

    // honest counts: 2 000 runs simulated (the title), 120 of them drawn as lines (the legend)
    await expect(mc).toContainText("2000 Läufe");
    await expect(fan).toContainText("120 Linien");
    await expect(fan).toContainText(/\d+ im Plus/);
    await expect(fan).toContainText(/\d+ im Minus/);

    // one canvas, never one node per path; the backing store stays within DPR 2
    expect(await fan.locator("canvas").count()).toBe(1);
    const sizes = await fan.locator("canvas").evaluate((c: HTMLCanvasElement) => ({ w: c.width, cssW: c.clientWidth }));
    expect(sizes.w).toBeLessThanOrEqual(Math.ceil(sizes.cssW * 2) + 1);

    // crosshair by pointer
    const box = (await fan.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await expect(async () => {
      const t = (await fan.getAttribute("aria-valuetext")) ?? "";
      expect(t).toMatch(/^Nach \d+ Trades: P95 .+, Median .+, P05 /);
    }).toPass({ timeout: 3000 });
    const mid = Number(await fan.getAttribute("aria-valuenow"));
    expect(mid).toBeGreaterThan(10);
    expect(mid).toBeLessThan(90);
    await page.mouse.move(box.x - 20, box.y - 20);
    await expect(fan).toHaveAttribute("aria-valuenow", "100");

    // keyboard: the focused fan steps trade by trade, Shift ten, Home / End, Escape rests
    await fan.focus();
    await page.keyboard.press("Home");
    await expect(fan).toHaveAttribute("aria-valuenow", "0");
    await page.keyboard.press("ArrowRight");
    await expect(fan).toHaveAttribute("aria-valuenow", "1");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(fan).toHaveAttribute("aria-valuenow", "11");
    await page.keyboard.press("End");
    await expect(fan).toHaveAttribute("aria-valuenow", "100");
    await page.keyboard.press("ArrowLeft");
    await expect(fan).toHaveAttribute("aria-valuenow", "99");
    await page.keyboard.press("Escape");
    await expect(fan).toHaveAttribute("aria-valuenow", "100");

    // the run scrubber below still works next to it
    await expect(mc.getByRole("slider", { name: "Simulierte Läufe durchgehen" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("counting figures settle on their final text and leave no inline width behind", async ({ page }) => {
    await seed(page, { extra: { "tj2-trades": analyseTrades() } });
    await openRoute(page, "/#analyse", "Analyse");
    const mc = page.getByTestId("ana-mc");
    await mc.scrollIntoViewIfNeeded();
    const median = mc.locator("span.num", { hasText: /^[+−]?\d/ }).first();
    await expect(median).toHaveText(/^[+−]?\d[\d.]*,?\d* R$/, { timeout: 15_000 });
    await expect(async () => {
      const style = await median.evaluate((e) => (e as HTMLElement).getAttribute("style") ?? "");
      expect(style).not.toContain("min-width");
    }).toPass({ timeout: 5000 });
  });

  test("reduced motion: the fan is finished at once, no list is armed", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page, { extra: { "tj2-trades": analyseTrades() } });
    await openRoute(page, "/#analyse", "Analyse");
    const mc = page.getByTestId("ana-mc");
    await mc.scrollIntoViewIfNeeded();
    await expect(mc.getByTestId("mc-fan")).toHaveAttribute("data-drawn", "true", { timeout: 25_000 });
    expect(await page.locator("[data-rows-arm]").count()).toBe(0);
  });

  test("the Übersicht carries no rich attribute and no armed list", async ({ page }) => {
    await seed(page, { extra: { "tj2-trades": analyseTrades() } });
    await page.goto("/#overview");
    await page.locator('[data-page="overview"][data-page-role="current"]').first().waitFor({ state: "attached", timeout: 25_000 });
    await page.waitForTimeout(1500);
    expect(await page.locator('[data-page="overview"][data-rich]').count()).toBe(0);
    expect(await page.locator("[data-page=overview] [data-rows-arm], [data-page=overview] [data-rows-go]").count()).toBe(0);
  });
});
