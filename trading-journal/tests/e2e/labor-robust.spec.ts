/**
 * Labor › Lauf with a Binance that does not answer (the report: "Lade Kerzen 0 von 2 …" for ever, "Abbrechen" without effect).
 * The network is mocked per host: Binance-Futures' candle endpoint HANGS (the request stays open), the EU-proxy path answers
 * the SPA's HTML (as on a deploy without the rewrite), Bybit is refused, and Binance spot (`data-api.binance.vision`) serves the
 * same real bars of the box fixture.
 *
 * Covered: the hanging request ends at the app's time limit and the run continues on the fallback source – the RESULT names it
 * ("Quelle: Spot, nicht Futures", the note under it, the assumptions) and the Futures wording is not used; while waiting the card
 * says what is going on (never a silent "0 %"); "Abbrechen" ends the hung request at once; when every source fails the card names
 * the reason per source, offers "Erneut versuchen" (a 44 px target on touch screens) and the second try produces a Futures result.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { boxFixture } from "./mocks/boxFixture";

const PROJECTS = ["mobile", "desktop"];
const KLINES = (u: URL): boolean => u.origin === "https://fapi.binance.com" && u.pathname === "/fapi/v1/klines" && u.searchParams.has("startTime");
const cors = { "access-control-allow-origin": "*" };

async function open(page: Page, info: TestInfo): Promise<{ errors: string[]; spot: URL[] }> {
  test.skip(!PROJECTS.includes(info.project.name), "Labor runs on mobile + desktop");
  const errors = collectErrors(page);
  const spot: URL[] = [];
  await seed(page, { boxes: true, extra: { "tj2-labor": { strategy: "box", symbol: "BTCUSDT", period: "6m", boxTf: "4h" } } });
  const fix = boxFixture(Date.now());
  // Binance spot serves the same real bars (Binance paging: the first `limit` rows from `startTime`)
  await page.route("https://data-api.binance.vision/api/v3/klines**", (route) => {
    const u = new URL(route.request().url());
    spot.push(u);
    const n = (k: string): number | undefined => (u.searchParams.has(k) ? Number(u.searchParams.get(k)) : undefined);
    const rows = fix.rows(u.searchParams.get("interval") ?? "4h", { limit: n("limit"), startTime: n("startTime"), endTime: n("endTime") }, u.searchParams.get("symbol") ?? "BTCUSDT") ?? [];
    return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(rows) });
  });
  await page.route("https://api.bybit.com/**", (route) => route.abort("failed"));
  await openRoute(page, "/#labor", "Labor");
  return { errors, spot };
}

/** What Chrome logs for the requests the test itself refuses or lets hang. */
const expected = (e: string): boolean => /Failed to fetch|net::ERR_|fapi\.binance\.com|api\.bybit\.com|data-api\.binance\.vision|Unexpected token|is not valid JSON/.test(e);

