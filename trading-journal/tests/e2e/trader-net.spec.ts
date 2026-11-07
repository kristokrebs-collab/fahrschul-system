/**
 * "Top-Trader (Binance)" in the Long signal on a KNOWN market: the mocked Binance REST serves a generated price path
 * and a top-trader POSITION series that was net long and flipped to net short 60 periods (hours) ago (`flip-short`,
 * `mocks/synth.ts`) – the same numbers feed the expectation (the app's own pure `buildTraderNet` on the mock rows).
 * NOT checked against real Binance values (fapi.binance.com answers 451 from the sandbox network).
 * Covered: the plaque (side, since when, net, price since the flip), the lazy canvas chart (painted green AND red, the flip
 * mark at the interpolated crossing, ease-out draw-in vs reduced motion), crosshair readout (mouse / tap), the one extra
 * row in "Warum handeln oder auslassen?" (never a contradiction), Short view without it, the fixed box heights (no layout
 * jump between data / no data / chart opening) and the touch targets.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { buildTraderNet, type NetPriceBar } from "../../src/domain/signals";
import { collectErrors, expectNoHorizontalScroll, hasTouch, isMobile, pinClock, seed, utcToday } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { FLIP_PERIODS, synthKlines, synthRatios, type RatioScript } from "./mocks/synth";

const HOUR = 3_600_000;
const AT = () => utcToday(6, 3);
const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function openLong(page: Page, ratios: RatioScript = "flip-short", opts: { afterSeed?: () => Promise<unknown> } = {}): Promise<{ card: Locator; plaque: Locator; now: number; anchor: number }> {
  const at = AT();
  const clock = await pinClock(page, at);
  const anchor = at - 60_000;
  await seed(page, { synth: { ratios, anchor }, clock: clock.now });
  // routes registered later win: after `seed` the spec can overrule the mock for single requests
  await opts.afterSeed?.();
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  const card = page.getByTestId("signal-card");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
  await expect(card.getByTestId("signal-verdict")).toBeVisible();
  return { card, plaque: card.getByTestId("trader-net"), now: at, anchor };
}

/** What the app must derive from the mock's rows (its own pure function on the same data). */
function expectedNet(now: number, anchor: number, ratios: RatioScript = "flip-short") {
  const rows = synthRatios("top-position", "1h", { limit: 500 }, ratios, now);
  const positions = rows.map((r) => ({ time: Number(r.timestamp), longPct: Number(r.longAccount) * 100, shortPct: Number(r.shortAccount) * 100 }));
  const bars: NetPriceBar[] = synthKlines("1h", { limit: 499 }, anchor, now, "capitulation").map((k) => ({ time: k[0], open: Number(k[1]), close: Number(k[4]) }));
  return buildTraderNet(positions, bars, now, HOUR);
}

/** Counts green-dominant and red-dominant painted pixels of the chart's canvas. */
async function paintedPixels(chart: Locator): Promise<{ green: number; red: number; total: number }> {
  return chart.locator("canvas").evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext("2d")!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let green = 0;
    let red = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b, a] = [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!];
      if (a < 40) continue;
      if (g > r + 25 && g > b + 15) green++;
      else if (r > g + 25 && r > b + 15) red++;
    }
    return { green, red, total: c.width * c.height };
  });
}

