/**
 * „Passt zu dir?“ (F49) end to end against the market mock with REAL Binance BTCUSDT 4h / 1D bars (`boxes: true`, no network):
 * after a Labor run the card sits under the diagnosis (own lazy chunk) and holds the run against the seeded journal – either
 * the comparison (frictions / agreements / unknowns, each statement with both figures, no score, no recommendation) or, when
 * the journal is too small, an honest empty state that names the numbers. It changes neither the run nor the journal.
 *
 * Runs on the routed page `/#labor` of the production build (`PW_LABOR_URL` overrides it). Nothing depends on the clock.
 */
import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";

const LABOR_URL = process.env.PW_LABOR_URL ?? "/#labor";
const PROJECTS = ["mobile", "desktop"];

test.describe("Labor · Passt zu dir?", () => {
  test.setTimeout(180_000);

  test("the card appears under a finished run: a comparison with both figures, or an honest empty state – never a score", async ({ page }, info) => {
    test.skip(!PROJECTS.includes(info.project.name), "Labor runs on mobile + desktop");
    const errors = collectErrors(page);
    await seed(page, { boxes: true, extra: { "tj2-labor": { strategy: "custom", symbol: "BTCUSDT", period: "6m" } } });
    await openRoute(page, LABOR_URL, "Labor");
    await expect(page.getByTestId("labor-fit")).toHaveCount(0);
    await page.getByTestId("labor-start").click();
    await expect(page.getByTestId("labor-run")).toHaveAttribute("data-status", "done", { timeout: 60_000 });

    const card = page.getByTestId("labor-fit");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByTestId("fit-sample")).toContainText(/Trades im Test/);
    await expect(card.getByTestId("fit-sample")).toContainText(/Dein Journal: \d+ abgeschlossene Trades/);
    await expect(card.getByTestId("fit-caveat")).toContainText("sagt nicht, ob du die Idee handeln solltest");

    const status = await card.getAttribute("data-status");
    expect(["ok", "journalFew", "journalNone", "strategyFew"]).toContain(status);
    if (status === "ok") {
      const items = card.getByTestId("fit-item");
      expect(await items.count()).toBe(8);
      expect(await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-id")).sort())).toEqual(["discipline", "drawdown", "frequency", "hold", "risk", "streak", "winRate", "window"]);
      for (const kind of await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")))) expect(["match", "friction", "unknown"]).toContain(kind);
    } else {
      await expect(card.getByTestId("fit-empty")).toContainText(/\d/);
      await expect(card.getByTestId("fit-items")).toHaveCount(0);
    }
    // never a total score or a recommendation to act
    expect(((await card.textContent()) ?? "").match(/\bscore\b|\bnote \d|empfehle|geeignet/i)).toBeNull();

    await expectNoHorizontalScroll(page);
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="labor-fit"]' });
      expect(misses, JSON.stringify(misses)).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
});
