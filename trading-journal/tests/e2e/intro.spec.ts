import { expect, test, type Page } from "@playwright/test";
import { collectErrors, fixture, seed } from "./helpers";
import { mockMarket } from "./mocks/market";

/**
 * The opening intro ("das Journal baut sich auf"). Unlike every other spec this one does NOT set the session flag
 * `tj2-intro`, so the intro autoplays on the overview.
 */
async function seedWithIntro(page: Page): Promise<void> {
  await mockMarket(page, "live");
  await page.addInitScript((fx) => {
    for (const [k, v] of Object.entries(fx as Record<string, unknown>)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  }, fixture);
}

const stage = (page: Page) => page.getByRole("dialog", { name: "Intro" });

/**
 * Settled app: no stage, app root not inert, every overview cell at transform none, cells on screen (and their reveal
 * wrapper) fully opaque. "On screen" uses the Reveal's own viewport (`src/motion/Reveal.tsx` REVEAL_VIEWPORT margin
 * −50 px): a cell whose top edge peeks less than 50 px above the fold reveals on the first scroll, like every reveal.
 */
async function expectSettled(page: Page): Promise<void> {
  await expect(stage(page)).toHaveCount(0);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", /.*/);
  const cells = await page.locator("[data-intro-cell]").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const inView = r.top < innerHeight - 50 && r.bottom > 50;
      const chain: number[] = [];
      for (let n: Element | null = el.firstElementChild; n && chain.length < 2; n = n.firstElementChild) chain.push(+getComputedStyle(n).opacity);
      return { transform: getComputedStyle(el).transform, opacity: +getComputedStyle(el).opacity, inView, chain };
    }),
  );
  expect(cells.length).toBeGreaterThan(5);
  for (const c of cells) {
    expect(c.transform).toBe("none");
    expect(c.opacity).toBe(1);
    if (c.inView) expect(Math.min(...c.chain), JSON.stringify(c)).toBeGreaterThan(0.99);
  }
  const grid = await page.locator("[data-intro-cell]").first().evaluate((el) => {
    const g = el.parentElement as HTMLElement;
    return { transform: getComputedStyle(g).transform, filter: getComputedStyle(g).filter };
  });
  expect(grid).toEqual({ transform: "none", filter: "none" });
}

test.describe("intro", () => {
  test("plays on a fresh session, the pill skips it, the app is interactive afterwards", async ({ page }) => {
    const errors = collectErrors(page);
    await seedWithIntro(page);
    await page.goto("/#overview");
    await expect(stage(page)).toBeVisible();
    await expect(page.locator("#root")).toHaveAttribute("inert", "");
    expect(await page.evaluate(() => sessionStorage.getItem("tj2-intro"))).toBe("1");
    const pill = page.getByRole("button", { name: "Überspringen" });
    await expect(pill).toBeVisible();
    await page.waitForTimeout(600);
    const t0 = Date.now();
    await pill.click();
    await expect(stage(page)).toHaveCount(0, { timeout: 2000 });
    expect(Date.now() - t0).toBeLessThan(1500);
    await page.waitForTimeout(900); // reveals inside the landed cells
    await expectSettled(page);
    await page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Trades" }).click();
    await expect(page).toHaveURL(/#trades/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Esc skips; the skip pill is reachable by keyboard", async ({ page }) => {
    await seedWithIntro(page);
    await page.goto("/#overview");
    await expect(stage(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Überspringen" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(stage(page)).toHaveCount(0, { timeout: 2000 });
    await page.waitForTimeout(900);
    await expectSettled(page);
  });

  test("plays through to the end and lands every cell; a reload in the same session does not replay", async ({ page }) => {
    const errors = collectErrors(page);
    await seedWithIntro(page);
    await page.goto("/#overview");
    await expect(stage(page)).toBeVisible();
    await expect(stage(page)).toHaveCount(0, { timeout: 15_000 });
    await page.waitForTimeout(900);
    await expectSettled(page);
    await expect(page.getByTestId("hero-net")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.waitForTimeout(400);
    await expect(stage(page)).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("no intro under reduced motion or on a deep link into another page", async ({ page }) => {
    await seedWithIntro(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.waitForTimeout(500);
    await expect(stage(page)).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => sessionStorage.clear());
    await page.goto("/#trades");
    await page.reload();
    await page.waitForTimeout(800);
    await expect(stage(page)).toHaveCount(0);
  });

  test("switched off in the settings (tj2-ui-intro = off): no intro", async ({ page }) => {
    await seedWithIntro(page);
    await page.addInitScript(() => localStorage.setItem("tj2-ui-intro", "off"));
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.waitForTimeout(500);
    await expect(stage(page)).toHaveCount(0);
  });

  test("header logo replays the intro from another page and lands on the overview top", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page); // session flag set: no autoplay
    await page.goto("/#trades");
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.locator("header").getByRole("button", { name: "Übersicht" }).click();
    await expect(stage(page)).toBeVisible();
    await expect(page).toHaveURL(/#overview/);
    await page.keyboard.press("Escape");
    await expect(stage(page)).toHaveCount(0, { timeout: 2000 });
    await page.waitForTimeout(900);
    await expectSettled(page);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(4);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Settings: the intro switch writes tj2-ui-intro, \"Intro jetzt abspielen\" replays on the overview", async ({ page }) => {
    await seed(page);
    await page.goto("/#settings");
    await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
    const sw = page.getByRole("switch", { name: "Intro beim Start abspielen" });
    await sw.scrollIntoViewIfNeeded();
    await sw.click();
    expect(await page.evaluate(() => localStorage.getItem("tj2-ui-intro"))).toBe("off");
    await sw.click();
    expect(await page.evaluate(() => localStorage.getItem("tj2-ui-intro"))).toBe("on");
    await page.getByRole("button", { name: "Intro jetzt abspielen" }).click();
    await expect(stage(page)).toBeVisible();
    await expect(page).toHaveURL(/#overview/);
    await page.getByRole("button", { name: "Überspringen" }).click();
    await expect(stage(page)).toHaveCount(0, { timeout: 2000 });
    await page.waitForTimeout(900);
    await expectSettled(page);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(4);
  });
});
