/**
 * P07 Labor end to end against the market mock with REAL Binance BTCUSDT 4h / 1D bars (`mockMarket(…, { boxes: true })`,
 * served with Binance's `startTime` / `limit` paging semantics) – the lab's own history loader, the real Box-zu-Box
 * engine in the worker, the funding endpoint of the mock.
 *
 * Covered: `h1 Labor`; strategy tiles; a Box-zu-Box run over 6 months: the loader (paged `startTime` requests), the busy
 * stage (radar band + dot-matrix percentage), the equity with trade dots, KPIs, trades → replay sheet, OOS, walk-forward,
 * the overfitting verdict, the heat map, the assumptions (fees, slippage, funding, no look-ahead), the comparison card;
 * "Als Backtest-Referenz übernehmen" (hold) writes `settings.backtest` with the meaning `BacktestCompare` reads; a second
 * run is served from the IndexedDB cache (no new kline requests); cancel; the rule builder; an unreachable Binance gives
 * the honest German hint; no horizontal scroll at 390 px; no console errors.
 *
 * Until P14 registers the page the spec opens the dev harness `/dev/labor.html` (Vite dev server, e.g.
 * `npx vite --port 4182` + `PW_BASE_URL`); set `PW_LABOR_URL=/#labor` once routed. On a production preview without the
 * harness the tests skip themselves. `P07_SHOTS=<dir>` writes review screenshots.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, fixture, seed } from "./helpers";

const LABOR_URL = process.env.PW_LABOR_URL ?? "/dev/labor.html";
const SHOTS = process.env.P07_SHOTS;
const PROJECTS = ["mobile", "desktop"];

async function shot(page: Page, info: TestInfo, name: string, fullPage = true): Promise<void> {
  if (!SHOTS) return;
  await page.addStyleTag({ content: "header{position:static!important}" });
  if (fullPage) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    // slow enough that every first-view effect (cascades pause off screen) finishes where it is
    for (let y = 0; y < h; y += 420) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(900);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOTS}/P07-strategy-${name}-${info.project.name === "mobile" ? "390" : "1440"}.png`, fullPage, animations: "disabled" });
}

async function open(page: Page, info: TestInfo, opts: { extra?: Record<string, unknown>; block?: boolean } = {}): Promise<{ errors: string[]; klines: URL[] }> {
  test.skip(!PROJECTS.includes(info.project.name), "Labor runs on mobile + desktop");
  const errors = collectErrors(page);
  const klines: URL[] = [];
  await seed(page, { boxes: true, extra: { "tj2-labor": { strategy: "box", symbol: "BTCUSDT", period: "6m", boxTf: "4h" }, ...(opts.extra ?? {}) }, onRequest: (u) => u.pathname === "/fapi/v1/klines" && u.searchParams.has("startTime") && klines.push(u) });
  if (opts.block) await page.route("https://fapi.binance.com/fapi/v1/klines**", (r) => r.abort("failed"));
  const res = await page.goto(LABOR_URL);
  const served =
    !!res &&
    res.ok() &&
    (await page
      .getByRole("heading", { level: 1, name: "Labor" })
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false));
  test.skip(!served, "the Labor page is served by the dev harness (Vite dev server) until P14 routes it");
  return { errors, klines };
}

async function runBacktest(page: Page): Promise<void> {
  await page.getByTestId("labor-start").click();
  await expect(page.getByTestId("labor-run")).toHaveAttribute("data-status", "done", { timeout: 45_000 });
}

test.describe("Labor", () => {
  test.setTimeout(120_000);
  test("Box-zu-Box auf echter Historie: Lauf, Trades, Replay, Robustheit, Annahmen", async ({ page }, info) => {
    const { errors, klines } = await open(page, info);
    await expect(page.getByTestId("labor-strategy-box")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("labor-assumptions")).toContainText("Kein Blick in die Zukunft");
    await shot(page, info, "labor-idle", false);
    await page.getByTestId("labor-start").click();
    // the busy stage: radar band + the dot-matrix percentage as a progressbar (never a live region)
    await expect(page.getByTestId("labor-busy").getByRole("progressbar")).toBeVisible();
    await expect(page.getByTestId("labor-run")).toHaveAttribute("data-status", "done", { timeout: 45_000 });
    // real paging: forward from startTime on the 4h interval
    expect(klines.length).toBeGreaterThan(0);
    expect(klines.every((u) => u.searchParams.get("interval") === "4h" && u.searchParams.get("symbol") === "BTCUSDT")).toBe(true);
    await expect(page.getByTestId("labor-equity").getByRole("img")).toBeVisible();
    await expect(page.getByTestId("labor-kpis")).toContainText("Trades");
    await expect(page.getByTestId("labor-race")).toContainText("Buy & Hold");
    // assumptions name the real data and the costs
    const ass = page.getByTestId("labor-assumptions");
    await expect(ass).toContainText("geschlossene 4h-Kerzen BTCUSDT von Binance-Futures");
    await expect(ass).toContainText("Gebühren Binance");
    await expect(ass).toContainText("Top-Trader-Bias");
    // robustness block
    await expect(page.getByTestId("labor-oos")).toBeVisible();
    await expect(page.getByTestId("labor-wf")).toBeVisible();
    await expect(page.getByTestId("labor-verdict")).not.toBeEmpty();
    await expect(page.getByTestId("labor-heat").getByRole("grid")).toBeVisible();
    await expect(page.getByTestId("labor-compare").getByTestId("labor-run-card")).toHaveCount(1);
    // a trade opens the replay sheet with the run's own bars
    const trades = page.getByTestId("labor-trade");
    if (await trades.count()) {
      await trades.first().click();
      await expect(page.getByTestId("labor-replay")).toBeVisible();
      await expect(page.getByRole("slider", { name: "Replay-Zeitleiste" })).toBeVisible();
      await shot(page, info, "labor-replay", false);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("labor-replay")).toHaveCount(0);
    } else {
      await expect(page.getByTestId("labor-trades")).toContainText("Keine Trades");
    }
    await expectNoHorizontalScroll(page);
    await shot(page, info, "labor-result");
    expect(errors).toEqual([]);
  });

  test("Als Backtest-Referenz übernehmen schreibt settings.backtest; zweiter Lauf kommt aus dem Cache", async ({ page }, info) => {
    const { errors, klines } = await open(page, info, { extra: { "tj2-labor": { strategy: "rules", symbol: "BTCUSDT", period: "6m", rules: { interval: "4h", side: "long", conds: [{ kind: "rsiBelow", a: 40 }] } } } });
    await expect(page.getByTestId("labor-strategy-rules")).toHaveAttribute("aria-checked", "true");
    await runBacktest(page);
    const first = klines.length;
    expect(first).toBeGreaterThan(0);
    const adopt = page.getByTestId("labor-adopt");
    await expect(adopt).toBeVisible();
    await adopt.scrollIntoViewIfNeeded();
    const box = (await adopt.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1500);
    await page.mouse.up();
    await expect(page.getByTestId("labor-reference")).toContainText("Backtest-Referenz übernommen");
    const bt = await page.evaluate(() => (window as unknown as { __tjJournal: { getState(): { settings: { backtest: Record<string, unknown> } } } }).__tjJournal.getState().settings.backtest);
    expect(String(bt.label)).toMatch(/^Labor · Regel-Baukasten 4h · BTCUSDT · \d+ Trades$/);
    expect(Number(bt.winRate)).toBeGreaterThan(0);
    expect(Number(bt.avgLoss)).toBeLessThan(0);
    // a second run: every bar from IndexedDB
    await page.getByTestId("labor-start").click();
    await expect(page.getByTestId("labor-run")).toHaveAttribute("data-status", "done", { timeout: 45_000 });
    expect(klines.length).toBe(first);
    await expect(page.getByTestId("labor-compare").getByTestId("labor-run-card")).toHaveCount(1); // same set-up: one card
    expect(errors).toEqual([]);
  });

  test("Abbrechen und ehrlicher Hinweis ohne Binance", async ({ page }, info) => {
    const { errors } = await open(page, info, { block: true });
    await page.getByTestId("labor-start").click();
    await expect(page.getByTestId("labor-run")).toHaveAttribute("data-status", /error|cancelled/, { timeout: 30_000 });
    await expect(page.getByTestId("labor-run")).toContainText(/Binance ist (gerade )?nicht erreichbar|fehlgeschlagen/);
    await expectNoHorizontalScroll(page);
    // the proxy fallback (same origin) answers HTML in the mock → the browser logs the failed fetches only
    expect(errors.filter((e) => !/Failed to fetch|net::ERR_FAILED|fapi\.binance\.com/.test(e))).toEqual([]);
  });

  test("Abbrechen während des Laufs", async ({ page }, info) => {
    const { errors } = await open(page, info, { extra: { "tj2-labor": { strategy: "box", symbol: "BTCUSDT", period: "3y", boxTf: "1d" } } });
    await page.getByTestId("labor-start").click();
    await expect(page.getByTestId("labor-cancel")).toBeVisible();
    await page.getByTestId("labor-cancel").click();
    await expect(page.getByTestId("labor-run")).toHaveAttribute("data-status", /cancelled|done/, { timeout: 30_000 });
    await expect(page.getByTestId("labor-start")).toBeEnabled();
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ Entscheidungsgrundlagen · Strategie (P07) */

