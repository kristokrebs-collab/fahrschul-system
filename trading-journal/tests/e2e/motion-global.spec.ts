/**
 * Motion & stability of the whole app (Feinschliff Auftrag 1, mobile 390 + desktop 1440):
 * - layout shift: every page settles with a cumulative layout shift of ≤ 0.02 (late cards reserve their end size),
 *   and the Analyse page's late cards (Monte Carlo, Benchmark) stand at their end size from the first frame;
 * - reduced motion: on every page nothing is stuck invisible and no animation keeps running forever;
 * - reveals: a tall card that never shows 15 % of itself still reveals (a fifth of the screen is enough).
 * No clock jumps, no frame times: only end states and layout facts.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, seed, waitForStableLayout } from "./helpers";

const PROJECTS = ["mobile", "desktop"];

/** page key → its h1 (the page's own title), as in `pages.spec.ts` */
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
  ["studio", /^Strategie-Studio$/],
  ["plan", /^Handelsplan$/],
  ["aktien", /^Aktien$/],
];

const pageH1 = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"] h1`).first();

/** Starts recording `layout-shift` entries (without recent input) before the app's first script. */
async function recordLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      /* no layout-shift entries in this engine: the test then reads 0 */
    }
  });
}
const cls = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls);

test.describe("motion & stability (global)", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop");
  });

  for (const [key, h1] of PAGES) {
    test(`#${key}: settles without layout shift (CLS ≤ 0.02)`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = collectErrors(page);
      await recordLayoutShift(page);
      await seed(page);
      await page.goto(`/#${key}`);
      await expect(pageH1(page, key)).toHaveText(h1, { timeout: 25_000 });
      await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 25_000 });
      await waitForStableLayout(page);
      expect(await cls(page), "cumulative layout shift until the page stopped moving").toBeLessThanOrEqual(0.02);
      expect(errors, errors.join("\n")).toEqual([]);
    });

    test(`#${key}: reduced motion – nothing stuck invisible, no endless animation`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await seed(page);
      await page.goto(`/#${key}`);
      await expect(pageH1(page, key)).toHaveText(h1, { timeout: 25_000 });
      await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 25_000 });
      await waitForStableLayout(page);
      // walk down the page once, so cells that wait for the viewport had their chance
      await page.evaluate(async () => {
        const step = Math.round(window.innerHeight * 0.8);
        for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 30));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(400);
      const found = await page.evaluate(() => {
        // a Reveal that has not run sits at opacity 0 with its y offset in the inline style
        const hidden = Array.from(document.querySelectorAll<HTMLElement>('[data-page-role="current"] *'))
          .filter((el) => el.style.opacity === "0" && /translateY\((8|10|12|14)px\)/.test(el.style.transform))
          .map((el) => `${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ""}`);
        // an animation that never ends (iterations ∞) keeps the page busy for ever
        const endless = document
          .getAnimations()
          .filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations === Infinity)
          .map((a) => {
            const t = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null;
            return `${a instanceof CSSAnimation ? a.animationName : "waapi"} on ${t?.tagName.toLowerCase() ?? "?"}.${(typeof t?.className === "string" ? t.className : "").split(/\s+/).slice(0, 2).join(".")}`;
          });
        return { hidden, endless };
      });
      expect(found.hidden, `still hidden under reduced motion: ${found.hidden.join(", ")}`).toEqual([]);
      expect(found.endless, `endless animations under reduced motion: ${found.endless.join(", ")}`).toEqual([]);
    });
  }

  test("markt (390 px): scrolled through slowly, nothing that is on screen stays at opacity 0 (tall cards reveal too)", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "the tall cards are a phone case");
    test.setTimeout(150_000);
    await seed(page);
    await page.goto("/#markt");
    await expect(pageH1(page, "markt")).toBeVisible({ timeout: 25_000 });
    await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 25_000 });
    await waitForStableLayout(page);
    const stuck = new Set<string>();
    for (let y = 0; ; y += 560) {
      const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      await page.evaluate((to) => window.scrollTo(0, to), Math.min(y, max));
      await page.waitForTimeout(1000);
      const hidden = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('[data-page-role="current"] *'))
          .filter((el) => {
            if (el.style.opacity !== "0" || !/translateY\((8|10|12|14)px\)/.test(el.style.transform)) return false;
            const r = el.getBoundingClientRect();
            const shown = Math.min(r.bottom, window.innerHeight - 50) - Math.max(r.top, 50);
            // on screen: at least a fifth of the (shrunk) viewport, or most of a short element
            return shown >= Math.min(window.innerHeight * 0.2, r.height * 0.6);
          })
          .map((el) => `${el.tagName.toLowerCase()} ${Math.round(el.getBoundingClientRect().height)}px`),
      );
      hidden.forEach((h) => stuck.add(h));
      if (y >= max) break;
    }
    expect([...stuck], "elements on screen that never revealed").toEqual([]);
  });

  test("analyse: the late cards stand at their end size from the first frame (no growth after load)", async ({ page }) => {
    test.setTimeout(90_000);
    await seed(page);
    await page.goto("/#analyse");
    await expect(pageH1(page, "analyse")).toHaveText(/^Analyse$/, { timeout: 25_000 });
    const heights = async () =>
      page.evaluate(() => Object.fromEntries(["ana-mc", "ana-bench"].map((id) => [id, document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.getBoundingClientRect().height ?? 0])));
    // the moment both cards exist …
    await expect.poll(async () => Object.values(await heights()).every((h) => h > 0), { timeout: 25_000 }).toBe(true);
    const first = await heights();
    // … and when the page has stopped moving
    await waitForStableLayout(page);
    const last = await heights();
    for (const id of ["ana-mc", "ana-bench"]) {
      expect(first[id], `${id} at first sight (${first[id]}) vs at rest (${last[id]})`).toBeGreaterThanOrEqual(last[id]! * 0.9);
    }
  });
});
