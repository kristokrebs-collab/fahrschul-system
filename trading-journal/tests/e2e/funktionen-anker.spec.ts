/**
 * Every function of the register can be found where it says it is: the page "Funktionen" lists each function with its page and
 * anchor (`data-page` / `data-anchor` of the row); this spec opens every page and checks that each anchor really stands in the
 * DOM of the page – except what only appears after an action or with a cloud account (the register says so in `needs`). And
 * the "Inhalt" strip of the long pages: every chip scrolls its section right under the strip (reduced motion: the jump path),
 * the strip sticks directly under the header and the page does not scroll sideways. No clocks, nothing that depends on the
 * market mock's time.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, seed } from "./helpers";

const PROJECTS = ["mobile", "desktop"];

interface Row {
  id: string;
  page: string;
  testid: string;
  heading: string;
  action: string;
  needs: string;
}

const layer = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"]`);

async function readRegister(page: Page): Promise<Row[]> {
  await page.goto("/#funktionen");
  await expect(layer(page, "funktionen").locator("h1").first()).toHaveText("Funktionen", { timeout: 25_000 });
  await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 25_000 });
  const groups = await page.getByTestId("funktionen-tile").evaluateAll((els) => els.map((e) => e.getAttribute("data-group")!));
  expect(groups).toHaveLength(12);
  const rows: Row[] = [];
  for (const g of groups) {
    await page.locator(`[data-testid="funktionen-tile"][data-group="${g}"]`).click();
    await expect(page.getByTestId("funktionen-group-view")).toHaveAttribute("data-group", g);
    rows.push(
      ...(await page.getByTestId("feature-row").evaluateAll((els) =>
        els.map((e) => ({
          id: e.getAttribute("data-feature")!,
          page: e.getAttribute("data-page")!,
          testid: e.getAttribute("data-anchor")!,
          heading: e.getAttribute("data-anchor-heading")!,
          action: e.getAttribute("data-action")!,
          needs: e.getAttribute("data-needs")!,
        })),
      )),
    );
    await page.getByTestId("funktionen-back").click();
    await expect(page.getByTestId("funktionen-tile").first()).toBeVisible();
  }
  return rows;
}

/** scrolls through the page once so lazy and deferred cards mount */
async function mountEverything(page: Page): Promise<void> {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h + 1200; y += 600) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
    await page.waitForTimeout(50);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(300);
}

test.describe("Funktionen: Anker und Inhalt", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("every anchor of the register is in the DOM of its page", async ({ page }) => {
    test.setTimeout(480_000); // twelve groups and every page of the register, on a loaded machine
    const errors = collectErrors(page);
    await seed(page);
    const rows = await readRegister(page);
    expect(rows.length).toBeGreaterThan(120);
    expect(new Set(rows.map((r) => r.id)).size, "each function is in exactly one group").toBe(rows.length);

    const pages = [...new Set(rows.filter((r) => (r.testid || r.heading) && !r.needs && !r.action).map((r) => r.page))];
    const misses: string[] = [];
    for (const p of pages) {
      await page.goto(`/#${p}`);
      await expect(layer(page, p).locator("h1").first()).toBeAttached({ timeout: 30_000 });
      await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
      await page.waitForTimeout(600);
      await mountEverything(page);
      const mine = rows.filter((r) => r.page === p && (r.testid || r.heading) && !r.needs && !r.action);
      const found = await page.evaluate(
        ({ key, list }) => {
          const root = document.querySelector(`[data-page="${key}"][data-page-role="current"]`)!;
          return list.map((r) => {
            const byId = r.testid ? root.querySelector(`[data-testid="${r.testid}"]`) : null;
            const byHeading = r.heading ? Array.from(root.querySelectorAll("h2, h3")).find((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim().startsWith(r.heading)) : null;
            return { id: r.id, ok: !!(byId ?? byHeading), what: r.testid || r.heading };
          });
        },
        { key: p, list: mine },
      );
      for (const f of found) if (!f.ok) misses.push(`${f.id} → ${p}: „${f.what}“ is not in the DOM`);
    }
    expect(misses).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the Inhalt strip of every long page: each chip scrolls its section under the strip, the strip sticks under the header", async ({ page }) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    // the jump path of reduced motion: the scroll is instant, the check needs no waiting for an animation
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page);
    const withNav = ["markt", "coach", "analyse", "risiko", "labor", "wachstum", "berichte", "settings"];
    const problems: string[] = [];
    for (const p of withNav) {
      await page.goto(`/#${p}`);
      await expect(layer(page, p).locator("h1").first()).toBeAttached({ timeout: 30_000 });
      await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
      const nav = layer(page, p).getByTestId("section-nav");
      await expect(nav).toBeVisible({ timeout: 20_000 });
      // the strip looks for its sections for three seconds and then drops the chip of one that is not on the page (a card that
      // needs a run or a hypothesis first): wait that out, then the chips are what stays
      await page.waitForTimeout(3600);
      const chips = nav.locator("[data-section-chip]");
      const n = await chips.count();
      expect(n, p).toBeGreaterThanOrEqual(3);
      await expectNoHorizontalScroll(page);
      // the strip sits in the flow under the page header; scrolled down it sticks right under the app header
      const headerBottom = await page.evaluate(() => Math.round(document.querySelector("header")!.getBoundingClientRect().bottom));
      await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }));
      await page.waitForTimeout(200);
      const stuck = await nav.evaluate((el) => Math.round(el.getBoundingClientRect().top));
      if (Math.abs(stuck - headerBottom) > 1) problems.push(`${p}: strip at ${stuck}, header ends at ${headerBottom}`);
      for (let i = 0; i < n; i++) {
        const id = (await chips.nth(i).getAttribute("data-section-chip"))!;
        await chips.nth(i).click();
        const probe = () =>
          page.evaluate(
            ({ key, id }) => {
              const root = document.querySelector(`[data-page="${key}"][data-page-role="current"]`)!;
              const el = root.querySelector(`[data-section="${id}"]`) ?? root.querySelector(`[data-testid="${id}"]`) ?? root.querySelector(`[id="${id}"]`);
              const navEl = root.querySelector('[data-testid="section-nav"]')!;
              const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
              return { found: !!el, gap: el ? Math.round(el.getBoundingClientRect().top - navEl.getBoundingClientRect().bottom) : null, atEnd };
            },
            { key: p, id },
          );
        // the section ends up just under the strip – once the cards above it have arrived (lazy ones swap a skeleton for the
        // card after the jump; the page then brings the section back to its line). Cards found by their heading (settings) have
        // no direct id here.
        const settled = (r: Awaited<ReturnType<typeof probe>>): boolean => !r.found || r.gap === null || r.atEnd || (r.gap >= -2 && r.gap <= 70);
        await expect.poll(async () => settled(await probe()), { timeout: 9000, message: `${p}/${id}: ${JSON.stringify(await probe())}` }).toBe(true);
        await expectNoHorizontalScroll(page);
      }
    }
    expect(problems).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
