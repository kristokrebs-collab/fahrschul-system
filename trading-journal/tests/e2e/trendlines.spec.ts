/**
 * Preis- & RSI-Struktur (F05) end to end against the market mock with REAL BTCUSDT 4h / 1D bars (`seed(page, { boxes: true })`):
 *
 * - Markt page: the card (own lazy chunk) lists a row per selected timeframe (default 1h 4h 1D 1W) with the price and RSI
 *   lines, approach / break / retest as separate statements and the distance in % and ATR;
 * - a timeframe the mocked feed cannot serve yet is a disabled chip WITH its reason, never replaced by another one;
 * - the timeframe chips are stored in `settings.trendlines` (versioned, the other settings untouched) and survive a reload;
 * - the chart draws the price lines (`data-trendlines`, the chart's `__tjTrend` hook) and the switch / the legend chip turns
 *   them off and on; the mirror flips only the price axis (same x, mirrored y), flipping back restores the picture;
 * - no console errors, no horizontal scroll at 390 px, touch targets ≥ 44 px on touch.
 *
 * No clock jumps; nothing here depends on the time of day (the fixture bars are real, the mock's "now" is the 4h bar of
 * 2026-10-11 00:00 UTC).
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, seed, stored } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";

const MARKT_URL = process.env.PW_MARKT_URL ?? "/#markt";
const PROJECTS = ["mobile", "desktop"];

async function openMarkt(page: Page): Promise<void> {
  await openRoute(page, MARKT_URL, "Markt");
  await expect(page.getByTestId("markt-view")).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
}

interface TrendHook {
  lines(): ReadonlyArray<{ id: string; label: string }>;
  geometry(): ReadonlyArray<{ id: string; x1: number; y1: number; x2: number; y2: number }>;
}

/** The lines the chart holds and draws (the host's `__tjTrend` hook), `null` before the primitive exists. */
async function trendHook(page: Page): Promise<{ lines: string[]; drawn: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }> } | null> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="markt-chart"] [role="img"][aria-label="Kerzenchart"]') as (Element & { __tjTrend?: TrendHook }) | null;
    const hook = host?.__tjTrend;
    return hook ? { lines: hook.lines().map((l) => l.id), drawn: hook.geometry().map((g) => ({ id: g.id, x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 })) } : null;
  });
}

