/**
 * Zeitmaschine end to end (Labor section, mobile + desktop) against the market mock with REAL BTCUSDT 4h bars (`boxes: true`, no
 * network): a plan typed by hand → candles are loaded → the card computes in the worker (progress) → odds, fan, histogram, cases,
 * earlier occasions and the comparison appear; a changed price re-runs on the same candles; an invalid plan says why; cancelling
 * stops. Nothing here depends on the clock: the market is a fixed set of bars and the figures are compared with each other
 * (shares add up, the same plan twice gives the same numbers), never with fixed values.
 *
 * Runs on the routed page `/#labor` of the production build (`PW_LABOR_URL` overrides it).
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, screenshot, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { synthPrice } from "./mocks/synth";

const LABOR_URL = process.env.PW_LABOR_URL ?? "/#labor";
const PROJECTS = ["mobile", "desktop"];
/** The last closed 4h candle of the mock closes at 82 941; a long a bit below it with a 2 R target. */
const PLAN = { entry: "82.900", stop: "80.500", target: "87.700" };

async function open(page: Page, info: TestInfo): Promise<string[]> {
  test.skip(!PROJECTS.includes(info.project.name), "Zeitmaschine runs on mobile + desktop");
  const errors = collectErrors(page);
  await seed(page, { boxes: true });
  await openRoute(page, LABOR_URL, "Labor");
  await page.getByTestId("tm-section").scrollIntoViewIfNeeded();
  return errors;
}

async function fillPlan(page: Page, plan = PLAN): Promise<void> {
  await page.getByTestId("tm-entry").fill(plan.entry);
  await page.getByTestId("tm-stop").fill(plan.stop);
  await page.getByTestId("tm-target").fill(plan.target);
}

const pct = async (page: Page, id: string): Promise<number> => {
  const txt = (await page.getByTestId(id).locator("span").nth(1).textContent()) ?? "";
  return Number(txt.replace(/[^\d,]/g, "").replace(",", "."));
};

