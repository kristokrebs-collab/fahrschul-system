/**
 * Einstiegs-Check on a KNOWN market: the mocked Binance REST serves a generated price path (`mocks/synth.ts`: a
 * three-day fall into a capitulation low, then a sharp turn) as 15m / 1h / 4h klines, plus top-trader / all-accounts
 * ratio series per period. The expected evaluation comes from the app's own pure engine on the same data
 * (`mocks/synthOracle.ts`): every candle alignment gives "Sehr starker Long-Einstieg" with Bottom on 30m / 45m / 1h.
 * Also: "Top-Trader kaufen · Retail rot" lit / open, the hero strip line, chart MCB dots on 30m.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { collectErrors, fixture, isMobile, screenshot, seed, stored } from "./helpers";
import type { RatioScript } from "./mocks/synth";
import { expectedSignals } from "./mocks/synthOracle";

/** Last trade price of the `live` WS scenario (the engine completes the running bars with it). */
const LIVE_PRICE = 84_199;

async function openCheck(page: Page, ratios: RatioScript, extra?: Record<string, unknown>): Promise<{ card: Locator; anchor: number }> {
  const anchor = Date.now();
  await seed(page, { synth: { ratios, anchor }, extra });
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  const card = page.getByTestId("signal-card");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
  await expect(card.getByTestId("signal-verdict")).toBeVisible();
  return { card, anchor };
}

/** Number shown by a rung meter (`MCB` / `RSI`), German decimal comma. */
async function meterValue(rung: Locator, label: "MCB" | "RSI"): Promise<number> {
  const row = rung.locator("div.mt-2\\.5", { has: rung.page().getByText(label, { exact: true }) }).first();
  const text = (await row.locator("span.num").first().textContent()) ?? "";
  const m = /[−-]?\d+(,\d+)?/.exec(text.replace(/\s/g, ""));
  return m ? Number(m[0].replace("−", "-").replace(",", ".")) : NaN;
}

