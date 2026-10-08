/**
 * Übersicht: hero tiles (readable at every width), fact morph dialogs, ranking → setup explainer → `#trades?setup=`,
 * FAB → editor morph, market scenarios on the MarketPanel.
 */
import { expect, test } from "@playwright/test";
import { collectErrors, isMobile, screenshot, seed, toast } from "./helpers";

const HERO_LABELS = ["Trades", "Win-Rate", "Profit-Faktor", "Ø R", "Max. Drawdown", "Erwartungswert", "Serie"];

async function gotoOverview(page: import("@playwright/test").Page) {
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  await expect(page.getByTestId("market-panel")).toContainText("BTC/USDT");
}

/** A hero tile is the MorphCard button inside the `<dl>`; `hasText` on the label. */
function heroTile(page: import("@playwright/test").Page, label: string) {
  return page.locator('dl [aria-haspopup="dialog"]', { has: page.locator("dt", { hasText: label }) }).first();
}

test.describe("hero", () => {
  test("all seven KPI tiles are fully readable (no truncated label or value)", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await gotoOverview(page);
    await page.waitForTimeout(1200);
    await screenshot(page, info, "overview-hero");
    for (const label of HERO_LABELS) {
      const tile = heroTile(page, label);
      await expect(tile).toBeVisible();
      const overflow = await tile.evaluate((el) => {
        const cells = Array.from(el.querySelectorAll<HTMLElement>("dt span.truncate, dd"));
        return cells.map((c) => ({ text: c.textContent, clipped: c.scrollWidth > c.clientWidth + 1 }));
      });
      for (const c of overflow) expect(c.clipped, `${label}: "${c.text}" is truncated`).toBe(false);
    }
    // market tiles (Funding / OI / Taker / Bid/Ask) are not truncated either
    if (!isMobile(info)) {
      const clipped = await page
        .getByTestId("market-panel")
        .locator(".truncate")
        .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
      expect(clipped, `truncated market values: ${clipped.join(", ")}`).toEqual([]);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("tiles stay readable at 1024 px", async ({ page }, info) => {
    test.skip(isMobile(info), "desktop only");
    await seed(page);
    await page.setViewportSize({ width: 1024, height: 900 });
    await gotoOverview(page);
    await page.waitForTimeout(800);
    await screenshot(page, info, "overview-hero-1024");
    for (const label of HERO_LABELS) {
      const clipped = await heroTile(page, label).evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>("dt span.truncate, dd")).some((c) => c.scrollWidth > c.clientWidth + 1));
      expect(clipped, `${label} truncated at 1024`).toBe(false);
    }
  });

  test("tile `+` opens the fact dialog with formula + verdict; Escape closes and reveals the tile again", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await gotoOverview(page);
    const tile = heroTile(page, "Win-Rate");
    await tile.hover();
    await tile.click();
    // three frames during the open morph: never a blank / popped frame (dialog or source visible at all times)
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(80);
      await page.screenshot({ path: `/tmp/shots/${info.project.name}-fact-open-${i}.png` });
    }
    const dialog = page.getByRole("dialog", { name: "Win-Rate" });
    await expect(dialog).toBeVisible();
    // formula `{wins} Gewinner ÷ {n} Trades = {pct}` + verdict text
    await expect(dialog).toContainText(/Gewinner ÷ \d+ Trades =/);
    await expect(dialog).toContainText(/Backtest|Break-even|Trades/);
    await screenshot(page, info, "overview-fact-dialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(tile).toBeVisible();
    await expect(tile).toHaveCSS("visibility", "visible");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("`Details +` opens the Netto-P&L fact dialog", async ({ page }) => {
    await seed(page);
    await gotoOverview(page);
    await page.getByRole("button", { name: /Details \+/ }).click();
    const dialog = page.getByRole("dialog", { name: "Netto-P&L" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("USDT");
    await dialog.getByRole("button", { name: "Schließen", exact: true }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe("ranking", () => {
  test("row → setup explainer → `Alle Trades mit dieser Grundlage →` filters the trades page", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await gotoOverview(page);
    const row = page.locator('[aria-haspopup="dialog"]', { hasText: "BSL/EQL Liquidity Sweep" }).first();
    await row.scrollIntoViewIfNeeded();
    await row.click();
    const dialog = page.getByRole("dialog", { name: "BSL/EQL Liquidity Sweep" });
    await expect(dialog).toBeVisible();
    await screenshot(page, info, "overview-setup-explainer");
    await dialog.getByRole("button", { name: "Alle Trades mit dieser Grundlage →" }).click();
    await expect(page).toHaveURL(/#trades\?setup=/);
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    // the setup filter is a MorphSelect (button trigger carrying the value)
    const select = page.getByRole("button", { name: "Entscheidungsgrundlage", exact: true });
    await expect(select).not.toHaveAttribute("data-value", "all");
    await expect(select).toContainText("BSL/EQL Liquidity Sweep");
    // deep link is not overridden by a second scroll restore: the page starts at the top
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(40);
    await screenshot(page, info, "trades-filtered-by-setup");
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("editor from the FAB", () => {
  test("FAB `+` morphs into the editor, save → toast + row, `Speichern & neu` resets, `Live-Preis übernehmen` inserts the price", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await gotoOverview(page);
    const fab = page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Trade eintragen" });
    await fab.click();
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(80);
      await page.screenshot({ path: `/tmp/shots/${info.project.name}-fab-open-${i}.png` });
    }
    const dialog = page.getByRole("dialog", { name: "Trade eintragen" });
    await expect(dialog).toBeVisible();
    await screenshot(page, info, "editor-empty");

    // live price from the mocked market: the WS replay prints 84.206,1 → 84.215,4 → 84.199 within 2.2 s of the
    // socket opening; the button takes the freshest trade, so wait until the last one arrived (the market card's price
    // reads it) — a fast run reached the click while 84.215,4 was the last trade
    const live = dialog.getByRole("button", { name: /Live-Preis.*übernehmen/ }).first();
    await expect(live).toBeVisible();
    await expect(page.getByTestId("market-panel").locator("[data-rolling-digits] > .sr-only").first()).toHaveText("84.199");
    await live.click();
    await expect(dialog.locator("#f-entry")).toHaveValue(/84\.?199/);

    await dialog.locator("#f-entry").fill("80000");
    await dialog.locator("#f-exit").fill("82000");
    await dialog.locator("#f-size").fill("5000");
    await dialog.locator("#f-reason").fill("E2E Trade");
    await screenshot(page, info, "editor-filled");
    await dialog.getByRole("button", { name: "Speichern & neu" }).click();
    await expect(toast(page)).toContainText("Trade gespeichert");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#f-entry")).toHaveValue("");
    await expect(dialog.locator("#f-reason")).toHaveValue("");

    await dialog.locator("#f-entry").fill("81000");
    await dialog.locator("#f-exit").fill("80000");
    await dialog.locator("#f-size").fill("4000");
    await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page)).toContainText("Trade gespeichert");
    await screenshot(page, info, "editor-saved-toast");

    await page.goto("/#trades");
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    await expect(page.getByText("15 Trades", { exact: true })).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("market scenarios", () => {
  test("stale: WS goes silent → age counts up, silent recovery keeps the price honest, no crash", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { scenario: "stale" });
    await gotoOverview(page);
    const panel = page.getByTestId("market-panel");
    await expect(panel.getByText(/Live · vor/)).toBeVisible();
    // no WS message after 3 s: the age label keeps counting (≥ 10 s) instead of pretending a fresh tick – or, once the
    // silence is detected (10 s), the socket's recovery REST-polls the price and says so honestly …
    await expect(panel.getByText(/Live · vor (1\d|[2-5]\d)s|Kurs per Abfrage · 5 s/).first()).toBeVisible({ timeout: 25_000 });
    await screenshot(page, info, "market-stale");
    // … and the provider's silent recovery (REST poll / reconnect) never drops to `Kein Live-Kurs`: the pill reads
    // `Live` (the reconnected socket delivers) or `Kurs per Abfrage · 5 s` (between a silence and the next delivery)
    await page.waitForTimeout(12_000);
    await expect(panel.getByText(/Kein Live-Kurs/)).toHaveCount(0);
    await expect(panel.locator("[data-status-pill]").first()).toHaveText(/^(Live|Kurs per Abfrage · 5 s)/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("blocked_451: Binance unreachable → Bybit fallback badge + price", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { scenario: "blocked_451" });
    await gotoOverview(page);
    const panel = page.getByTestId("market-panel");
    await expect(panel.getByText(/Bybit/).first()).toBeVisible({ timeout: 20_000 });
    await expect(panel).not.toContainText("Kurs wird geladen");
    await screenshot(page, info, "market-blocked-451");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("offline: no source at all → `Kein Live-Kurs`, page still usable", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { scenario: "offline" });
    await gotoOverview(page);
    const panel = page.getByTestId("market-panel");
    await expect(panel.getByText(/Kein Live-Kurs|Offline/).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000);
    await screenshot(page, info, "market-offline");
    await expect(page.locator("#chart-card")).toContainText(/Noch keine Kerzen|Offline/);
    // the rest of the page is alive
    await page.goto("/#trades");
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("reconnect: WS drops once and comes back live", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { scenario: "reconnect" });
    await gotoOverview(page);
    const panel = page.getByTestId("market-panel");
    await expect(panel.getByText(/Live · vor/)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(6000);
    await expect(panel.getByText(/Live · vor/)).toBeVisible({ timeout: 20_000 });
    await screenshot(page, info, "market-reconnect");
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test("chart card renders a dense 4h / 1M window with a filled ratio pane", async ({ page }, info) => {
  test.skip(isMobile(info), "desktop only");
  await seed(page);
  await gotoOverview(page);
  const card = page.locator("#chart-card");
  await expect(card.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await expect(card.getByRole("radio", { name: "4h", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(card.getByRole("radio", { name: "1M", exact: true })).toHaveAttribute("aria-checked", "true");
  // two panes: main + ratio (lightweight-charts renders one table row per pane)
  expect(await card.locator("table tr").count()).toBeGreaterThanOrEqual(2);
  await screenshot(page, info, "overview-chart");
});
