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
   * …/facts-….css" as page errors). Here the chunks of the idle chain answer slowly, so the window hits the preload on purpose.
   * Only those: the chunks the Übersicht itself needs on screen (its candle chart, the feature hosts) come at normal speed –
   * a module whose request is cut off stays failed for the rest of the document (the browser keeps the failure), so cutting
   * one of those would be a coin toss between "the page shows its error frame" and "nothing happens", and says nothing about
   * the chain.
   */
  /** The chunks of the idle chain (`IDLE_STEPS` in App.tsx) by file name without hash: editor, detail, Trades, Markt, setup editor, Einstellungen, Entscheidungsgrundlagen. */
  const IDLE_CHAIN_CHUNKS = ["TradeEditor", "TradeDetail", "TradesView", "MarktView", "SetupEditor", "SettingsPage", "SetupsView"];
  const slowChunks = async (page: Page, ms: number): Promise<void> => {
    await page.route(/\/assets\/[^/]+\.(js|css)(\?.*)?$/, async (route) => {
      const name = /\/assets\/([A-Za-z]+)-[^/]+\.(js|css)(\?.*)?$/.exec(route.request().url())?.[1] ?? "";
      if (!IDLE_CHAIN_CHUNKS.includes(name)) return route.continue();
      await new Promise((r) => setTimeout(r, ms));
      await route.continue().catch(() => undefined);
    });
  };
  const noNetErrors = (errors: string[]): string[] => errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|net::ERR/.test(e));

  /** Resolves once no asset (chunk) was requested for `quietMs` – the idle chain has finished. */
  const assetsQuiet = async (page: Page, quietMs = 2500): Promise<void> => {
    let last = Date.now();
    page.on("request", (r) => {
      if (/\/assets\//.test(r.url())) last = Date.now();
    });
    while (Date.now() - last < quietMs) await page.waitForTimeout(250);
  };

  test("offline while the idle preload downloads: no page error, the chain resumes, the editor still opens (or says honestly why not)", async ({ page, context }) => {
    const errors = collectErrors(page);
    await seed(page);
    await slowChunks(page, 1800);
    // Every request for a chunk of the idle chain, whenever it was made. How far the chain got before the drop depends on the
    // runner: on a fast one the idle slots come early and all seven steps may have started before the network goes away, their
    // downloads are cut off, and the browser never asks again for a module whose request failed. So the test does not count
    // requests after `online`; it asks the invariant: no step of the chain is lost. A step that had not started when the
    // network went away is started after `online`; one that had started was requested before.
    const requested = new Set<string>();
    page.on("request", (r) => {
      const m = r.url().match(/\/assets\/([A-Za-z]+)-[^/]+\.js(\?.*)?$/);
      if (m) requested.add(m[1]!);
    });
    const missingSteps = (): string[] => IDLE_CHAIN_CHUNKS.filter((c) => !requested.has(c));
    await page.goto("/#overview");
    await expect(page.getByTestId("market-panel")).toBeVisible();
    // the idle chain has started (editor first) and its chunks are still in flight when the network goes away
    await page.waitForTimeout(700);
    await context.setOffline(true);
    await page.waitForTimeout(4500);
    expect(noNetErrors(errors), errors.join("\n")).toEqual([]);
    const unstarted = missingSteps();
    await context.setOffline(false);
    // the chain goes on by itself with the steps it had not started yet (none left: it had started them all)
    await expect.poll(missingSteps, { timeout: 30_000, message: `the idle chain resumes after \`online\` (not started at the drop: ${unstarted.join(", ") || "nothing"})` }).toEqual([]);
    expect(noNetErrors(errors), errors.join("\n")).toEqual([]);
    // A module whose request was cut off by the drop stays failed for the rest of the document (the browser keeps the failure),
    // so the editor either opens or the app says so ("Neu laden" is the way out) – never a silent tap.
    await page.getByRole("button", { name: "Trade eintragen" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Trade eintragen" });
    const said = page.getByText("Der Editor konnte nicht geladen werden");
    await expect(dialog.or(said)).toBeVisible({ timeout: 30_000 });
    if (await said.isVisible()) {
      await page.reload();
      await page.getByRole("button", { name: "Trade eintragen" }).first().click();
      await expect(dialog).toBeVisible({ timeout: 30_000 });
    }
    expect(await dialog.evaluate((el) => getComputedStyle(el.closest(".fixed") ?? el).position), "stylesheet of the chunk applied").toBe("fixed");
  });

  test("a page that is not loaded yet, opened offline: an honest placeholder, no error, and it loads once online", async ({ page, context }) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByTestId("market-panel")).toBeVisible();
    // no request may be cut off by the drop: wait until the idle chain has loaded what it loads (Analyse is not part of it)
    await assetsQuiet(page);
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
