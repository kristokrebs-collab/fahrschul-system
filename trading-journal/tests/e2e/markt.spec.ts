/**
 * P02 Box zu Box end to end against the market mock with REAL BTCUSDT 4h / 1D bars (`mockMarket(…, { boxes: true })`:
 * the 4h bar of 2026-10-11 00:00 UTC is "now" – an A+ range long at the support with a broken RSI line).
 *
 * Markt page: `h1 Markt`, the best setups (A+ / A only, a MorphCard dialog with every reason and weight), the box phase
 * rail with the candle-close countdown, the own chart with boxes + targets + RSI pane (timeframe switch 4h / 1D / 1W),
 * the RSI trendlines, the watchlist scanner (on demand), the settings written at once, no horizontal scroll at 390 px,
 * no console errors. Runs on the routed page `/#markt` of the production build (P14; `PW_MARKT_URL` overrides it, e.g.
 * the dev harness `/dev/markt.html` under `npm run dev`).
 *
 * Overview (real app, any server): the chart's new `RSI` pane and the `Boxen` layer toggle (off by default), the
 * Top-Trader card's order-flow row with the Box-Bias chip. `P02_SHOTS_DIR` also writes review screenshots.
 */
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, fixture, isMobile, openRoute, seed } from "./helpers";

const MARKT_URL = process.env.PW_MARKT_URL ?? "/#markt";
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

/** Box fix review screenshots (`BOXFIX_SHOTS_DIR`): `P02-boxfix-{name}-{390|1440}.png` of one element. */
const BOXFIX_SHOTS = process.env.BOXFIX_SHOTS_DIR;
async function boxfixShot(page: Page, info: TestInfo, name: string, el: Locator): Promise<void> {
  if (!BOXFIX_SHOTS) return;
  await page.mouse.move(1, 1); // no crosshair tooltip in the picture
  await page.waitForTimeout(1600); // the boxes' draw-in (tween.draw) and the strip wipe settle
  await el.screenshot({ path: `${BOXFIX_SHOTS}/P02-boxfix-${name}-${info.project.name === "mobile" ? "390" : "1440"}.png`, animations: "disabled" });
}

/** The chart's read-only box hook (`BOX_DEBUG_KEY` in src/chart/primitives/BoxPrimitive.ts). */
interface BoxHook {
  geometry(): ReadonlyArray<{ id: string; x1: number; x2: number; active: boolean }>;
  boxes(): ReadonlyArray<{ id: string; from: number; to: number | null; top: number; btm: number; active?: boolean; label?: string }>;
  bars(): ReadonlyArray<{ time: number; close: number }>;
  x(logical: number): number | null;
}
interface Placement {
  /** ids of the drawn boxes */
  drawn: string[];
  /** the engine's newest box (its own id, not the `:live` part) when drawn: its left edge and the left edge of the bar of its t0 */
  active: { id: string; x1: number; edge: number | null; t0OnBar: boolean } | null;
  /** drawn boxes whose left edge is not the left edge of their first bar */
  misplaced: string[];
  /** closed candles under a box that close outside it (± 20 % of its height, wider than the engine's buffer) */
  outside: string[];
}

/**
 * Where the chart in `scope` draws its boxes against its own bars (`null` until the chart exists): every left edge on
 * the left edge of the box's first bar (x = 0 when the box starts off screen), every closed candle under a box closing
 * inside it (`closes`: the chart's interval is the boxes' own).
 */
async function boxPlacement(page: Page, scope: string, closes: boolean): Promise<Placement | null> {
  return page.evaluate(
    ({ scope, closes }) => {
      const host = document.querySelector(`${scope} [role="img"][aria-label="Kerzenchart"]`) as (Element & { __tjBoxes?: BoxHook }) | null;
      const hook = host?.__tjBoxes;
      if (!hook) return null;
      const bars = hook.bars();
      const boxes = hook.boxes();
      const geo = hook.geometry();
      const out: Placement = { drawn: geo.map((g) => g.id), active: null, misplaced: [], outside: [] };
      const firstAt = (sec: number) => bars.findIndex((b) => b.time >= sec);
      for (const g of geo) {
        const b = boxes.find((x) => x.id === g.id);
        if (!b) continue;
        const sec = Math.floor(b.from / 1000);
        const i = firstAt(sec);
        const edge = sec < (bars[0]?.time ?? 0) ? -1 : i < 0 ? null : hook.x(i - 0.5);
        if (edge == null || Math.abs(g.x1 - Math.max(0, edge)) > 0.75) out.misplaced.push(`${g.id}: x1 ${g.x1.toFixed(1)} ≠ ${edge?.toFixed(1)}`);
        if (b.active && !g.id.endsWith(":live")) out.active = { id: g.id, x1: g.x1, edge, t0OnBar: bars.some((x) => x.time === sec) };
        if (!closes) continue;
        const tol = 0.2 * (b.top - b.btm);
        for (let j = 0; j < bars.length - 1; j++) {
          const x = hook.x(j);
          const c = bars[j]!.close;
          if (x != null && x >= g.x1 && x <= g.x2 && (c > b.top + tol || c < b.btm - tol)) out.outside.push(`${g.id} bar ${j} close ${c}`);
        }
      }
      return out;
    },
    { scope, closes },
  );
}

