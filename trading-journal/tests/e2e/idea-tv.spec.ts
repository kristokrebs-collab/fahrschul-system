/**
 * F12 + F14 end to end (production build, market mock with real Binance bars, `boxes: true`):
 * - "Diese Idee testen" on the live entry check ("Warum handeln oder auslassen?") fills the lab's "Eigene Idee" and opens the
 *   Labor page; the origin card names what became a rule and what did not, with reasons; the way back restores the old set-up.
 * - The Labor page shows the honest TradingView adapter status and reads a TradingView strategy-tester export in the browser
 *   (English and German files), naming unreadable lines by their line number. No uploads, no horizontal scroll at 390 px.
 *
 * No clock jumps and no time-dependent expectations: the checks look at end states only.
 */
import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, seed } from "./helpers";

const PROJECTS = ["mobile", "desktop"];

const EN = [
  "Trade #,Type,Date/Time,Signal,Price USDT,Position size (qty),Net P&L USDT",
  "2,Exit short,2025-03-04 08:00,Close,64000,1,1500",
  "2,Entry short,2025-03-03 16:00,Short,65500,1,1500",
  "1,Exit long,2025-03-03 16:00,TP,abc,1,200",
  "1,Entry long,2025-03-03 08:00,Long,65500,1,200",
].join("\n");
const DE = [
  "Trade-Nr.;Typ;Datum/Uhrzeit;Signal;Preis USDT;Kontrakte;Gewinn USDT",
  "1;Ausstieg Long;03.03.2025 16:00;TP;65.700,5;0,5;100,25",
  "1;Einstieg Long;03.03.2025 08:00;Long;65.500;0,5;100,25",
].join("\n");

test.describe("Idee testen · TradingView", () => {
  test.setTimeout(120_000);

  test("Einstiegs-Check → Labor: Entwurf mit Lücken, Weg zurück", async ({ page }, info) => {
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop");
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await page.goto("/");
    const why = page.getByTestId("why-section");
    await expect(why).toBeVisible({ timeout: 40_000 });
    await why.getByRole("button", { name: "Details zeigen: Warum handeln oder auslassen?" }).click();
    await page.getByTestId("signal-to-lab").click();
    await expect(page).toHaveURL(/#labor/);
    const card = page.getByTestId("labor-idea");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("labor-idea-mapped")).toContainText("MCB-Leiter");
    await expect(page.getByTestId("labor-idea-gaps")).toContainText("Top-Trader-Teil");
    await expect(page.getByTestId("labor-idea-gaps")).toContainText("keine Historie");
    await expect(card).toContainText("gespeichert und gestartet ist nichts");
    // the lab is filled: "Eigene Idee" with the ladder block, nothing started
    await expect(page.getByTestId("labor-strategy-custom")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("labor-builder")).toBeVisible();
    await expect(page.getByTestId("labor-leaf").first()).toHaveAttribute("data-block", "mcbLadder");
    await expect(page.getByTestId("labor-view")).toHaveAttribute("data-status", "idle");
    await expectNoHorizontalScroll(page);
    // the way back
    await page.getByTestId("labor-idea-back").click();
    await expect(page.getByTestId("labor-idea")).toHaveCount(0);
    await expect(page.getByTestId("labor-strategy-box")).toHaveAttribute("aria-checked", "true");
    expect(errors).toEqual([]);
  });

  test("Labor: Adapterstatus und TradingView-Export im Browser lesen", async ({ page }, info) => {
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop");
    const errors = collectErrors(page);
    const posts: string[] = [];
    page.on("request", (r) => r.method() === "POST" && posts.push(r.url()));
    await seed(page, { boxes: true });
    await openRoute(page, "/#labor", "Labor");
    const status = page.getByTestId("labor-tv-status");
    await status.scrollIntoViewIfNeeded();
    await expect(status).toBeVisible({ timeout: 25_000 });
    await expect(status.locator('[data-adapter="tester-export"]')).toContainText("unterstützt");
    await expect(status.locator('[data-adapter="alert-webhook"]')).toContainText("nur Forwardtest über Alert");
    await expect(status.locator('[data-adapter="account"]')).toContainText("nicht unterstützt");
    await expect(status.locator('[data-adapter="account"]')).toContainText("kein Login");

    const file = page.getByTestId("labor-tv-file");
    await file.setInputFiles({ name: "trades.csv", mimeType: "text/csv", buffer: Buffer.from(EN) });
    await expect(page.getByTestId("labor-tv-summary")).toContainText("1 Trade gelesen");
    await expect(page.getByTestId("labor-tv-summary")).toContainText("1 Zeile nicht lesbar");
    await expect(page.getByTestId("labor-tv-errors")).toContainText("Zeile 4");
    await expect(page.getByTestId("labor-tv-errors")).toContainText("Preis „abc“ ist keine Zahl");
    await expect(page.getByTestId("labor-tv-norun")).toBeVisible();

    await file.setInputFiles({ name: "handel.csv", mimeType: "text/csv", buffer: Buffer.from(DE) });
    await expect(page.getByTestId("labor-tv-summary")).toContainText("1 Trade gelesen");
    await expect(page.getByTestId("labor-tv-summary")).toContainText("Kopfzeile deutsch");
    await expect(page.getByTestId("labor-tv-errors")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    // the file stayed in the browser
    expect(posts.filter((u) => !u.includes("127.0.0.1") && !u.includes("localhost"))).toEqual([]);
    expect(errors).toEqual([]);
  });
});
