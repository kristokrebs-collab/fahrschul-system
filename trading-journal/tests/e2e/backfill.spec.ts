/**
 * „Börsenhistorie nachladen“ (F26/F07) end to end, on a phone and on the desktop:
 *
 * - Einstellungen › Datenarchiv › Börsenhistorie nachladen: the sentences before the click (what is loaded, stored apart and
 *   labelled, ~30 days, nothing uploaded), 7 days for one symbol, the click, the progress, the result; the six loaded rows appear
 *   in the overview marked „nachgeladen“, the collector's switch stays off and its configuration is never written;
 * - Markt › Squeeze-Beobachtung: right after the load the card has a sample from the loaded history in its own block with its own
 *   source line (one earlier case: funding +0,07 % and 70 % long all week);
 * - cancel: the run stops, the result says so, what came before stays;
 * - axe (WCAG 2.1 A + AA) on the section with a finished run in the dark and the light theme, touch targets ≥ 44 px.
 *
 * The exchange is a route handler (the endpoints answer by `startTime` / `endTime` / `limit` like Binance, with deterministic
 * numbers) – no network, no clock jumps, nothing that depends on the mock's time of day.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, screenshot, seed, stored } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { themeSettled } from "./uxHarness";

const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const CFG_KEY = "tj2-archive-cfg";
const STEP = 5 * 60_000;
const H = 3_600_000;

/** Binance's history endpoints, answering by window; `delayMs` slows every answer (the cancel test needs a run that lasts). */
async function mockHistory(page: Page, opts: { delayMs?: number } = {}): Promise<{ calls: () => number }> {
  let calls = 0;
  await page.route("https://fapi.binance.com/**", async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    const hist = ["/futures/data/openInterestHist", "/futures/data/globalLongShortAccountRatio", "/futures/data/topLongShortPositionRatio", "/futures/data/topLongShortAccountRatio", "/fapi/v1/fundingRate", "/fapi/v1/markPriceKlines"];
    // the app's own feeds ask the same endpoints without a window (`limit` only): the market mock of `seed` answers those
    if (!hist.includes(p) || !u.searchParams.has("startTime")) return route.fallback();
    calls += 1;
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const symbol = u.searchParams.get("symbol") ?? "BTCUSDT";
    const start = Number(u.searchParams.get("startTime") ?? 0);
    const end = Number(u.searchParams.get("endTime") ?? Date.now());
    const limit = Number(u.searchParams.get("limit") ?? 500);
    const grid: number[] = [];
    for (let t = Math.ceil(start / STEP) * STEP; t <= end && grid.length < limit; t += STEP) grid.push(t);
    const ok = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    if (p === "/futures/data/openInterestHist") return ok(grid.map((t) => ({ symbol, sumOpenInterest: "1000.5", sumOpenInterestValue: "80000000", timestamp: t })));
    if (p === "/futures/data/globalLongShortAccountRatio") return ok(grid.map((t) => ({ symbol, longShortRatio: "2.3333", longAccount: "0.7000", shortAccount: "0.3000", timestamp: t })));
    if (p === "/futures/data/topLongShortPositionRatio" || p === "/futures/data/topLongShortAccountRatio") return ok(grid.map((t) => ({ symbol, longShortRatio: "0.8182", longAccount: "0.4500", shortAccount: "0.5500", timestamp: t })));
    if (p === "/fapi/v1/fundingRate") {
      const rows: unknown[] = [];
      for (let t = Math.ceil(start / (8 * H)) * 8 * H; t <= end && rows.length < limit; t += 8 * H) rows.push({ symbol, fundingTime: t, fundingRate: "0.00070000", markPrice: "80000.00000000" });
      return ok(rows);
    }
    return ok(grid.map((t) => [t, "80000", "80010", "79990", "80000.00", "0", t + STEP - 1, "0", 0, "0", "0", "0"]));
  });
  return { calls: () => calls };
}

