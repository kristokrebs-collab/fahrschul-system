/**
 * Einstiegs-Check on a KNOWN market: the mocked Binance REST serves a generated price path (`mocks/synth.ts`: a
 * three-day fall into a capitulation low, then a sharp turn) as 15m / 1h / 4h klines, plus the top-trader / all-accounts
 * ratio series (the check reads the 5-minute ones). The expected evaluation comes from the app's own pure engine on the
 * same data (`mocks/synthOracle.ts`). The page clock is pinned (`pinClock`) so "now" always sits at the same place in the
 * 30m candle: 10:03 UTC with the turn ending at 10:02 → the base candle that carried the signal has CLOSED ("bestätigt").
 * Covered: verdict + candle-close state, ladder tiles with their states, RSI, zone, the graded Top-Trader-Kombi (4 parts
 * lit / unlit with their values), divergence and support / resistance rows, the hero strip line, chart MCB dots on 30m
 * and the chart layer toggles.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { STRENGTH_LABEL, type GradedPart, type Signals } from "../../src/domain/signals";
import { collectErrors, fixture, isMobile, pinClock, screenshot, seed, stored, utcToday, verdictLabel, type FakeClock } from "./helpers";
import type { RatioScript } from "./mocks/synth";
import { expectedSignals } from "./mocks/synthOracle";

/** Last trade price of the `live` WS scenario (the engine completes the running bars with it). */
const LIVE_PRICE = 84_199;
/** 10:03 UTC: three minutes into a 30m candle, the turn ended one minute ago on the candle before (closed). */
const AT = () => utcToday(10, 3);

const de0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const RUNG_TEXT: Record<string, string> = { provisional: "vorläufig·schließt in", confirmed: "bestätigt", strong: "stark bestätigt" };

async function openCheck(page: Page, ratios: RatioScript, extra?: Record<string, unknown>): Promise<{ card: Locator; anchor: number; clock: FakeClock }> {
  const at = AT();
  const clock = await pinClock(page, at);
  const anchor = at - 60_000;
  await seed(page, { synth: { ratios, anchor }, clock: clock.now, extra });
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  const card = page.getByTestId("signal-card");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
  await expect(card.getByTestId("signal-verdict")).toBeVisible();
  return { card, anchor, clock };
}

/** Number shown by a rung meter (`MCB` / `RSI`), German decimal comma. */
async function meterValue(rung: Locator, label: "MCB" | "RSI"): Promise<number> {
  const row = rung.locator("div.mt-2\\.5", { has: rung.page().getByText(label, { exact: true }) }).first();
  const text = (await row.locator("span.num").first().textContent()) ?? "";
  const m = /[−-]?\d+(,\d+)?/.exec(text.replace(/\s/g, ""));
  return m ? Number(m[0].replace("−", "-").replace(",", ".")) : NaN;
}

const part = (sig: Signals, side: "long" | "short", id: GradedPart["id"]): GradedPart => {
  const p = sig[side].parts?.find((x) => x.id === id);
  if (!p) throw new Error(`oracle: no ${id} part`);
  return p;
};

