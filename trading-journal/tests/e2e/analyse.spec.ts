/**
 * P03 Analyse page end to end: a seeded journal of 140 generated trades (deterministic; two setups with a clear edge,
 * one without, stops on every trade, exit times, ATR, MAE / MFE, tags) on top of the legacy fixture's settings, the
 * market mock for the daily candles (benchmark).
 *
 * Covered: `h1 Analyse`, the Kennzahlen hero (Sharpe, edge test, 9 ratio tiles → MorphCard dialog with sample and
 * interval), Monte Carlo (fan drawn, band uncovered, the scrubber moves the red run and its readout), risk of ruin,
 * the breakdown (robust best banner, dimension switch through the MorphSelect, rows open their trades), the
 * weekday × time heatmap (84 cells, best cell), MAE / MFE, distribution, rolling (scrub → readout), streaks, the
 * benchmark race, the comparison, a custom stat saved into `settings.analytics.custom` and removed again, the empty
 * journal's preview, `?dim=` deep link, no horizontal scroll at 390 px, no console errors.
 *
 * Runs on the routed page `/#analyse` of the production build (P14; `PW_ANALYSE_URL` overrides it, e.g. the dev harness
 * `/dev/analyse.html` under `npm run dev`). `P03_SHOTS` writes review screenshots into that directory.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { analyseTrades } from "./analyseData";
import { collectErrors, expectNoHorizontalScroll, openRoute, seed, waitForStableLayout } from "./helpers";

const ANALYSE_URL = process.env.PW_ANALYSE_URL ?? "/#analyse";
const SHOTS = process.env.P03_SHOTS;
const PROJECTS = ["mobile", "desktop"];

async function shot(page: Page, info: TestInfo, name: string, fullPage = false): Promise<void> {
  if (!SHOTS) return;
  if (fullPage) {
    await page.addStyleTag({ content: "header{position:static!important}" });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 400) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(160);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOTS}/P03-analytics-${name}-${info.project.name === "mobile" ? "390" : "1440"}.png`, fullPage, animations: "disabled" });
}

/** Opens the Analyse page (`query` = the hash query, e.g. `?dim=weekday`); fails when it does not come up. */
async function openAnalyse(page: Page, query = ""): Promise<void> {
  await openRoute(page, `${ANALYSE_URL}${query}`, "Analyse");
}

