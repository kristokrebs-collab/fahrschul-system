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
 * The intro runs on the page clock: the stage covers the app for ≈ 3.5 s, then it hands over to the build and the skip
 * pill stops taking taps (by design: it would float over the landing cards). A loaded machine can spend that long on a
 * few Playwright round trips, so the skip tests drive the page clock (`page.clock`: requestAnimationFrame,
 * performance.now, timers): frozen while the test looks at the stage, stepped until the pill has faded in, stepped
 * through the skip (its duration is checked in page time), running again afterwards.
 */
async function holdClock(page: Page): Promise<void> {
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);
}

/** Freezes an installed page clock mid-test (before a replay is triggered); `page.clock.resume()` lets it run again. */
async function pauseClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 3000);
}

/** Steps the held clock until the stage is up (the header logo's replay waits for the multi-tap window, 450 ms). */
async function stageShown(page: Page): Promise<void> {
  for (let step = 0; step < 20 && (await stage(page).count()) === 0; step++) await page.clock.runFor(100);
  await expect(stage(page)).toBeVisible();
}

/** Steps the held clock until the skip pill has faded in (the director starts once Doto is loaded, ≤ 450 ms). */
async function pillShown(page: Page) {
  const pill = page.getByRole("button", { name: "Überspringen" });
  await expect(pill).toBeVisible();
  let opacity = 0;
  for (let step = 0; step < 30 && opacity < 0.99; step++) {
    await page.clock.runFor(100);
    opacity = await pill.evaluate((el) => Number(getComputedStyle(el).opacity));
  }
  expect(opacity).toBeGreaterThanOrEqual(0.99);
  // still the stage (≈ 3.5 s of intro time to go): the pill is on top and takes the tap
  await expect(page.locator("#root")).toHaveAttribute("aria-hidden", "true");
  return pill;
}

/** After a skip: the stage is gone within 400 ms of page time (skip settle 260 ms + commit), then the clock runs again. */
async function skipSettles(page: Page): Promise<void> {
  await page.clock.runFor(400);
  await expect(stage(page)).toHaveCount(0, { timeout: 2000 });
  await page.clock.resume();
}

/**
 * Settled app: no stage, app root neither hidden nor inert (while covering it is `aria-hidden`, deliberately not
 * `inert` since perf-120), every overview cell at transform none, cells on screen (and their reveal
 * wrapper) fully opaque. "On screen" uses the Reveal's own viewport (`src/motion/Reveal.tsx` REVEAL_VIEWPORT margin
 * −50 px): a cell whose top edge peeks less than 50 px above the fold reveals on the first scroll, like every reveal.
 */
async function expectSettled(page: Page): Promise<void> {
  await expect(stage(page)).toHaveCount(0);
  await expect(page.locator("#root")).not.toHaveAttribute("aria-hidden", /.*/);
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
    await holdClock(page);
    await seedWithIntro(page);
    await page.goto("/#overview");
    await expect(stage(page)).toBeVisible();
    await expect(page.locator("#root")).toHaveAttribute("aria-hidden", "true");
    expect(await page.evaluate(() => sessionStorage.getItem("tj2-intro"))).toBe("1");
    const pill = await pillShown(page);
    await pill.click();
    await skipSettles(page);
    await page.waitForTimeout(900); // reveals inside the landed cells
    await expectSettled(page);
    await page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Trades" }).click();
    await expect(page).toHaveURL(/#trades/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Esc skips; the skip pill is reachable by keyboard", async ({ page }) => {
    await holdClock(page);
    await seedWithIntro(page);
    await page.goto("/#overview");
    await expect(stage(page)).toBeVisible();
    await pillShown(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Überspringen" })).toBeFocused();
    await page.keyboard.press("Escape");
    await skipSettles(page);
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
    await page.clock.install();
    await seed(page); // session flag set: no autoplay
    await page.goto("/#trades");
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 400));
    await pauseClock(page);
    await page.locator("header").getByRole("button", { name: "Übersicht" }).click();
    await stageShown(page);
    await expect(page).toHaveURL(/#overview/);
    await pillShown(page);
    await page.keyboard.press("Escape");
    await skipSettles(page);
    await page.waitForTimeout(900);
    await expectSettled(page);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(4);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Settings: the intro switch writes tj2-ui-intro, \"Intro jetzt abspielen\" replays on the overview", async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await page.goto("/#settings");
    await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
    const sw = page.getByRole("switch", { name: "Intro beim Start abspielen" });
    await sw.scrollIntoViewIfNeeded();
    await sw.click();
    expect(await page.evaluate(() => localStorage.getItem("tj2-ui-intro"))).toBe("off");
    await sw.click();
    expect(await page.evaluate(() => localStorage.getItem("tj2-ui-intro"))).toBe("on");
    await pauseClock(page);
    await page.getByRole("button", { name: "Intro jetzt abspielen" }).click();
    await stageShown(page);
    await expect(page).toHaveURL(/#overview/);
    const pill = await pillShown(page);
    await pill.click();
    await skipSettles(page);
    await page.waitForTimeout(900);
    await expectSettled(page);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(4);
  });
});
