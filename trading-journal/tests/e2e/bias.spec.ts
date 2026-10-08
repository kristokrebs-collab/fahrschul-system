/**
 * Long/Short-Tendenz on a KNOWN market (`mocks/synth.ts`): the generated capitulation low + turn is a long setup on
 * every rung, so the bar must lean right of the centre with the label the pure model computes from the same data
 * (`mocks/synthOracle.ts` → `computeBias`). The SHORT setup is the same price path mirrored around the live price
 * (`p' = 2·84 200 − p`: a blow-off top that turns down) — WaveTrend, RSI and the premium/discount range mirror exactly,
 * so the bar must lean left — never against the check's valid Short-Einstieg. Also: the explainer (tap / Enter; the
 * weights add up to 100 %, the contributions to the shown sum, no row text overlaps), the hero strip line, no overlap
 * at the user's sizes.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { computeBias } from "../../src/domain/signals/bias";
import { DEFAULT_SIGNAL_CFG, sanitizeSignalCfg } from "../../src/domain/signals";
import { collectErrors, expectNoHorizontalScroll, seed } from "./helpers";
import { SYNTH_LAST, synthKlines } from "./mocks/synth";
import { expectedSignals } from "./mocks/synthOracle";

const LIVE_PRICE = 84_199;
const MIRROR = 2 * SYNTH_LAST;

/** Serves the synthetic klines mirrored around the live price (registered after `seed`, so it wins). */
async function mirrorKlines(page: Page, anchor: number): Promise<void> {
  await page.route("https://fapi.binance.com/fapi/v1/klines**", async (route) => {
    const u = new URL(route.request().url());
    const num = (k: string) => (u.searchParams.get(k) == null ? undefined : Number(u.searchParams.get(k)));
    const rows = synthKlines(u.searchParams.get("interval") ?? "1h", { limit: num("limit"), startTime: num("startTime"), endTime: num("endTime") }, anchor).map((r) => {
      const m = (x: string) => (MIRROR - Number(x)).toFixed(1);
      return [r[0], m(r[1]), m(r[3]), m(r[2]), m(r[4]), ...r.slice(5)];
    });
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(rows) });
  });
}

async function openBias(page: Page, mode: "long" | "short"): Promise<{ card: Locator; bias: Locator; anchor: number }> {
  const anchor = Date.now();
  await seed(page, { synth: { ratios: mode === "long" ? "whale-long" : "flat", anchor } });
  if (mode === "short") await mirrorKlines(page, anchor);
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  const card = page.getByTestId("signal-card");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
  const bias = card.getByTestId("signal-bias");
  await expect(bias).toBeVisible();
  return { card, bias, anchor };
}

/** x of the needle's centre relative to the track (0 … 1), once the spring has settled. */
async function needleAt(bias: Locator): Promise<number> {
  const track = bias.getByTestId("bias-track");
  const read = async () => {
    const t = await track.boundingBox();
    const n = await track.locator("[data-testid=bias-needle] > span").last().boundingBox();
    return t && n ? (n.x + n.width / 2 - t.x) / t.width : NaN;
  };
  let last = NaN;
  await expect
    .poll(async () => {
      const a = await read();
      const settled = Math.abs(a - last) < 0.002;
      last = a;
      return settled;
    })
    .toBe(true);
  return last;
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
}

/** `+0,16` / `−0,05` / `±0,00` → number */
const deNum = (t: string): number => Number(t.replace("±", "").replace("−", "-").replace(",", "."));