test.describe("Analyse", () => {
  test.setTimeout(90_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "P03 runs on mobile + desktop");
  });

  test("Kennzahlen, Monte Carlo, Risk of Ruin, Breakdown, Heatmap … – no errors, no horizontal scroll", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { extra: { "tj2-trades": analyseTrades() } });
    await openAnalyse(page);
    const view = page.getByTestId("analyse-view");
    await expect(view).toHaveAttribute("data-n", "140");

    // hero: Sharpe headline, edge test, the ratio tiles
    const hero = page.getByTestId("ana-hero");
    await expect(hero.getByTestId("ana-sharpe")).toContainText(/\d/);
    await expect(hero.getByTestId("ana-edge")).toContainText(/p (=|<) 0,\d/);
    await expect(hero.locator("[data-testid^=ana-tile-]")).toHaveCount(9);
    // costs: Brutto (vor Kosten) → Gebühren → Funding → Netto (Review F05; the tile label is „Brutto“ since P1-18)
    const costs = page.getByTestId("ana-costs");
    await expect(costs.getByText("Brutto", { exact: true })).toBeVisible();
    await expect(costs.getByTestId("ana-cost-net")).toContainText(/\d/);
    await shot(page, info, "top");

    // a tile opens its explainer (MorphCard dialog) with the sample and the 80 % interval
    await hero.getByTestId("ana-tile-sqn").getByRole("button").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Stichprobe", { exact: true })).toBeVisible();
    await expect(dialog.getByText("80-%-Intervall").first()).toBeVisible();
    await shot(page, info, "dialog");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Monte Carlo: fan drawn, band uncovered, the scrubber moves the red run
    const mc = page.getByTestId("ana-mc");
    await mc.scrollIntoViewIfNeeded();
    await expect(mc.getByTestId("mc-fan")).toHaveAttribute("data-drawn", "true", { timeout: 20_000 });
    // web build / dev server: the simulation ran in the module worker (the idle-chunk fallback is for file builds)
    expect(page.workers().length).toBeGreaterThan(0);
    const readout = mc.getByTestId("mc-readout");
    await expect(readout).toContainText(/^Lauf \d+: Ende/);
    const before = await readout.textContent();
    const slider = mc.getByRole("slider", { name: "Simulierte Läufe durchgehen" });
    await slider.focus();
    await page.keyboard.press("Home");
    await expect(readout).toContainText(/^Lauf 1:/);
    expect(await readout.textContent()).not.toBe(before);
    await mc.getByRole("radio", { name: "250 Trades" }).click();
    await expect(mc.getByTestId("mc-fan")).toHaveAttribute("data-drawn", "true", { timeout: 20_000 });
    await expect(mc).toContainText("nach 250 Trades");

    // risk of ruin: a simulated value
    const ror = page.getByTestId("ana-ror");
    await expect(ror.getByTestId("ror-value")).toHaveAttribute("data-state", "done", { timeout: 20_000 });
    await expect(ror.getByTestId("ror-value")).toContainText("%");

    // breakdown: the robust best leads, dimension switch, a row opens its trades
    const bd = page.getByTestId("ana-breakdown");
    await bd.scrollIntoViewIfNeeded();
    await expect(bd.getByTestId("bd-banner")).toContainText(/Trade the best|Vorn · noch unsicher/);
    await expect(bd.getByTestId("bd-row").first()).toBeVisible();
    await bd.getByTestId("bd-dim").click();
    await page.getByRole("option", { name: /^Session/ }).click();
    await expect(bd.getByTestId("bd-row").first()).toHaveAttribute("data-key", /asia|london|ny|late|weekend/);
    await bd.getByTestId("bd-row").first().getByRole("button").click();
    await expect(bd.locator("[data-trade-id]").first()).toBeVisible();

    // heatmap: 84 cells, the best one marked, a tap shows its numbers
    const heat = page.getByTestId("ana-heat");
    await expect(heat.getByTestId("heat-cell")).toHaveCount(84);
    await heat.getByTestId("heat-cell").nth(30).click();
    await expect(heat.getByTestId("heat-detail")).toContainText(/\d Trades?/);

    // execution + patterns
    await expect(page.getByTestId("mae-scatter")).toBeVisible();
    await expect(page.getByTestId("dist-hist")).toBeVisible();
    await expect(page.getByTestId("dist-without")).toContainText("Ohne deine 3 besten Trades");
    const rolling = page.getByTestId("ana-rolling");
    await rolling.scrollIntoViewIfNeeded();
    const rr = rolling.getByTestId("rolling-readout");
    await expect(rr).toContainText(/^Trade 140 ·/);
    await rolling.getByRole("slider").focus();
    await page.keyboard.press("Home");
    await expect(rr).toContainText(/^Trade 20 ·/);
    await expect(page.getByTestId("streak-verdict")).toContainText(/Verlust/);

    // benchmark: the race against buy & hold from the daily candles
    const bench = page.getByTestId("ana-bench");
    await bench.scrollIntoViewIfNeeded();
    await expect(bench.getByTestId("bench-race")).toBeVisible({ timeout: 20_000 });
    await expect(bench).toContainText("Buy & Hold");
    await expect(page.getByTestId("ana-compare").getByTestId("cmp-row").first()).toBeVisible();

    await shot(page, info, "page", true);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("a custom stat is saved into the settings and removed again", async ({ page }) => {
    await seed(page, { extra: { "tj2-trades": analyseTrades() } });
    await openAnalyse(page);
    await waitForStableLayout(page);
    const card = page.getByTestId("ana-custom");
    await card.scrollIntoViewIfNeeded();
    // scrolling mounts the cards around it (`Later`) – let them settle, the open list closes when its trigger moves
    await waitForStableLayout(page);
    // a tap that lasts longer than the press-hold time (a busy runner) is read as a hold and does not open the list: tap
    // again until it is open (`aria-expanded` says so, a second tap on an open list would close it)
    const metric = card.getByTestId("custom-metric");
    await expect(async () => {
      if ((await metric.getAttribute("aria-expanded")) !== "true") await metric.click();
      await page.getByRole("option", { name: "Ø R" }).click({ timeout: 3_000 });
      await expect(metric).toContainText("Ø R", { timeout: 2_000 });
    }).toPass({ timeout: 40_000 });
    await card.getByRole("radio", { name: "Long" }).click();
    await expect(card.getByTestId("custom-preview")).toContainText("Ø R · Long · nach Session");
    await card.getByTestId("custom-save").click();
    const saved = card.getByTestId("custom-stat");
    await expect(saved).toHaveCount(1);
    await expect(saved).toContainText("Ø R · Long · nach Session");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("tj2-settings") ?? "{}") as { analytics?: { custom?: { metric: string; filter: { side?: string }; groupBy: string }[] } });
    expect(stored.analytics?.custom?.[0]).toMatchObject({ metric: "avgR", filter: { side: "long" }, groupBy: "session" });
    // survives a reload
    await page.reload();
    // the cards below the first screenful mount one after the other after the first paint (`Later`): give the last one time
    await expect(page.getByTestId("ana-custom").getByTestId("custom-stat")).toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId("ana-custom").getByRole("button", { name: /entfernen$/ }).click();
    await expect(page.getByTestId("ana-custom").getByTestId("custom-stat")).toHaveCount(0, { timeout: 10_000 });
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem("tj2-settings") ?? "{}") as { analytics?: { custom?: unknown[] } });
    expect(after.analytics?.custom).toEqual([]);
  });

  test("deep link ?dim= opens the breakdown on that dimension", async ({ page }) => {
    await seed(page, { extra: { "tj2-trades": analyseTrades() } });
    await openAnalyse(page, "?dim=weekday");
    await expect(page.getByTestId("ana-breakdown").getByTestId("bd-row").first()).toHaveAttribute("data-key", "0");
    await expect(page.getByTestId("bd-dim")).toContainText("Wochentag");
  });

  test("the empty journal shows one calm preview card", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { empty: true });
    await openAnalyse(page);
    await expect(page.getByTestId("ana-preview")).toBeVisible();
    await expect(page.getByTestId("ana-preview")).toContainText("Noch nichts zu analysieren");
    await shot(page, info, "empty");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("reduced motion: the final picture at once, no errors", async ({ page }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page, { extra: { "tj2-trades": analyseTrades() } });
    await openAnalyse(page);
    await expect(page.getByRole("heading", { level: 2, name: "Kennzahlen" })).toBeVisible();
    const mc = page.getByTestId("ana-mc");
    await mc.scrollIntoViewIfNeeded();
    await expect(mc.getByTestId("mc-fan")).toHaveAttribute("data-drawn", "true", { timeout: 20_000 });
    // whiskers / bars carry no pending transform (static end state)
    const pending = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="analyse-view"] span[style*="scaleX(0)"], [data-testid="analyse-view"] span[style*="scaleY(0)"]')).length);
    expect(pending).toBe(0);
    // Motion's own dev notice about the emulated setting is not an app defect
    expect(errors.filter((e) => !/Reduced Motion enabled/.test(e))).toEqual([]);
  });

  test("the legacy fixture (11 closed trades): honest small-sample states, no errors", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await openAnalyse(page);
    await expect(page.getByTestId("analyse-view")).toHaveAttribute("data-n", "11");
    await expect(page.getByTestId("ana-hero")).toBeVisible();
    await expect(page.getByTestId("ana-excursion")).toContainText("Noch keine MAE / MFE");
    await shot(page, info, "fixture", true);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});