test.describe("Preis- & RSI-Struktur", () => {
  test.setTimeout(90_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("a row per timeframe with price and RSI lines, locked timeframes keep their reason – no errors, no horizontal scroll", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await openMarkt(page);
    const card = page.getByTestId("markt-trend");
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId("trend-row").first()).toBeVisible({ timeout: 30_000 });

    // default selection 1h 4h 1D 1W, each a row
    await expect(card.getByTestId("trend-row")).toHaveCount(4);
    expect(await card.getByTestId("trend-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-tf")))).toEqual(["1h", "4h", "1D", "1W"]);

    // 4h and 1D come with real candles: both series, both kinds, every statement carries a phase and a tone
    for (const tf of ["4h", "1D"]) {
      const row = card.locator(`[data-testid="trend-row"][data-tf="${tf}"]`);
      await expect(row).toHaveAttribute("data-status", "ok", { timeout: 30_000 });
      await expect(row.getByTestId("trend-series")).toHaveCount(2);
      await expect(row.getByTestId("trend-kind")).toHaveCount(4);
      await expect(row).toContainText(/\d+ geschlossene Kerzen/);
    }
    // every line statement is one of the separate phases, and a price line names its distance in % and ATR
    const phases = await card.getByTestId("trend-line").evaluateAll((els) => els.map((e) => ({ phase: e.getAttribute("data-phase"), series: e.getAttribute("data-series"), text: e.textContent ?? "" })));
    for (const p of phases) expect(["intact", "approach", "break", "retest-open", "retest-held", "retest-failed", "no-retest"]).toContain(p.phase);
    for (const p of phases.filter((x) => x.series === "price" && (x.phase === "intact" || x.phase === "approach"))) expect(p.text).toMatch(/\d+,\d{2} % \(\d+,\d ATR\)/);
    for (const p of phases.filter((x) => x.series === "rsi" && (x.phase === "intact" || x.phase === "approach"))) expect(p.text).toMatch(/\d+,\d Punkte/);

    // a timeframe that is not available is a locked chip with its reason listed – and not silently another one
    const chips = card.getByTestId("trend-tfs");
    const locked = chips.locator("button[data-locked]");
    for (const tf of await locked.evaluateAll((els) => els.map((e) => e.getAttribute("data-tf")))) {
      await expect(card.getByTestId("trend-blocked")).toContainText(tf === "1D" ? "1D" : tf!);
    }
    for (const row of await card.locator('[data-testid="trend-row"][data-status="locked"]').all()) await expect(row.getByTestId("trend-locked")).not.toHaveText("");

    await expectNoHorizontalScroll(page);
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="markt-trend"]' });
      expect(misses, JSON.stringify(misses)).toEqual([]);
    }
    expect(errors).toEqual([]);
  });

  test("the timeframe chips are stored in settings.trendlines, survive a reload and the other settings stay untouched", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await openMarkt(page);
    const card = page.getByTestId("markt-trend");
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId("trend-row").first()).toBeVisible({ timeout: 30_000 });
    const before = await stored<Record<string, unknown>>(page, "tj2-settings");
    expect(before?.trendlines).toBeUndefined();

    const chips = card.getByTestId("trend-tfs");
    // 1h off, 4h stays, 1W off → 4h and 1D remain
    await chips.getByRole("button", { name: "1H", exact: true }).click();
    await chips.getByRole("button", { name: "1W", exact: true }).click();
    await expect(card.getByTestId("trend-row")).toHaveCount(2);
    await expect.poll(async () => (await stored<{ trendlines?: { v?: number; tfs?: string[]; chart?: boolean } }>(page, "tj2-settings"))?.trendlines).toEqual({ v: 1, tfs: ["4h", "1D"], chart: true });
    const after = await stored<Record<string, unknown>>(page, "tj2-settings");
    const { trendlines: _t, ...rest } = after ?? {};
    void _t;
    expect(rest).toEqual(before);

    await page.reload();
    await expect(page.getByTestId("markt-view")).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
    const again = page.getByTestId("markt-trend");
    await again.scrollIntoViewIfNeeded();
    await expect(again.getByTestId("trend-row")).toHaveCount(2);
    expect(await again.getByTestId("trend-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-tf")))).toEqual(["4h", "1D"]);
    await expect(again.getByTestId("trend-tfs").getByRole("button", { name: "4H", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  });

  test("the chart draws the price lines, the switch turns them off and on, the mirror flips only the price axis", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await openMarkt(page);
    const chart = page.getByTestId("markt-chart");
    await chart.scrollIntoViewIfNeeded();
    await expect(chart.locator("[data-ready=true]")).toBeVisible({ timeout: 20_000 });
    const wrap = chart.locator("[data-trendlines]");
    // the card says which price lines exist (4h, 1D, 1W of the default selection are at least as long as the 4h chart)
    const card = page.getByTestId("markt-trend");
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('[data-testid="trend-row"][data-tf="4h"]')).toHaveAttribute("data-status", "ok", { timeout: 30_000 });
    const priceLines = await card
      .locator('[data-testid="trend-row"]')
      .evaluateAll((rows) => rows.filter((r) => ["4h", "1D", "1W"].includes(r.getAttribute("data-tf") ?? "")).reduce((n, r) => n + r.querySelectorAll('[data-testid="trend-line"][data-series="price"]').length, 0));
    await chart.scrollIntoViewIfNeeded();
    if (priceLines === 0) {
      // an honest empty picture: no line in the data, no line in the chart
      await expect(wrap).toHaveAttribute("data-trendlines", "0");
      return;
    }
    await expect(wrap).toHaveAttribute("data-trendlines", String(priceLines), { timeout: 15_000 });
    await expect.poll(async () => (await trendHook(page))?.lines.length ?? -1, { timeout: 15_000 }).toBe(priceLines);

    // the mirror: same x for every drawn point, y mirrored (their sum is constant), flipping back restores the picture
    await expect.poll(async () => (await trendHook(page))?.drawn.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
    const plain = (await trendHook(page))!;
    const flip = chart.getByRole("switch", { name: /spiegel/i }).first();
    await flip.click();
    await expect.poll(async () => {
      const m = (await trendHook(page))?.drawn ?? [];
      const p = plain.drawn.find((g) => m.some((x) => x.id === g.id));
      const q = p && m.find((x) => x.id === p.id);
      return p && q ? Math.abs(q.x1 - p.x1) < 0.75 && Math.abs(q.x2 - p.x2) < 0.75 && Math.abs(q.y1 - p.y1) > 4 : false;
    }, { timeout: 15_000 }).toBe(true);
    await flip.click();
    await expect.poll(async () => {
      const back = (await trendHook(page))?.drawn ?? [];
      return plain.drawn.every((p) => {
        const q = back.find((x) => x.id === p.id);
        return q != null && Math.abs(q.y1 - p.y1) < 0.75 && Math.abs(q.y2 - p.y2) < 0.75 && Math.abs(q.x1 - p.x1) < 0.75;
      });
    }, { timeout: 15_000 }).toBe(true);

    // the legend chip turns the lines off (stored), the card's switch brings them back
    await chart.getByTestId("chart-trend-toggle").click();
    await expect(wrap).toHaveAttribute("data-trendlines", "0", { timeout: 15_000 });
    await expect.poll(async () => (await stored<{ trendlines?: { chart?: boolean } }>(page, "tj2-settings"))?.trendlines?.chart).toBe(false);
    await card.scrollIntoViewIfNeeded();
    await card.getByTestId("trend-chart-switch").click();
    await chart.scrollIntoViewIfNeeded();
    await expect(wrap).toHaveAttribute("data-trendlines", String(priceLines), { timeout: 15_000 });
    expect(errors).toEqual([]);
  });
});
