/**
 * F73 Labor · "Eigene Idee" end to end against the market mock with REAL Binance BTCUSDT 4h / 1D bars (`boxes: true`, served
 * with Binance's `startTime` / `limit` paging – no network): the user builds a two-condition strategy in the UI (RSI below a
 * level on the execution candles AND a daily moving-average filter), sees it read back in plain language, runs it through the
 * lab's own loader and worker and gets the diagnosis "Warum so schwach?" with the rule funnel and the no-cost comparison.
 * Also: higher timeframes below the execution interval are shown disabled with their reason, drafts survive a reload.
 *
 * Runs on the routed page `/#labor` of the production build (`PW_LABOR_URL` overrides it).
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, seed } from "./helpers";

const LABOR_URL = process.env.PW_LABOR_URL ?? "/#labor";
const PROJECTS = ["mobile", "desktop"];

async function open(page: Page, info: TestInfo): Promise<{ errors: string[]; klines: URL[] }> {
  test.skip(!PROJECTS.includes(info.project.name), "Labor runs on mobile + desktop");
  const errors = collectErrors(page);
  const klines: URL[] = [];
  await seed(page, { boxes: true, extra: { "tj2-labor": { strategy: "custom", symbol: "BTCUSDT", period: "6m" } }, onRequest: (u) => u.pathname === "/fapi/v1/klines" && u.searchParams.has("startTime") && klines.push(u) });
  await openRoute(page, LABOR_URL, "Labor");
  return { errors, klines };
}

test.describe("Labor · Eigene Idee", () => {
  test.setTimeout(150_000);

  test("zwei Bedingungen bauen, laufen lassen, Diagnose lesen", async ({ page }, info) => {
    const { errors, klines } = await open(page, info);
    // "Eigene Idee" is the first choice and selected; the three templates follow
    const tiles = page.getByRole("radiogroup", { name: "Strategie" }).getByRole("radio");
    await expect(tiles.first()).toHaveAttribute("data-testid", "labor-strategy-custom");
    await expect(tiles.first()).toHaveAttribute("aria-checked", "true");
    await expect(tiles).toHaveCount(4);
    const builder = page.getByTestId("labor-builder");
    await expect(builder).toBeVisible();

    // start from nothing: remove both conditions of the default idea → an error blocks the run, with its reason
    await builder.getByRole("button", { name: /Bedingung entfernen: RSI Niveau/ }).click();
    await builder.getByRole("button", { name: /Bedingung entfernen: Kurs gegen Durchschnitt/ }).click();
    await expect(page.getByTestId("labor-check")).toContainText("Ohne mindestens eine Bedingung gibt es kein Signal");
    await expect(page.getByTestId("labor-start")).toBeDisabled();

    // condition 1: RSI(14) below 45 on the execution candles (4h)
    await page.getByTestId("labor-add-cond").click();
    await page.getByTestId("labor-block-rsi").click();
    const level = builder.getByRole("textbox", { name: "RSI Niveau: Niveau" });
    await level.fill("45");
    await level.press("Enter");

    // condition 2: close above the 20-day average – on the DAILY chart
    await page.getByTestId("labor-add-cond").click();
    await page.getByTestId("labor-block-maPrice").click();
    const len = builder.getByRole("textbox", { name: "Kurs gegen Durchschnitt: Länge" });
    await len.fill("20");
    await len.press("Enter");
    const second = builder.getByTestId("labor-leaf").nth(1);
    const tfGroup = second.getByRole("radiogroup", { name: /Zeitebene: Kurs gegen Durchschnitt/ });
    // lower timeframes are disabled WITH their reason (4h execution)
    const lowered = tfGroup.getByRole("radio", { name: "1h" });
    await expect(lowered).toBeDisabled();
    await expect(lowered).toHaveAttribute("title", /niedriger als die Ausführung \(4h\)/);
    await tfGroup.getByRole("radio", { name: "1D" }).click();

    // the idea in plain language, no errors, start enabled
    await expect(page.getByTestId("labor-idea-summary")).toContainText("Long wenn RSI(14) unter 45 UND Schluss über EMA 20 [1D].");
    await expect(page.getByTestId("labor-check")).toContainText("Keine Fehler");
    await expect(page.getByTestId("labor-start")).toBeEnabled();
    await expectNoHorizontalScroll(page);

    // run: 4h (execution) and 1D (confirmation) are loaded from the mocked exchange, nothing else
    await page.getByTestId("labor-start").click();
    await expect(page.getByTestId("labor-run")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    expect(new Set(klines.map((u) => u.searchParams.get("interval")))).toEqual(new Set(["4h", "1d"]));

    // the diagnosis under the run
    const diag = page.getByTestId("labor-diagnosis");
    await diag.scrollIntoViewIfNeeded();
    await expect(diag).toContainText("Warum so schwach?");
    const funnel = diag.getByTestId("labor-funnel-row");
    await expect(funnel.first()).toContainText("Kerzen im Zeitraum geprüft");
    await expect(funnel.last()).toContainText("Ausgeführt und geschlossen");
    expect(await funnel.evaluateAll((els) => els.some((e) => e.getAttribute("data-kind") === "leaf"))).toBe(true);
    // the findings are observations with numbers (or an honest "nothing to report")
    const findings = diag.getByTestId("labor-finding");
    if (await findings.count()) {
      for (const t of await findings.allTextContents()) expect(t).toMatch(/\d/);
    } else {
      await expect(diag.getByTestId("labor-findings-empty")).toBeVisible();
    }
    // the comparison without costs is a real re-run
    await expect(diag.getByTestId("labor-compare-table")).toContainText("Ohne Kosten");
    await expect(page.getByTestId("labor-compare").getByTestId("labor-run-card")).toContainText("Meine Idee");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("Vorlage laden, als Entwurf speichern, nach dem Neuladen wieder öffnen", async ({ page }, info) => {
    const { errors } = await open(page, info);
    await page.getByTestId("labor-template-mtf-pullback").click();
    await expect(page.getByTestId("labor-idea-summary")).toContainText("Long wenn");
    await page.getByTestId("labor-draft-save").click();
    await expect(page.getByTestId("labor-draft")).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Labor" })).toBeVisible();
    // the set-up and the draft were remembered in this browser
    await expect(page.getByTestId("labor-strategy-custom")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("labor-drafts-toggle").click();
    await expect(page.getByTestId("labor-draft")).toContainText("Rücksetzer im Mehrzeitrahmen-Trend");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});
