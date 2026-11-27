/**
 * Touch targets ≥ 44 px on the PHONE (390 × 844, coarse pointer), every page – Runde 13 (Funktionsprüfung). `touch.spec.ts` audits the
 * touch TABLETS only; at 390 px rows of 30-px buttons wrap onto a second line and the 44-px tap areas of two stacked buttons overlap
 * (Einstellungen: „Vorschau“ / „Logo wiederholen“, „Einführung starten“ / „Alle Tastenkürzel“, the two Rückmeldung switches).
 * The same measure as `touch.spec.ts` (`hitbox.ts`: hit testing around the centre, a neighbour that takes a probe counts against the
 * element); the sideways-scrolling „Inhalt“ strip and 1-px file inputs are exempt for the same stated reasons.
 */
import { expect, test, type Page } from "@playwright/test";
import { seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR, type HitBoxMiss } from "./hitbox";

const PAGES = ["overview", "trades", "setups", "settings", "markt", "analyse", "risiko", "coach", "labor", "wachstum", "community", "cockpit", "konto", "preise", "funktionen", "studio"] as const;

const exempt = (m: HitBoxMiss) => m.where === "section-nav" || m.w <= 1;
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

test.describe("touch targets ≥ 44 px on the phone", () => {
  for (const key of PAGES) {
    test(`page ${key}`, async ({ page }, info) => {
      test.skip(info.project.name !== "mobile", "the phone (390 px, coarse pointer)");
      test.setTimeout(150_000);
      await seed(page);
      await page.goto(`/#${key}`);
      await expect(page.locator(`[data-page="${key}"][data-page-role="current"] h1`).first()).toBeAttached({ timeout: 40_000 });
      await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 40_000 });
      await page.waitForTimeout(1200);
      await scrollThrough(page);
      const misses = (await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR })).filter((m) => !exempt(m));
      expect(misses, report(misses)).toEqual([]);
    });
  }
});
