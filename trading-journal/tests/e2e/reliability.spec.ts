/**
 * Data reliability (decision 14): every feed keeps refreshing across tab switches and network changes.
 * - Hidden tab: the scheduler pauses (no REST polls while hidden, even after a long sleep); back in front
 *   (`visibilitychange`) every REST feed older than its cadence is re-polled within seconds (staggered).
 * - Offline → online: the UI says "Offline" honestly; the `online` event resumes the feeds and the status returns to live.
 * The page clock is pinned so a "6 minutes hidden" really is 6 minutes for the app and the market mock.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, pinClock, seed, utcToday } from "./helpers";

const MIN = 60_000;

/** Request log (path + time) of the mocked Binance REST. */
function requestLog(): { log: { path: string; at: number }[]; onRequest: (u: URL) => void; since: (mark: number, path: string) => number } {
  const log: { path: string; at: number }[] = [];
  return {
    log,
    onRequest: (u) => log.push({ path: u.pathname, at: Date.now() }),
    since: (mark, path) => log.filter((r) => r.at >= mark && r.path === path).length,
  };
}

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test.describe("data reliability", () => {
  test("hidden tab pauses the polls; back in front, every stale feed is re-polled", async ({ page }) => {
    const errors = collectErrors(page);
    const clock = await pinClock(page, utcToday(10, 3));
    const req = requestLog();
    await seed(page, { clock: clock.now, onRequest: req.onRequest });
    await page.goto("/#overview");
    const panel = page.getByTestId("market-panel");
    await expect(panel).toBeVisible();
    await expect.poll(() => req.since(0, "/fapi/v1/ticker/24hr"), { timeout: 15_000, message: "bootstrap" }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);

    // hidden for 6 minutes (longer than the cadence of ticker 30 s, open interest 60 s, the 5-min top traders)
    await setHidden(page, true);
    await clock.forward(6 * MIN);
    await page.waitForTimeout(2500);
    const quiet = Date.now();
    await page.waitForTimeout(3000);
    expect(req.since(quiet, "/fapi/v1/ticker/24hr"), "no polls while hidden").toBe(0);
    expect(req.since(quiet, "/fapi/v1/openInterest"), "no polls while hidden").toBe(0);

    // back in front: the resume re-polls what went stale (staggered over a few seconds)
    const back = Date.now();
    await setHidden(page, false);
    for (const path of ["/fapi/v1/ticker/24hr", "/fapi/v1/openInterest", "/futures/data/topLongShortPositionRatio", "/futures/data/globalLongShortAccountRatio"]) {
      await expect.poll(() => req.since(back, path), { timeout: 15_000, message: `${path} re-polled after the tab came back` }).toBeGreaterThan(0);
    }
    await expect(panel).not.toContainText("Offline");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("offline → online: honest Offline status, then the feeds resume", async ({ page, context }) => {
    const errors = collectErrors(page);
    const req = requestLog();
    await seed(page, { onRequest: req.onRequest });
    await page.goto("/#settings");
    await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
    // the card sits in a `Fold` (its closed title is a second, hidden "Live-Daten" text) – the heading is the card itself
    const live = page.getByRole("heading", { level: 2, name: "Live-Daten", exact: true });
    await live.scrollIntoViewIfNeeded();
    const card = page.locator("section, div").filter({ has: page.getByText("Gesamtstatus", { exact: true }) }).last();
    await expect(card).toContainText("Online", { timeout: 20_000 });

    await context.setOffline(true);
    await expect(card).toContainText("Offline", { timeout: 15_000 });
    await expect(card).not.toContainText(/^Online/);

    const back = Date.now();
    await context.setOffline(false);
    await expect(card).toContainText("Online", { timeout: 15_000 });
    await expect.poll(() => req.log.filter((r) => r.at >= back).length, { timeout: 20_000, message: "REST polls resume after `online`" }).toBeGreaterThan(0);
    expect(errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|net::ERR/.test(e)), errors.join("\n")).toEqual([]);
  });

  /**
   * Budget-Schnitt follow-up: the idle preload (editor, detail, tabs …) and every lazy page are chunks. In CI the idle slot
   * is early, so the offline window of the test above hit a chunk that was still on its way ("Unable to preload CSS for
   * …/facts-….css" as page errors). Here every lazy chunk answers slowly, so the window hits the preload on purpose.
   */
  const slowChunks = async (page: Page, ms: number): Promise<void> => {
    await page.route(/\/assets\/[^/]+\.(js|css)(\?.*)?$/, async (route) => {
      // the first-load files (entry, vendor chunks) at normal speed – only what loads later is slow
      if (/\/assets\/(index|react|motion|recharts|rolldown-runtime)-/.test(route.request().url())) return route.continue();
      await new Promise((r) => setTimeout(r, ms));
      await route.continue().catch(() => undefined);
    });
  };
  const noNetErrors = (errors: string[]): string[] => errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|net::ERR/.test(e));

  test("offline while the idle preload downloads: no page error, the chunks arrive after `online`", async ({ page, context }) => {
    const errors = collectErrors(page);
    await seed(page);
    await slowChunks(page, 1800);
    await page.goto("/#overview");
    await expect(page.getByTestId("market-panel")).toBeVisible();
    // the idle chain has started (editor first) and its chunks are still in flight when the network goes away
    await page.waitForTimeout(700);
    await context.setOffline(true);
    await page.waitForTimeout(4500);
    expect(noNetErrors(errors), errors.join("\n")).toEqual([]);
    await context.setOffline(false);
    // the chain resumes by itself: the editor opens (its chunk was fetched again, with its stylesheet)
    await page.getByRole("button", { name: "Trade eintragen" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Trade eintragen" });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    // …and it is styled: the dialog is a fixed overlay with a real box, not an unstyled block in the flow
    expect(await dialog.evaluate((el) => getComputedStyle(el.closest(".fixed") ?? el).position), "stylesheet of the chunk applied").toBe("fixed");
    expect(noNetErrors(errors), errors.join("\n")).toEqual([]);
  });

  test("a page that is not loaded yet, opened offline: an honest placeholder, no error, and it loads once online", async ({ page, context }) => {
    const errors = collectErrors(page);
    await seed(page);
    await slowChunks(page, 300);
    await page.goto("/#overview");
    await expect(page.getByTestId("market-panel")).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => {
      location.hash = "#analyse";
    });
    const wait = page.locator('[data-page-skeleton="analyse"]');
    await expect(wait).toBeVisible({ timeout: 15_000 });
    await expect(wait).toContainText("Du bist offline");
    await expect(wait.getByRole("button", { name: "Wiederholen" })).toBeVisible();
    expect(noNetErrors(errors), errors.join("\n")).toEqual([]);
    await context.setOffline(false);
    await expect(page.locator('[data-page="analyse"][data-page-role="current"] h1').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-page-skeleton]")).toHaveCount(0);
    expect(noNetErrors(errors), errors.join("\n")).toEqual([]);
  });
});