/** An untagged BTC long with a Box-zu-Box breakout A+ at entry (what the classifier recognises). */
const UNTAGGED = {
  id: "t_p07_untagged",
  account: "scalp",
  side: "long",
  status: "closed",
  date: "2026-05-04T10:00",
  pair: "BTC/USDT",
  timeframe: "4h",
  entry: 80000,
  stop: 79000,
  target: 83000,
  exit: 83000,
  size: 8000,
  leverage: 3,
  fees: 4,
  pnlManual: null,
  setups: [],
  checks: {},
  conviction: 4,
  followedPlan: true,
  emotion: "Ruhig",
  reason: "",
  notes: "",
  chart: "",
  pnl: null,
  r: null,
  mistakes: [],
  createdAt: "2026-05-04T10:00:00.000Z",
  updatedAt: "2026-05-04T10:00:00.000Z",
  boxSnap: { v: 1, symbol: "BTCUSDT", tf: "4h", at: 1, source: "retro", phase: "breakout", dir: 1, pos: 1.1, zone: "top", box: null, setup: { kind: "breakout", grade: "A+", score: 88, side: "long", entry: 80000, stop: 79000, rr: 3, targets: [83000] }, htf: null, rsi: null },
};

async function openSetups(page: Page, info: TestInfo): Promise<string[]> {
  test.skip(!PROJECTS.includes(info.project.name), "P07 runs on mobile + desktop");
  const errors = collectErrors(page);
  const raw = fixture["tj2-trades"];
  const trades = (typeof raw === "string" ? JSON.parse(raw) : raw) as unknown[];
  await seed(page, { extra: { "tj2-trades": [...trades, UNTAGGED] } });
  await page.goto("/#setups");
  await expect(page.getByRole("heading", { level: 1, name: "Entscheidungsgrundlagen" })).toBeVisible();
  return errors;
}