test.describe("Einstiegs-Check on a known market", () => {
  test("ladder dots lit, strength label, RSI, zone and `Top-Trader kaufen · Retail rot` match the engine", async ({ page }, info) => {
    const errors = collectErrors(page);
    const { card, anchor } = await openCheck(page, "whale-long");
    const label = card.getByTestId("signal-label");
    await expect(label).toHaveText("Sehr starker Long-Einstieg", { timeout: 15_000 });
    // the whale grading adds one strength level: strength 4 = "Maximal"
    await expect(card.getByRole("img", { name: "Stärke 4 von 4" })).toBeVisible();
    await expect(card.getByRole("radio", { name: "Long" })).toHaveAttribute("aria-checked", "true");

    const exp = expectedSignals(anchor, Date.now(), LIVE_PRICE, "whale-long");
    expect(exp.long.label, "oracle").toBe("Sehr starker Long-Einstieg");
    expect(exp.long.strength, "oracle").toBe(4);
    await expect(card.getByRole("img", { name: `Score ${exp.long.score} von 100` })).toBeVisible();
    await expect(card.getByText(`Maximal · ${exp.long.tiers} von 4 Timeframes`)).toBeVisible();

    // ladder: the confirmed rungs light up, each with its MCB event and an RSI near oversold
    const rungs = card.getByTestId("signal-rung");
    await expect(rungs).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      const rung = rungs.nth(i);
      const c = exp.checks[i]!;
      await expect(rung).toContainText(c.tf);
      if (i < exp.long.tiers) {
        await expect(rung, `${c.tf} lit`).toHaveAttribute("data-lit", "true");
        await expect(rung).toContainText(c.wt.long?.kind === "bottom" ? "Bottom" : "Kaufsignal");
      } else await expect(rung, `${c.tf} not lit`).not.toHaveAttribute("data-lit", /.*/);
      const rsi = await meterValue(rung, "RSI");
      expect(Math.abs(rsi - c.rsi), `${c.tf} RSI ${rsi} vs engine ${c.rsi.toFixed(1)}`).toBeLessThan(2.5);
    }
    for (let i = 0; i < 3; i++) expect(exp.checks[i]!.rsiLong, `${exp.checks[i]!.tf} RSI near oversold`).toBe(true);

    // zone: 1h discount, the marker label on the bar
    const zone = card.getByTestId("signal-zone");
    await expect(zone).toContainText("Zone · 1h");
    await expect(zone).toContainText(`Discount · ${Math.round(exp.zone!.zone.pos * 100)} %`);

    // conditions list: every rung of the confirmed ladder, the RSI, the zone and the whale line are ticked
    const reasons = card.getByRole("list", { name: "Bedingungen" });
    await expect(reasons.getByText("RSI nahe überverkauft (≤ 40)")).toBeVisible();
    await expect(reasons.locator("li", { hasText: "Preis im Discount (1h)" })).toContainText("erfüllt");
    await expect(reasons.locator("li", { hasText: "Top-Trader kaufen · Retail rot (2× 30m/1h)" })).toContainText("erfüllt");

    // "Top-Trader kaufen · Retail rot": lit, both readings over the last 2 periods, a chip per period with its run
    const whale = card.getByTestId("signal-whale");
    await expect(whale).toHaveAttribute("data-state", "ok");
    await expect(whale).toHaveAttribute("data-lit", "true");
    await expect(whale).toContainText("Top-Trader kaufen · Retail rot");
    await expect(whale).toContainText("+10 Score · +1 Stärke");
    await expect(whale).toContainText("+2,7 pp"); // top traders 56,2 → 58,9 % long
    await expect(whale).toContainText("−2,5 pp"); // all accounts 49,1 → 46,6 % long = retail red
    const chips = whale.getByLabel("Perioden in Folge");
    await expect(chips).toContainText("30m · 4×");
    await expect(chips).toContainText("1h · 4×");
    await screenshot(page, info, "signal-card-known");

    // Short side: the mirror condition is open (top traders do not sell)
    await card.getByRole("radio", { name: "Short" }).click();
    await expect(whale).toHaveAttribute("data-state", "open");
    await expect(whale).toContainText("Top-Trader verkaufen · Retail grün");
    await expect(card.getByTestId("signal-label")).toHaveText(exp.short.label);

    // hero strip (≥ lg): the same verdict and the whale line
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      const strip = page.getByTestId("signal-strip");
      await expect(strip).toBeVisible();
      await expect(strip.getByTestId("signal-strip-whale")).toHaveAttribute("data-lit", "true");
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("without top traders buying the whale row stays open and the grade is the plain ladder grade", async ({ page }) => {
    const { card, anchor } = await openCheck(page, "flat");
    const exp = expectedSignals(anchor, Date.now(), LIVE_PRICE, "flat");
    const withWhale = expectedSignals(anchor, Date.now(), LIVE_PRICE, "whale-long");
    expect(exp.long.whale?.ok, "oracle: condition open").toBe(false);
    expect(exp.long.whale?.points, "oracle: no points").toBe(0);
    // the bonus is exactly the weight (10 points, capped at 100) and one strength level (capped at 4)
    expect(withWhale.long.score).toBe(Math.min(100, exp.long.score + 10));
    expect(withWhale.long.strength).toBe(Math.min(4, exp.long.strength + 1));
    await expect(card.getByTestId("signal-label")).toHaveText(exp.long.label, { timeout: 15_000 });
    await expect(card.getByRole("img", { name: `Stärke ${exp.long.strength} von 4` })).toBeVisible();
    await expect(card.getByRole("img", { name: `Score ${exp.long.score} von 100` })).toBeVisible();
    const whale = card.getByTestId("signal-whale");
    await expect(whale).toHaveAttribute("data-state", "open");
    await expect(whale).not.toHaveAttribute("data-lit", /.*/);
    await expect(whale).toContainText("mind. 2× in Folge");
    await expect(card.getByRole("list", { name: "Bedingungen" }).locator("li", { hasText: "Top-Trader kaufen · Retail rot" })).toContainText("offen");
  });

  test("switched off in the settings: no whale row, no bonus", async ({ page }) => {
    const settings = { ...(fixture["tj2-settings"] as Record<string, unknown>), signals: { whale: { on: false } } };
    const { card, anchor } = await openCheck(page, "whale-long", { "tj2-settings": settings });
    // switched off = the plain ladder grade (the same as a reading that does not hold)
    const plain = expectedSignals(anchor, Date.now(), LIVE_PRICE, "flat");
    await expect(card.getByTestId("signal-label")).toHaveText(plain.long.label, { timeout: 15_000 });
    await expect(card.getByRole("img", { name: `Stärke ${plain.long.strength} von 4` })).toBeVisible();
    await expect(card.getByRole("img", { name: `Score ${plain.long.score} von 100` })).toBeVisible();
    await expect(card.getByTestId("signal-whale")).toHaveCount(0);
    await expect(card.getByRole("list", { name: "Bedingungen" }).getByText(/Top-Trader/)).toHaveCount(0);
  });

  test("Bybit fallback (no Binance top traders): `keine Daten`, never a fail", async ({ page }) => {
    // Binance blocked: klines come from Bybit (same generated market), which has no top-trader data
    await seed(page, { scenario: "blocked_451", synth: { ratios: "whale-long" } });
    await page.goto("/#overview");
    const card = page.getByTestId("signal-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute("data-state", /ok|stale/, { timeout: 30_000 });
    await expect(card.getByTestId("signal-label")).toHaveText(/Long-Einstieg/);
    const whale = card.getByTestId("signal-whale");
    await expect(whale).toHaveAttribute("data-state", "none");
    await expect(whale).toContainText("keine Daten");
    await expect(card.getByRole("list", { name: "Bedingungen" }).getByText(/Top-Trader kaufen/)).toHaveCount(0);
  });
});

test.describe("chart", () => {
  /** Pixels of the MCB long colour (`#3ddc84`) on the chart canvases (candles are ink: white / grey / black). */
  async function greenPixels(card: Locator): Promise<number> {
    return card.locator("canvas").evaluateAll((els) => {
      let n = 0;
      // read through a copy (own context with willReadFrequently: no readback warning on the chart's canvases)
      const copy = document.createElement("canvas");
      for (const el of els as HTMLCanvasElement[]) {
        if (!el.width || !el.height) continue;
        copy.width = el.width;
        copy.height = el.height;
        const ctx = copy.getContext("2d", { willReadFrequently: true });
        if (!ctx) continue;
        ctx.clearRect(0, 0, el.width, el.height);
        ctx.drawImage(el, 0, 0);
        const d = ctx.getImageData(0, 0, el.width, el.height).data;
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i]! - 61) < 30 && Math.abs(d[i + 1]! - 220) < 30 && Math.abs(d[i + 2]! - 132) < 30 && d[i + 3]! > 120) n++;
      }
      return n;
    });
  }

  test("30m interval: built from the 15m feed, MCB dots + legend on the canvas", async ({ page }, info) => {
    const errors = collectErrors(page);
    const urls: string[] = [];
    await seed(page, { synth: { ratios: "whale-long" }, onRequest: (u) => urls.push(`${u.pathname}?${u.searchParams.toString()}`) });
    await page.goto("/#overview");
    const card = page.locator("#chart-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
    const interval = card.getByRole("radiogroup", { name: "Intervall" });
    await expect(interval.getByRole("radio")).toHaveText(["1m", "30m", "1h", "4h"]);

    // 1m has no check timeframe → no dots, no legend
    await interval.getByRole("radio", { name: "1m", exact: true }).click();
    await expect(interval.getByRole("radio", { name: "1m", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(card.getByTestId("mcb-legend")).toHaveCount(0);
    await page.waitForTimeout(800);
    const before = await greenPixels(card);

    await interval.getByRole("radio", { name: "30m", exact: true }).click();
    await expect(interval.getByRole("radio", { name: "30m", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(card.getByTestId("mcb-legend")).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId("mcb-legend")).toContainText("MCB Bottom/Kauf");
    await expect.poll(() => greenPixels(card), { timeout: 10_000, message: "MCB long dots drawn on the 30m chart" }).toBeGreaterThan(before + 20);
    // the interval is a persisted chart preference (`tj2-ui.chart.interval`)
    await expect.poll(async () => (await stored<{ chart?: { interval?: string } }>(page, "tj2-ui"))?.chart?.interval).toBe("30m");
    // the 30m chart reads the 15m feed (no separate 30m kline stream)
    expect(urls.some((u) => u.startsWith("/fapi/v1/klines") && u.includes("interval=15m"))).toBe(true);
    if (!isMobile(info)) await screenshot(page, info, "chart-30m-mcb");

    // 1h keeps the dots
    await interval.getByRole("radio", { name: "1h", exact: true }).click();
    await expect(card.getByTestId("mcb-legend")).toBeVisible({ timeout: 15_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
