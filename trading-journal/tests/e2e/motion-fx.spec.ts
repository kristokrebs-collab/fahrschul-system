/**
 * P01 motion library in a real browser: the dev galleries `dev/pulse-fx.html` (fx kit) and `dev/pulse-ui.html` (pulse
 * ports). The galleries are dev-only pages (not part of the app build), so this spec runs against the Vite dev server
 * (`npx vite --port 4182` + `PW_BASE_URL=http://127.0.0.1:4182`) and skips itself on a production preview.
 * Contracts: every effect runs without console errors / React or Motion warnings, finishes (finite) at its real end
 * state, keeps 390 px free of horizontal scroll, and shows the static end state under reduced motion.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, isMobile } from "./helpers";

async function open(page: Page, path: string): Promise<boolean> {
  const res = await page.goto(path);
  if (!res || !res.ok()) return false;
  return page
    .locator("[data-gallery]")
    .first()
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
}

async function gallery(page: Page, path: string) {
  const ok = await open(page, path);
  test.skip(!ok, "the motion galleries are served by the Vite dev server only (dev/*.html)");
}

test.describe("fx kit gallery", () => {
  test("every effect renders and settles without errors; no horizontal scroll", async ({ page }) => {
    const errors = collectErrors(page);
    await gallery(page, "/dev/pulse-fx.html");
    await expect(page.locator("[data-section]")).toHaveCount(14);
    // scroll through so every first-view effect runs, then let them finish
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 400) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1800);
    await expectNoHorizontalScroll(page);
    await expect(page.getByRole("meter", { name: "Tagesverlust-Limit" })).toHaveAttribute("aria-valuenow", "46");
    await expect(page.getByRole("img", { name: /Kontostand: 10.000/ })).toBeVisible();
    // the accessible value is final at once; the rain sleeps off screen and lands on the value once seen again
    const cascade = page.locator('[data-fx="number-cascade"]').first();
    await expect(cascade.locator(".sr-only")).toHaveText("+12.480,50 USDT");
    await cascade.scrollIntoViewIfNeeded();
    await expect(cascade.locator('[aria-hidden="true"]')).toHaveText("+12.480,50 USDT");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("interactions: radar stops, the limit fills into the red, a row dissolves, the coach streams", async ({ page }) => {
    const errors = collectErrors(page);
    await gallery(page, "/dev/pulse-fx.html");

    const radar = page.getByRole("img", { name: /Scan (läuft|pausiert)/ });
    await expect(radar).toHaveAttribute("data-scanning", "");
    await page.getByTestId("radar-toggle").click();
    await expect(page.getByRole("img", { name: "Scan pausiert" })).not.toHaveAttribute("data-scanning", /.*/);

    const limit = page.getByRole("meter", { name: "Tagesverlust-Limit" });
    await limit.scrollIntoViewIfNeeded();
    await page.getByTestId("liquid-up").click();
    await page.getByTestId("liquid-up").click();
    await expect(limit).toHaveAttribute("aria-valuenow", "82");
    await expect(limit).toHaveAttribute("data-danger", "");

    const list = page.getByTestId("dissolve-list");
    await list.scrollIntoViewIfNeeded();
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await page.getByTestId("dissolve-b").click();
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list).not.toContainText("ETHUSDT");

    await page.getByTestId("coach-ask").scrollIntoViewIfNeeded();
    await page.getByTestId("coach-ask").click();
    await expect(page.getByText("Coach denkt …")).toBeVisible();
    await expect(page.locator('[data-fx="coach-stream"]')).toHaveAttribute("data-caught-up", "", { timeout: 15_000 });
    await expect(page.locator('[data-fx="coach-stream"] .sr-only')).toContainText("A+-Setups");

    await page.getByTestId("celebrate-record").scrollIntoViewIfNeeded();
    await page.getByTestId("celebrate-record").click();
    await page.waitForTimeout(1600);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("reduced motion: static end states, no scan, no particles", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gallery(page, "/dev/pulse-fx.html");
    await expect(page.getByRole("img", { name: "Scan läuft" })).not.toHaveAttribute("data-scanning", /.*/);
    await expect(page.locator('[data-fx="breakout-streak"]')).toHaveCount(0);
    await expect(page.locator('[data-fx="number-cascade"] [aria-hidden="true"]').first()).toHaveText("+12.480,50 USDT");
    await expect(page.locator('[data-fx="spotlight-sweep"]')).toHaveCount(0);
  });
});

test.describe("pulse ports gallery", () => {
  test("renders every port without errors; no horizontal scroll", async ({ page }) => {
    const errors = collectErrors(page);
    await gallery(page, "/dev/pulse-ui.html");
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 400) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(4500);
    await expectNoHorizontalScroll(page);
    await expect(page.getByRole("group", { name: "Trader-Profil" })).toHaveAttribute("data-open", "");
    await expect(page.getByRole("button", { name: "Pro starten" })).toBeVisible();
    await expect(page.getByRole("figure", { name: "Beispiel-Setups" })).toContainText("Trade the best.");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("scrub timeline: keys step, play runs to the end", async ({ page }) => {
    await gallery(page, "/dev/pulse-ui.html?c=scrub&bare");
    const slider = page.getByRole("slider", { name: "Session-Replay" });
    await expect(slider).toHaveAttribute("aria-valuetext", "03:52");
    await slider.focus();
    await page.keyboard.press("End");
    await expect(slider).toHaveAttribute("aria-valuetext", "08:00");
    await page.keyboard.press("Home");
    await expect(slider).toHaveAttribute("aria-valuetext", "01:00");
    await page.getByRole("button", { name: "Abspielen" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Abspielen" })).toBeVisible({ timeout: 12_000 });
    await expect(slider).toHaveAttribute("aria-valuetext", "08:00");
  });

  test("fullscreen wipe: opens as a dialog, Escape closes and returns focus", async ({ page }) => {
    await gallery(page, "/dev/pulse-ui.html?c=fswipe&bare");
    const trigger = page.getByTestId("fswipe-open");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Wochenbericht bereit" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Bericht bereit." })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0, { timeout: 4000 });
    await expect(trigger).toBeFocused();
  });

  test("glyph zoom: dives into the word and hands over the content", async ({ page }) => {
    await gallery(page, "/dev/pulse-ui.html?c=glyph&bare");
    const stage = page.getByRole("group", { name: "Share-Karte" });
    await expect(stage).not.toHaveAttribute("data-covered", /.*/);
    await page.getByTestId("glyph-toggle").click();
    await expect(stage).toHaveAttribute("data-covered", "", { timeout: 4000 });
    await expect(stage.getByText("Trade geteilt")).toBeVisible();
  });

  test("magnify row and card fan", async ({ page }, info) => {
    await gallery(page, "/dev/pulse-ui.html?c=magnify&bare");
    const bar = page.getByRole("toolbar", { name: "Gruppen" });
    if (!isMobile(info)) {
      const swing = bar.getByRole("button", { name: "Swing" });
      await swing.hover();
      await expect.poll(async () => swing.evaluate((b) => (b.parentElement as HTMLElement).style.transform)).toContain("scale(");
    }
    await bar.getByRole("button", { name: "Krypto" }).click();
    await expect(page.getByText("Gewählt: Krypto")).toBeVisible();

    await page.goto("/dev/pulse-ui.html?c=spread&bare");
    const fan = page.getByRole("button", { name: "Strategien auffächern" });
    await fan.scrollIntoViewIfNeeded();
    await expect(fan).toHaveAttribute("aria-expanded", "true", { timeout: 5000 });
    await fan.click();
    await expect(fan).toHaveAttribute("aria-expanded", "false");
  });
});