async function hold(page: Page, testId: string): Promise<void> {
  const el = page.getByTestId(testId);
  await el.scrollIntoViewIfNeeded();
  const box = (await el.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
}

test.describe("Entscheidungsgrundlagen · Strategie", () => {
  test.setTimeout(120_000);

  test("Editor: Strategie-Abschnitte speichern, Karte zeigt Strategie-Profil, Klassifizierung ordnet zu", async ({ page }, info) => {
    const errors = await openSetups(page, info);
    const card = page.getByTestId("setup-card-s_bo");
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: "Bearbeiten" }).click();
    const sheet = page.getByRole("dialog", { name: "Grundlage bearbeiten" });
    await expect(sheet).toBeVisible();
    const fields = sheet.getByTestId("setup-strategy-fields");
    await fields.getByRole("button", { name: "+ Entry-Kriterium" }).click();
    await fields.getByRole("textbox", { name: "Entry 1", exact: true }).fill("Schlusskurs über der Box");
    await fields.getByRole("button", { name: "+ Ziel erreicht" }).click();
    await fields.getByRole("textbox", { name: "Strategie-Tags" }).fill("Breakout");
    await fields.getByRole("textbox", { name: "Strategie-Tags" }).press("Enter");
    await fields.getByRole("button", { name: "Details zeigen: Risiko, Märkte und Auto-Erkennung" }).click();
    await fields.getByRole("textbox", { name: "Märkte" }).fill("BTCUSDT");
    await fields.getByRole("textbox", { name: "Märkte" }).press("Enter");
    await fields.getByRole("group", { name: "Timeframes" }).getByRole("button", { name: "4h", exact: true }).click();
    await fields.getByRole("group", { name: "Box-Setup beim Einstieg" }).getByRole("button", { name: "Ausbruch", exact: true }).click();
    await fields.getByRole("group", { name: "Richtung" }).getByRole("button", { name: "Long", exact: true }).click();
    await shot(page, info, "setup-editor", false);
    await sheet.getByRole("button", { name: "Speichern" }).click();
    await expect(sheet).toHaveCount(0);
    // stored as passthrough keys on the setup
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("tj2-settings") ?? "{}").setups.find((s: { id: string }) => s.id === "s_bo"));
    expect(saved.entryCriteria).toEqual([expect.objectContaining({ text: "Schlusskurs über der Box" })]);
    expect(saved.exitCriteria).toEqual([expect.objectContaining({ text: "Ziel erreicht" })]);
    expect(saved.tags).toEqual(["Breakout"]);
    expect(saved.markets).toEqual(["BTCUSDT"]);
    expect(saved.auto).toMatchObject({ boxKinds: ["breakout"], sides: ["long"] });
    // the card's strategy block opens the profile
    await expect(card.getByTestId("setup-strategy")).toBeVisible();
    await card.getByRole("button", { name: /Strategie-Profil/ }).click();
    const profile = page.getByTestId("strategy-profile");
    await expect(profile).toContainText("Schlusskurs über der Box");
    await expect(profile).toContainText("Konformität je Teil");
    await shot(page, info, "setup-profile", false);
    await page.keyboard.press("Escape");
    await expect(profile).toHaveCount(0);
    // bulk classification: the untagged breakout trade is a sure match for s_bo
    const classify = page.getByTestId("setup-classify");
    await classify.scrollIntoViewIfNeeded();
    await expect(classify).toContainText("ohne Grundlage");
    await classify.getByTestId("setup-classify-open").click();
    const row = page.getByTestId("setup-classify-row").filter({ hasText: "4H-Breakout über 85.900" }).first();
    await expect(row).toContainText("Box-Setup beim Einstieg: Ausbruch");
    await shot(page, info, "setup-classify", false);
    await hold(page, "setup-classify-all");
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("tj2-trades") ?? "[]").find((t: { id: string }) => t.id === "t_p07_untagged")?.setups)).toEqual(["s_bo"]);
    expect(errors).toEqual([]);
  });

  test("Bibliothek filtern und 2–3 Grundlagen mit Intervallen vergleichen", async ({ page }, info) => {
    const errors = await openSetups(page, info);
    const lib = page.getByTestId("setup-library");
    await lib.getByLabel("Bibliothek durchsuchen").fill("Sweep");
    await expect(page.getByTestId("setup-card-s_sweep")).toBeVisible();
    await expect(page.getByTestId("setup-card-s_bo")).toHaveCount(0);
    await lib.getByLabel("Bibliothek durchsuchen").fill("gibtesnicht");
    await expect(page.getByTestId("setup-library-empty")).toBeVisible();
    await lib.getByRole("button", { name: "Filter zurücksetzen" }).click();
    await expect(page.getByTestId("setup-card-s_bo")).toBeVisible();
    await lib.getByTestId("setup-compare-open").click();
    const cmp = page.getByTestId("setup-compare");
    await expect(cmp.getByTestId("setup-compare-column")).toHaveCount(2);
    await expect(cmp.getByTestId("setup-compare-verdict")).not.toBeEmpty();
    await cmp.getByRole("button", { name: /BSL\/EQL Liquidity Sweep/ }).click();
    await expect(cmp.getByTestId("setup-compare-column")).toHaveCount(3);
    await expectNoHorizontalScroll(page);
    await shot(page, info, "setup-compare", false);
    await page.keyboard.press("Escape");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "setups-page");
    expect(errors).toEqual([]);
  });
});
