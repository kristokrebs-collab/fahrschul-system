/**
 * Transaktionsbuch (F70, Hilfsrechnung) end to end on the Berichte page (own lazy chunk, `seed(page)` = the legacy journal
 * fixture): the book as rows with the FIFO result, the year summary, the account switch of the page (the rows of Makro and Scalp
 * add up to all of them), the zone of the times, the CSV export with the head „Hilfsrechnung ohne Steuerberatung“ and the print
 * view with the same head (`window.print` stubbed, the dialog is the browser's). No console errors, no horizontal scroll at
 * 390 px, touch targets ≥ 44 px on touch. Nothing here depends on the clock.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, screenshot, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";

const PROJECTS = ["mobile", "desktop"];
const NOTE = "Hilfsrechnung ohne Steuerberatung; Steuerregeln prüft eine Fachperson";

async function openLedger(page: Page) {
  await openRoute(page, "/#berichte", "Berichte");
  const card = page.getByTestId("ledger-card");
  await expect(card).toBeAttached({ timeout: 40_000 });
  await card.scrollIntoViewIfNeeded();
  return card;
}

const rowsOf = async (page: Page): Promise<number> => Number(await page.getByTestId("ledger-card").getAttribute("data-rows"));

test.describe("Transaktionsbuch", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("rows with the FIFO result, the year summary, the head of a Hilfsrechnung – no errors, no horizontal scroll, touch targets", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    const card = await openLedger(page);
    await expect(card).toContainText(NOTE);
    await expect(card.getByTestId("ledger-scope-note")).toContainText("Staking, Rewards, Airdrops");
    expect(await rowsOf(page)).toBeGreaterThan(0);

    // the year summary: gains, losses, fees, funding and the result after costs of the newest year
    const year = card.getByTestId("ledger-year").first();
    await expect(year).toBeVisible();
    for (const word of ["Gewinne", "Verluste", "Ergebnis brutto", "Gebühren", "Funding", "Nach Gebühren und Funding"]) await expect(year).toContainText(word);

    // rows: a time, the account and market, the kind; closings carry their FIFO matches
    const row = card.getByTestId("ledger-row").first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(/\d\d\.\d\d\.\d{4} \d\d:\d\d/);
    const closing = card.locator('[data-testid="ledger-row"][data-kind="close"]').first();
    await closing.scrollIntoViewIfNeeded();
    await expect(closing).toContainText("Schließen");

    // honest limits: what is not in the book is said, no tax is claimed
    await expect(card).toContainText("Es wird keine Steuer berechnet und keine Haltefrist behauptet");
    await expect(card).toContainText("Keine professionelle Finanzberatung.");

    await screenshot(page, info, "ledger");
    await expectNoHorizontalScroll(page);
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="ledger-card"]' });
      expect(misses, JSON.stringify(misses)).toEqual([]);
    }
    expect(errors).toEqual([]);
  });

  test("the account switch of the page: Makro and Scalp rows add up to all rows", async ({ page }) => {
    await seed(page);
    await openLedger(page);
    const all = await rowsOf(page);
    await page.getByRole("radio", { name: "Makro" }).first().click();
    await expect.poll(() => rowsOf(page)).toBeLessThanOrEqual(all);
    const makro = await rowsOf(page);
    await page.getByRole("radio", { name: "Scalp" }).first().click();
    await expect.poll(async () => (await rowsOf(page)) + makro).toBe(all);
    await page.getByRole("radio", { name: "Gesamt" }).first().click();
    await expect.poll(() => rowsOf(page)).toBe(all);
  });

  test("the zone: the same row reads differently in UTC and in New York", async ({ page }) => {
    await seed(page);
    const card = await openLedger(page);
    const first = card.getByTestId("ledger-row").first();
    const id = (await first.getAttribute("data-id"))!;
    const stamp = async (): Promise<string> => (await card.locator(`[data-testid="ledger-row"][data-id="${id}"]`).first().textContent())!.match(/\d\d\.\d\d\.\d{4} \d\d:\d\d/)![0];
    const pick = async (name: string): Promise<void> => {
      await page.getByTestId("ledger-zone").click();
      await page.getByRole("listbox").getByRole("option", { name }).click();
    };
    await pick("UTC");
    const utc = await stamp();
    await pick("New York");
    const ny = await stamp();
    expect(ny).not.toBe(utc);
  });

  test("CSV: the book and the matching with the head, and the print view with the same head", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed++;
      };
    });
    await seed(page);
    const card = await openLedger(page);

    const [book] = await Promise.all([page.waitForEvent("download"), card.getByTestId("ledger-csv").click()]);
    expect(book.suggestedFilename()).toMatch(/^transaktionsbuch-(\d{4}|alle-jahre)\.csv$/);
    const text = readFileSync((await book.path())!, "utf8");
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text.split("\n")[0]).toBe(`\uFEFF"${NOTE}"`);
    expect(text).toContain("Datum/Zeit;Zeit (UTC);Konto;Börse;Markt;Art;Kauf/Verkauf;Richtung;Menge;Preis;Gebühr;Funding;Realisiertes Ergebnis (brutto);Eröffnung (Datum);Schließung (Datum);Währung;Quelle;Eintrag-ID;Hinweise");
    expect(text).toContain("Jahreszusammenfassung");

    const [match] = await Promise.all([page.waitForEvent("download"), card.getByTestId("ledger-csv-match").click()]);
    expect(match.suggestedFilename()).toMatch(/^fifo-zuordnung-/);
    expect(readFileSync((await match.path())!, "utf8").split("\n")[0]).toBe(`\uFEFF"${NOTE}"`);

    await card.getByTestId("ledger-print-btn").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
    const doc = page.getByTestId("ledger-print");
    await expect(doc).toHaveCount(1);
    await expect(doc.getByTestId("ledger-print-note")).toHaveText(NOTE);
    await expect(doc).toContainText("Nicht enthalten: Ein- und Auszahlungen");
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(page.getByTestId("ledger-print")).toHaveCount(0);
  });
});
