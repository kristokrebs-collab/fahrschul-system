/**
 * „Aus Screenshot übernehmen“ in „Trade eintragen“ WITHOUT the model (standard build: no cloud, no key): the button is there
 * as soon as a screenshot is attached, says that it reads on this device, and the text recognition IN THE BROWSER reads the
 * user's real Bitget screenshot (`tests/fixtures/ocr/bitget-positionshistorie-1.jpg`: Positionshistorie, TRUMPUSDT Short
 * isoliert 15×, SOLUSDT Long Cross 2×, a cut-off BTCUSDT card). Two trades → the short choice list (the BTC card is named,
 * never offered) → pick TRUMP → the open form shows its values, every taken field marked, nothing saved before „Speichern“.
 * Then „Alle übernehmen“ writes the other trade through the import's commit (undo offered). Mobile + desktop.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { collectErrors, expectNoHorizontalScroll, seed } from "./helpers";

const PROJECTS = ["mobile", "desktop"];
const IMAGE = fileURLToPath(new URL("../fixtures/ocr/bitget-positionshistorie-1.jpg", import.meta.url));
const SHOTS = process.env.OCR_SHOTS;

type Journal = { __tjJournal: { getState(): { trades: { pair: string; side: string; entry: number | null; exit: number | null; qty?: number | null; leverage: number | null; marginMode?: string; tags?: string[] }[] } } };
const fab = (page: Page) => page.locator('[data-layer="Dock"], [data-layer="Seitenleiste"]').getByRole("button", { name: "Trade eintragen" });
const trades = (page: Page) => page.evaluate(() => (window as unknown as Journal).__tjJournal.getState().trades);

async function openWithShot(page: Page): Promise<Locator> {
  await fab(page).click();
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });
  await expect(editor).toBeVisible();
  await expect(editor.locator("[inert] #f-entry")).toHaveCount(0);
  await editor.locator('input[type="file"]').setInputFiles(IMAGE);
  const thumb = editor.getByRole("button", { name: "Screenshot 1 öffnen" });
  await expect(thumb).toBeVisible();
  return editor;
}

async function readAndList(page: Page, editor: Locator): Promise<Locator> {
  const action = editor.getByTestId("extract-action");
  await expect(action).toHaveAttribute("data-reader", "local");
  await expect(editor.getByTestId("extract-reader")).toContainText("Liest auf diesem Gerät, ohne KI");
  await editor.getByTestId("extract-open").click();
  const sheet = page.getByTestId("ocr-sheet");
  await expect(sheet).toHaveAttribute("data-target", "editor");
  await expect(sheet).toHaveAttribute("data-phase", "preview", { timeout: 180_000 });
  return sheet;
}

test.describe("Aus Screenshot übernehmen – lokal im Trade-Formular", () => {
  test.beforeEach(async ({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop only");
  });

  test("Bitget-Positionshistorie → Auswahl (BTC abgeschnitten) → TRUMP → Formular ausgefüllt und markiert, nichts gespeichert", async ({ page }, info) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await seed(page, { empty: true });
    await page.goto("/#trades");
    const editor = await openWithShot(page);
    const sheet = await readAndList(page, editor);

    await expect(page.getByTestId("ocr-summary")).toContainText("2 Trades erkannt");
    await expect(page.getByTestId("ocr-incomplete")).toContainText("BTCUSDT");
    await expect(page.getByTestId("ocr-incomplete")).toContainText("abgeschnitten");
    await expect(page.getByTestId("ocr-form-hint")).toContainText("wähle den für dieses Formular");
    const rows = sheet.getByTestId("ocr-trade");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("TRUMP/USDT · Short · 15×");
    await expect(rows.nth(1)).toContainText("SOL/USDT · Long · 2×");
    // SOL's ROI fits result, position value and leverage (read right, or repaired and marked „korrigiert“) – no ROI warning
    await expect(rows.nth(1).getByTestId("ocr-warning")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/fill-list-${info.project.name}.png`, animations: "disabled" });

    await rows.nth(1).getByTestId("ocr-form-pick").click();
    await rows.nth(0).getByTestId("ocr-form-pick").click();
    await expect(rows.nth(0).getByTestId("ocr-form-pick")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ocr-fill").click();
    await expect(page.getByTestId("ocr-sheet")).toHaveCount(0);

    await expect(editor.locator("#f-pair")).toHaveValue("TRUMP/USDT");
    await expect(editor.locator("#f-entry")).toHaveValue("1,547");
    await expect(editor.locator("#f-exit")).toHaveValue("1,485");
    await expect(editor.locator("#f-qty")).toHaveValue("667,91");
    await expect(editor.locator("#f-lev")).toHaveValue("15");
    await expect(editor.locator("#f-date")).toHaveValue("2026-11-04T01:26");
    await expect(editor.locator("#f-exit-date")).toHaveValue("2026-11-04T03:43");
    await expect(editor.locator("#f-pnl")).toHaveValue("41,34228791");
    await expect(editor.getByRole("radio", { name: /Short/ })).toHaveAttribute("aria-checked", "true");
    await expect(editor.getByRole("radio", { name: "Isoliert" })).toHaveAttribute("aria-checked", "true");
    for (const k of ["pair", "side", "date", "entry", "exit", "qty", "exitDate", "pnlManual", "leverage", "marginMode"]) await expect(editor.getByTestId(`shot-mark-${k}`)).toHaveAttribute("data-state", "read");
    await expect(editor.getByTestId("shot-mark-fees")).toHaveAttribute("data-state", "derived");
    await expect(editor.getByTestId("shot-fill-note")).toContainText("auf diesem Gerät gelesen, ohne KI");
    await expect(editor.getByTestId("shot-fill-note")).toContainText("Nicht übernommen: BTCUSDT");
    // a field the trader changes loses its mark
    await editor.locator("#f-entry").fill("1,55");
    await expect(editor.getByTestId("shot-mark-entry")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/fill-form-${info.project.name}.png`, animations: "disabled" });
    // nothing was saved
    expect(await trades(page)).toHaveLength(0);
    await editor.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect.poll(async () => (await trades(page)).length).toBe(1);
    expect((await trades(page))[0]).toMatchObject({ pair: "TRUMP/USDT", side: "short", entry: 1.55, exit: 1.485, qty: 667.91, leverage: 15, marginMode: "isolated", tags: ["Screenshot-Import"] });
    expect(errors).toEqual([]);
  });

  test("„Alle übernehmen“: TRUMP ins Formular, SOL direkt ins Journal (mit Rückgängig)", async ({ page }) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await seed(page, { empty: true });
    await page.goto("/#trades");
    const editor = await openWithShot(page);
    await readAndList(page, editor);
    await expect(page.getByTestId("ocr-fill-all")).toHaveText("Alle 2 übernehmen");
    await page.getByTestId("ocr-fill-all").click();
    await expect(page.getByTestId("ocr-sheet")).toHaveCount(0);
    await expect.poll(async () => (await trades(page)).length).toBe(1);
    expect((await trades(page))[0]).toMatchObject({ pair: "SOL/USDT", side: "long", entry: 95, exit: 92.06, qty: 2.31, leverage: 2, marginMode: "cross" });
    await expect(editor.locator("#f-entry")).toHaveValue("1,547");
    await expect(page.getByRole("button", { name: "Rückgängig" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
