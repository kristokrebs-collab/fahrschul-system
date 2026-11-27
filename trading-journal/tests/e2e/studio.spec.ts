/**
 * Strategie-Studio end to end on the routed page `/#studio` of the production build against the market mock with REAL BTCUSDT
 * bars (`boxes: true`, Binance `startTime` / `limit` paging – no network, no clock jumps):
 *
 * - a text is typed, "Verstehen" shows what was understood (own words marked), the questions and the assumptions, the backtest runs
 *   on the real candles and ends in the honest result card, "Als Entwurf speichern" makes v1 and survives a reload (`settings.studio`);
 * - two strategies side by side, "Alle testen" names how many were compared, shows the multiple-testing note and a ranked table
 *   (cards on a phone), and starts paper accounts for all after asking;
 * - no console errors, no horizontal scroll (mobile 390 px included).
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, scrollUntilVisible, seed, stored } from "./helpers";

const URL = process.env.PW_STUDIO_URL ?? "/#studio";
const PROJECTS = ["mobile", "desktop", "tablet-1280"];
const SHOTS = process.env.STUDIO_SHOTS_DIR;

const TEXT_1 = "Long, wenn der RSI unter 45 liegt und der Kurs über dem EMA 50 liegt, Stop 1,5 ATR, Ziel 2R";
const TEXT_2 = "Long, wenn der RSI unter 35 liegt, Stop 1,5 ATR, Ziel 2R";

interface StoredStudio {
  strategies?: { id: string; name: string; text: string; versions: { n: number; text: string }[]; live: unknown[] }[];
}
const studioOf = async (page: Page): Promise<NonNullable<StoredStudio["strategies"]>> => ((await stored<{ studio?: StoredStudio }>(page, "tj2-settings"))?.studio?.strategies ?? []) as NonNullable<StoredStudio["strategies"]>;

async function open(page: Page, info: TestInfo): Promise<string[]> {
  test.skip(!PROJECTS.includes(info.project.name), "Strategie-Studio runs on mobile + desktop + the 1280 px tablet");
  const errors = collectErrors(page);
  await seed(page, { boxes: true, extra: { "tj2-labor": { strategy: "custom", symbol: "BTCUSDT", period: "6m", funding: "none" } } });
  await openRoute(page, URL, "Strategie-Studio");
  return errors;
}

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.waitForTimeout(900);
  const width = info.project.use.viewport?.width ?? 0;
  if (width > 600) {
    await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: true });
    return;
  }
  // a phone page is very tall: readable slices instead of one thin strip
  const [w, h] = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.scrollHeight]);
  for (let i = 0, y = 0; y < h; i++, y += 1500) await page.screenshot({ path: `${SHOTS}/${name}-${width}-${i}.png`, fullPage: true, clip: { x: 0, y, width: w, height: Math.min(1500, h - y) } });
}

test.describe("Strategie-Studio", () => {
  test.setTimeout(180_000);

  test("Text schreiben, verstehen, Backtest, als Entwurf speichern – und nach dem Neuladen noch da", async ({ page }, info) => {
    const errors = await open(page, info);
    await expectNoHorizontalScroll(page);
    await expect(page.getByTestId("studio-list-empty")).toBeVisible();

    await page.getByTestId("studio-text").fill(TEXT_1);
    await page.getByTestId("studio-understand").click();
    const understood = page.getByTestId("studio-understood");
    await expect(understood).toBeVisible();
    await expect(understood.getByTestId("studio-understood-item")).toHaveCount(5);
    await expect(understood).toContainText("RSI unter 45 liegt");
    await expect(page.getByTestId("studio-unclear")).toContainText("Alles, was du geschrieben hast, ist einer Regel zugeordnet.");
    await expect(page.getByTestId("studio-assumptions")).toContainText("Zeitrahmen 4h");
    await expect(page.getByTestId("studio-rules")).toContainText("Bereit zum Prüfen");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "studio-1-verstanden");

    // the backtest on real candles
    await scrollUntilVisible(page, page.getByTestId("studio-run"));
    await page.getByTestId("studio-run").click();
    const result = page.getByTestId("studio-result");
    await expect(result).toBeVisible({ timeout: 90_000 });
    await expect(result.getByTestId("studio-kpis")).toContainText("Trefferquote");
    await expect(result.getByTestId("studio-kpis")).toContainText("Max. Drawdown");
    await expect(result.getByTestId("studio-sample")).toBeVisible();
    await expect(page.getByTestId("studio-backtest")).not.toContainText("Finanzberatung");
    await expect(page.getByTestId("studio-backtest")).toContainText("zeigt die Vergangenheit, keine Prognose");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "studio-2-backtest");

    // save as a draft: v1
    await page.getByTestId("studio-name").fill("RSI-Dip");
    await scrollUntilVisible(page, page.getByTestId("studio-save"));
    await page.getByTestId("studio-save").click();
    await expect.poll(async () => (await studioOf(page))[0]?.versions.map((v) => v.n), { timeout: 15_000 }).toEqual([1]);
    expect((await studioOf(page))[0]).toMatchObject({ name: "RSI-Dip", text: TEXT_1 });
    await scrollUntilVisible(page, page.getByTestId("studio-version-1"));
    await shot(page, info, "studio-3-version");

    // reload: the strategy is in the list, opened with its text
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Strategie-Studio" })).toBeVisible();
    await expect(page.getByTestId("studio-list").getByText("RSI-Dip")).toBeVisible();
    await expect(page.getByTestId("studio-text")).toHaveValue(TEXT_1);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("unklare Stellen und offene Fragen: nichts wird geraten, ein Antwort-Chip ergänzt die Regeln", async ({ page }, info) => {
    const errors = await open(page, info);
    // the sentence of the brief: six parts understood, nothing unclear
    await page.getByTestId("studio-example-rsi").click();
    await expect(page.getByTestId("studio-understood").getByTestId("studio-understood-item")).toHaveCount(6);
    await expect(page.getByTestId("studio-unclear")).toContainText("Alles, was du geschrieben hast, ist einer Regel zugeordnet.");
    await page.getByTestId("studio-example-vague").click();
    await expect(page.getByTestId("studio-unclear-item").first()).toBeVisible();
    await expect(page.getByTestId("studio-unclear")).toContainText("engem");
    const ask = page.getByTestId("studio-ask-op:long");
    await scrollUntilVisible(page, ask);
    await expect(ask).toHaveAttribute("data-state", "open");
    await ask.getByTestId("studio-answer-op:long-or-first").click();
    await expect(ask).toHaveAttribute("data-state", "answered");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "studio-4-unklar");
    expect(errors).toEqual([]);
  });

  test("zwei Strategien: Alle testen nennt die Zahl, warnt vor dem Mehrfachtest und rankt; dann Papierkonten für alle", async ({ page }, info) => {
    const errors = await open(page, info);
    // strategy 1
    await page.getByTestId("studio-text").fill(TEXT_1);
    await page.getByTestId("studio-name").fill("Eins");
    await page.getByTestId("studio-understand").click();
    await page.getByTestId("studio-save").click();
    await expect.poll(async () => (await studioOf(page)).length, { timeout: 15_000 }).toBe(1);
    // strategy 2
    await page.getByTestId("studio-new").click();
    await expect(page.getByTestId("studio-text")).toHaveValue("");
    await page.getByTestId("studio-text").fill(TEXT_2);
    await page.getByTestId("studio-name").fill("Zwei");
    await page.getByTestId("studio-understand").click();
    await page.getByTestId("studio-save").click();
    await expect.poll(async () => (await studioOf(page)).length, { timeout: 15_000 }).toBe(2);
    expect((await studioOf(page)).every((s) => s.versions.length === 1)).toBe(true);

    // tick both → the count and the warning are there BEFORE the run
    for (const s of await studioOf(page)) await page.getByTestId(`studio-pick-${s.id}`).click();
    await expect(page.getByTestId("studio-picked")).toHaveText("2 Strategien ausgewählt");
    await expect(page.getByTestId("studio-cmp-n")).toHaveText("2");
    await expect(page.getByTestId("studio-cmp-before")).toContainText("2 Strategien auf denselben Daten verglichen");
    await page.getByTestId("studio-compare-run").click();
    const res = page.getByTestId("studio-cmp-result");
    await expect(res).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("studio-cmp-n")).toHaveText("2");
    await expect(res.getByTestId("studio-cmp-multiple")).toContainText("Verglichene Strategien: 2");
    await expect(res.getByTestId("studio-cmp-window")).toContainText("Train/Test-Schnitt");
    // desktop: the table, phone: one card per strategy
    const rows = info.project.name === "mobile" ? res.locator('[data-testid^="studio-cmp-card-"]') : res.locator('[data-testid^="studio-cmp-row-"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, info, "studio-5-vergleich");

    // paper accounts for all ticked strategies – asked first, never an order
    await scrollUntilVisible(page, page.getByTestId("studio-live-all-start"));
    await page.getByTestId("studio-live-all-start").click();
    await expect(page.getByTestId("studio-live-all-confirm")).toContainText("Kein Echtgeld, keine Order.");
    await page.getByTestId("studio-live-all-yes").click();
    await expect.poll(async () => ((await stored<{ forward?: { accounts?: unknown[] } }>(page, "tj2-settings"))?.forward?.accounts ?? []).length, { timeout: 15_000 }).toBe(2);
    await expect.poll(async () => (await studioOf(page)).every((s) => s.live.length === 1)).toBe(true);
    expect(errors).toEqual([]);
  });
});