test.describe("Labor · Zeitmaschine", () => {
  test.setTimeout(180_000);

  test("Plan eintragen → Kerzen laden → durchspielen: Chancen, Fächer, Histogramm, Fälle, Vorfälle, Vergleich", async ({ page }, info) => {
    const errors = await open(page, info);
    // before anything is typed: the honest empty state and no button that could start a run
    await expect(page.getByTestId("tm-load-start")).toBeDisabled();
    await expect(page.getByTestId("tm-card")).toHaveCount(0);

    await fillPlan(page);
    await expect(page.getByTestId("tm-load-start")).toBeEnabled();
    await page.getByTestId("tm-load-start").click();
    const card = page.getByTestId("tm-card");
    await expect(card).toHaveAttribute("data-status", "done", { timeout: 120_000 });
    await expect(page.getByTestId("tm-result")).toHaveAttribute("data-seed", "19");

    // the three odds add up (rounding to a tenth)
    const [t, s, n] = [await pct(page, "tm-p-target"), await pct(page, "tm-p-stop"), await pct(page, "tm-p-neither")];
    expect(t + s + n).toBeGreaterThan(99.7);
    expect(t + s + n).toBeLessThan(100.3);
    await expect(page.getByTestId("tm-verdict")).toHaveAttribute("data-verdict", /.+/);
    await expect(page.getByTestId("tm-source")).toContainText("Binance");
    await expect(page.getByTestId("tm-plan")).toContainText("Long");
    const note = card.getByTestId("analysis-note");
    await expect(note).toContainText("Keine professionelle Finanzberatung.");
    await expect(note).toContainText("keine Zusage");

    // the pictures: the fan (bands, stop line dashed, target line solid) and the histogram
    const fan = page.getByTestId("tm-fan");
    await fan.scrollIntoViewIfNeeded();
    await expect(fan).toHaveAttribute("data-drawn", "true");
    await expect(fan.locator('[data-line="stop"]')).toHaveCount(1);
    await expect(fan.locator('[data-line="target"]')).toHaveCount(1);
    await expect(fan.locator('[data-band="90"]')).toHaveCount(1);
    expect(await fan.locator("[data-path]").count()).toBeGreaterThan(5);
    await expect(page.getByTestId("tm-fan-readout")).toContainText("Median");
    const hist = page.getByTestId("tm-hist");
    await hist.scrollIntoViewIfNeeded();
    await expect(hist).toHaveAttribute("data-drawn", "true");
    expect(await hist.locator("[data-bin]").count()).toBeGreaterThan(2);
    await screenshot(page, info, "tm-result-top");

    // worst / middle / best, time to exit, the earlier occasions and the comparison
    for (const id of ["tm-case-worst", "tm-case-median", "tm-case-best", "tm-t-target", "tm-history", "tm-compare"]) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("tm-compare-row")).toHaveCount(4);
    await expect(page.getByTestId("tm-compare-text")).toContainText(/Vorfälle/);
    await expect(page.getByTestId("tm-assumptions")).toBeVisible();
    await page.getByTestId("tm-assumptions").locator("summary").click();
    await expect(page.getByTestId("tm-assumptions")).toContainText("Seed 19");
    await page.getByTestId("tm-assumptions").scrollIntoViewIfNeeded();
    await screenshot(page, info, "tm-result-bottom");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("ein anderer Preis rechnet auf denselben Kerzen neu; derselbe Plan zweimal gibt dieselben Zahlen", async ({ page }, info) => {
    const errors = await open(page, info);
    await fillPlan(page);
    await page.getByTestId("tm-load-start").click();
    await expect(page.getByTestId("tm-card")).toHaveAttribute("data-status", "done", { timeout: 120_000 });
    const first = await page.getByTestId("tm-p-target").innerText();
    // a wider stop: the old result is marked as outdated, then the new one comes (same candles, no new load)
    await page.getByTestId("tm-stop").fill("79.000");
    await expect(page.getByTestId("tm-stale")).toBeVisible();
    await expect(page.getByTestId("tm-result")).toHaveAttribute("data-stale", "false", { timeout: 60_000 });
    await expect(page.getByTestId("tm-card")).toHaveAttribute("data-status", "done");
    // and back: the first plan again gives the first numbers
    await page.getByTestId("tm-stop").fill(PLAN.stop);
    await expect(page.getByTestId("tm-result")).toHaveAttribute("data-stale", "false", { timeout: 60_000 });
    await expect.poll(() => page.getByTestId("tm-p-target").innerText(), { timeout: 60_000 }).toBe(first);
    expect(errors).toEqual([]);
  });

  test("ein Plan, der keinen Sinn ergibt, nennt den Grund und rechnet nicht; falsche Seite beim Short ebenso", async ({ page }, info) => {
    const errors = await open(page, info);
    await fillPlan(page, { entry: "82.900", stop: "84.000", target: "87.700" });
    await expect(page.getByTestId("tm-form-problem")).toContainText("Bei Long muss der Stop unter dem Einstieg liegen");
    await expect(page.getByTestId("tm-load-start")).toBeDisabled();
    await page.getByTestId("tm-entry").fill("");
    await expect(page.getByTestId("tm-form-problem")).toContainText("Es fehlt: Einstieg");
    await expect(page.getByTestId("tm-card")).toHaveCount(0);
    await screenshot(page, info, "tm-form-problem");
    expect(errors).toEqual([]);
  });

  test("Abbrechen hält die Rechnung an", async ({ page }, info) => {
    const errors = await open(page, info);
    await fillPlan(page);
    // more sessions and a long time stop make the run last long enough to press the button
    await page.getByRole("button", { name: /Weitere Einstellungen der Zeitmaschine/ }).click();
    await page.getByRole("radio", { name: "20 000" }).click();
    await page.getByTestId("tm-horizon").fill("400");
    await page.getByTestId("tm-load-start").click();
    const busy = page.getByTestId("tm-busy");
    await expect(busy.or(page.getByTestId("tm-card").and(page.locator('[data-status="done"]')))).toBeVisible({ timeout: 90_000 });
    if (await busy.isVisible()) {
      await expect(busy.getByRole("progressbar")).toHaveAttribute("aria-valuenow", /\d+/);
      await page.getByTestId("tm-cancel").click();
      await expect(page.getByTestId("tm-cancelled")).toBeVisible();
      await expect(page.getByTestId("tm-card")).toHaveAttribute("data-status", "cancelled");
    }
    expect(errors).toEqual([]);
  });

  test("Touch-Ziele des Formulars und der Karte sind mindestens 44 px", async ({ page }, info) => {
    test.skip(!hasTouch(info), "touch project only");
    await open(page, info);
    await fillPlan(page);
    await page.getByTestId("tm-load-start").click();
    await expect(page.getByTestId("tm-card")).toHaveAttribute("data-status", "done", { timeout: 120_000 });
    const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="tm-section"]' });
    expect(misses, JSON.stringify(misses)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------------------ Trade-Detail */

const HOUR = 3_600_000;

/** Local wall clock of `ms` in Europe/Berlin (the browser's zone) as `YYYY-MM-DDTHH:mm`. */
function berlin(ms: number): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Two closed BTC/USDT trades on the synthetic price path: one with a stop, one without. */
function journalTrades(anchor: number) {
  const at = (h: number) => Math.floor((anchor - h * HOUR) / HOUR) * HOUR;
  const p = (t: number) => Math.round(synthPrice(t, anchor) * 10) / 10;
  const base = { account: "scalp", timeframe: "1h", checks: {}, conviction: 4, followedPlan: true, emotion: "Ruhig", reason: "", notes: "", chart: "", leverage: 5, fees: 2, pnlManual: null, pnl: null, r: null, createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", status: "closed", pair: "BTC/USDT", target: null, setups: [] as string[] };
  const mk = (id: string, side: "long" | "short", from: number, to: number, stop: boolean) => {
    const e = at(from);
    const x = at(to);
    return { ...base, id, side, date: berlin(e), exitDate: berlin(x), entry: p(e), stop: stop ? Math.round(p(e) * (side === "long" ? 0.99 : 1.01) * 10) / 10 : null, exit: p(x), size: Math.round(p(e) * 0.2 * 10) / 10 };
  };
  return [mk("t_tm_a", "long", 100, 90, true), mk("t_tm_b", "short", 70, 62, false)];
}

/** The fields a Zeitmaschine must never touch, per trade. */
const coreTrades = async (page: Page): Promise<string> =>
  JSON.stringify(
    (await page.evaluate(() => JSON.parse(localStorage.getItem("tj2-trades") ?? "[]") as Record<string, unknown>[]))
      .map((t) => ({ id: t.id, side: t.side, status: t.status, date: t.date, exitDate: t.exitDate, entry: t.entry, stop: t.stop, target: t.target, exit: t.exit, size: t.size, pnl: t.pnl, r: t.r }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  );

test.describe("Trade-Detail · Zeitmaschine", () => {
  test.setTimeout(180_000);

  async function openDetail(page: Page, info: TestInfo, id: string): Promise<string[]> {
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
    const errors = collectErrors(page);
    const anchor = Date.now();
    await seed(page, { synth: { anchor }, extra: { "tj2-trades": journalTrades(anchor) } });
    await page.goto("/#trades");
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    await page.locator(`[data-trade-id="${id}"]:visible`).first().click();
    await expect(page.getByRole("dialog", { name: "Trade-Details" })).toBeVisible();
    return errors;
  }

  test("der Knopf im Trade-Detail öffnet das Blatt: Plan des Trades, nur Kerzen vor dem Einstieg, Ergebnis, was wirklich passiert ist – nichts wird gespeichert", async ({ page }, info) => {
    const errors = await openDetail(page, info, "t_tm_a");
    const before = await coreTrades(page);
    await page.getByRole("dialog", { name: "Trade-Details" }).getByRole("button", { name: "Zeitmaschine" }).click();
    const sheet = page.getByTestId("tm-trade");
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    await expect(sheet).toContainText("BTC/USDT");
    // no target in the trade: the sheet says it is assumed and lets the trader choose
    await expect(sheet).toContainText("(angenommen)");
    await expect(page.getByTestId("tm-trade-actual")).toContainText("Was wirklich passiert ist");
    await expect(page.getByTestId("tm-card")).toHaveAttribute("data-status", "done", { timeout: 120_000 });
    await expect(page.getByTestId("tm-card")).toContainText("Kerzen vor");
    await expect(page.getByTestId("tm-verdict")).toBeVisible();
    await expect(page.getByTestId("tm-result")).toHaveAttribute("data-seed", "19");
    // a different assumed target is a different plan: the card runs again
    const first = await page.getByTestId("tm-p-target").innerText();
    await page.getByRole("radio", { name: "3 R" }).click();
    await expect(page.getByTestId("tm-stale").or(page.getByTestId("tm-busy")).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("tm-result")).toHaveAttribute("data-stale", "false", { timeout: 90_000 });
    expect(await page.getByTestId("tm-p-target").innerText()).not.toBe(first);
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "tm-trade-sheet");
    // the idle MAE / MFE backfill may add its own measurements: only what the trader entered must be untouched
    expect(await coreTrades(page)).toBe(before);
    expect(errors).toEqual([]);
  });

  test("ein Trade ohne Stop: ehrlich leer mit dem Grund, keine Rechnung", async ({ page }, info) => {
    const errors = await openDetail(page, info, "t_tm_b");
    await page.getByRole("dialog", { name: "Trade-Details" }).getByRole("button", { name: "Zeitmaschine" }).click();
    await expect(page.getByTestId("tm-trade-notice")).toContainText("keinen Stop", { timeout: 30_000 });
    await expect(page.getByTestId("tm-card")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