test.describe("Labor · Binance antwortet nicht", () => {
  test.setTimeout(150_000);

  test("Futures hängt → nach dem Zeitlimit kommt die Ausweichquelle; das Ergebnis nennt sie", async ({ page }, info) => {
    const { errors, spot } = await open(page, info);
    await page.route(KLINES, () => {
      /* never answered: the connection hangs */
    });
    await page.getByTestId("labor-start").click();
    // while the first request hangs the card says what it waits for – not a silent 0 %
    const note = page.getByTestId("labor-load-note");
    await expect(note).toContainText("Frage Binance-Futures", { timeout: 8_000 });
    await expect(page.getByTestId("labor-busy").getByRole("progressbar")).toBeVisible();
    await expect(page.getByTestId("labor-busy")).toContainText(/Lade Kerzen 0 von \d+/);
    // … and after the 12-s limit it moves on to the next source and keeps saying why
    await expect(note).toContainText(/Neuer Versuch in \d+ s|vorher|Weiter mit/, { timeout: 30_000 });
    await expect(page.getByTestId("labor-run")).toHaveAttribute("data-status", "done", { timeout: 90_000 });
    // the source of the candles is named in one line, with the note under it
    await expect(page.getByTestId("labor-stand")).toContainText("Quelle: Spot, nicht Futures");
    const sourceNote = page.getByTestId("labor-source-note");
    await expect(sourceNote).toContainText("Binance-Futures war nicht erreichbar");
    await expect(sourceNote).toContainText("Binance-Futures: keine Antwort in 12 s");
    await expect(sourceNote).toContainText("Spot kennt kein Funding");
    // the assumptions stay true: no "von Binance-Futures" for spot candles
    const ass = page.getByTestId("labor-assumptions");
    await expect(ass).toContainText("von Binance Spot, nicht Futures");
    await expect(ass).not.toContainText(/Kerzen BTCUSDT von Binance-Futures/);
    expect(spot.length).toBeGreaterThan(0);
    expect(spot.every((u) => u.searchParams.get("symbol") === "BTCUSDT" && Number(u.searchParams.get("limit")) <= 1000)).toBe(true);
    // the run itself is a real result
    await expect(page.getByTestId("labor-equity").getByRole("img")).toBeVisible();
    await expect(page.getByTestId("labor-kpis")).toContainText("Trades");
    await expect(page.getByTestId("labor-compare").getByTestId("labor-run-card")).toContainText("Spot");
    await expectNoHorizontalScroll(page);
    expect(errors.filter((e) => !expected(e))).toEqual([]);
  });

  test("Abbrechen beendet den hängenden Abruf sofort", async ({ page }, info) => {
    const { errors } = await open(page, info);
    const aborted: string[] = [];
    page.on("requestfailed", (r) => {
      if (r.url().startsWith("https://fapi.binance.com/fapi/v1/klines") && r.url().includes("startTime")) aborted.push(r.failure()?.errorText ?? "");
    });
    await page.route(KLINES, () => {
      /* hangs */
    });
    await page.getByTestId("labor-start").click();
    await expect(page.getByTestId("labor-load-note")).toContainText("Frage Binance-Futures", { timeout: 8_000 });
    await page.waitForTimeout(1_200);
    await page.getByTestId("labor-cancel").click();
    // seconds before the 12-s limit would end the request: the cancel is what ends it
    await expect(page.getByTestId("labor-run")).toHaveAttribute("data-status", "cancelled", { timeout: 3_000 });
    await expect(page.getByTestId("labor-start")).toBeEnabled();
    // the request under way was cut off (ERR_ABORTED), it does not linger until the 12-s limit
    await expect.poll(() => aborted.length, { timeout: 3_000 }).toBeGreaterThan(0);
    await expect(page.getByTestId("labor-load-note")).toHaveCount(0);
    expect(errors.filter((e) => !expected(e))).toEqual([]);
  });

  test("alles fällt aus → klare Meldung mit Grund je Quelle und „Erneut versuchen“; der zweite Versuch läuft", async ({ page }, info) => {
    const { errors } = await open(page, info);
    const refuse = (route: { abort: (r: string) => Promise<void> }) => route.abort("failed");
    await page.route(KLINES, refuse);
    await page.route("https://data-api.binance.vision/api/v3/klines**", refuse);
    await page.route("**/api/v1/klines**", refuse);
    await page.getByTestId("labor-start").click();
    await expect(page.getByTestId("labor-run")).toHaveAttribute("data-status", "error", { timeout: 60_000 });
    const run = page.getByTestId("labor-run");
    await expect(run).toContainText("Binance ist gerade nicht erreichbar, auch die Ausweichquellen antworten nicht");
    const detail = page.getByTestId("labor-error-detail");
    await expect(detail).toContainText("Futures: nicht erreichbar");
    await expect(detail).toContainText("Spot: nicht erreichbar");
    await expect(page.getByTestId("labor-load-note")).toHaveCount(0); // no endless loading
    await expectNoHorizontalScroll(page);
    const retry = page.getByTestId("labor-retry");
    await expect(retry).toBeVisible();
    await expect(retry).toHaveText("Erneut versuchen");
    // the message and the button fit in the fixed stage (no clipped content, no layout jump)
    const fits = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="labor-run"] [data-testid="labor-retry"]')?.closest(".overflow-hidden") as HTMLElement | null;
      const btn = document.querySelector('[data-testid="labor-retry"]')?.getBoundingClientRect();
      const box = stage?.getBoundingClientRect();
      return !!btn && !!box && btn.top >= box.top - 1 && btn.bottom <= box.bottom + 1;
    });
    expect(fits).toBe(true);
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="labor-run"]' });
      expect(misses, JSON.stringify(misses)).toEqual([]);
    }
    // the network is back: futures candles again
    await page.unroute(KLINES);
    await retry.click();
    await expect(page.getByTestId("labor-run")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    await expect(page.getByTestId("labor-stand")).toContainText("Quelle: Binance USDⓈ-M");
    await expect(page.getByTestId("labor-source-note")).toHaveCount(0);
    await expect(page.getByTestId("labor-assumptions")).toContainText("von Binance-Futures");
    expect(errors.filter((e) => !expected(e))).toEqual([]);
  });
});
