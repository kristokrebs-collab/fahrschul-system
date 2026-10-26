/**
 * Aktien end to end on the routed page `/#aktien` of the production build, with the network mocked (`page.route`): the stock
 * functions answer from the specs, Binance from the market mock – nothing leaves the machine, no clock jumps.
 *
 * - Scanner (Tagesbalken): the directory, 6 charts → a flag and an oversold recovery are listed with their reason; a cheap
 *   chart and a listing with a bad status are skipped, an unknown ticker fails – and the summary counts exactly that, with the
 *   error rate; a chart preview opens; a hit goes to the watchlist and survives a reload;
 * - Scanner (Eröffnungsspanne): a breakout of the 15-minute range on 5-minute candles of a fixed past session;
 * - Krypto: the top-N list and the candles come from Binance;
 * - the honest failures: the server functions missing, the directory blocked (the reason is named, nothing is listed);
 * - cancel keeps what was found; the news: merged, rated by keyword, "Neu" since the last visit, marked read;
 * - no console errors and no horizontal scroll (390 px included); axe (WCAG 2.1 A + AA incl. contrast, dark and light) on the page WITH hits, an
 *   open chart preview, a watchlist row and a headline.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, seed, stored } from "./helpers";

const PROJECTS = ["mobile", "desktop"];
const SHOTS = process.env.AKTIEN_SHOTS_DIR;
const DAY = 86_400_000;
const MIN = 60_000;
const JSON_HEADERS = { "content-type": "application/json" };

/* ------------------------------------------------------------------ data builders */

/** `closes` as wire bars `[time, o, h, l, c, v]`, one per day, the last one the day before yesterday 14:30 UTC (a finished bar on any weekday, weekend or holiday: a day without a session counts as complete after 24 h). */
function dailyBars(closes: readonly number[], volume = 2_000_000): number[][] {
  const midnight = Math.floor(Date.now() / DAY) * DAY;
  return closes.map((c, i) => [midnight - (closes.length - i + 1) * DAY + 14.5 * 3_600_000, c, c * 1.002, c * 0.998, c, volume]);
}
const flat = (n: number, v: number): number[] => Array.from({ length: n }, () => v);
/** 24 flat closes, then a run from 80 to 90 over ten bars and a tight flag of five closes: +12.5 % and a 0.8 % range (40 bars). */
const FLAG_CLOSES = [...flat(24, 80), 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 90, 90.5, 89.8, 90.2, 90.1];
/** a fall with small bounces and an up-close at the end: the RSI was under 30 on the bar before */
const OVERSOLD_CLOSES = [...Array.from({ length: 39 }, (_, i) => 100 - i * 1.4 + (i % 4 === 0 ? 2.4 : 0)), 48.4];
const meta = (name: string, price: number) => ({ name, currency: "USD", exchange: "NasdaqGS", price, prevClose: price - 1, volume: 5_000_000, marketTime: Date.now() - 3_600_000 });

const DIRECTORY = [
  { symbol: "FLAG", name: "Flag Corp. - Common Stock", exchange: "NASDAQ", fin: "N" },
  { symbol: "OVRS", name: "Oversold Inc. Common Stock", exchange: "NYSE", fin: null },
  { symbol: "DULL", name: "Dull Holdings - Common Stock", exchange: "NASDAQ", fin: "N" },
  { symbol: "CHEAP", name: "Cheap Co. - Common Stock", exchange: "NASDAQ", fin: "N" },
  { symbol: "DEFI", name: "Deficient Ltd. - Common Stock", exchange: "NASDAQ", fin: "D" },
  { symbol: "NOPE", name: "Nope Corp. - Common Stock", exchange: "NASDAQ", fin: "N" },
];

const BARS: Record<string, { closes: number[]; vol?: number }> = {
  FLAG: { closes: FLAG_CLOSES },
  OVRS: { closes: OVERSOLD_CLOSES },
  DULL: { closes: flat(40, 50) },
  CHEAP: { closes: flat(40, 2) },
  DEFI: { closes: flat(40, 30) },
};

