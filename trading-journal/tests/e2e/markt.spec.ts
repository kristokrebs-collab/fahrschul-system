/**
 * P02 Box zu Box end to end against the market mock with REAL BTCUSDT 4h / 1D bars (`mockMarket(…, { boxes: true })`:
 * the 4h bar of 2026-10-10 20:00 UTC is "now" – an A+ range long at the support with a broken RSI line).
 *
 * Markt page: `h1 Markt`, the best setups (A+ / A only, a MorphCard dialog with every reason and weight), the box phase
 * rail with the candle-close countdown, the own chart with boxes + targets + RSI pane (timeframe switch 4h / 1D / 1W),
 * the RSI trendlines, the watchlist scanner (on demand), the settings written at once, no horizontal scroll at 390 px,
 * no console errors. Until P14 registers the `markt` page the spec opens the dev harness `/dev/markt.html` (Vite dev
 * server, e.g. `npx vite --port 4191` + `PW_BASE_URL`); set `PW_MARKT_URL=/#markt` once the page is routed. On a
 * production preview without the harness these tests skip themselves.
 *
 * Overview (real app, any server): the chart's new `RSI` pane and the `Boxen` layer toggle (off by default), the
 * Top-Trader card's order-flow row with the Box-Bias chip. `P02_SHOTS_DIR` also writes review screenshots.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, fixture, isMobile, seed } from "./helpers";

const MARKT_URL = process.env.PW_MARKT_URL ?? "/dev/markt.html";
const SHOTS = process.env.P02_SHOTS_DIR;
const P02_PROJECTS = ["mobile", "desktop"];
/** The seeded journal's settings (the fixture stores them as a JSON string or an object). */
const fixtureSettings = (): Record<string, unknown> => {
  const raw = fixture["tj2-settings"];
  return (typeof raw === "string" ? JSON.parse(raw) : (raw ?? {})) as Record<string, unknown>;
};

async function shot(page: Page, info: TestInfo, name: string, fullPage = false): Promise<void> {
  if (!SHOTS) return;
  if (fullPage) {
    // every first-view effect runs (reveals, draw-ins), the sticky header stays at the top of the picture
    await page.addStyleTag({ content: "header{position:static!important}" });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 450) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(140);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.waitForTimeout(1600); // entrances settle (JS animations are not frozen by `animations: "disabled"`)
  await page.screenshot({ path: `${SHOTS}/P02-box-${name}-${info.project.name === "mobile" ? "390" : "1440"}.png`, fullPage, animations: "disabled" });
}

/** Opens the Markt page; false (→ skip) where the dev harness is not served. */
async function openMarkt(page: Page): Promise<boolean> {
  const res = await page.goto(MARKT_URL);
  if (!res || !res.ok()) return false;
  return page
    .getByRole("heading", { level: 1, name: "Markt" })
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
}

