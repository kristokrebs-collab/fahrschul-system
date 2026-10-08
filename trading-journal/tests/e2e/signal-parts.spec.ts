/**
 * Graded parts of the Einstiegs-Check on a DIVERGENCE market (`synth.ts` shape `divergence`): the fall ends 10 h before
 * the anchor at L1, a bounce, a slow decline to a slightly LOWER low L2 (RSI and WaveTrend make a HIGHER low = regular
 * bullish divergence on 30m / 45m / 1h), then a rally through the bounce high (a bullish CHoCH on 1h). With the top
 * traders > 64 % long and retail red (`whale-long`) the falling-knife filter has all 3 automatic points from the same
 * evaluation (structure 1H/4H, RSI divergence, Top-Trader-Kombi). Covered: the divergence card (rows per timeframe, the
 * best hit), support / resistance, the reason rows, the hero strip, the falling-knife card + dialog (sources, verdict,
 * the check's own state, manual reading only a note) and the divergence / S/R lines on the 30m chart.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { GradedPart, Signals } from "../../src/domain/signals";
import { collectErrors, pinClock, seed, utcToday, verdictLabel } from "./helpers";
import { DIV_LEVELS } from "./mocks/synth";
import { expectedSignals } from "./mocks/synthOracle";

const LIVE_PRICE = 84_199;
const de0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

async function openDivMarket(page: Page): Promise<{ card: Locator; exp: Signals }> {
  // 10:03 UTC, the market's anchor 15 min earlier: the rally broke the bounce high two 1h candles ago
  const at = utcToday(10, 3);
  const clock = await pinClock(page, at);
  const anchor = at - 15 * 60_000;
  await seed(page, { synth: { ratios: "whale-long", anchor, shape: "divergence" }, clock: clock.now });
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  const card = page.getByTestId("signal-card");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
  return { card, exp: expectedSignals(anchor, clock.now(), LIVE_PRICE, "whale-long", { shape: "divergence" }) };
}

const part = (sig: Signals, id: GradedPart["id"], side: "long" | "short" = "long"): GradedPart => sig[side].parts!.find((p) => p.id === id)!;

test.describe("graded parts on a divergence market", () => {
  test("divergence card lit per timeframe with the best hit, S/R, reasons and the hero strip match the engine", async ({ page }, info) => {
    const errors = collectErrors(page);
    const { card, exp } = await openDivMarket(page);
    const div = part(exp, "div");
    expect(div.ok, "oracle: a closed regular bullish divergence").toBe(true);
    expect(div.tf).toBe("30m");
    await expect(verdictLabel(card)).toHaveText(exp.long.label, { timeout: 15_000 });

    const box = card.getByTestId("signal-div");
    await expect(box).toHaveAttribute("data-state", "ok");
    await expect(box).toHaveAttribute("data-lit", "true");
    await expect(box).toContainText("Bullische Divergenz");
    await expect(box.getByTestId("signal-part-points")).toHaveText(`+10 von 10${div.bonus ? "+1 Stärke" : ""}`);
    for (const it of div.items) {
      const row = box.locator(`[data-testid=signal-div-row][data-tf="${it.id}"]`);
      await expect(row).toContainText(it.value);
      await expect(row, `${it.id} state`).toHaveAttribute("data-state", it.met ? "confirmed" : "none");
    }
    // the best hit: what (RSI regulär), where (the two lows: price lower, oscillator higher) and when
    const hit = box.getByTestId("signal-div-hit");
    await expect(hit).toContainText("30m · RSI regulär: Tief");
    const best = div.hits!.filter((h) => h.tf === "30m" && h.osc === "rsi" && h.kind === "regular").sort((a, b) => a.barsAgo - b.barsAgo)[0]!;
    expect(best.to.price, "lower low in price").toBeLessThan(best.from.price);
    expect(best.to.osc, "higher low in RSI").toBeGreaterThan(best.from.osc);
    expect(best.to.price).toBeCloseTo(DIV_LEVELS.low2, -2);
    await expect(hit).toContainText(`${de0.format(best.from.price)} → ${de0.format(best.to.price)}`);
    await expect(card.getByRole("list", { name: "Bedingungen" }).locator("li", { hasText: "Bullische Divergenz (30m)" })).toContainText("erfüllt");

    // support / resistance: the engine's levels (the range low under the price, the supply block above)
    const sr = part(exp, "sr");
    const srBox = card.getByTestId("signal-sr");
    await expect(srBox).toHaveAttribute("data-state", sr.ok ? "ok" : sr.grade > 0 ? "part" : "open");
    if (sr.levels?.lean) await expect(srBox.getByTestId("signal-sr-lean")).toHaveText(`${sr.levels.lean.label} ${de0.format(sr.levels.lean.price)}`);
    if (sr.levels?.target) await expect(srBox.getByTestId("signal-sr-target")).toContainText(`${sr.levels.target.label} ${de0.format(sr.levels.target.price)}`);

    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      const strip = page.getByTestId("signal-strip");
      await expect(strip.getByTestId("signal-strip-div")).toHaveAttribute("data-lit", "true");
      await expect(strip.getByTestId("signal-strip-div")).toContainText("Divergenz30m");
    }
    await card.screenshot({ path: info.outputPath("div-card.png"), animations: "disabled" });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Falling-Knife-Filter: 3 automatic points from the Einstiegs-Check (structure, RSI divergence, Top-Trader-Kombi)", async ({ page }, info) => {
    const errors = collectErrors(page);
    const { exp } = await openDivMarket(page);
    const k = exp.knife!.long;
    expect(k.items.map((i) => [i.id, i.met])).toEqual([
      ["structure", true],
      ["divergence", true],
      ["whale", true],
    ]);
    const kc = page.getByTestId("knife-card");
    await kc.scrollIntoViewIfNeeded();
    await expect(kc).toHaveAttribute("data-n", "3", { timeout: 15_000 });
    await expect(kc).toHaveAttribute("data-tone", "win");
    await expect(kc).toContainText("3/3");
    await expect(page.getByText("Kein fallendes Messer: Makro-Long abgesichert.")).toBeVisible();
    // the support-zone point is gone (decision 11)
    await expect(page.getByText("Preis in Support-/Liquiditätszone")).toHaveCount(0);

    await kc.click();
    const dialog = page.getByRole("dialog", { name: "Falling-Knife-Filter" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Sicherheits-Check für Makro-Longs („kein fallendes Messer“)");
    await expect(dialog.getByTestId("knife-count")).toHaveText("3/3");
    const items = dialog.getByTestId("knife-item");
    await expect(items).toHaveCount(3);
    for (const it of k.items) {
      const row = dialog.locator(`[data-testid=knife-item][data-id=${it.id}]`);
      await expect(row).toHaveAttribute("data-met", "true");
      await expect(row).toContainText(it.label);
      await expect(row).toContainText(it.detail);
    }
    await expect(dialog.locator("[data-testid=knife-item][data-id=structure]")).toContainText("dieselbe wie Support / Widerstand im Einstiegs-Check");
    await expect(dialog.locator("[data-testid=knife-item][data-id=structure]")).toContainText(`CHoCH ↑ über ${de0.format(DIV_LEVELS.high)}`);
    await expect(dialog.locator("[data-testid=knife-item][data-id=divergence]")).toContainText("dieselben wie im Einstiegs-Check");
    await expect(dialog.locator("[data-testid=knife-item][data-id=whale]")).toContainText("Binance-5-min-Daten");
    await expect(dialog).toContainText("Alle 3 Punkte erfüllt: Filter frei");
    // the trigger is the Einstiegs-Check: its own verdict for the same side, from the same evaluation
    await expect(dialog.getByTestId("knife-trigger")).toContainText(exp.long.label.replace(/^Vorläufig: /, ""));
    await expect(dialog.getByTestId("knife-trigger")).toContainText(`Score ${exp.long.score}`);
    // a manual Hyblock reading is only a note
    if ((await dialog.getByTestId("knife-reading").count()) > 0) await expect(dialog.getByTestId("knife-reading")).toContainText("Notiz, zählt nicht");
    await dialog.screenshot({ path: info.outputPath("knife-dialog.png"), animations: "disabled" });

    // the short side mirrors: none of its points hold here
    await dialog.getByRole("radiogroup", { name: "Richtung des Filters" }).getByRole("radio", { name: "Short" }).click();
    await expect(dialog.getByTestId("knife-count")).toHaveText(`${exp.knife!.short.n}/3`);
    for (const it of exp.knife!.short.items) await expect(dialog.locator(`[data-testid=knife-item][data-id=${it.id}]`)).toHaveAttribute("data-met", it.met === null ? "none" : String(it.met));
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("chart: divergence lines and S/R levels on 30m, each with its own layer toggle", async ({ page }) => {
    const errors = collectErrors(page);
    await openDivMarket(page);
    const card = page.locator("#chart-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
    await card.getByRole("radiogroup", { name: "Intervall" }).getByRole("radio", { name: "30m", exact: true }).click();
    await card.getByRole("radio", { name: "1M", exact: true }).click();
    await expect(card.getByTestId("chart-layers")).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId("chart-state-key")).toContainText("regulär");
    const toggle = (k: string) => card.locator(`[data-testid=chart-layers] button[data-chart-layer=${k}]`);

    const print = () =>
      card.locator("canvas").evaluateAll((els) => {
        const copy = document.createElement("canvas");
        const out: number[] = [];
        for (const el of els as HTMLCanvasElement[]) {
          if (!el.width || !el.height) continue;
          copy.width = el.width;
          copy.height = el.height;
          const ctx = copy.getContext("2d", { willReadFrequently: true })!;
          ctx.clearRect(0, 0, el.width, el.height);
          ctx.drawImage(el, 0, 0);
          const d = ctx.getImageData(0, 0, el.width, el.height).data;
          for (let i = 0; i < d.length; i += 4 * 5) out.push(d[i]! + d[i + 1]! + d[i + 2]!);
        }
        return out;
      });
    const diff = (a: number[], b: number[]) => a.reduce((n, v, i) => n + (Math.abs(v - (b[i] ?? -999)) > 24 ? 1 : 0), Math.abs(a.length - b.length));
    const settled = async () => {
      let prev = await print();
      await expect
        .poll(
          async () => {
            await page.waitForTimeout(700);
            const cur = await print();
            const n = diff(prev, cur);
            prev = cur;
            return n;
          },
          { timeout: 10_000 },
        )
        .toBeLessThan(3);
      return prev;
    };

    for (const layer of ["div", "sr"] as const) {
      const on = await settled();
      await toggle(layer).click();
      await expect(toggle(layer)).toHaveAttribute("aria-pressed", "false");
      await expect.poll(async () => diff(on, await print()), { timeout: 5_000, message: `${layer} lines leave the canvas` }).toBeGreaterThan(15);
      await toggle(layer).click();
      await expect(toggle(layer)).toHaveAttribute("aria-pressed", "true");
      await expect.poll(async () => diff(on, await print()), { timeout: 5_000, message: `${layer} lines are back` }).toBeLessThan(15);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
