/**
 * Ähnliche Situationen (F19) end to end against the market mock with REAL BTCUSDT 4h / 1D bars (`seed(page, { boxes: true })`):
 *
 * - Markt page: the card (own lazy chunk) under the structure card describes the current situation, says how many closed
 *   candles it used and either shows a verdict (≥ 20 hits: headline with range, counter-examples, sample) or „Zu wenig Daten“ –
 *   never a quote under 20 hits; the caveats (keine Prognose, Mehrfachtest) are always there;
 * - the unit switch re-reads the hits in %, the choice is remembered (a reload keeps it);
 * - a timeframe the mocked feed cannot serve says why;
 * - a hit opens the sheet with the situation on the real candles and the replay timeline; Escape closes it;
 * - the assistant's „zeig mir ähnliche Situationen“ opens the Markt page at the card (it only opens);
 * - no console errors, no horizontal scroll at 390 px, touch targets ≥ 44 px on touch.
 *
 * No clock jumps; nothing here depends on the time of day (fixed bars; the mock's "now" is the 4h bar of 2026-10-11 00:00 UTC).
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, scrollUntilVisible, seed, stored } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";

const MARKT_URL = process.env.PW_MARKT_URL ?? "/#markt";
const PROJECTS = ["mobile", "desktop"];

async function openMarkt(page: Page): Promise<void> {
  await openRoute(page, MARKT_URL, "Markt");
  await expect(page.getByTestId("markt-view")).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
}

async function settledCard(page: Page) {
  const card = page.getByTestId("markt-similar");
  await scrollUntilVisible(page, card, 30_000);
  await expect(card).toHaveAttribute("data-status", /^(ok|few)$/, { timeout: 30_000 });
  return card;
}

test.describe("Ähnliche Situationen", () => {
  test.setTimeout(90_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("describes the situation, states its sample, shows a verdict only with enough hits and always the caveats", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await openMarkt(page);
    const card = await settledCard(page);

    await expect(card.getByTestId("similar-meta")).toContainText(/\d+ geschlossene Kerzen/);
    await expect(card.getByTestId("similar-caveats")).toContainText("keine Prognose");
    await expect(card.getByTestId("similar-caveats")).toContainText("Mehrfachtest");

    const status = await card.getAttribute("data-status");
    if (status === "ok") {
      await expect(card.getByTestId("similar-headline")).toHaveText(/^In \d+ von \d+ ähnlichen Situationen lag der Kurs nach 12 Kerzen (höher|tiefer) \(\d+ %, Spanne \d+–\d+ %\)\.$/);
      await expect(card.getByTestId("similar-counters")).toBeVisible();
      await expect(card.getByTestId("similar-baseline")).toContainText("Im ganzen Zeitraum");
    } else {
      // under 20 hits: no verdict, no bar, no counter list – only the reason and the hits
      await expect(card.getByTestId("similar-few")).toContainText("Zu wenig Daten");
      await expect(card.getByTestId("similar-bar")).toHaveCount(0);
      await expect(card.getByTestId("similar-summary")).toHaveCount(0);
    }
    await expectNoHorizontalScroll(page);
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="markt-similar"]' });
      expect(misses, JSON.stringify(misses)).toEqual([]);
    }
    expect(errors).toEqual([]);
  });

  test("the unit switch re-reads the hits in percent and the choice survives a reload", async ({ page }) => {
    await seed(page, { boxes: true });
    await openMarkt(page);
    const card = await settledCard(page);
    await card.getByRole("radio", { name: "%" }).click();
    const hits = card.getByTestId("similar-hit");
    if ((await hits.count()) > 0) await expect(hits.first()).toContainText(" %");
    expect(await stored<{ v: number; unit: string; tf: string }>(page, "tj2-similar")).toMatchObject({ v: 1, unit: "pct", tf: "4h" });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Markt" })).toBeVisible();
    const again = await settledCard(page);
    await expect(again.getByRole("radio", { name: "%" })).toBeChecked();
  });

  test("switching the timeframe reads that timeframe's own candles (never another one's) and 4h is back with its own", async ({ page }) => {
    await seed(page, { boxes: true });
    await openMarkt(page);
    const card = await settledCard(page);
    const bars = async (): Promise<number> => Number(((await card.getByTestId("similar-meta").textContent()) ?? "").match(/(\d+) geschlossene Kerzen/)?.[1] ?? 0);
    const h4 = await bars();
    await card.getByTestId("similar-tfs").locator('button[data-tf="1D"]').click();
    // the daily feed loads over REST: until it is there the card says why (its own reason), afterwards it counts the 1D candles
    await expect.poll(async () => (await card.getByTestId("similar-meta").count()) > 0 && (await bars()) !== h4, { timeout: 30_000 }).toBe(true);
    await expect(card).toHaveAttribute("data-status", /^(ok|few)$/);
    await card.getByTestId("similar-tfs").locator('button[data-tf="4h"]').click();
    await expect.poll(bars, { timeout: 15_000 }).toBe(h4);
  });

  test("a hit opens the sheet with the situation on the real candles; Escape closes it", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await openMarkt(page);
    const card = await settledCard(page);
    const hits = card.getByTestId("similar-hit");
    test.skip((await hits.count()) === 0, "this data set yields no hit at all");
    await hits.first().click();
    const sheet = page.getByTestId("similar-sheet");
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByTestId("similar-sheet-outcome")).toContainText(/max\./);
    await expect(sheet.locator('[data-ready="true"]')).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByRole("slider")).toBeVisible();
    await expect(sheet.getByTestId("similar-sheet-values")).toContainText("RSI-Stand");
    await expectNoHorizontalScroll(page);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the assistant opens the card – and only opens it", async ({ page }) => {
    await seed(page, { boxes: true });
    await openRoute(page, "/#overview", "Übersicht");
    await page.getByTestId("assistant-button").click();
    const dialog = page.getByRole("dialog", { name: "Assistent" });
    await expect(dialog).toBeVisible();
    await page.getByTestId("assistant-input").fill("zeig mir ähnliche Situationen");
    await page.getByTestId("assistant-send").click();
    await expect(page.getByRole("heading", { level: 1, name: "Markt" })).toBeVisible({ timeout: 20_000 });
    const card = page.getByTestId("markt-similar");
    await expect(card).toBeVisible({ timeout: 30_000 });
    // nothing was started or saved by the assistant
    expect(await stored(page, "tj2-similar")).toBeNull();
  });
});
