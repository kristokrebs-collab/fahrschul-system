/**
 * Übersicht after the rules-v2 decisions:
 * - decision 13: no general SHORT trigger on the hero — a 4H close under the stored short level shows no
 *   "Short-Trigger aktiv" and no "Short-Trigger in −x %" row (decision 23: the Lage-Ampel replaced the manual
 *   scenario box); the stored level itself stays untouched.
 * - decision 7: `?debug=layers` opens the layer diagnostics (outlines + labels of every fixed / sticky layer, the
 *   Prüfstreifen, viewport numbers, Kopieren, Minimieren, Esc); Samsung Internet (the Galaxy Tab projects) gets the safe
 *   effects (`html[data-safe-fx]`). Everything it changed is restored on close.
 * - decision 12: the Disziplin card with only 3 trades fills its space — every day cell drawn, the heat map as wide
 *   as its column, today marked, score trend, last trading days and the weakest rule (1692×978, 1280×800, 390).
 */
import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, fixture, hasTouch, isTouchTablet, scrollUntilVisible, seed, stored } from "./helpers";

const baseSettings = fixture["tj2-settings"] as Record<string, unknown>;

test.describe("Übersicht v2", () => {
  test("decision 13 / 23: a close under the stored short level — no Short-Trigger on the hero (the Lage-Ampel replaced the scenario), the level stays stored", async ({ page }, info) => {
    const errors = collectErrors(page);
    // levels far above the live price (~84 200): the last 4H close is under the SHORT level → the trigger engine says
    // "short"; the Übersicht must show the neutral range instead
    const market = { symbol: "BINANCE:BTCUSDT", longTrigger: 99_000, longStop: 97_000, shortTrigger: 95_000, invalidation: 70_000, lowerHigh: 82_829, rsiWeekly: 62.09, zoneLow: 81_500, zoneHigh: 82_200 };
    await seed(page, { extra: { "tj2-settings": { ...baseSettings, market } } });
    await page.goto("/#overview");
    const panel = page.getByTestId("market-panel");
    await expect(panel).toBeVisible();
    // decision 23: the automatic Lage-Ampel replaced the manual scenario box and the "Long-Trigger in" row (the
    // stored levels only draw chart lines); lg+ it is the hero's band, below inside the market panel
    await expect(page.getByTestId("lage-panel")).toHaveAttribute("data-state", /red|amber|green/, { timeout: 20_000 });
    await expect(page.getByTestId("scenario-box")).toHaveCount(0);
    await expect(panel).not.toContainText("Short-Trigger");
    await expect(page.getByText(/Long-Trigger in [+−-]\d/)).toHaveCount(0);
    await expect(page.getByText(/Short-Trigger (aktiv|in )/)).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("hero-no-short.png"), animations: "disabled" });
    // the stored level is untouched (no data deletion)
    const s = await stored<{ market?: { shortTrigger?: number } }>(page, "tj2-settings");
    expect(s?.market?.shortTrigger).toBe(95_000);
    // the settings still edit it, with the new help text
    await page.goto("/#settings");
    await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
    await expect(page.getByText("Nur SHORT-Linie im Chart · Übersicht ohne Short-Trigger")).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("decision 7: ?debug=layers outlines and labels every fixed / sticky layer, with the Prüfstreifen, Kopieren and Esc", async ({ page, context }, info) => {
    const errors = collectErrors(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    await seed(page);
    await page.goto("/?debug=layers#overview");
    const diag = page.getByRole("region", { name: "Ebenen-Diagnose" });
    await expect(diag).toBeVisible({ timeout: 15_000 });
    await expect(diag.getByRole("heading", { name: "Ebenen-Diagnose" })).toBeVisible();
    const samsung = isTouchTablet(info);
    // Samsung Internet (Galaxy Tab projects): the safe effects are on from the first paint
    expect(await page.evaluate(() => document.documentElement.hasAttribute("data-safe-fx")), "safe effects only for Samsung Internet").toBe(samsung);
    await expect(diag.getByRole("button", { name: "Sichere Effekte (Samsung) anwenden" })).toHaveAttribute("aria-pressed", String(samsung));
    if (samsung) await expect(diag).toContainText("Samsung Internet");
    // every fixed / sticky layer is listed with name, size and z; the header and the dock are among them
    const list = diag.locator("li");
    await expect.poll(() => list.count(), { timeout: 5_000 }).toBeGreaterThan(1);
    await expect(diag).toContainText("Header");
    if (hasTouch(info) || (page.viewportSize()?.width ?? 0) < 1024) await expect(diag).toContainText("Dock");
    await expect(diag).toContainText(/fixed · \d+×\d+ @/);
    const vp = page.viewportSize()!;
    await expect(diag).toContainText(`inner ${vp.width}×${vp.height}`);
    await expect(diag).toContainText(/Unterkante \(Mitte, 12 px darüber\)/);
    await page.screenshot({ path: info.outputPath("debug-layers.png") });

    // Kopieren: the plain-text report (clipboard, or a selectable text field when the clipboard is not allowed)
    await diag.getByRole("button", { name: "Kopieren" }).click();
    await expect(diag.getByRole("button", { name: /Kopiert ✓/ }).or(diag.getByText("Kopieren nicht erlaubt"))).toBeVisible();
    const copied = (await diag.getByRole("button", { name: /Kopiert ✓/ }).count()) > 0;
    const report = copied ? await page.evaluate(() => navigator.clipboard.readText()) : await diag.locator("textarea").inputValue();
    expect(report).toContain("Header");
    expect(report).toContain(`${vp.width}×${vp.height}`);

    // a layer can be hidden (and comes back on close); Minimieren keeps outlines + strip only
    // only real layers: the chart's layer toggles (`data-chart-layer`) are no diagnostics layers
    await expect(diag).not.toContainText("mcb (button)");
    const hide = diag.getByRole("button", { name: "Header (header) ausblenden" });
    await hide.click();
    await expect(diag.getByRole("button", { name: "Header (header) einblenden" })).toBeVisible();
    expect(await page.evaluate(() => document.querySelector<HTMLElement>("header[data-layer=Header]")?.style.visibility)).toBe("hidden");
    await diag.getByRole("button", { name: "Minimieren" }).click();
    await expect(page.getByRole("button", { name: "Ebenen-Diagnose öffnen" })).toBeVisible();
    await expect(diag.getByRole("heading", { name: "Ebenen-Diagnose" })).toHaveCount(0);
    await page.getByRole("button", { name: "Ebenen-Diagnose öffnen" }).click();
    await expect(diag.getByRole("heading", { name: "Ebenen-Diagnose" })).toBeVisible();

    // Esc closes it and restores what it changed
    await page.keyboard.press("Escape");
    await expect(diag).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.hasAttribute("data-safe-fx"))).toBe(samsung);
    expect(await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("[data-layer]")).filter((e) => e.style.visibility === "hidden").length)).toBe(0);
    // without the parameter: nothing
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Ebenen-Diagnose" })).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("decision 12: the Disziplin card with 3 trades fills its space (every day drawn, full-width heat map, trend, last days, weakest rule)", async ({ page }, info) => {
    test.skip(info.project.name === "tablet-portrait" || info.project.name === "desktop", "the user's sizes: 1692×978, 1280×800, 390");
    const errors = collectErrors(page);
    const base = fixture["tj2-trades"] as Record<string, unknown>[];
    const day = (n: number, h: number) => {
      const x = new Date(Date.now() - n * 86_400_000);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}T${String(h).padStart(2, "0")}:00`;
    };
    const three = [base[0], base[5], base[12]].map((t, i) => ({ ...t, id: `t_e2e_disc_${i}`, date: day([1, 3, 6][i]!, 10 + i) }));
    await seed(page, { extra: { "tj2-trades": three } });
    await page.goto("/#overview");
    const card = page.getByTestId("insights-discipline");
    await scrollUntilVisible(page, card);
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);

    const heat = card.getByRole("listbox");
    const weeks = Number(await heat.getAttribute("data-weeks"));
    expect(weeks, "weeks follow the width").toBeGreaterThanOrEqual(8);
    // every past day is a cell (faint dot without trades): weeks × 7 minus the days after today
    const cells = await heat.getByRole("option").count();
    expect(cells).toBeGreaterThan(weeks * 7 - 7);
    expect(cells).toBeLessThanOrEqual(weeks * 7);
    await expect(heat.locator("[data-key]")).toHaveCount(3);
    await expect(heat.locator("[data-today]")).toHaveCount(1);
    // the score trend, the last trading days and the weakest rule fill the rest
    await expect(card).toContainText("3 Handelstage");
    await expect(card.getByRole("button", { name: /: \d+ %, \d+ von \d+ Regeln/ })).toHaveCount(3);
    await expect(card).toContainText("Schwächste Regel");

    // no black hole: the heat map spans its column up to the right edge of the trend row
    const trendRight = await card.getByText(/ · 3 Handelstage$/).evaluate((el) => el.getBoundingClientRect().right);
    const hb = (await heat.boundingBox())!;
    const cb = (await card.boundingBox())!;
    if (info.project.name !== "mobile") expect(Math.abs(hb.x + hb.width - trendRight), `heat map right ${hb.x + hb.width} vs column right ${trendRight}`).toBeLessThanOrEqual(12);
    else expect(hb.width / cb.width, "phone: heat map over the card width").toBeGreaterThan(0.75);
    await expectNoHorizontalScroll(page);
    await card.screenshot({ path: info.outputPath(`disziplin-3-trades-${info.project.name}.png`), animations: "disabled" });
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
