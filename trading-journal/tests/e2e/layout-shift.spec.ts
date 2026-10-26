/**
 * Layout stability of the long pages (Feinschliff Runde 8, Seiten B): late cards (lazy chunks, workers, candles that load) bring
 * their place with them, so nothing below them moves. Two measures per page, mobile + desktop, dark:
 *  - the `layout-shift` entries of the browser (the sum of the shifts without a recent input) stay at or below 0,02, and
 *  - the page does not grow after its first picture: the document height a moment after the heading and a few seconds later
 *    differ by less than 60 px (a skeleton of the finished size instead of a card that arrives bigger).
 * No clock jumps, no waiting for a time of day; the numbers are read at the end, not mid-animation.
 */
import { expect, test } from "@playwright/test";
import { seed } from "./helpers";

const PAGES = ["markt", "analyse", "risiko", "coach", "labor", "studio", "plan", "aktien"] as const;
const PROJECTS = ["mobile", "desktop"];
const MAX_CLS = 0.02;
const MAX_GROWTH = 60;

for (const key of PAGES) {
  test(`${key}: kein Springen nach dem Laden (CLS und Seitenhöhe)`, async ({ page }, info) => {
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop");
    test.setTimeout(90_000);
    await seed(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(`/#${key}`);
    await expect(page.locator(`[data-page="${key}"][data-page-role="current"] h1`).first()).toBeAttached({ timeout: 30_000 });
    await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
    const height = () => page.evaluate(() => document.documentElement.scrollHeight);
    await page.waitForTimeout(1200);
    const first = await height();
    await page.waitForTimeout(5000);
    const last = await height();
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(last - first, `${key}: die Seite wuchs von ${first} auf ${last} px`).toBeLessThan(MAX_GROWTH);
    expect(cls, `${key}: Layout-Verschiebung ${cls.toFixed(4)}`).toBeLessThanOrEqual(MAX_CLS);
  });
}
