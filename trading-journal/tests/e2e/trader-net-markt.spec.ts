/**
 * "Top-Trader: Netto Long/Short" – the big card on the Markt page (Einordnung) on a KNOWN market: the mocked Binance REST serves a
 * generated price path and a top-trader POSITION series that was net long and flipped to net short 60 periods (hours) ago
 * (`flip-short`, `mocks/synth.ts`), 500 hourly points = 20 days and 18 hours. The expectation comes from the app's own pure
 * functions on the same rows (`buildTraderNet`, `netTitle`).
 * NOT checked against real Binance values (fapi.binance.com answers 451 from the sandbox network).
 * Covered: the headline in words (no earlier flip in the loaded history → „im geladenen Verlauf von 20 Tagen erstmals“), the key
 * figures, the range switch with the real length, the lazy canvas plot (green and red areas, price axis, flip arrow), the draw-in and
 * the ONE ring pulse (and none under reduced motion), the time-axis hover glow, crosshair (mouse / tap / keys), the state without Binance
 * data (same box), no layout jump, touch targets ≥ 44 px, axe in dark and light, nothing sideways.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { buildTraderNet, netTitle, type NetPriceBar } from "../../src/domain/signals";
import { collectErrors, expectNoHorizontalScroll, hasTouch, isMobile, pinClock, seed, utcToday } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { FLIP_PERIODS, synthKlines, synthRatios } from "./mocks/synth";

const HOUR = 3_600_000;
const AT = () => utcToday(6, 3);
const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const CARD = "markt-trader-net";

interface Opened {
  card: Locator;
  now: number;
  anchor: number;
}

async function openMarkt(page: Page, opts: { light?: boolean; afterSeed?: () => Promise<unknown> } = {}): Promise<Opened> {
  const at = AT();
  const clock = await pinClock(page, at);
  const anchor = at - 60_000;
  // every WAAPI animation the app starts is counted by the element's test id (the ring pulse is one of them)
  await page.addInitScript(() => {
    const w = window as unknown as { __animated: string[]; __clears: number };
    w.__animated = [];
    const orig = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element["animate"]>) {
      w.__animated.push(this.getAttribute("data-testid") ?? this.tagName);
      return orig.apply(this, args);
    };
    // every picture of the plot starts with a clearRect on one of its two canvases: counted
    w.__clears = 0;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (this: CanvasRenderingContext2D, ...args: Parameters<CanvasRenderingContext2D["clearRect"]>) {
      if (this.canvas.closest?.('[data-testid="trader-net-plot"]')) w.__clears++;
      return clear.apply(this, args);
    };
  });
  await seed(page, { synth: { ratios: "flip-short", anchor }, clock: clock.now, extra: opts.light ? { "tj2-theme": JSON.stringify("light") } : {} });
  await opts.afterSeed?.();
  await page.goto("/#markt");
  await expect(page.locator('[data-page="markt"][data-page-role="current"] h1').first()).toBeAttached({ timeout: 30_000 });
  const card = page.getByTestId(CARD);
  await card.scrollIntoViewIfNeeded();
  return { card, now: at, anchor };
}

/** What the app must derive from the mock's rows (its own pure functions on the same data). */
function expectedNet(now: number, anchor: number) {
  const rows = synthRatios("top-position", "1h", { limit: 500 }, "flip-short", now);
  const positions = rows.map((r) => ({ time: Number(r.timestamp), longPct: Number(r.longAccount) * 100, shortPct: Number(r.shortAccount) * 100 }));
  const bars: NetPriceBar[] = synthKlines("1h", { limit: 499 }, anchor, now, "capitulation").map((k) => ({ time: k[0], open: Number(k[1]), close: Number(k[4]) }));
  return buildTraderNet(positions, bars, now, HOUR);
}

/** Counts green-dominant and red-dominant painted pixels of the plot's base canvas. */
async function paintedPixels(plot: Locator): Promise<{ green: number; red: number }> {
  return plot.locator("canvas").first().evaluate((c: HTMLCanvasElement) => {
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
    return { green, red };
  });
}