test.describe("Markt · Box zu Box", () => {
  test.setTimeout(90_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!P02_PROJECTS.includes(info.project.name), "P02 runs on mobile + desktop");
  });

  test("best setups, phase rail, chart with boxes and RSI pane, RSI lines – no errors, no horizontal scroll", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    test.skip(!(await openMarkt(page)), "the Markt page is served by the dev harness (Vite dev server) until P14 routes it");
    const view = page.getByTestId("markt-view");
    await expect(view).toHaveAttribute("data-state", "ok", { timeout: 30_000 });

    // trade the best: only A+ / A cards, the dot-matrix grade is the accessible name
    const best = page.getByTestId("best-setup");
    await expect(best.first()).toBeVisible({ timeout: 20_000 });
    const grades = await best.evaluateAll((els) => els.map((e) => e.getAttribute("data-grade")));
    expect(grades.length).toBeGreaterThan(0);
    for (const g of grades) expect(["A+", "A"]).toContain(g);
    await expect(page.getByRole("img", { name: /^Note A\+?$/ }).first()).toBeVisible();

    // phase rail + countdown to the candle close
    const state = page.getByTestId("markt-state");
    await expect(state.getByRole("list", { name: "Phasen der Box" })).toBeVisible();
    await expect(state.getByText(/^Kerzenschluss in/)).toBeVisible();
    await expect(state.locator("[aria-current=step]")).toHaveCount(1);

    // the chart: boxes drawn, RSI legend, timeframe switch
    const chart = page.getByTestId("markt-chart");
    await chart.scrollIntoViewIfNeeded();
    await expect(chart.locator("[data-ready=true]")).toBeVisible({ timeout: 20_000 });
    await expect(chart.locator("[data-boxes]")).not.toHaveAttribute("data-boxes", "0");
    await expect(chart.getByTestId("rsi-legend")).toContainText(/RSI 14\s*\d+,\d/);
    await shot(page, info, "markt", true);
    await chart.getByRole("radio", { name: "1D" }).click();
    await expect(chart.locator("[data-tf]").first()).toHaveAttribute("data-tf", "1d");
    await expect(chart.locator("[data-ready=true]")).toBeVisible();
    await chart.getByRole("radio", { name: "1W" }).click();
    await expect(chart.locator("[data-tf]").first()).toHaveAttribute("data-tf", "1w");

    // RSI trendlines per timeframe
    const rsi = page.getByTestId("markt-rsi");
    await expect(rsi.getByTestId("rsi-row")).toHaveCount(3);

    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("a setup opens its reasons with weights and the plan (MorphCard dialog)", async ({ page }, info) => {
    await seed(page, { boxes: true });
    test.skip(!(await openMarkt(page)), "dev harness only");
    const card = page.getByTestId("best-setup").first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const explain = dialog.getByTestId("setup-explain");
    await expect(explain.getByRole("heading", { name: "Gründe" })).toBeVisible();
    expect(await explain.locator("li[data-ok]").count()).toBeGreaterThanOrEqual(4);
    await expect(explain.getByText("CRV")).toBeVisible();
    await shot(page, info, "setup-dialog");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("scanner scans the watchlist on demand; settings write settings.boxes at once", async ({ page }, info) => {
    const errors = collectErrors(page);
    // four symbols = 16 weight: one scan fits the scanner's own minute budget (ten take ~2 minutes by design)
    await seed(page, { boxes: true, extra: { "tj2-settings": { ...fixtureSettings(), boxes: { watchlist: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT"] } } } });
    test.skip(!(await openMarkt(page)), "dev harness only");
    const scanner = page.getByTestId("markt-scanner");
    await scanner.scrollIntoViewIfNeeded();
    // the first scan starts by itself; afterwards "Jetzt scannen" works again
    await expect(scanner.locator("[data-state]")).toHaveAttribute("data-state", /^(ok|scanning)$/, { timeout: 20_000 });
    await expect(scanner.locator("[data-state]")).toHaveAttribute("data-state", "ok", { timeout: 60_000 });
    const rows = scanner.getByTestId("scan-row");
    for (const g of await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-grade")))) expect(["A+", "A"]).toContain(g);
    await expect(scanner.getByTestId("scan-now")).toBeEnabled();

    const settings = page.getByTestId("markt-settings");
    await settings.scrollIntoViewIfNeeded();
    const watch = settings.getByTestId("watchlist");
    await expect(watch.getByRole("listitem")).toHaveCount(4);
    await watch.getByRole("button", { name: "DOGEUSDT entfernen" }).click();
    await expect(watch.getByRole("listitem")).toHaveCount(3);
    await settings.getByRole("radio", { name: "nur A+" }).click();
    const stored = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("tj2-settings") ?? "{}") as { boxes?: { watchlist?: string[]; minGrade?: string } };
      return s.boxes;
    });
    expect(stored?.watchlist).not.toContain("DOGEUSDT");
    expect(stored?.minGrade).toBe("A+");
    // every listed setup now is A+
    for (const g of await page.getByTestId("best-setup").evaluateAll((els) => els.map((e) => e.getAttribute("data-grade")))) expect(g).toBe("A+");
    await shot(page, info, "settings");
    if (isMobile(info)) await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});

test.describe("Übersicht · RSI-Pane, Boxen-Ebene, Order-Flow", () => {
  test.setTimeout(90_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!P02_PROJECTS.includes(info.project.name), "P02 runs on mobile + desktop");
  });

  test("the chart's RSI pane and the Boxen layer (off by default); the Top-Trader order-flow row", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await page.goto("/");
    const chartCard = page.locator("#chart-card");
    await expect(chartCard).toBeVisible({ timeout: 30_000 });
    await chartCard.scrollIntoViewIfNeeded();
    await expect(chartCard.locator("[data-ready=true]")).toBeVisible({ timeout: 30_000 });
    // the layer toggle exists and is off: the overview looks as before
    const boxes = chartCard.getByRole("button", { name: "Box-zu-Box-Boxen im Chart (4h)" });
    await expect(boxes).toHaveAttribute("aria-pressed", "false");
    await boxes.click();
    await expect(boxes).toHaveAttribute("aria-pressed", "true");
    // RSI pane
    await chartCard.getByRole("radio", { name: "RSI" }).click();
    await expect(chartCard.getByTestId("rsi-legend")).toContainText(/RSI 14\s*\d+,\d/, { timeout: 15_000 });
    await shot(page, info, "overview-chart");
    // order flow row (closed by default) with the Box-Bias chip
    const flow = page.getByTestId("top-trader-flow");
    await flow.scrollIntoViewIfNeeded();
    await expect(flow).toHaveAttribute("data-open", "false");
    await expect(flow.getByTestId("box-bias")).toBeVisible();
    await flow.getByRole("button", { name: /^Order-Flow/ }).click();
    await expect(flow).toHaveAttribute("data-open", "true");
    await expect(flow.getByText("OI Δ24h")).toBeVisible();
    await shot(page, info, "overview-flow");
    if (isMobile(info)) await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});