/** the 5-minute candles of Friday 2026-10-23 (a session that lies in the past): range 9:30–9:45, then the bar 10:05–10:10 breaks out for ORBA */
function sessionBars(breakout: boolean): number[][] {
  const open = Date.UTC(2026, 9, 23, 13, 30);
  const out: number[][] = [];
  for (let k = 0; k < 78; k++) {
    let c = 100 + (k % 3) * 0.1;
    if (breakout && k >= 7) c = 101.4 + (k % 2) * 0.1; // bar 7 (10:05) closes above the range high (100.4)
    out.push([open + k * 5 * MIN, c, c + 0.2, c - 0.2, c, 10_000]);
  }
  return out;
}

/* ------------------------------------------------------------------ mocks */

interface Mock {
  barCalls: string[];
  symbolCalls: number;
  newsCalls: string[];
}

async function mockStocks(page: Page, opts: { directory?: "ok" | "blocked" | "none"; delayMs?: number; extraBars?: Record<string, { closes: number[] }>; news?: (symbol: string) => unknown } = {}): Promise<Mock> {
  const mock: Mock = { barCalls: [], symbolCalls: 0, newsCalls: [] };
  const dir = opts.directory ?? "ok";
  if (dir === "none") return mock; // no function at all: the SPA answers with its page (what a static host does)
  await page.route(/\/api\/v1\/stocks\/symbols/, async (route: Route) => {
    mock.symbolCalls++;
    if (dir === "blocked") return route.fulfill({ status: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: { code: "stock_upstream_blocked", message: "Nasdaq Trader verweigert den Abruf (HTTP 403)." } }) });
    const counts = { rows: 40, kept: DIRECTORY.length, dropped: { ETFs: 20, Warrants: 10 } };
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ source: "nasdaqtrader", fileTime: Date.UTC(2026, 9, 24, 1, 31), fetchedAt: Date.now(), counts, symbols: DIRECTORY.map((e) => [e.symbol, e.name, e.exchange, e.fin]) }) });
  });
  await page.route(/\/api\/v1\/stocks\/bars/, async (route: Route) => {
    const u = new URL(route.request().url());
    const interval = u.searchParams.get("interval") ?? "1d";
    const symbols = (u.searchParams.get("symbols") ?? "").split(",").filter(Boolean);
    mock.barCalls.push(`${interval}:${symbols.join(",")}`);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const results: Record<string, unknown> = {};
    for (const s of symbols) {
      if (interval === "5m") {
        results[s] = s.startsWith("ORB") ? { ok: true, bars: sessionBars(s === "ORBA"), meta: meta(s, 101) } : { ok: false, reason: "bad-symbol", message: "Yahoo Finance kennt dieses Kürzel nicht." };
        continue;
      }
      const b = BARS[s] ?? opts.extraBars?.[s];
      results[s] = b ? { ok: true, bars: dailyBars(b.closes), meta: meta(s, b.closes[b.closes.length - 1]!) } : { ok: false, reason: "bad-symbol", message: "Yahoo Finance kennt dieses Kürzel nicht." };
    }
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ source: "yahoo", interval, range: u.searchParams.get("range"), fetchedAt: Date.now(), results }) });
  });
  await page.route(/\/api\/v1\/stocks\/quote/, async (route: Route) => {
    const symbols = (new URL(route.request().url()).searchParams.get("symbols") ?? "").split(",").filter(Boolean);
    const results = Object.fromEntries(
      symbols.map((s) => [s, { ok: true, name: `${s} Corp.`, currency: "USD", exchange: "NasdaqGS", price: 123.45, prevClose: 120, change: 3.45, changePct: 2.875, dayHigh: 124, dayLow: 119, volume: 1000, fiftyTwoWeekHigh: 130, fiftyTwoWeekLow: 90, marketTime: Date.now() - 3_600_000 }]),
    );
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ source: "yahoo", fetchedAt: Date.now(), results }) });
  });
  await page.route(/\/api\/v1\/stocks\/news/, async (route: Route) => {
    const symbols = (new URL(route.request().url()).searchParams.get("symbols") ?? "").split(",").filter(Boolean);
    mock.newsCalls.push(symbols.join(","));
    const results = Object.fromEntries(symbols.map((s) => [s, opts.news ? opts.news(s) : { ok: true, items: [] }]));
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ source: "yahoo-rss", fetchedAt: Date.now(), results }) });
  });
  return mock;
}