const animated = (page: Page) => page.evaluate(() => (window as unknown as { __animated: string[] }).__animated);

test.describe("Top-Trader: Netto Long/Short on the Markt page", () => {
  test.setTimeout(90_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("headline, key figures and the honest length of the loaded history", async ({ page }, info) => {
    const errors = collectErrors(page);
    const { card, now, anchor } = await openMarkt(page);
    const exp = expectedNet(now, anchor);
    expect(exp.status).toBe("ok");
    expect(exp.flip, "oracle: one flip to Short").toMatchObject({ from: "long", to: "short" });
    expect(exp.previousFlip, "oracle: no earlier flip in the loaded history").toBeNull();
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    await expect(card).toHaveAttribute("data-side", "short");
    await expect(card).toContainText("Top-Trader: Netto Long/Short");
    const title = card.getByTestId("trader-net-title");
    // no earlier flip: the sentence says it instead of inventing a date
    await expect(title).toHaveText(netTitle(exp).text);
    await expect(title).toHaveText(/^Top-Trader \(Binance\) sind seit \d\d\.\d\d\. netto Short – im geladenen Verlauf von 20 Tagen erstmals\.$/);
    await expect(title).toHaveAttribute("data-kind", "first-in-history");
    await expect(card.getByTestId("trader-net-line")).toHaveText("Geladener Verlauf: 20 Tage (500 Punkte, Abstand 1 Std.) · Zeiten in UTC");
    // key figures
    await expect(card.getByTestId("trader-net-kpi-net-value")).toHaveText(/^−\d+,\d Pkt\.$/);
    await expect(card.getByTestId("trader-net-kpi-since-value")).toHaveText("2 Tage");
    await expect(card.getByTestId("trader-net-kpi-price-value")).toHaveText(/^[+−]\d+,\d %$/);
    await expect(card.getByText("Netto Short", { exact: true })).toBeVisible();
    // naming: the series is the biggest accounts of ONE exchange - never "Wale" / "Glassnode" as a name or source
    const text = await card.innerText();
    expect(text.replace(/keine On-Chain-Wale/g, "")).not.toMatch(/Wal(e|s)|Glassnode/i);
    await expect(card.getByTestId("trader-net-help")).toContainText("keine On-Chain-Wale");
    await expect(card.getByTestId("trader-net-help")).toContainText("einzelne Börse");
    await page.screenshot({ path: info.outputPath(`trader-net-markt-${info.project.name}-card.png`), clip: (await card.boundingBox())! });
    expect(errors.filter((e) => !/willReadFrequently/.test(e))).toEqual([]);
  });

  test("range switch: 7 Tage, 14 Tage and Alles with the real length; the card keeps its size", async ({ page }) => {
    const { card } = await openMarkt(page);
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    const plot = card.getByTestId("trader-net-plot");
    await expect(plot).toHaveAttribute("data-drawn", "true", { timeout: 8_000 });
    const all = Number(await plot.getAttribute("data-points"));
    expect(all).toBe(500);
    const group = card.getByRole("radiogroup", { name: "Zeitraum" });
    await expect(group.getByRole("radio")).toHaveCount(3);
    await expect(group.getByRole("radio", { name: "Alles · 20 Tage" })).toBeChecked();
    const before = (await card.boundingBox())!.height;
    await group.getByRole("radio", { name: "7 Tage" }).click();
    await expect(plot).toHaveAttribute("data-points", /^1[67]\d$/);
    // the flip (60 h ago) is inside 7 days: the plot still marks it
    await expect(plot).not.toHaveAttribute("data-flip", "none");
    await expect(plot).toHaveAttribute("data-drawn", "true", { timeout: 5_000 });
    expect(Math.abs((await card.boundingBox())!.height - before)).toBeLessThan(1.5);
    await group.getByRole("radio", { name: "14 Tage" }).click();
    await expect(plot).toHaveAttribute("data-points", /^3[3-9]\d$/);
    await group.getByRole("radio", { name: "Alles · 20 Tage" }).click();
    await expect(plot).toHaveAttribute("data-points", "500");
    expect(Math.abs((await card.boundingBox())!.height - before)).toBeLessThan(1.5);
  });

  test("the lazy canvas plot paints green and red areas; the curve draws in once and a ring pulses once at the flip", async ({ page }, info) => {
    const { card } = await openMarkt(page);
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    const plot = card.getByTestId("trader-net-plot");
    await expect(plot).toBeVisible();
    await expect(plot).toHaveAccessibleName(/^Top-Trader \(Binance\) netto, 500 Punkte von \d\d\.\d\d\. bis \d\d\.\d\d\.: zuletzt −\d+,\d Pkt\., letzter Umschlag zu Short am \d\d\.\d\d\.\.$/);
    // fixed box: 256 px on a phone, 336 px from lg
    const box = (await plot.boundingBox())!;
    const lg = (page.viewportSize()?.width ?? 0) >= 1024;
    expect(box.height).toBeGreaterThan((lg ? 336 : 256) - 1);
    expect(box.height).toBeLessThan((lg ? 336 : 256) + 1);
    await expect(plot).toHaveAttribute("data-drawn", "true", { timeout: 8_000 });
    await expect.poll(async () => (await paintedPixels(plot)).red, { timeout: 5_000 }).toBeGreaterThan(300);
    const px = await paintedPixels(plot);
    // 440 of 500 periods net long (green), the newest 60 net short (red, the smaller part on the right)
    expect(px.green).toBeGreaterThan(300);
    expect(px.red).toBeLessThan(px.green);
    // the ring at the flip pulsed exactly once, and so does nothing else of the plot animate in a loop
    await expect.poll(async () => (await animated(page)).filter((n) => n === "trader-net-ring").length).toBe(1);
    await page.waitForTimeout(1500);
    expect((await animated(page)).filter((n) => n === "trader-net-ring").length).toBe(1);
    await expect(card.getByTestId("trader-net-ring")).toHaveCSS("opacity", "0");
    await expect(card.getByTestId("trader-net-legend")).toContainText("BTC-Preislinie");
    await page.screenshot({ path: info.outputPath(`trader-net-markt-${info.project.name}-plot.png`), clip: (await plot.boundingBox())! });
  });

  test("reduced motion: the finished plot is there at once, no ring", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { card } = await openMarkt(page);
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    const plot = card.getByTestId("trader-net-plot");
    await expect(plot).toHaveAttribute("data-drawn", "true");
    await expect.poll(async () => (await paintedPixels(plot)).red, { timeout: 1_500 }).toBeGreaterThan(300);
    await page.waitForTimeout(800);
    expect((await animated(page)).filter((n) => n === "trader-net-ring")).toEqual([]);
    // the glow cross-fade has no time left (the app's reduced-motion rule shortens every transition to a microsecond)
    const ms = await card.getByTestId("trader-net-glow").evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration) * 1000);
    expect(ms).toBeLessThan(1);
  });

  test("crosshair: pointer / tap shows date, net and price; the time axis lights the area up; arrow keys work", async ({ page }, info) => {
    const { card } = await openMarkt(page);
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    const plot = card.getByTestId("trader-net-plot");
    await expect(plot).toHaveAttribute("data-drawn", "true", { timeout: 8_000 });
    const tip = card.getByTestId("trader-net-tip");
    const glow = card.getByTestId("trader-net-glow");
    await expect(tip).toHaveCSS("opacity", "0");
    const b = (await plot.boundingBox())!;
    const at = { x: b.width * 0.4, y: b.height * 0.45 };
    if (isMobile(info)) await plot.tap({ position: at });
    else await page.mouse.move(b.x + at.x, b.y + at.y);
    await expect(tip).toHaveCSS("opacity", "1");
    await expect(tip).toContainText(/\d\d\.\d\d\., \d\d:\d\d UTC/);
    await expect(tip).toContainText(/Netto \+\d+,\d Pkt\. · Long 5\d,\d %/);
    await expect(tip).toContainText(/BTC \d/);
    // inside the plot box
    const tb = (await tip.boundingBox())!;
    expect(tb.x).toBeGreaterThanOrEqual(b.x - 1);
    expect(tb.x + tb.width).toBeLessThanOrEqual(b.x + b.width + 1);
    // above the time axis the area is at rest ...
    await expect(glow).toHaveCSS("opacity", "0");
    // ... on it, it lights up (a cross-fade of a second canvas, opacity only)
    if (isMobile(info)) await plot.tap({ position: { x: b.width * 0.5, y: b.height - 8 } });
    else await page.mouse.move(b.x + b.width * 0.5, b.y + b.height - 8);
    await expect(glow).toHaveCSS("opacity", "1");
    if (!isMobile(info)) {
      await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
      await expect(glow).toHaveCSS("opacity", "0");
      await page.mouse.move(b.x + b.width + 40, b.y - 40);
      await expect(tip).toHaveCSS("opacity", "0");
    }
    // the newest end by keyboard: net short
    await plot.focus();
    await page.keyboard.press("End");
    await expect(tip).toContainText(/Netto −\d+,\d Pkt\./);
    await expect(plot.locator("[aria-live=polite]")).toContainText(/Netto −\d+,\d Pkt\./);
    await page.keyboard.press("Home");
    await expect(tip).toContainText(/Netto \+\d+,\d Pkt\./);
    await page.keyboard.press("Escape");
    await expect(tip).toHaveCSS("opacity", "0");
  });

  test("no Binance data: the card keeps its box, says why and draws nothing", async ({ page }) => {
    // the 1h top-trader POSITION series is dropped (network error)
    const { card } = await openMarkt(page, {
      afterSeed: () => page.route("https://fapi.binance.com/futures/data/topLongShortPositionRatio**", (route) => (new URL(route.request().url()).searchParams.get("period") === "1h" ? route.abort("failed") : route.fallback())),
    });
    await expect(card).toHaveAttribute("data-state", /^(none|loading)$/, { timeout: 25_000 });
    await expect(card.getByTestId("trader-net-title")).toHaveAttribute("data-kind", /^(none|short)$/, { timeout: 25_000 });
    const without = (await card.boundingBox())!;
    await expect(card.getByTestId("trader-net-plot")).toHaveCount(0);
    await expect(card.getByTestId("trader-net-empty")).toBeVisible();
    await expect(card.getByTestId("trader-net-kpi-net-value")).toHaveText("–");
    expect(await card.innerText()).not.toMatch(/Glassnode/i);
    // the same card with data (second page, same size)
    const page2 = await page.context().newPage();
    const ok = await openMarkt(page2);
    await expect(ok.card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    const withData = (await ok.card.boundingBox())!;
    expect(Math.abs(without.height - withData.height), `card ${withData.height} px with data, ${without.height} px without`).toBeLessThan(4);
    expect(Math.abs(without.width - withData.width)).toBeLessThan(1.5);
    await page2.close();
  });

  test("the plot paints only while it draws in: nothing at rest, nothing per crosshair move, about one picture per frame while it wipes", async ({ page }, info) => {
    const { card } = await openMarkt(page);
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    const plot = card.getByTestId("trader-net-plot");
    await expect(plot).toHaveAttribute("data-drawn", "true", { timeout: 8_000 });
    await page.waitForTimeout(600);
    const clears = () => page.evaluate(() => (window as unknown as { __clears: number }).__clears);
    // at rest: no loop keeps painting (a finished plot costs nothing)
    const rest0 = await clears();
    await page.waitForTimeout(2500);
    expect(await clears(), "canvas clears while the finished plot rests").toBe(rest0);
    // the crosshair, the readout and the glow are DOM and CSS: no canvas repaint per move (mouse), nor per key
    const b = (await plot.boundingBox())!;
    if (!isMobile(info)) {
      for (let i = 0; i < 40; i++) await page.mouse.move(b.x + 40 + ((b.width - 80) * i) / 40, b.y + b.height * 0.4);
      await page.mouse.move(b.x + b.width * 0.5, b.y + b.height - 8);
    }
    await plot.focus();
    for (const key of ["End", "ArrowLeft", "ArrowLeft", "Home", "Escape"]) await page.keyboard.press(key);
    await page.waitForTimeout(300);
    expect(await clears(), "canvas clears while the crosshair moves").toBe(rest0);
    // a range switch replays a short wipe: both canvases are cleared once per frame (base + glow), the wipe lasts 0.65 s
    const group = card.getByRole("radiogroup", { name: "Zeitraum" });
    await group.getByRole("radio", { name: "14 Tage" }).click();
    await expect(plot).toHaveAttribute("data-drawn", "true", { timeout: 8_000 });
    await page.waitForTimeout(300);
    const wipe = (await clears()) - rest0;
    expect(wipe, "pictures painted for a 0,65 s wipe").toBeGreaterThan(2);
    expect(wipe, "at most a picture per frame on a 120 Hz screen (two canvases)").toBeLessThanOrEqual(2 * 130);
    // and it rests again
    const after = await clears();
    await page.waitForTimeout(1500);
    expect(await clears()).toBe(after);
    info.annotations.push({ type: "wipe", description: `${wipe} canvas clears for the replayed wipe` });
  });

  test("touch targets and accessibility (dark): ≥ 44 px, axe finds nothing, nothing scrolls sideways", async ({ page }) => {
    const { card } = await openMarkt(page);
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    await expect(card.getByTestId("trader-net-plot")).toHaveAttribute("data-drawn", "true", { timeout: 8_000 });
    await card.scrollIntoViewIfNeeded();
    if (hasTouch(test.info())) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: `[data-testid="${CARD}"]` });
      expect(misses, misses.map((m) => `${m.name} ${m.w}×${m.h} (${m.where})`).join("\n")).toEqual([]);
    }
    const res = await new AxeBuilder({ page }).include(`[data-testid="${CARD}"]`).withTags(TAGS).analyze();
    expect(res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    await expectNoHorizontalScroll(page);
  });

  test("light theme: the plot is repainted on paper, axe finds nothing, a screenshot is kept", async ({ page }, info) => {
    const { card } = await openMarkt(page, { light: true });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    const plot = card.getByTestId("trader-net-plot");
    await expect(plot).toHaveAttribute("data-drawn", "true", { timeout: 8_000 });
    await expect.poll(async () => (await paintedPixels(plot)).red, { timeout: 5_000 }).toBeGreaterThan(300);
    // light ink: the price line and the axis text are dark on the paper (the dark theme's are near white), and the areas
    // use the darker light-mode green / red (no #3ddc84 neon on paper)
    const ink = await plot.locator("canvas").first().evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      let neon = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b, a] = [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!];
        if (a > 200 && r < 110 && g < 110 && b < 110) dark++;
        if (a > 200 && r > 50 && r < 75 && g > 205 && g < 235 && b > 115 && b < 145) neon++;
      }
      return { dark, neon };
    });
    expect(ink.dark, "dark price line and labels on the paper plot").toBeGreaterThan(100);
    expect(ink.neon, "the dark theme's neon green is not painted on paper").toBeLessThan(20);
    await card.scrollIntoViewIfNeeded();
    const res = await new AxeBuilder({ page }).include(`[data-testid="${CARD}"]`).withTags(TAGS).analyze();
    expect(res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`trader-net-markt-${info.project.name}-light.png`), clip: (await card.boundingBox())! });
    await expectNoHorizontalScroll(page);
  });

  test("the page does not grow when the card arrives: its place is reserved in the finished size", async ({ page }) => {
    const { card } = await openMarkt(page);
    const grow = await page.evaluate(() => document.documentElement.scrollHeight);
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    await expect(card.getByTestId("trader-net-plot")).toHaveAttribute("data-drawn", "true", { timeout: 8_000 });
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(after - grow, `the page grew from ${grow} to ${after} px`).toBeLessThan(60);
    expect(FLIP_PERIODS).toBe(60);
  });
});