/** Drags the chart in `scope` one swipe towards older bars (a narrow chart shows only the last days). */
async function panBack(page: Page, scope: Locator): Promise<void> {
  const r = await scope.locator('[role="img"][aria-label="Kerzenchart"]').boundingBox();
  if (!r) return;
  const y = r.y + r.height * 0.3;
  await page.mouse.move(r.x + r.width * 0.3, y);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.65, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** The placement once the engine's newest box starts in view (narrow charts are panned back to it, at most 16 swipes). */
async function newestBoxInView(page: Page, scope: string, el: Locator, closes: boolean): Promise<Placement> {
  let p = (await boxPlacement(page, scope, closes))!;
  for (let k = 0; k < 16 && !((p.active?.edge ?? -1) > 20); k++) {
    await panBack(page, el);
    p = (await boxPlacement(page, scope, closes))!;
  }
  return p;
}

/** Opens the Markt page (fails when it does not come up). */
async function openMarkt(page: Page): Promise<void> {
  await openRoute(page, MARKT_URL, "Markt");
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
    await openMarkt(page);
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
    await openMarkt(page);
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

  test("box fix: every box sits on its own bars – the active box starts at the bar of its t0, no candle under a box closes outside (4h / 1D / 1W)", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await openMarkt(page);
    await expect(page.getByTestId("markt-view")).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
    const chart = page.getByTestId("markt-chart");
    await chart.scrollIntoViewIfNeeded();
    await expect(chart.locator("[data-ready=true]")).toBeVisible({ timeout: 20_000 });
    for (const tf of ["4h", "1D", "1W"] as const) {
      const id = tf.toLowerCase();
      if (tf !== "4h") {
        await chart.getByRole("radio", { name: tf }).click();
        await expect(chart.locator("[data-tf]").first()).toHaveAttribute("data-tf", id);
      }
      // the boxes of this timeframe are drawn (ids `${tf}:…`)
      await expect.poll(async () => (await boxPlacement(page, '[data-testid="markt-chart"]', true))?.drawn.some((d) => d.startsWith(`${id}:`)) ?? false, { timeout: 15_000 }).toBe(true);
      await boxfixShot(page, info, `markt-${id}`, chart);
      const p = (await boxPlacement(page, '[data-testid="markt-chart"]', true))!;
      expect(p.misplaced, `${tf}: left edges`).toEqual([]);
      expect(p.outside, `${tf}: candles under the boxes`).toEqual([]);
      if (tf === "4h") {
        // the e2e's "now" (real 2026-10-11 00:00): the strong 82.832–85.224 box of 23.09. – drawn from its own first bar
        const q = await newestBoxInView(page, '[data-testid="markt-chart"]', chart, true);
        expect(q.active, "4h newest box drawn").not.toBeNull();
        expect(q.active!.t0OnBar).toBe(true);
        expect(q.active!.edge!).toBeGreaterThan(20); // inside the view, not on the pane's left edge
        expect(Math.abs(q.active!.x1 - q.active!.edge!)).toBeLessThanOrEqual(0.75);
        expect(q.misplaced, "4h left edges (panned)").toEqual([]);
        expect(q.outside, "4h candles under the boxes (panned)").toEqual([]);
        await chart.getByRole("button", { name: "Folgen" }).click({ timeout: 2_000 }).catch(() => undefined); // back to the live edge
      }
    }
    expect(errors).toEqual([]);
  });

  test("scanner scans the watchlist on demand; settings write settings.boxes at once", async ({ page }, info) => {
    const errors = collectErrors(page);
    // four symbols = 16 weight: one scan fits the scanner's own minute budget (ten take ~2 minutes by design)
    await seed(page, { boxes: true, extra: { "tj2-settings": { ...fixtureSettings(), boxes: { watchlist: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT"] } } } });
    await openMarkt(page);
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
    // every listed setup now is A+ (an A card that is still playing its exit leaves the DOM a moment later)
    await expect
      .poll(async () => (await page.getByTestId("best-setup").evaluateAll((els) => els.map((e) => e.getAttribute("data-grade")))).filter((g) => g !== "A+"), { timeout: 5_000 })
      .toEqual([]);
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

  test("box fix: the Boxen layer on the 4h chart draws every box on its own bars", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await page.goto("/");
    const chartCard = page.locator("#chart-card");
    await expect(chartCard).toBeVisible({ timeout: 30_000 });
    await chartCard.scrollIntoViewIfNeeded();
    await expect(chartCard.locator("[data-ready=true]")).toBeVisible({ timeout: 30_000 });
    const four = chartCard.getByRole("radiogroup", { name: "Intervall" }).getByRole("radio", { name: "4h", exact: true });
    if ((await four.getAttribute("aria-checked")) !== "true") await four.click();
    await expect(four).toHaveAttribute("aria-checked", "true");
    await chartCard.getByRole("button", { name: "Box-zu-Box-Boxen im Chart (4h)" }).click();
    await expect.poll(async () => (await boxPlacement(page, "#chart-card", true))?.drawn.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
    await boxfixShot(page, info, "overview-boxen", chartCard);
    const p = await newestBoxInView(page, "#chart-card", chartCard, true);
    expect(p.misplaced).toEqual([]);
    expect(p.outside).toEqual([]);
    expect(p.active, "newest box drawn").not.toBeNull();
    expect(p.active!.t0OnBar).toBe(true);
    expect(Math.abs(p.active!.x1 - p.active!.edge!)).toBeLessThanOrEqual(0.75);
    expect(errors).toEqual([]);
  });
});
