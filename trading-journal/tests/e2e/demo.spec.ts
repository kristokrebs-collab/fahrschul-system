/**
 * F58 Interaktive Demo end to end (mobile 390 + desktop): reached from the page „Funktionen“ (the quiet box), from „Einführung &
 * Hilfe“ in the settings and from the function search; five steps with the real calculations (CSV preview, rule translator, engine,
 * paper trade, key-level replay) on clearly marked example data – EVERY card says „Beispiel – nicht deine Daten“; nothing of it
 * reaches the journal, the settings, the browser storage or the server; no sideways scroll, touch targets ≥ 44 px. No clocks,
 * nothing that depends on the market mock's time.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, screenshot, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";

const PROJECTS = ["mobile", "desktop"];
const TAG = "Beispiel – nicht deine Daten";

const layer = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"]`);
const dialog = (page: Page) => page.getByRole("dialog", { name: "Demo mit Beispieldaten" });
const tid = (page: Page, id: string) => dialog(page).getByTestId(id);

/** The journal's own storage keys of both editions – the demo must leave them exactly as they were. */
async function journalState(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => /^tj2(share)?-(trades|settings|days|hyblock)$/.test(k))));
}

async function openFromFunktionen(page: Page): Promise<void> {
  await seed(page);
  await page.goto("/#funktionen");
  await expect(layer(page, "funktionen").locator("h1").first()).toHaveText("Funktionen", { timeout: 25_000 });
  await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 25_000 });
  const box = layer(page, "funktionen").getByTestId("funktionen-demo");
  await box.scrollIntoViewIfNeeded();
  await expect(box).toBeVisible();
  await box.getByTestId("funktionen-demo-open").click();
  await expect(dialog(page)).toBeVisible({ timeout: 25_000 });
  await expect(tid(page, "demo-host")).toBeVisible();
}

async function everyCardIsMarked(page: Page): Promise<void> {
  const cards = tid(page, "demo-card");
  const n = await cards.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await expect(cards.nth(i).getByTestId("demo-tag")).toHaveText(TAG);
    await expect(cards.nth(i).getByTestId("demo-foot")).toContainText("Keine professionelle Finanzberatung.");
  }
}

