/**
 * Screenshot-Import ohne Schlüssel, ohne Server: the text recognition runs IN THE BROWSER on a real Bitunix screenshot
 * (`tests/fixtures/ocr/bitunix-positionshistorie-1.jpg`: Positionshistorie, three cards, the third cut off at the bottom).
 * No network except the app's own self-hosted OCR files (`/ocr/<version>/…`); no clock jumps – the waits are on the end
 * state (the first read loads the engine and can take a while on a loaded machine).
 *
 * Walks: „Screenshot importieren“ on the trades page → choose the picture → read → PREVIEW (2 trades, the cut-off card is
 * reported as incomplete and not offered) → fields incl. the derived fees → „Alle 2 Trades eintragen“ → the trades are in the
 * journal at once, the toast offers „Rückgängig“ → undo removes exactly them. Mobile + desktop.
 */
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { collectErrors, expectNoHorizontalScroll, openRoute, seed } from "./helpers";

const PROJECTS = ["mobile", "desktop"];
const IMAGE = fileURLToPath(new URL("../fixtures/ocr/bitunix-positionshistorie-1.jpg", import.meta.url));
const SHOTS = process.env.OCR_SHOTS;

type Journal = { __tjJournal: { getState(): { trades: { id: string; pair: string; side: string; entry: number | null; exit: number | null; qty?: number | null; pnl: number | null; leverage: number | null; date: string; exitDate?: string; tags?: string[]; fees: number | null; pnlManual: number | null }[] } } };
const trades = (page: Page) => page.evaluate(() => (window as unknown as Journal).__tjJournal.getState().trades);