test.describe("Einstiegs-Check on a known market", () => {
  test("confirmed long: verdict, candle-close state, ladder, RSI, zone and the Top-Trader-Kombi 4 of 4 match the engine", async ({ page }, info) => {
    const errors = collectErrors(page);
    const { card, anchor, clock } = await openCheck(page, "whale-long");
    const exp = expectedSignals(anchor, clock.now(), LIVE_PRICE, "whale-long");
    expect(exp.long.state, "oracle: the base candle closed with the signal").toBe("confirmed");
    expect(exp.long.valid).toBe(true);
    expect(exp.long.strength, "oracle: the combo's +1 strength").toBe(4);
    expect(part(exp, "long", "traders").ok, "oracle: combo holds").toBe(true);

    const label = verdictLabel(card);
    await expect(label).toHaveText(exp.long.label, { timeout: 15_000 });
    await expect(label).toHaveText("Sehr starker Long-Einstieg");
    await expect(card.getByRole("img", { name: "Stärke 4 von 4" })).toBeVisible();
    await expect(card.getByRole("img", { name: `Score ${exp.long.score} von 100` })).toBeVisible();
    await expect(card.getByText(`${STRENGTH_LABEL[4]} · ${exp.long.tiers} von 4 Timeframes`)).toBeVisible();
    await expect(card.getByRole("radio", { name: "Long" })).toHaveAttribute("aria-checked", "true");

    // candle-close state: the verdict and its state line say "bestätigt" (no countdown, no warning marker)
    await expect(card.getByTestId("signal-verdict")).toHaveAttribute("data-state", "confirmed");
    const state = card.getByTestId("signal-verdict").getByTestId("signal-state");
    await expect(state).toHaveAttribute("data-state", "confirmed");
    await expect(state).toHaveText("✓bestätigt · 30m-Kerze geschlossen");

    // ladder: the confirmed rungs light up, each with its MCB event, its own state and an RSI near oversold
    const rungs = card.getByTestId("signal-rung");
    await expect(rungs).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      const rung = rungs.nth(i);
      const c = exp.checks[i]!;
      await expect(rung).toContainText(c.tf);
      if (i < exp.long.tiers) {
        await expect(rung, `${c.tf} lit`).toHaveAttribute("data-lit", "true");
        await expect(rung).toContainText(c.wt.long?.kind === "bottom" ? "Bottom" : "Kaufsignal");
        await expect(rung, `${c.tf} state`).toHaveAttribute("data-state", exp.long.rungStates![i]!);
        await expect(rung.getByTestId("signal-rung-state")).toContainText(RUNG_TEXT[exp.long.rungStates![i]!]!);
      } else await expect(rung, `${c.tf} not lit`).not.toHaveAttribute("data-lit", /.*/);
      const rsi = await meterValue(rung, "RSI");
      expect(Math.abs(rsi - c.rsi), `${c.tf} RSI ${rsi} vs engine ${c.rsi.toFixed(1)}`).toBeLessThan(2.5);
    }
    for (let i = 0; i < 3; i++) expect(exp.checks[i]!.rsiLong, `${exp.checks[i]!.tf} RSI near oversold`).toBe(true);

    // zone: 1h discount, the marker label on the bar
    const zone = card.getByTestId("signal-zone");
    await expect(zone).toContainText("Zone · 1h");
    await expect(zone).toContainText(`Discount · ${Math.round(exp.zone!.zone.pos * 100)} %`);

    // conditions list: ladder, RSI, zone and the combo line (4 of 4) are ticked
    const reasons = card.getByRole("list", { name: "Bedingungen" });
    await expect(reasons.getByText("RSI nahe überverkauft (≤ 40)")).toBeVisible();
    await expect(reasons.locator("li", { hasText: "Preis im Discount (1h)" })).toContainText("erfüllt");
    await expect(reasons.locator("li", { hasText: "Top-Trader long · Retail rot (4 von 4)" })).toContainText("erfüllt");

    // Top-Trader-Kombi scorecard: lit, every part met with its value, full points and the strength bonus
    const traders = part(exp, "long", "traders");
    const whale = card.getByTestId("signal-whale");
    await expect(whale).toHaveAttribute("data-state", "ok");
    await expect(whale).toHaveAttribute("data-lit", "true");
    await expect(whale).toContainText("Top-Trader long · Retail rot");
    await expect(whale.getByTestId("signal-part-points")).toHaveText("+10 von 10+1 Stärke");
    const cells = whale.getByTestId("signal-part-cell");
    await expect(cells).toHaveCount(4);
    for (const [id, value] of [
      ["pos", "66,0 % Long"],
      ["acc", "65,4 % Long"],
      ["retail", "−0,5 pp"],
      ["zone", traders.items.find((x) => x.id === "zone")!.value],
    ] as const) {
      const cell = whale.locator(`[data-testid=signal-part-cell][data-id=${id}]`);
      await expect(cell, `${id} met`).toHaveAttribute("data-met", "true");
      await expect(cell).toContainText(value);
    }
    await expect(whale.locator("[data-testid=signal-part-cell][data-id=pos]")).toContainText("Ziel > 64 % Long");
    await expect(whale.locator("[data-testid=signal-part-cell][data-id=retail]")).toContainText("rot: Long-Anteil fällt (5m)");

    // divergences: one row per ladder timeframe; the synthetic fall has none
    const div = card.getByTestId("signal-div");
    const divPart = part(exp, "long", "div");
    await expect(div).toHaveAttribute("data-state", divPart.grade > 0 ? (divPart.ok ? "ok" : "part") : "open");
    await expect(div).toContainText("Bullische Divergenz");
    await expect(div.getByTestId("signal-div-row")).toHaveCount(4);
    for (const it of divPart.items) await expect(div.locator(`[data-testid=signal-div-row][data-tf="${it.id}"]`)).toContainText(it.value);

    // support / resistance: the level leaned on and the next one with the room in R (same numbers as the engine)
    const sr = card.getByTestId("signal-sr");
    const srPart = part(exp, "long", "sr");
    await expect(sr).toHaveAttribute("data-state", srPart.ok ? "ok" : srPart.grade > 0 ? "part" : "open");
    await expect(sr).toContainText("Support + Platz nach oben");
    const lv = srPart.levels!;
    if (lv.lean) await expect(sr.getByTestId("signal-sr-lean")).toHaveText(`${lv.lean.label} ${de0.format(lv.lean.price)}`);
    if (lv.target) await expect(sr.getByTestId("signal-sr-target")).toContainText(`${lv.target.label} ${de0.format(lv.target.price)}`);
    await expect(sr).toContainText(srPart.items.find((x) => x.id === "room")!.value.split(" · ").at(-1)!);
    await expect(card.getByTestId("signal-parts")).toContainText("Teil-Bedingungen");
    await screenshot(page, info, "signal-card-known");

    // Short side: the mirror combo is open (top traders are long, retail red, price in discount)
    await card.getByRole("radio", { name: "Short" }).click();
    await expect(whale).toHaveAttribute("data-state", "open");
    await expect(whale).not.toHaveAttribute("data-lit", /.*/);
    await expect(whale).toContainText("Top-Trader short · Retail grün");
    await expect(whale.locator("[data-testid=signal-part-cell][data-id=pos]")).toHaveAttribute("data-met", "false");
    await expect(verdictLabel(card)).toHaveText(exp.short.label);
    await expect(card.getByTestId("signal-sr")).toContainText("Widerstand + Platz nach unten");

    // hero strip (≥ lg): the same verdict, its state and the parts line
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      const strip = page.getByTestId("signal-strip");
      await expect(strip).toBeVisible();
      await expect(strip.getByTestId("signal-strip-whale")).toHaveAttribute("data-lit", "true");
      await expect(strip.getByTestId("signal-strip-whale")).toContainText("Top-Trader4/4");
      await expect(strip.getByTestId("signal-strip-sr")).toHaveAttribute("data-state", srPart.ok ? "ok" : srPart.grade > 0 ? "part" : "open");
      await expect(strip.getByTestId("signal-strip-div")).toBeVisible();
      await expect(strip.getByTestId("signal-state")).toHaveAttribute("data-state", "confirmed");
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("top traders not above 64 %: the combo gives partial credit (2 of 4), no strength bonus", async ({ page }) => {
    const { card, anchor, clock } = await openCheck(page, "flat");
    const exp = expectedSignals(anchor, clock.now(), LIVE_PRICE, "flat");
    const withCombo = expectedSignals(anchor, clock.now(), LIVE_PRICE, "whale-long");
    const p = part(exp, "long", "traders");
    expect(p.ok, "oracle: combo open").toBe(false);
    expect(p.met, "oracle: retail red + discount").toBe(2);
    // partial credit: weight × met/4 points; the full combo adds the rest and one strength level (capped at 4)
    expect(withCombo.long.strength).toBe(Math.min(4, exp.long.strength + 1));
    await expect(verdictLabel(card)).toHaveText(exp.long.label, { timeout: 15_000 });
    await expect(card.getByRole("img", { name: `Stärke ${exp.long.strength} von 4` })).toBeVisible();
    await expect(card.getByRole("img", { name: `Score ${exp.long.score} von 100` })).toBeVisible();
    const whale = card.getByTestId("signal-whale");
    await expect(whale).toHaveAttribute("data-state", "part");
    await expect(whale).not.toHaveAttribute("data-lit", /.*/);
    await expect(whale.getByTestId("signal-part-points")).toHaveText("+5 von 10");
    await expect(whale.locator("[data-testid=signal-part-cell][data-id=pos]")).toHaveAttribute("data-met", "false");
    await expect(whale.locator("[data-testid=signal-part-cell][data-id=pos]")).toContainText("55,0 % Long");
    await expect(whale.locator("[data-testid=signal-part-cell][data-id=acc]")).toHaveAttribute("data-met", "false");
    await expect(whale.locator("[data-testid=signal-part-cell][data-id=retail]")).toHaveAttribute("data-met", "true");
    await expect(whale.locator("[data-testid=signal-part-cell][data-id=zone]")).toHaveAttribute("data-met", "true");
    await expect(card.getByRole("list", { name: "Bedingungen" }).locator("li", { hasText: "Top-Trader long · Retail rot (2 von 4)" })).toContainText("offen");
  });

  test("switched off in the settings: no combo card, no points, no bonus", async ({ page }) => {
    const settings = { ...(fixture["tj2-settings"] as Record<string, unknown>), signals: { whale: { on: false } } };
    const { card, anchor, clock } = await openCheck(page, "whale-long", { "tj2-settings": settings });
    const off = expectedSignals(anchor, clock.now(), LIVE_PRICE, "whale-long", { cfg: { whale: { on: false } } });
    expect(off.long.parts?.some((x) => x.id === "traders"), "oracle: no combo part").toBe(false);
    await expect(verdictLabel(card)).toHaveText(off.long.label, { timeout: 15_000 });
    await expect(card.getByRole("img", { name: `Stärke ${off.long.strength} von 4` })).toBeVisible();
    await expect(card.getByRole("img", { name: `Score ${off.long.score} von 100` })).toBeVisible();
    await expect(card.getByTestId("signal-whale")).toHaveCount(0);
    await expect(card.getByTestId("signal-div")).toBeVisible();
    await expect(card.getByRole("list", { name: "Bedingungen" }).getByText(/Top-Trader/)).toHaveCount(0);
  });

  test("Bybit fallback (no Binance top traders): `keine Daten`, never a fail", async ({ page }) => {
    // Binance blocked: klines come from Bybit (same generated market), which has no top-trader data
    const at = AT();
    const clock = await pinClock(page, at);
    await seed(page, { scenario: "blocked_451", synth: { ratios: "whale-long", anchor: at - 60_000 }, clock: clock.now });
    await page.goto("/#overview");
    const card = page.getByTestId("signal-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute("data-state", /ok|stale/, { timeout: 30_000 });
    await expect(verdictLabel(card)).toHaveText(/Long-Einstieg/);
    const whale = card.getByTestId("signal-whale");
    await expect(whale).toHaveAttribute("data-state", "none");
    await expect(whale).toContainText("keine Daten");
    for (const id of ["pos", "acc", "retail"]) await expect(whale.locator(`[data-testid=signal-part-cell][data-id=${id}]`)).toHaveAttribute("data-met", "none");
    await expect(card.getByRole("list", { name: "Bedingungen" }).locator("li", { hasText: "Top-Trader long · Retail rot" })).toContainText("keine Daten");
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

  /** A cheap fingerprint of every chart canvas (sampled pixels) — changes when a layer is drawn or removed. */
  async function canvasPrint(card: Locator): Promise<number[]> {
    return card.locator("canvas").evaluateAll((els) => {
      const copy = document.createElement("canvas");
      const out: number[] = [];
      for (const el of els as HTMLCanvasElement[]) {
        if (!el.width || !el.height) continue;
        copy.width = el.width;
        copy.height = el.height;
        const ctx = copy.getContext("2d", { willReadFrequently: true });
        if (!ctx) continue;
        ctx.clearRect(0, 0, el.width, el.height);
        ctx.drawImage(el, 0, 0);
        const d = ctx.getImageData(0, 0, el.width, el.height).data;
        for (let i = 0; i < d.length; i += 4 * 7) out.push(d[i]! + d[i + 1]! + d[i + 2]!);
      }
      return out;
    });
  }
  const changed = (a: number[], b: number[]): number => {
    let n = Math.abs(a.length - b.length);
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (Math.abs(a[i]! - b[i]!) > 24) n++;
    return n;
  };
  /** The canvas print once nothing moves any more (the overlay re-reads its data ≤ 1/s and on new candles). */
  async function settledPrint(card: Locator): Promise<number[]> {
    let prev = await canvasPrint(card);
    await expect
      .poll(
        async () => {
          await card.page().waitForTimeout(700);
          const cur = await canvasPrint(card);
          const n = changed(prev, cur);
          prev = cur;
          return n;
        },
        { timeout: 10_000, message: "chart settles" },
      )
      .toBeLessThan(3);
    return prev;
  }

  test("30m interval: built from the 15m feed, MCB dots + legend + layer toggles on the canvas", async ({ page }, info) => {
    const errors = collectErrors(page);
    const urls: string[] = [];
    const at = AT();
    const clock = await pinClock(page, at);
    await seed(page, { synth: { ratios: "whale-long", anchor: at - 60_000 }, clock: clock.now, onRequest: (u) => urls.push(`${u.pathname}?${u.searchParams.toString()}`) });
    await page.goto("/#overview");
    const card = page.locator("#chart-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
    const interval = card.getByRole("radiogroup", { name: "Intervall" });
    await expect(interval.getByRole("radio")).toHaveText(["1m", "30m", "1h", "4h"]);

    // 1m has no check timeframe → no dots, no legend, no layer toggles
    await interval.getByRole("radio", { name: "1m", exact: true }).click();
    await expect(interval.getByRole("radio", { name: "1m", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(card.getByTestId("mcb-legend")).toHaveCount(0);
    await expect(card.getByTestId("chart-layers")).toHaveCount(0);
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

    // layer toggles: MCB · Divergenzen · S/R on, Struktur off by default; the key names the candle-close looks
    const layers = card.getByTestId("chart-layers");
    await expect(layers).toBeVisible();
    const toggle = (name: string) => layers.getByRole("group", { name: "Ebenen im Chart" }).locator(`button[data-chart-layer=${name}]`);
    for (const [k, on] of [["mcb", "true"], ["div", "true"], ["sr", "true"], ["struct", "false"]] as const) await expect(toggle(k)).toHaveAttribute("aria-pressed", on);
    await expect(card.getByTestId("chart-state-key")).toContainText("vorläufig");
    await expect(card.getByTestId("chart-state-key")).toContainText("bestätigt");
    if (!isMobile(info)) await screenshot(page, info, "chart-30m-mcb");

    // S/R off: the support / resistance lines and labels leave the canvas; on again: back (persisted in tj2-ui flags).
    // 1M: the 30m structure over the whole month has the range low in view on every width (a phone shows ~2 days)
    await card.getByRole("radio", { name: "1M", exact: true }).click();
    await expect(card.getByRole("radio", { name: "1M", exact: true })).toHaveAttribute("aria-checked", "true");
    const withSr = await settledPrint(card);
    await toggle("sr").click();
    await expect(toggle("sr")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => changed(withSr, await canvasPrint(card)), { timeout: 5_000, message: "S/R lines removed from the canvas" }).toBeGreaterThan(30);
    await expect.poll(async () => (await stored<{ flags?: Record<string, unknown> }>(page, "tj2-ui"))?.flags?.chartSrOff).toBe(true);
    await toggle("sr").click();
    await expect(toggle("sr")).toHaveAttribute("aria-pressed", "true");
    // MCB off: the dots go (other long-green marks, e.g. the LONG level label, stay)
    const withMcb = await greenPixels(card);
    await toggle("mcb").click();
    await expect(card.getByTestId("mcb-legend")).toHaveCount(0);
    await expect.poll(() => greenPixels(card), { timeout: 5_000, message: "MCB dots removed" }).toBeLessThanOrEqual(withMcb - 20);
    await toggle("mcb").click();
    await expect.poll(() => greenPixels(card), { timeout: 5_000 }).toBeGreaterThan(withMcb - 5);
    // Struktur on: swing labels / BOS lines appear (a phone's pane shows ~2 days, where the fall has no swing in view)
    const noStruct = await settledPrint(card);
    await toggle("struct").click();
    await expect(toggle("struct")).toHaveAttribute("aria-pressed", "true");
    if (!isMobile(info)) await expect.poll(async () => changed(noStruct, await canvasPrint(card)), { timeout: 5_000, message: "structure drawn" }).toBeGreaterThan(10);
    await expect.poll(async () => (await stored<{ flags?: Record<string, unknown> }>(page, "tj2-ui"))?.flags?.chartStructOn).toBe(true);

    // 1h keeps the dots
    await interval.getByRole("radio", { name: "1h", exact: true }).click();
    await expect(card.getByTestId("mcb-legend")).toBeVisible({ timeout: 15_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