async function open(page: Page, info: TestInfo, extra: Record<string, unknown> = {}): Promise<string[]> {
  test.skip(!PROJECTS.includes(info.project.name), "Aktien runs on mobile + desktop");
  const errors = collectErrors(page);
  await seed(page, { extra });
  return errors;
}

async function go(page: Page): Promise<void> {
  await openRoute(page, "/#aktien", "Aktien");
  await expect(page.getByTestId("aktien-scanner")).toBeVisible();
}

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  if (!SHOTS) return;
  // the cards reveal when they come into view: walk the page once, then back to the top
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total + 800; y += 500) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(900);
  const width = info.project.use.viewport?.width ?? 0;
  const [w, h] = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.scrollHeight]);
  if (width > 600) {
    await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: true });
    return;
  }
  for (let i = 0, y = 0; y < h; i++, y += 1500) await page.screenshot({ path: `${SHOTS}/${name}-${width}-${i}.png`, fullPage: true, clip: { x: 0, y, width: w, height: Math.min(1500, h - y) } });
}

const count = async (page: Page, id: string): Promise<number> => Number((await page.getByTestId(id).locator("dd").first().innerText()).replace(/\D/g, ""));

/* ------------------------------------------------------------------ specs */

test.describe("Aktien", () => {
  test.setTimeout(120_000);

  test("Scanner mit Tagesbalken: Treffer mit Begründung, übersprungene und fehlgeschlagene Charts gezählt, Chart-Vorschau, Watchlist", async ({ page }, info) => {
    const errors = await open(page, info);
    const mock = await mockStocks(page);
    await go(page);
    await expectNoHorizontalScroll(page);
    // before the first scan: nothing is listed, and it says so
    await expect(page.getByTestId("aktien-results-idle")).toBeVisible();
    await expect(page.getByTestId("aktien-hit")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Inhalt dieser Seite" })).toBeVisible();

    await page.getByTestId("aktien-start").click();
    await expect(page.getByTestId("aktien-summary")).toBeVisible({ timeout: 30_000 });
    // 6 charts asked for: FLAG, OVRS, DULL scanned · CHEAP (price) and DEFI (status) skipped · NOPE failed (unknown ticker)
    await expect.poll(() => count(page, "aktien-n-requested")).toBe(6);
    expect(await count(page, "aktien-n-scanned")).toBe(3);
    expect(await count(page, "aktien-n-skipped")).toBe(2);
    expect(await count(page, "aktien-n-failed")).toBe(1);
    expect(await count(page, "aktien-n-hits")).toBe(2);
    await expect(page.getByTestId("aktien-n-failed")).toContainText("Fehlerquote 16,7 %");
    await expect(page.getByTestId("aktien-skipped-by")).toContainText("Kurs unter dem Mindestpreis");
    await expect(page.getByTestId("aktien-skipped-by")).toContainText("Nasdaq-Finanzstatus nicht normal");
    await expect(page.getByTestId("aktien-failed-by")).toContainText("Kürzel unbekannt");
    await expect(page.getByTestId("aktien-sample")).toContainText("Block 1 von 1 des Verzeichnisses");
    await expect(page.getByTestId("aktien-universe-stand")).toContainText("Nasdaq Trader Symbolverzeichnis");
    expect(mock.symbolCalls).toBe(1);

    // the two hits, each with its reason, its stand and its rank
    const hits = page.getByTestId("aktien-hit");
    await expect(hits).toHaveCount(2);
    const flag = page.locator('[data-testid="aktien-hit"][data-symbol="FLAG"]');
    await expect(flag).toHaveAttribute("data-setup", "flag");
    await expect(flag.getByTestId("aktien-why")).toContainText("Erst +12,5 % in 10 Tagen (80,00 → 90,00), dann 5 Schlusskurse in einer Spanne von nur 0,8 %.");
    await expect(flag.getByTestId("aktien-hit-stand")).toContainText("Quelle: Yahoo Finance (inoffiziell)");
    await expect(flag.getByTestId("aktien-hit-stand")).toContainText("letzte Kerze");
    const ovrs = page.locator('[data-testid="aktien-hit"][data-symbol="OVRS"]');
    await expect(ovrs).toHaveAttribute("data-setup", "rsi");
    await expect(ovrs.getByTestId("aktien-why")).toContainText("RSI(14) lag zuvor bei");
    await expect(page.getByTestId("aktien-rank")).toHaveText(["1", "2"]);
    // a result card ends with the sentence
    await expect(page.getByTestId("aktien-results").getByTestId("aktien-note")).toContainText("Keine professionelle Finanzberatung.");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "aktien-1-scanner");

    // the chart preview shows what the rule read
    await flag.getByTestId("aktien-hit-chart").click();
    const detail = flag.getByTestId("aktien-hit-detail");
    await expect(detail.getByTestId("aktien-minichart")).toBeVisible();
    await expect(detail).toContainText("Geprüfte Bedingungen");
    await expect(detail).toContainText("Schwelle: mehr als 10,0 %");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "aktien-2-chart");

    // to the watchlist, and it is still there after a reload
    await flag.getByTestId("aktien-hit-watch").click();
    await expect(flag.getByTestId("aktien-hit-watch")).toHaveText("Auf der Watchlist");
    const row = page.locator('[data-testid="aktien-watch-row"][data-symbol="FLAG"]');
    await expect(row).toBeVisible();
    await expect(row.getByTestId("aktien-watch-quote")).toContainText("123,45");
    await expect(row.getByTestId("aktien-watch-quote")).toContainText("+2,88 %");
    await expect(page.getByTestId("aktien-watch-stand")).toContainText("Quelle: Yahoo Finance (inoffiziell)");
    await expect.poll(async () => ((await stored<{ watchlist?: { items?: { id: string }[] } }>(page, "tj2-settings"))?.watchlist?.items ?? []).map((i) => i.id)).toEqual(["stock:FLAG"]);
    await page.reload();
    await expect(page.getByTestId("aktien-scanner")).toBeVisible();
    await expect(page.locator('[data-testid="aktien-watch-row"][data-symbol="FLAG"]')).toBeVisible();
    await expectNoHorizontalScroll(page);

    // an unknown ticker is refused with a reason, a duplicate too; remove works
    await page.getByTestId("aktien-watch-input").fill("FLAG");
    await page.getByTestId("aktien-watch-add").click();
    await expect(page.getByTestId("aktien-watch-msg")).toHaveText("Steht schon auf der Watchlist.");
    await page.getByTestId("aktien-watch-input").fill("12 34");
    await page.getByTestId("aktien-watch-add").click();
    await expect(page.getByTestId("aktien-watch-msg")).toHaveText("Das ist kein gültiges Kürzel.");
    await page.locator('[data-testid="aktien-watch-row"][data-symbol="FLAG"]').getByTestId("aktien-watch-remove").click();
    await expect(page.getByTestId("aktien-watch-empty")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Thresholds are visible and change the result: a looser flag rule lists one more chart", async ({ page }, info) => {
    const errors = await open(page, info);
    await mockStocks(page);
    await go(page);
    await page.getByTestId("aktien-rules-toggle").click();
    const rule = page.getByTestId("aktien-rule-flag");
    await expect(rule).toContainText("um mehr als 10,0 % gestiegen");
    await expect(rule).toContainText("unter 5,0 %");
    await expect(page.getByTestId("aktien-rule-orb")).toHaveCount(0); // only the rules of the chosen setups
    await expectNoHorizontalScroll(page);
    // 99 % of the run threshold: nothing qualifies any more
    const gain = rule.getByLabel("mehr als");
    await gain.fill("40");
    await gain.blur();
    await expect(rule).toContainText("um mehr als 40,0 % gestiegen");
    await page.getByTestId("aktien-start").click();
    await expect(page.getByTestId("aktien-summary")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("aktien-n-hits").locator("dd").first()).toHaveText("1"); // only the RSI recovery is left
    await expect(page.locator('[data-testid="aktien-hit"][data-symbol="FLAG"]')).toHaveCount(0);
    // reset brings the default back
    await page.getByTestId("aktien-rules-reset").click();
    await expect(rule).toContainText("um mehr als 10,0 % gestiegen");
    expect(errors).toEqual([]);
  });

  test("Eröffnungsspanne: der Ausbruch der ersten 15 Minuten auf 5-Minuten-Kerzen einer vergangenen Sitzung", async ({ page }, info) => {
    const errors = await open(page, info);
    await mockStocks(page);
    await go(page);
    await page.getByRole("radio", { name: "Eröffnungsspanne" }).click();
    await page.getByRole("radio", { name: "Eigene Liste" }).click();
    await page.getByTestId("aktien-custom").fill("ORBA, ORBB");
    await page.getByTestId("aktien-start").click();
    await expect(page.getByTestId("aktien-summary")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => count(page, "aktien-n-requested")).toBe(2);
    expect(await count(page, "aktien-n-scanned")).toBe(2); // ORBB is read too – its range never broke
    expect(await count(page, "aktien-n-failed")).toBe(0);
    expect(await count(page, "aktien-n-hits")).toBe(1);
    await expect(page.locator('[data-testid="aktien-hit"][data-symbol="ORBB"]')).toHaveCount(0);
    const hit = page.locator('[data-testid="aktien-hit"][data-symbol="ORBA"]');
    await expect(hit).toHaveAttribute("data-setup", "orb");
    // the bar from 10:05 to 10:10 is the first one that closes above the range high
    await expect(hit.getByTestId("aktien-why")).toContainText("Schloss um 10:10 NY");
    await expect(hit.getByTestId("aktien-why")).toContainText("über dem Spannenhoch 100,40");
    await expect(page.getByTestId("aktien-session")).toBeVisible();
    await hit.getByTestId("aktien-hit-chart").click();
    await expect(hit.getByTestId("aktien-minichart")).toBeVisible();
    await expect(hit.getByTestId("aktien-hit-detail")).toContainText("Eröffnungsspanne 09:30–09:45 NY");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "aktien-3-orb");
    expect(errors).toEqual([]);
  });

  test("Krypto: Top-N nach Umsatz und die Kerzen kommen von Binance", async ({ page }, info) => {
    const errors = await open(page, info);
    await mockStocks(page, { directory: "none" });
    const ticker = (symbol: string, qv: number) => ({ symbol, priceChangePercent: "1.5", lastPrice: "50", highPrice: "55", lowPrice: "45", volume: "10", quoteVolume: String(qv), closeTime: Date.now() });
    await page.route("https://fapi.binance.com/fapi/v1/ticker/24hr*", (route) => route.fulfill({ status: 200, headers: { ...JSON_HEADERS, "access-control-allow-origin": "*" }, body: JSON.stringify([ticker("BTCUSDT", 9e9), ticker("ETHUSDT", 5e9), ticker("SOLUSDT", 3e9), ticker("DOGEUSDT", 1e9), ticker("BTCUSDT_250627", 8e9)]) }));
    const klines: string[] = [];
    await page.route("https://fapi.binance.com/fapi/v1/klines*", (route) => {
      const u = new URL(route.request().url());
      if (u.searchParams.get("limit") !== "99") return route.fallback(); // the app's own live feeds
      klines.push(u.searchParams.get("symbol") ?? "");
      const midnight = Math.floor(Date.now() / DAY) * DAY;
      const rows = OVERSOLD_CLOSES.map((c, i) => {
        const t = midnight - (OVERSOLD_CLOSES.length - i) * DAY;
        return [t, String(c), String(c + 1), String(c - 1), String(c), "100", t + DAY - 1, "5000", 10, "50", "2500", "0"];
      });
      return route.fulfill({ status: 200, headers: { ...JSON_HEADERS, "access-control-allow-origin": "*" }, body: JSON.stringify(rows) });
    });
    await go(page);
    await page.getByTestId("aktien-scanner").getByRole("radio", { name: "Krypto" }).click();
    await page.getByTestId("aktien-setup-flag").click(); // RSI recovery only
    await page.getByTestId("aktien-start").click();
    await expect(page.getByTestId("aktien-summary")).toBeVisible({ timeout: 30_000 });
    // the four USDT perpetuals of the ticker list (the delivery contract is left out), highest turnover first
    await expect.poll(() => count(page, "aktien-n-requested")).toBe(4);
    expect(klines.sort()).toEqual(["BTCUSDT", "DOGEUSDT", "ETHUSDT", "SOLUSDT"]);
    await expect(page.getByTestId("aktien-sample")).toContainText("Die 4 USDT-Perpetuals mit dem höchsten 24-h-Umsatz (Binance, gewünscht waren 30)");
    await expect(page.getByTestId("aktien-universe-stand")).toContainText("Quelle: Binance");
    const hit = page.locator('[data-testid="aktien-hit"][data-symbol="BTCUSDT"]');
    await expect(hit).toHaveAttribute("data-setup", "rsi");
    await expect(hit.getByTestId("aktien-hit-stand")).toContainText("Binance");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("Ehrlicher Leerzustand: ohne Server-Funktionen steht der Grund da, nichts wird erfunden – und Krypto bleibt möglich", async ({ page }, info) => {
    const errors = await open(page, info);
    await mockStocks(page, { directory: "none" });
    await go(page);
    await page.getByTestId("aktien-start").click();
    const box = page.getByTestId("aktien-error");
    await expect(box).toBeVisible({ timeout: 30_000 });
    await expect(box).toHaveAttribute("data-reason", "no-server");
    await expect(box).toContainText("Kein Scan möglich");
    await expect(box).toContainText("Die Server-Funktionen für Aktien-Daten sind auf dieser Seite nicht eingerichtet.");
    await expect(box).toContainText("Der Krypto-Scan läuft trotzdem");
    await expect(page.getByTestId("aktien-hit")).toHaveCount(0);
    await expect(page.getByTestId("aktien-summary")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, info, "aktien-4-leer");
    expect(errors).toEqual([]);
  });

  test("Ein gesperrtes Symbolverzeichnis wird mit Grund gemeldet, nicht überspielt", async ({ page }, info) => {
    const errors = await open(page, info);
    await mockStocks(page, { directory: "blocked" });
    await go(page);
    await page.getByTestId("aktien-start").click();
    const box = page.getByTestId("aktien-error");
    await expect(box).toBeVisible({ timeout: 30_000 });
    await expect(box).toHaveAttribute("data-reason", "blocked");
    await expect(box).toContainText("Nasdaq Trader verweigert den Abruf (HTTP 403).");
    await expect(box).toContainText("Es werden keine Ersatzdaten erfunden.");
    await expect(page.getByTestId("aktien-results")).toContainText("Es gibt keine Treffer, weil der Scan nicht laufen konnte");
    expect(errors).toEqual([]);
  });

  test("Abbrechen hält an und behält, was gefunden wurde", async ({ page }, info) => {
    const errors = await open(page, info);
    // 40 charts in batches of 16 (two requests each), every answer takes a moment
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`S${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`, { closes: FLAG_CLOSES }]));
    await mockStocks(page, { delayMs: 1500, extraBars: many });
    await go(page);
    await page.getByRole("radio", { name: "Eigene Liste" }).click();
    await page.getByTestId("aktien-custom").fill(Object.keys(many).join(" "));
    await page.getByTestId("aktien-start").click();
    // wait until the first batch of 16 is through (the progress counts what was decided), then stop
    await expect(page.getByTestId("aktien-progress")).toContainText(/\b(16|32) von 40 Charts/, { timeout: 30_000 });
    await page.getByTestId("aktien-abort").click();
    await expect(page.getByTestId("aktien-aborted")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("aktien-aborted")).toContainText("von 40 Charts");
    const done = await count(page, "aktien-n-scanned");
    expect(done).toBeGreaterThanOrEqual(16);
    expect(done).toBeLessThan(40);
    await expect(page.getByTestId("aktien-hit")).toHaveCount(done); // every scanned chart is a flag in this mock
    await expect(page.getByTestId("aktien-start")).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test("News: zusammengefasst, nach Stichwörtern gewichtet, „Neu“ seit dem letzten Besuch, als gelesen markieren", async ({ page }, info) => {
    const now = Date.now();
    const item = (id: string, title: string, ageMin: number, host = "finance.yahoo.com") => ({ id, title, url: `https://${host}/${id}`, publisher: host, publishedAt: now - ageMin * MIN, summary: null });
    const errors = await open(page, info, { "tj2-aktien-news-seen": { lastVisit: now - 120 * MIN } });
    const mock = await mockStocks(page, {
      news: (s) =>
        s === "TSLA"
          ? { ok: true, items: [item("a", "Tesla files for Chapter 11 bankruptcy protection", 30), item("b", "Analyst upgrades Tesla, raises price target", 90, "marketwatch.com"), item("c", "Tesla opens a new store in Berlin", 200), item("old", "Tesla news from last month", 10 * 24 * 60)] }
          : { ok: true, items: [item("a", "Tesla files for Chapter 11 bankruptcy protection", 30), item("d", "Nvidia earnings: revenue tops forecasts", 60)] },
    });
    await go(page);
    // the news section asks for stocks only: first an empty watchlist says what is missing
    await expect(page.getByTestId("aktien-news-empty")).toBeVisible();
    for (const s of ["TSLA", "NVDA"]) {
      await page.getByTestId("aktien-watch-input").fill(s.toLowerCase());
      await page.getByTestId("aktien-watch-add").click();
      await expect(page.locator(`[data-testid="aktien-watch-row"][data-symbol="${s}"]`)).toBeVisible();
    }
    const stories = page.getByTestId("aktien-story");
    await expect(stories).toHaveCount(4, { timeout: 30_000 }); // 4 stories: the old one (10 days) is outside the 3-day window, the shared one is merged
    // TSLA was read when it was added; adding NVDA asked only for NVDA (TSLA's headlines were still fresh in the cache)
    expect(mock.newsCalls).toEqual(["TSLA", "NVDA"]);
    // most important first: the bankruptcy headline carries both tickers and its keyword
    const first = stories.first();
    await expect(first).toHaveAttribute("data-level", "high");
    await expect(first).toContainText("Chapter 11");
    await expect(first.getByTestId("aktien-story-words")).toContainText("Stichwörter: Chapter 11");
    await expect(first).toContainText("TSLA");
    await expect(first).toContainText("NVDA");
    await expect(first.getByTestId("aktien-story-link")).toHaveAttribute("rel", "noopener noreferrer");
    // new since the last visit (2 h ago): the 30-, 60- and 90-minute-old stories; the 200-minute one is not
    await expect(page.locator('[data-testid="aktien-story"][data-new="1"]')).toHaveCount(3);
    await expect(page.getByTestId("aktien-news-visit")).toContainText("3 Meldungen neu seit dem letzten Besuch");
    await expect(page.getByTestId("aktien-news-stand")).toContainText("Quelle: Yahoo Finance");
    await expect(page.getByTestId("aktien-news").getByTestId("aktien-note")).toContainText("Keine professionelle Finanzberatung.");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "aktien-5-news");
    // the filters: only the new ones, only the important ones
    await page.getByRole("radio", { name: "Wichtige" }).click();
    await expect(stories).toHaveCount(2); // the bankruptcy and the earnings headline
    await page.getByRole("radio", { name: "Alle" }).click();
    // read: nothing is new any more
    await page.getByTestId("aktien-news-markread").click();
    await expect(page.locator('[data-testid="aktien-story"][data-new="1"]')).toHaveCount(0);
    await expect(page.getByTestId("aktien-news-visit")).toContainText("Nichts Neues seit dem letzten Besuch");
    expect(errors).toEqual([]);
  });

  test("Layout: Abschnitte, Platzhalter für die Analyse, keine Seite breiter als der Bildschirm", async ({ page }, info) => {
    const errors = await open(page, info);
    await mockStocks(page);
    await go(page);
    const nav = page.getByRole("navigation", { name: "Inhalt dieser Seite" });
    await expect(nav.getByRole("button")).toHaveText(["Scanner", "Watchlist", "News", "Analyse", "Kongress"]);
    for (const id of ["analyst-panel", "dcf-panel", "thesis-panel"]) await expect(page.getByTestId("aktien-analyse").getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("aktien-kongress")).toContainText("Kommt gleich");
    await expect(page.locator("#aktien-watchlist-h")).toHaveText("Watchlist");
    await expect(page.getByTestId("aktien-watchlist")).toContainText("0 / 50");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "aktien-0-seite");
    expect(errors).toEqual([]);
  });

  // the self check (selbstpruefung.spec) audits the empty page; this audits the page WITH hits, an open preview, a watchlist row and headlines
  for (const theme of ["dark", "light"] as const) {
    test(`Barrierefreiheit mit Treffern, Vorschau, Watchlist und Meldungen (axe, ${theme === "dark" ? "dunkles" : "helles"} Thema)`, async ({ page }, info) => {
      const now = Date.now();
      const errors = await open(page, info, { "tj2-theme": JSON.stringify(theme) });
      await mockStocks(page, { news: () => ({ ok: true, items: [{ id: "n1", title: "Flag Corp. files for Chapter 11 bankruptcy protection", url: "https://finance.yahoo.com/n1", publisher: "finance.yahoo.com", publishedAt: now - 30 * MIN, summary: null }] }) });
      await go(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByTestId("aktien-start").click();
      await expect(page.getByTestId("aktien-summary")).toBeVisible({ timeout: 30_000 });
      const flag = page.locator('[data-testid="aktien-hit"][data-symbol="FLAG"]');
      await flag.getByTestId("aktien-hit-chart").click();
      await expect(flag.getByTestId("aktien-minichart")).toBeVisible();
      await flag.getByTestId("aktien-hit-watch").click();
      await expect(page.locator('[data-testid="aktien-watch-row"][data-symbol="FLAG"]').getByTestId("aktien-watch-quote")).toContainText("123,45");
      await expect(page.getByTestId("aktien-story")).toHaveCount(1, { timeout: 30_000 });
      // the cards reveal when they come into view: walk the page once so nothing is audited half-faded
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < total + 800; y += 500) {
        await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
        await page.waitForTimeout(60);
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForTimeout(1200);
      const res = await new AxeBuilder({ page }).include('[data-page="aktien"][data-page-role="current"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      expect(lines, `aktien ${theme}: axe`).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
});