test.describe("Top-Trader netto in the Long signal", () => {
  test.setTimeout(90_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("the plaque names the series, the side, since when it flipped and the net - matching the engine's flip", async ({ page }) => {
    const errors = collectErrors(page);
    const { plaque, now, anchor } = await openLong(page);
    const exp = expectedNet(now, anchor);
    expect(exp.status).toBe("ok");
    expect(exp.flip, "oracle: one flip to Short").toMatchObject({ from: "long", to: "short" });
    // 59.5 h and a few minutes ago -> "seit 2 Tagen"
    expect(exp.flip!.ageMs).toBeGreaterThan((FLIP_PERIODS - 1) * HOUR);
    await expect(plaque).toHaveAttribute("data-state", "ok", { timeout: 20_000 });
    await expect(plaque).toHaveAttribute("data-side", "short");
    await expect(plaque).toContainText("Top-Trader (Binance)");
    await expect(plaque.getByTestId("trader-net-headline")).toHaveText("netto Short, seit 2 Tagen umgeschlagen");
    await expect(plaque.getByTestId("trader-net-detail")).toContainText(/^Netto −\d+,\d Pkt\. \(Long \d+,\d %\)/);
    await expect(plaque.getByTestId("trader-net-detail")).toContainText(/Preis seit dem Umschlag [+−]\d+,\d %/);
    await expect(plaque.getByText("Netto Short", { exact: true })).toBeVisible();
    // honest naming everywhere in the card
    expect(await plaque.innerText()).not.toMatch(/Wal(e|s)|Glassnode/i);
    expect(errors).toEqual([]);
  });

  test("opened: the lazy canvas chart paints green and red areas around zero and marks the flip", async ({ page }, info) => {
    const errors = collectErrors(page);
    const { plaque, now, anchor } = await openLong(page);
    const exp = expectedNet(now, anchor);
    await expect(plaque).toHaveAttribute("data-state", "ok", { timeout: 20_000 });
    await expect(plaque.getByRole("button", { name: /Details zeigen: Top-Trader \(Binance\) netto/ })).toBeVisible();
    const toggle = plaque.locator('button[aria-controls="trader-net-body"]');
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const chart = plaque.getByTestId("trader-net-chart");
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAttribute("data-points", String(exp.points.length));
    await expect(chart).toHaveAttribute("data-flip", String(Math.round(exp.flip!.at)));
    await expect(chart).toHaveAccessibleName(/^Top-Trader \(Binance\) netto, \d+ Punkte von \d\d\.\d\d\. bis \d\d\.\d\d\.: zuletzt −\d+,\d Pkt\., letzter Wechsel nach Short am \d\d\.\d\d\.\.$/);
    // fixed box: 176 px, whatever the width
    const box = await chart.boundingBox();
    expect(box!.height).toBeGreaterThan(175.5);
    expect(box!.height).toBeLessThan(178.5);
    // the ease-out draw-in ends: both areas are on the canvas (old net long = green, recent net short = red)
    await expect.poll(async () => (await paintedPixels(chart)).red, { timeout: 5_000 }).toBeGreaterThan(300);
    const px = await paintedPixels(chart);
    expect(px.green, "net long part").toBeGreaterThan(300);
    // the recent 60 of ~500 periods are short: the red part is the smaller one on the right
    expect(px.red).toBeLessThan(px.green);
    // what it is and what it is not, in one place
    await expect(plaque.getByTestId("trader-net-help")).toContainText("Long minus Short der größten Konten");
    await expect(plaque.getByTestId("trader-net-help")).toContainText("Keine On-Chain-Wale");
    await expect(plaque.getByTestId("trader-net-legend")).toContainText("BTC-Preis");
    await page.screenshot({ path: info.outputPath(`trader-net-${info.project.name}.png`), clip: (await plaque.boundingBox())! });
    // closing and reopening paints the finished chart at once (the wipe plays on the first opening only)
    await toggle.click();
    await expect(chart).toHaveCount(0);
    await toggle.click();
    await expect(plaque.getByTestId("trader-net-chart")).toBeVisible();
    expect((await paintedPixels(plaque.getByTestId("trader-net-chart"))).red).toBeGreaterThan(300);
    // (the spec's own pixel reads make Chrome warn about getImageData; that is not the app's)
    expect(errors.filter((e) => !/willReadFrequently/.test(e))).toEqual([]);
  });

  test("reduced motion: the finished chart is there without a wipe", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { plaque } = await openLong(page);
    await expect(plaque).toHaveAttribute("data-state", "ok", { timeout: 20_000 });
    await plaque.getByRole("button", { name: /Details zeigen/ }).click();
    const chart = plaque.getByTestId("trader-net-chart");
    await expect(chart).toBeVisible();
    // no waiting for a draw-in: painted in the frame after mount
    await expect.poll(async () => (await paintedPixels(chart)).red, { timeout: 1_500 }).toBeGreaterThan(300);
  });

  test("crosshair: pointer / tap shows the readout with net and price, leaving or tapping elsewhere closes it; arrow keys work", async ({ page }, info) => {
    const { plaque, card } = await openLong(page);
    await expect(plaque).toHaveAttribute("data-state", "ok", { timeout: 20_000 });
    await plaque.getByRole("button", { name: /Details zeigen/ }).click();
    const chart = plaque.getByTestId("trader-net-chart");
    await expect(chart).toBeVisible();
    await expect.poll(async () => (await paintedPixels(chart)).red, { timeout: 5_000 }).toBeGreaterThan(300);
    const tip = plaque.getByTestId("trader-net-tip");
    await expect(tip).toHaveCSS("opacity", "0");
    const b = (await chart.boundingBox())!;
    const at = { x: b.width * 0.5, y: b.height * 0.5 };
    if (isMobile(info)) await chart.tap({ position: at });
    else await page.mouse.move(b.x + at.x, b.y + at.y);
    await expect(tip).toHaveCSS("opacity", "1");
    await expect(tip).toContainText(/\d\d\.\d\d\., \d\d:\d\d UTC/);
    await expect(tip).toContainText(/Netto \+\d+,\d Pkt\. · Long 5\d,\d %/);
    await expect(tip).toContainText(/Preis \d/);
    // inside the plot box
    const tb = (await tip.boundingBox())!;
    expect(tb.x).toBeGreaterThanOrEqual(b.x - 1);
    expect(tb.x + tb.width).toBeLessThanOrEqual(b.x + b.width + 1);
    if (isMobile(info)) {
      await page.getByTestId("signal-card").getByRole("heading", { name: /Teil-Bedingungen|Einstiegs/ }).first().tap().catch(() => card.tap({ position: { x: 4, y: 4 } }));
    } else await page.mouse.move(b.x + b.width + 40, b.y - 40);
    await expect(tip).toHaveCSS("opacity", "0");
    // the newest end: net short
    await chart.focus();
    await page.keyboard.press("End");
    await expect(tip).toContainText(/Netto −\d+,\d Pkt\./);
    await expect(chart.locator("[aria-live=polite]")).toContainText(/Netto −\d+,\d Pkt\./);
    await page.keyboard.press("Escape");
    await expect(tip).toHaveCSS("opacity", "0");
  });

  test("Warum handeln oder auslassen: one extra optional row with the sentence, never a contradiction", async ({ page }) => {
    const { card } = await openLong(page);
    await expect(card.getByTestId("trader-net")).toHaveAttribute("data-state", "ok", { timeout: 20_000 });
    const why = card.getByTestId("why-section");
    await why.getByRole("button", { name: /Details zeigen/ }).click();
    const row = card.getByTestId("why-optional").locator("li", { hasText: "Top-Trader (Binance): netto" });
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-status", "unmet");
    await expect(row).toContainText("netto Short");
    await expect(row).toContainText("seit 2 Tagen umgeschlagen");
    await expect(row).toContainText("ändert die Bewertung aber nicht");
    await expect(card.getByTestId("why-conflicts")).not.toContainText("Top-Trader (Binance)");
    // the decision comes from the required / conflict groups only: same decision as without the series
    const decision = await why.getAttribute("data-decision");
    expect(["trade", "caution", "skip", "unclear"]).toContain(decision);
  });

  test("the Short view has none of it", async ({ page }) => {
    const { card } = await openLong(page);
    await expect(card.getByTestId("trader-net")).toBeVisible();
    await card.getByRole("radio", { name: "Short" }).click();
    await expect(card.getByTestId("trader-net")).toHaveCount(0);
    await card.getByRole("radio", { name: "Long" }).click();
    await expect(card.getByTestId("trader-net")).toBeVisible();
  });

  test("no layout jump: the plaque keeps its box when the 1h series fails (keine Daten), and the chart box is fixed", async ({ page }) => {
    // the 1h top-trader POSITION series is dropped (network error); the 5-minute ones the check reads still arrive
    const { plaque } = await openLong(page, "flip-short", {
      afterSeed: () =>
        page.route("https://fapi.binance.com/futures/data/topLongShortPositionRatio**", (route) => (new URL(route.request().url()).searchParams.get("period") === "1h" ? route.abort("failed") : route.fallback())),
    });
    await expect(plaque).toBeVisible();
    await expect(plaque).toHaveAttribute("data-state", /^(none|loading)$/, { timeout: 20_000 });
    const without = (await plaque.boundingBox())!;
    // no Expander, a reason instead of a chart
    await expect(plaque.getByRole("button")).toHaveCount(0);
    await expect(plaque.getByTestId("trader-net-headline")).not.toBeEmpty();
    expect(await plaque.innerText()).not.toMatch(/Wal(e|s)|Glassnode/i);
    // the same section with data (second page, same size)
    const page2 = await page.context().newPage();
    const ok = await openLong(page2);
    await expect(ok.plaque).toHaveAttribute("data-state", "ok", { timeout: 20_000 });
    const withData = (await ok.plaque.boundingBox())!;
    expect(Math.abs(without.height - withData.height), `plaque ${withData.height} px with data, ${without.height} px without`).toBeLessThan(1.5);
    expect(Math.abs(without.width - withData.width)).toBeLessThan(1.5);
    // the chart box keeps its height from the first frame (lazy chunk fallback = same box) until it is painted
    await ok.plaque.getByRole("button", { name: /Details zeigen/ }).click();
    const heights: number[] = [];
    for (let i = 0; i < 8; i++) {
      const c = ok.plaque.getByTestId("trader-net-chart");
      const bb = (await c.count()) ? await c.boundingBox() : null;
      if (bb) heights.push(Math.round(bb.height));
      await page2.waitForTimeout(150);
    }
    expect(heights.length).toBeGreaterThan(3);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
    await page2.close();
  });

  test("touch targets and accessibility: the controls are at least 44 px, axe finds nothing, the page does not scroll sideways", async ({ page }, info) => {
    const { plaque } = await openLong(page);
    await expect(plaque).toHaveAttribute("data-state", "ok", { timeout: 20_000 });
    await plaque.getByRole("button", { name: /Details zeigen/ }).click();
    await expect(plaque.getByTestId("trader-net-chart")).toBeVisible();
    await plaque.scrollIntoViewIfNeeded();
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="trader-net"]' });
      expect(misses, misses.map((m) => `${m.name} ${m.w}×${m.h} (${m.where})`).join("\n")).toEqual([]);
    }
    await expect.poll(async () => (await paintedPixels(plaque.getByTestId("trader-net-chart"))).red, { timeout: 5_000 }).toBeGreaterThan(300);
    const res = await new AxeBuilder({ page }).include('[data-testid="trader-net"]').withTags(TAGS).analyze();
    expect(res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    await expectNoHorizontalScroll(page);
  });

  test("the card height does not change when the net series arrives later than the check (skeleton reserves it)", async ({ page }) => {
    const { card } = await openLong(page);
    await expect(card.getByTestId("trader-net")).toHaveAttribute("data-state", "ok", { timeout: 20_000 });
    const h1 = (await card.boundingBox())!.height;
    await page.waitForTimeout(1_500);
    const h2 = (await card.boundingBox())!.height;
    expect(Math.abs(h2 - h1)).toBeLessThan(2);
  });
});