/** Explainer rows: `Gewicht 16 % → +0,16` add up to 100 % and to the sum line; no row's texts overlap each other. */
async function expectRowsAddUp(dialog: Locator): Promise<void> {
  const texts = (await dialog.getByTestId("bias-row-weight").allTextContents()).filter((t) => t.startsWith("Gewicht"));
  const parts = texts.map((t) => /^Gewicht (\d+) % → ([+−±][\d,]+)$/.exec(t.trim()));
  expect(parts.every(Boolean), texts.join(" | ")).toBe(true);
  expect(parts.reduce((a, m) => a + Number(m![1]), 0), "weights add up to 100 %").toBe(100);
  const sumLine = (await dialog.getByTestId("bias-sum").textContent()) ?? "";
  const sum = deNum(/^Summe ([+−±][\d,]+)/.exec(sumLine)![1]!);
  expect(parts.reduce((a, m) => a + Math.round(deNum(m![2]!) * 100), 0), `contributions add up to ${sumLine}`).toBe(Math.round(sum * 100));
  const rows = dialog.getByTestId("bias-row");
  for (let i = 0; i < (await rows.count()); i++) {
    const row = rows.nth(i);
    const spans = row.locator(":scope > span:not([aria-hidden]) > span"); // name × vote, detail × weight (not the bar)
    const boxes = [];
    for (let j = 0; j < (await spans.count()); j++) boxes.push(await spans.nth(j).boundingBox());
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) if (boxes[a] && boxes[b]) expect(overlaps(boxes[a]!, boxes[b]!), `row ${i}: text ${a} × ${b}`).toBe(false);
  }
}