async function openCard(page: Page): Promise<void> {
  await openRoute(page, "/#settings", "Einstellungen");
  await expect(page.getByTestId("settings-archive-card")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("archive-backfill").scrollIntoViewIfNeeded();
}

/** 7 days, BTCUSDT only: 23 requests. */
async function chooseSmall(page: Page): Promise<void> {
  const sec = page.getByTestId("archive-backfill");
  await sec.getByRole("radio", { name: "7 Tage" }).click();
  // the list of pressed buttons shrinks with every click: read the names first, then press each by name
  const pressed = sec.locator("ul[aria-label='Symbole'] button[aria-pressed='true']");
  const names = (await pressed.allTextContents()).map((t) => t.trim()).filter((t) => t !== "BTCUSDT");
  for (const name of names) await sec.locator("ul[aria-label='Symbole'] button[aria-pressed='true']", { hasText: name }).click();
  await expect(sec.getByTestId("backfill-preview")).toContainText("23 Abrufe für 1 Symbol");
}

async function expectAccessible(page: Page, include: string, what: string): Promise<void> {
  await page.waitForTimeout(1200);
  const res = await new AxeBuilder({ page }).include(include).withTags(TAGS).analyze();
  const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(lines, `${what}: axe violations`).toEqual([]);
}

test.describe("Börsenhistorie nachladen (F26/F07)", () => {
  test.setTimeout(150_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("the sentences before the click, the load from click to result, the marked rows and the sample in the squeeze card", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    const net = await mockHistory(page);
    await openCard(page);
    const sec = page.getByTestId("archive-backfill");
    await expect(sec.getByTestId("backfill-lead")).toContainText("Open Interest und die drei Long/Short-Verhältnisse in 5-Minuten-Schritten");
    await expect(sec.getByTestId("backfill-separate")).toContainText("als „nachgeladen“ gekennzeichnet – nie vermischt, nie geglättet");
    await expect(sec.getByTestId("backfill-window")).toContainText("nur etwa 30 Tage");
    await expect(sec.getByTestId("backfill-noserver")).toContainText("Es wird nichts hochgeladen");
    await expect(page.getByTestId("settings-archive-card")).toContainText("Keine professionelle Finanzberatung.");
    await expect(sec.getByTestId("backfill-nolog")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "backfill-before", false);

    await chooseSmall(page);
    await sec.getByTestId("backfill-start").click();
    await expect(sec.getByTestId("backfill-progress")).toBeVisible({ timeout: 15_000 });
    await expect(sec.getByTestId("backfill-progress-text")).toContainText("Abrufen");
    const result = sec.getByTestId("backfill-result");
    await expect(result).toHaveAttribute("data-state", "done", { timeout: 90_000 });
    await expect(result).toContainText("23 von 23 Abrufen");
    expect(net.calls()).toBe(23);
    await expect(sec.getByTestId("backfill-problems")).toHaveCount(0);
    await expect(sec.getByTestId("backfill-last")).toContainText("1 Symbol");
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "backfill-done", false);

    // the overview: six loaded rows, each marked, the archive itself still off and never written
    const card = page.getByTestId("settings-archive-card");
    await expect(card.locator('[data-testid="archive-row"][data-kind="backfill"]')).toHaveCount(6, { timeout: 20_000 });
    await expect(card.locator('[data-testid="archive-row"][data-kind="backfill"] [data-testid="archive-row-badge"]')).toHaveCount(6);
    await expect(card.locator('[data-testid="archive-row"]:not([data-kind="backfill"])')).toHaveCount(0);
    await expect(card.getByTestId("archive-loaded-total")).toContainText("nicht mit dem Gesammelten vermischt");
    await expect(card.getByRole("switch", { name: "Archiv sammeln" })).toHaveAttribute("aria-checked", "false");
    expect(await stored(page, CFG_KEY)).toBeNull();

    // the squeeze observation has its sample right away, in its own block with its own source line
    await page.evaluate(() => {
      location.hash = "#markt";
    });
    await expect(page.getByTestId("markt-view")).toBeVisible({ timeout: 30_000 });
    const squeeze = page.getByTestId("markt-squeeze");
    await squeeze.scrollIntoViewIfNeeded();
    const hist = squeeze.getByTestId("squeeze-history");
    await expect(hist).toBeVisible({ timeout: 30_000 });
    await expect(hist).toContainText("Stichprobe aus der nachgeladenen Börsenhistorie");
    await expect(hist.getByTestId("squeeze-history-episodes")).toContainText("In der nachgeladenen Historie");
    await expect(hist.getByTestId("squeeze-history-episodes")).toContainText("in 1 früheren Fall vor");
    await expect(hist.getByTestId("squeeze-history-stand")).toContainText("Quelle: Binance USDⓈ-M, öffentliche Historie (nachgeladen)");
    await expect(hist.getByTestId("squeeze-history-stand")).toContainText("nachgeladen ");
    await expect(squeeze.getByTestId("squeeze-history-nocollected")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "backfill-squeeze", false);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("cancel stops the run; what came before stays and the rest is named as not asked", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    const net = await mockHistory(page, { delayMs: 500 });
    await openCard(page);
    const sec = page.getByTestId("archive-backfill");
    await chooseSmall(page);
    await sec.getByTestId("backfill-start").click();
    await expect(sec.getByTestId("backfill-progress-text")).toContainText(/Funding · [1-9]\d* von 23 Abrufen|Markpreis/, { timeout: 30_000 });
    await sec.getByTestId("backfill-cancel").click();
    const result = sec.getByTestId("backfill-result");
    await expect(result).toHaveAttribute("data-state", "cancelled", { timeout: 30_000 });
    await expect(result).toContainText("Abgebrochen. Was bis dahin geladen war, bleibt gespeichert");
    await expect(sec.getByTestId("backfill-problems")).toContainText("nicht abgefragt");
    expect(net.calls()).toBeLessThan(23);
    await expect(sec.getByTestId("backfill-start")).toBeEnabled();
    await expect(page.getByTestId("settings-archive-card").locator('[data-testid="archive-row"][data-series="fundingHist"]')).toBeVisible({ timeout: 20_000 });
    await screenshot(page, info, "backfill-cancelled", false);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`barrierefrei und mit großen Tippflächen (${theme})`, async ({ page }, info) => {
      await seed(page, { boxes: true, extra: { "tj2-theme": JSON.stringify({ pref: theme, accent: "signal" }) } });
      await mockHistory(page);
      await openCard(page);
      await themeSettled(page);
      const sec = page.getByTestId("archive-backfill");
      await chooseSmall(page);
      await sec.getByTestId("backfill-start").click();
      await expect(sec.getByTestId("backfill-result")).toHaveAttribute("data-state", "done", { timeout: 90_000 });
      await expect(page.getByTestId("settings-archive-card").locator('[data-testid="archive-row"][data-kind="backfill"]')).toHaveCount(6, { timeout: 20_000 });
      await expectAccessible(page, '[data-testid="settings-archive-card"]', `Datenarchiv mit Nachladen (${theme})`);
      if (hasTouch(info)) {
        const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="archive-backfill"]' });
        expect(misses, misses.map((m) => `${m.name} ${m.w}×${m.h} (${m.where})`).join("\n")).toEqual([]);
      }
    });
  }
});