test.describe("Demo mit Beispieldaten", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("five steps from the Funktionen page: every card marked as example, the figures come from the real functions, nothing is saved or sent", async ({ page }, info) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && /\/api\//.test(r.url())) posts.push(`${r.method()} ${r.url()}`);
    });
    await seed(page);
    await page.goto("/#funktionen");
    await expect(layer(page, "funktionen").locator("h1").first()).toHaveText("Funktionen", { timeout: 25_000 });
    const before = await journalState(page);
    expect(Object.keys(before).length).toBeGreaterThan(0);
    await openFromFunktionen(page);

    // 1 Import
    await everyCardIsMarked(page);
    await expect(tid(page, "demo-step-import")).toHaveAttribute("aria-current", "step");
    await tid(page, "demo-import-preview").click();
    await expect(tid(page, "demo-import-preview-body")).toContainText("Erkannt als: Bitunix Futures");
    await expect(tid(page, "demo-import-row")).toHaveCount(8);
    await tid(page, "demo-import-trades").click();
    await expect(tid(page, "demo-import-n")).toContainText("8");
    await expect(tid(page, "demo-nothing-saved")).toBeVisible();
    await everyCardIsMarked(page);
    await expectNoHorizontalScroll(page);
    await tid(page, "demo-import-trades-body").scrollIntoViewIfNeeded();
    await screenshot(page, info, "demo-1-import");

    // 2 Regelentwurf: words, then the kit
    await tid(page, "demo-next").click();
    await expect(tid(page, "demo-idea")).toBeVisible();
    await expect(tid(page, "demo-parse")).toHaveAttribute("data-ready", "1");
    await expect(tid(page, "demo-plain")).toContainText("Long wenn Schluss über dem Hoch der letzten 20 Kerzen");
    await tid(page, "demo-example-pullback").click();
    await expect(tid(page, "demo-plain")).toContainText("RSI(14)");
    await tid(page, "demo-idea").fill("Kaufe bei Vollmond.");
    await expect(tid(page, "demo-rules-state")).toHaveAttribute("data-ready", "0");
    await tid(page, "demo-example-breakout").click();
    await page.getByRole("radio", { name: "Baukasten" }).click();
    await expect(tid(page, "demo-kit")).toBeVisible();
    await screenshot(page, info, "demo-2-kit");
    await page.getByRole("radio", { name: "In Worten" }).click();
    await expect(tid(page, "demo-idea")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await everyCardIsMarked(page);
    await screenshot(page, info, "demo-2-regeln");

    // 3 Test
    await tid(page, "demo-next").click();
    await expect(tid(page, "demo-test-run")).toBeVisible();
    await expect(tid(page, "demo-test-result")).toHaveCount(0);
    await tid(page, "demo-test-run").click();
    await expect(tid(page, "demo-test-result")).toBeVisible({ timeout: 30_000 });
    await expect(tid(page, "demo-fig-rate")).toContainText("80 %-Spanne");
    await expect(tid(page, "demo-meaning")).toContainText("Ein Test beweist keinen Gewinn");
    await expect(tid(page, "demo-funnel")).toBeVisible();
    await expect(tid(page, "demo-curve")).toBeVisible();
    await expect(tid(page, "demo-foot").first()).toContainText("künstliche Beispiel-Kerzen");
    await expectNoHorizontalScroll(page);
    await everyCardIsMarked(page);
    await screenshot(page, info, "demo-3-test");
    await tid(page, "demo-meaning").scrollIntoViewIfNeeded();
    await screenshot(page, info, "demo-3-test-meaning");
    await tid(page, "demo-funnel").scrollIntoViewIfNeeded();
    await screenshot(page, info, "demo-3-test-funnel");

    // 4 Demokonto
    await tid(page, "demo-next").click();
    await expect(tid(page, "demo-paper-chart")).toBeVisible();
    await tid(page, "demo-paper-open").click();
    await expect(tid(page, "demo-paper-verdict")).toContainText("Eröffnung der nächsten Kerze");
    await tid(page, "demo-paper-next").click();
    await expect(tid(page, "demo-paper-shown")).toContainText("1 Kerze aufgedeckt");
    await tid(page, "demo-paper-run").click();
    await expect(tid(page, "demo-paper-result")).toHaveAttribute("data-state", "closed");
    await expect(tid(page, "demo-paper-verdict")).toContainText(/Der Stop wurde erreicht|Das Ziel wurde erreicht/);
    await expect(tid(page, "demo-paper-r")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await everyCardIsMarked(page);
    await tid(page, "demo-paper-chart").scrollIntoViewIfNeeded();
    await screenshot(page, info, "demo-4-konto");
    await tid(page, "demo-paper-result").scrollIntoViewIfNeeded();
    await screenshot(page, info, "demo-4-konto-result");

    // 5 Alarm
    await tid(page, "demo-next").click();
    await expect(tid(page, "demo-alarm-events")).toHaveAttribute("data-n", "4");
    await expect(tid(page, "demo-alarm-event")).toHaveCount(4);
    await tid(page, "demo-alarm-at").fill("100");
    await expect(tid(page, "demo-alarm-events")).toHaveAttribute("data-n", "0");
    await tid(page, "demo-alarm-at").fill("240");
    await expect(tid(page, "demo-alarm-events")).toHaveAttribute("data-n", "4");
    await expect(tid(page, "demo-done-links")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await everyCardIsMarked(page);
    await tid(page, "demo-alarm-chart").scrollIntoViewIfNeeded();
    await screenshot(page, info, "demo-5-alarm");
    await tid(page, "demo-alarm-events").scrollIntoViewIfNeeded();
    await screenshot(page, info, "demo-5-alarm-events");

    // done: closing throws everything away, the journal is exactly as it was
    await tid(page, "demo-finish").click();
    await expect(dialog(page)).toHaveCount(0, { timeout: 10_000 });
    expect(await journalState(page)).toEqual(before);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /demo/i.test(k)))).toEqual([]);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => /demo/i.test(k)))).toEqual([]);
    expect(posts, posts.join("\n")).toEqual([]);
    // opened again, it starts from the beginning
    await layer(page, "funktionen").getByTestId("funktionen-demo-open").click();
    await expect(tid(page, "demo-progress")).toContainText("Schritt 1 von 5");
    await expect(tid(page, "demo-import-preview-body")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("is reached from „Einführung & Hilfe“ in the settings and closes with Escape", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#settings");
    await expect(layer(page, "settings").locator("h1").first()).toBeVisible({ timeout: 25_000 });
    const btn = page.getByTestId("onboarding-demo");
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await expect(dialog(page)).toBeVisible({ timeout: 25_000 });
    await expect(tid(page, "demo-lead")).toContainText("nicht in dein Journal, nicht in die Einstellungen, nicht in die Cloud");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0, { timeout: 10_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the function search finds it and opens it", async ({ page }) => {
    await seed(page);
    await page.goto("/#funktionen");
    await expect(layer(page, "funktionen").locator("h1").first()).toHaveText("Funktionen", { timeout: 25_000 });
    await layer(page, "funktionen").getByRole("searchbox", { name: "Was willst du tun?" }).fill("mit Beispieldaten ausprobieren");
    const hit = layer(page, "funktionen").locator('[data-testid="feature-row"][data-feature="produktdemo"]');
    await expect(hit).toBeVisible();
    await expect(hit).toHaveAttribute("data-action", "demo");
    await hit.getByRole("button").first().click();
    await expect(dialog(page)).toBeVisible({ timeout: 25_000 });
  });

  test("touch targets are at least 44 px on every step", async ({ page }, info) => {
    test.skip(!hasTouch(info), "touch projects");
    test.setTimeout(180_000);
    await openFromFunktionen(page);
    const audit = async (what: string) => {
      await page.waitForTimeout(400);
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[role="dialog"]' });
      expect(
        misses.map((m) => `${m.where} · ${m.name} ${m.w}×${m.h} → ${m.ew}×${m.eh} (taken by ${m.stolenBy})`),
        what,
      ).toEqual([]);
    };
    await tid(page, "demo-import-preview").click();
    await tid(page, "demo-import-trades").click();
    await audit("Import");
    await tid(page, "demo-next").click();
    await audit("Regelentwurf in Worten");
    await page.getByRole("radio", { name: "Baukasten" }).click();
    await audit("Regelentwurf Baukasten");
    await tid(page, "demo-next").click();
    await tid(page, "demo-test-run").click();
    await expect(tid(page, "demo-test-result")).toBeVisible({ timeout: 30_000 });
    await audit("Test");
    await tid(page, "demo-next").click();
    await tid(page, "demo-paper-open").click();
    await audit("Demokonto");
    await tid(page, "demo-next").click();
    await audit("Alarm");
  });
});