test.describe("Screenshot-Import mit Texterkennung im Browser", () => {
  test.beforeEach(async ({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop only");
  });

  test("Bild → Vorschau (2 Trades + 1 unvollständige Karte) → eintragen → Rückgängig", async ({ page }, info) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await seed(page, { empty: true });
    await openRoute(page, "/#trades", "Alle Trades");
    await expect(page.getByTestId("trades-shot-import")).toBeVisible();
    expect(await trades(page)).toHaveLength(0);

    await page.getByTestId("trades-shot-import").click();
    const sheet = page.getByTestId("ocr-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "pick");
    await expect(page.getByTestId("ocr-drop")).toBeVisible();
    // honest from the first screen: local, can be wrong
    await expect(page.getByRole("dialog")).toContainText("läuft nur auf deinem Gerät und kann sich vertun");

    await page.getByTestId("ocr-file").setInputFiles(IMAGE);
    await expect(page.getByTestId("ocr-picture")).toHaveCount(1);
    await page.getByTestId("ocr-read").click();
    await expect(page.getByTestId("ocr-busy")).toBeVisible();

    await expect(sheet).toHaveAttribute("data-phase", "preview", { timeout: 180_000 });
    await expect(page.getByTestId("ocr-summary")).toContainText("2 Trades erkannt");
    await expect(page.getByTestId("ocr-summary")).toContainText("1 Karte unvollständig");
    // the cut-off third card is reported, never offered
    await expect(page.getByTestId("ocr-incomplete")).toContainText("abgeschnitten");
    await expect(page.getByTestId("ocr-incomplete")).toContainText("nächsten Ausschnitt");
    await expect(page.getByTestId("ocr-incomplete")).toContainText("13×");
    await expect(page.getByTestId("ocr-trade")).toHaveCount(2);
    await expect(page.getByTestId("ocr-zone-text")).toContainText("Der Screenshot nennt keine Zeitzone – angenommen: Europe/Berlin");

    const [first, second] = [page.getByTestId("ocr-trade").nth(0), page.getByTestId("ocr-trade").nth(1)];
    await expect(first).toContainText("BTC/USDT · Long · 5×");
    await expect(first.getByTestId("ocr-cell-qty")).toContainText("0,0224");
    await expect(first.getByTestId("ocr-cell-entry")).toContainText("81.214,3");
    await expect(first.getByTestId("ocr-cell-exit")).toContainText("80.658");
    await expect(first.getByTestId("ocr-cell-pnl")).toContainText("-14,66565175");
    await expect(first.getByTestId("ocr-cell-date")).toContainText("22.10.2026 17:07:22");
    await expect(first.getByTestId("ocr-cell-exitDate")).toContainText("24.10.2026 15:44:24");
    // fees are DERIVED (prices × quantity − result) and say so
    await expect(first.getByTestId("ocr-cell-fees")).toContainText("abgeleitet");
    await expect(first.getByTestId("ocr-crop")).toBeVisible();
    await expect(second).toContainText("BTC/USDT · Long · 8×");
    await expect(second.getByTestId("ocr-cell-entry")).toContainText("81.724,5");
    await expect(second.getByTestId("ocr-cell-pnl")).toContainText("-3,61625864");
    await expectNoHorizontalScroll(page);
    if (SHOTS) {
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/ocr-preview-${info.project.name}.png`, animations: "disabled" });
    }

    // nothing is written before the button
    expect(await trades(page)).toHaveLength(0);
    const commit = page.getByTestId("ocr-commit");
    await expect(commit).toHaveText("Alle 2 Trades eintragen");
    await commit.click();

    // the trades are in the journal at once (the page behind the sheet), the toast offers the undo
    await expect.poll(async () => (await trades(page)).length).toBe(2);
    const saved = await trades(page);
    const long5 = saved.find((t) => t.leverage === 5)!;
    expect(long5).toMatchObject({ pair: "BTC/USDT", side: "long", entry: 81214.3, exit: 80658, qty: 0.0224, pnlManual: -14.66565175, date: "2026-10-22T17:07" });
    expect(long5.exitDate).toBe("2026-10-24T15:44:24");
    expect(long5.tags).toContain("Screenshot-Import");
    expect(long5.fees).toBeGreaterThan(2.2);
    expect(long5.fees).toBeLessThan(2.21);
    await expect(page.getByTestId("ocr-sheet")).toHaveCount(0);
    await expect(page.locator("[data-toast-island]")).toContainText("2 Trades eingetragen");
    await expect(page.getByTestId("trades-shot-import")).toBeVisible();
    if (SHOTS) {
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${SHOTS}/ocr-written-${info.project.name}.png`, animations: "disabled" });
    }

    await page.getByTestId("toast-action").click();
    await expect.poll(async () => (await trades(page)).length).toBe(0);
    // an imported history is not a „just saved“ trade: no coach / risk toast follows it
    await expect(page.locator("[data-toast-island]")).toContainText("2 Trades wieder entfernt");
    await expect(page.locator("[data-toast-island]")).not.toContainText("Coach");
    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  });

  test("ein zweites Mal dasselbe Bild: beide Trades sind als Duplikate erkannt und abgewählt", async ({ page }) => {
    test.setTimeout(240_000);
    await seed(page, { empty: true });
    await openRoute(page, "/#trades", "Alle Trades");
    const read = async () => {
      await page.getByTestId("trades-shot-import").click();
      await page.getByTestId("ocr-file").setInputFiles(IMAGE);
      await page.getByTestId("ocr-read").click();
      await expect(page.getByTestId("ocr-sheet")).toHaveAttribute("data-phase", "preview", { timeout: 180_000 });
    };
    await read();
    await page.getByTestId("ocr-commit").click();
    await expect.poll(async () => (await trades(page)).length).toBe(2);
    await expect(page.getByTestId("ocr-sheet")).toHaveCount(0);

    await read();
    await expect(page.getByTestId("ocr-trade")).toHaveCount(2);
    for (const i of [0, 1]) {
      await expect(page.getByTestId("ocr-trade").nth(i)).toHaveAttribute("data-taken", "0");
      await expect(page.getByTestId("ocr-trade").nth(i)).toContainText("Schon vorhanden");
    }
    await expect(page.getByTestId("ocr-commit")).toBeDisabled();
    await expect(page.getByTestId("ocr-commit")).toHaveText("Keinen Trade ausgewählt");
    // choosing one anyway is possible (the trader decides)
    await page.getByTestId("ocr-trade").nth(0).getByTestId("ocr-take").click();
    await expect(page.getByTestId("ocr-commit")).toHaveText("Trade eintragen");
  });
});