test.describe("Long/Short-Tendenz", () => {
  test("long setup: the bar leans left (Long side) with the model's label; explainer lists every condition", async ({ page }, info) => {
    const errors = collectErrors(page);
    const { card, bias, anchor } = await openBias(page, "long");
    const exp = computeBias(expectedSignals(anchor, Date.now(), LIVE_PRICE, "whale-long"), sanitizeSignalCfg(DEFAULT_SIGNAL_CFG));
    expect(exp, "oracle").not.toBeNull();
    expect(exp!.score, "oracle leans long").toBeGreaterThan(0.5);
    expect(exp!.label).toBe("Stark Long");

    await expect(bias).toHaveAttribute("data-level", "2", { timeout: 15_000 });
    await expect(bias.getByTestId("bias-label")).toHaveText("Stark Long");
    await expect(bias.getByTestId("bias-percent")).toContainText("Long");
    const meter = card.getByRole("meter", { name: "Long/Short-Tendenz" });
    await expect(meter).toHaveAttribute("aria-valuetext", /^Stark Long, \d+ %$/);
    const now = Number(await meter.getAttribute("aria-valuenow"));
    expect(Math.abs(now - Math.round(exp!.score * 100)), `aria-valuenow ${now} vs model ${exp!.score}`).toBeLessThanOrEqual(3);
    const x = await needleAt(bias);
    expect(x, "needle left of centre (Long left)").toBeLessThan(0.5 - exp!.score / 2 + 0.04);

    // label, percent and the bar never overlap; the box does not overlap the verdict row below
    const lb = await bias.getByTestId("bias-label").boundingBox();
    const pb = await bias.getByTestId("bias-percent").boundingBox();
    const tb = await bias.getByTestId("bias-track").boundingBox();
    expect(lb && pb && tb).toBeTruthy();
    expect(overlaps(lb!, pb!), "label × percent").toBe(false);
    expect(overlaps(pb!, tb!), "percent × track").toBe(false);
    const box = await bias.boundingBox();
    const verdict = await card.getByTestId("signal-verdict").boundingBox();
    expect(overlaps(box!, verdict!), "bias × verdict").toBe(false);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: info.outputPath(`bias-long-card.png`), animations: "disabled" });
    await card.screenshot({ path: info.outputPath(`bias-long-card-only.png`), animations: "disabled" });

    // hero strip (≥ lg): the compact line leans long too
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      const line = page.getByTestId("signal-strip-bias");
      await expect(line).toHaveAttribute("data-level", "2");
      const strip = page.getByTestId("signal-strip");
      await strip.scrollIntoViewIfNeeded();
      await strip.screenshot({ path: info.outputPath("bias-strip.png"), animations: "disabled" });
      // the taller strip still clears the KPI tiles under it and the hero's right column
      const hero = page.locator("section[aria-labelledby=hero-net-label]");
      const sb = await strip.boundingBox();
      const tiles = await hero.locator("dl").first().boundingBox();
      expect(sb && tiles).toBeTruthy();
      expect(sb!.y + sb!.height, "strip above the KPI tiles").toBeLessThanOrEqual(tiles!.y + 0.5);
      for (const part of ["bias-strip-label", "bias-strip-text"]) {
        const b = await line.getByTestId(part).boundingBox();
        expect(b && b.x >= sb!.x - 0.5 && b.x + b.width <= sb!.x + sb!.width + 0.5, `${part} inside the strip`).toBeTruthy();
      }
      await hero.screenshot({ path: info.outputPath("bias-hero.png"), animations: "disabled" });
    }

    // tap → explainer with a diverging bar per condition
    await bias.getByRole("button", { name: /^Long\/Short-Tendenz: Stark Long, \d+ %\. Bedingungen ansehen$/ }).click();
    const dialog = page.getByRole("dialog", { name: "Long/Short-Tendenz" });
    await expect(dialog).toBeVisible();
    const rows = dialog.getByTestId("bias-row");
    await expect(rows).toHaveCount(7);
    for (const id of ["mcb-30m", "mcb-45m", "mcb-1h", "rsi", "zone", "whale"]) {
      const v = Number(await dialog.locator(`[data-testid=bias-row][data-id="${id}"]`).getAttribute("data-vote"));
      expect(v, `${id} votes long`).toBeGreaterThan(0);
    }
    await expect(dialog.getByText("Top-Trader kaufen · Retail rot", { exact: true })).toBeVisible();
    await page.waitForTimeout(700);
    await expectRowsAddUp(dialog);
    await expect(dialog.getByTestId("bias-sum")).toContainText("→ Stark Long");
    await page.screenshot({ path: info.outputPath("bias-explainer.png"), animations: "disabled" });
    await dialog.getByRole("button", { name: "Schließen" }).click();
    await expect(dialog).toHaveCount(0);

    // keyboard: Enter opens it as well
    await bias.getByRole("button", { name: /Bedingungen ansehen$/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Long/Short-Tendenz" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Long/Short-Tendenz" })).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("short setup (mirrored market): the bar leans right (Short side) with a Short label", async ({ page }, info) => {
    const errors = collectErrors(page);
    const { card, bias } = await openBias(page, "short");
    await expect(card.getByTestId("signal-label")).toHaveText(/Short-Einstieg/, { timeout: 15_000 });
    await expect(bias).toHaveAttribute("data-level", /^-[12]$/);
    await expect(bias.getByTestId("bias-label")).toHaveText(/Short$/);
    await expect(bias.getByTestId("bias-percent")).toContainText("Short");
    const meter = card.getByRole("meter", { name: "Long/Short-Tendenz" });
    await expect(meter).toHaveAttribute("aria-valuetext", /^(Stark|Eher) Short, \d+ %$/);
    expect(Number(await meter.getAttribute("aria-valuenow"))).toBeLessThan(-15);
    const x = await needleAt(bias);
    expect(x, "needle right of centre (Short right)").toBeGreaterThan(0.58);
    await expectNoHorizontalScroll(page);
    await card.screenshot({ path: info.outputPath("bias-short-card-only.png"), animations: "disabled" });
    if ((page.viewportSize()?.width ?? 0) >= 1024) await expect(page.getByTestId("signal-strip-bias")).toHaveAttribute("data-level", /^-[12]$/);

    // explainer: rows add up; the flat top-trader reading is not titled "kaufen · Retail rot" on the short side
    await bias.getByRole("button", { name: /Bedingungen ansehen$/ }).click();
    const dialog = page.getByRole("dialog", { name: "Long/Short-Tendenz" });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(700);
    await expectRowsAddUp(dialog);
    await expect(dialog.getByTestId("bias-sum")).toContainText(/→ (Stark|Eher) Short/);
    const whale = dialog.locator("[data-testid=bias-row][data-id=whale]");
    const vote = await whale.getAttribute("data-vote");
    if (vote === "none" || Number(vote) <= 0) await expect(whale).not.toContainText("Top-Trader kaufen · Retail rot");
    await page.screenshot({ path: info.outputPath("bias-short-explainer.png"), animations: "disabled" });
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
