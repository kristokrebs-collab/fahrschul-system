/**
 * Scanner „Wer bricht aus?“ (Markt) und die „Rechnung“ des Positionsgrößen-Rechners (Risiko) end to end, gegen die Festkerzen der
 * Tests (`mocks/breakout.ts`: zwölf Märkte, New Yorker Sitzung vom 24.11.2026, „jetzt“ = Beginn + 2 h; erfunden, als Test-Daten
 * beschriftet) über die bestehende Markt-Attrappe (`seed` → `mockMarket`). Geprüft gegen Attrappen, nicht gegen die echte Börse.
 *
 * Abgedeckt: der Lauf startet erst, wenn der Block auf dem Schirm ist; zwölf Karten mit Note, Gründen, echten Mini-Kerzen, sortiert;
 * Quelle + Stand; die Regeln; Sitzungswechsel ohne neuen Abruf; Binance gesperrt → Bybit wird beim Namen genannt; alles aus → ehrlicher
 * Fehler ohne Ersatzdaten und „Erneut versuchen“; reduzierte Bewegung = Endzustand; kein Orderknopf; die Übernahme in den Rechner
 * (nur Vorbelegung, das Journal bleibt unberührt); im Rechner Betrag statt Prozent, Fehleingaben, die Rechnung; kein Querscrollen bei
 * 390 px, keine Konsolenfehler. `BREAKOUT_SHOTS=<Ordner>` schreibt die Bilder für die Durchsicht (hell / dunkel).
 */
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, pinClock, seed, stored } from "./helpers";
import { BREAKOUT_NOW, BREAKOUT_SCENARIOS } from "./mocks/breakout";
import { mockBreakout, type BreakoutMode } from "./mocks/breakoutRoutes";

const PROJECTS = ["mobile", "desktop", "tablet"];
const SHOTS = process.env.BREAKOUT_SHOTS;

type Mode = BreakoutMode;

interface Opened {
  log: { binance: string[]; bybit: string[] };
  errors: string[];
  setMode(m: Mode): void;
}

async function open(page: Page, o: { mode?: Mode; theme?: "light" | "dark"; url?: string; h1?: string } = {}): Promise<Opened> {
  let mode: Mode = o.mode ?? "binance";
  const clock = await pinClock(page, BREAKOUT_NOW);
  await seed(page, { clock: clock.now, extra: o.theme ? { "tj2-theme": JSON.stringify({ pref: o.theme, accent: "signal" }) } : {} });
  const log = await mockBreakout(page, () => mode, clock.now);
  const errors = collectErrors(page);
  await openRoute(page, o.url ?? "/#markt", o.h1 ?? "Markt");
  return { log, errors, setMode: (m) => void (mode = m) };
}

/** an input of the calculator by its exact label (the cards below it speak of "Einstieg" and "Stop" too) */
const field = (calc: Locator, name: string) => calc.getByRole("textbox", { name, exact: true });
const section = (page: Page) => page.getByTestId("breakout-section");
const card = (page: Page, symbol: string) => page.locator(`[data-testid=breakout-card][data-symbol="${symbol}"]`);
const order = (page: Page): Promise<string[]> => page.locator("[data-testid=breakout-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-symbol") ?? ""));

/** Brings the block on screen (its first scan starts then) and waits for the run to end. */
async function scanned(page: Page): Promise<void> {
  await section(page).scrollIntoViewIfNeeded();
  await expect(section(page)).toHaveAttribute("data-phase", "done", { timeout: 30_000 });
}

async function shot(page: Page, info: TestInfo, name: string, target = section(page)): Promise<void> {
  if (!SHOTS) return;
  await page.mouse.move(1, 1);
  await page.waitForTimeout(1500);
  const vp = page.viewportSize();
  // what the screen shows with the block at its top, then the whole block
  await target.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${name}-${vp?.width}x${vp?.height}.png`, animations: "disabled" });
  await target.screenshot({ path: `${SHOTS}/ganz-${name}-${vp?.width}x${vp?.height}.png`, animations: "disabled" });
}

test.describe("Scanner „Wer bricht aus?“", () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright wants the fixtures object first
  test.beforeEach(({}, info) => {
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop + Galaxy-Tab");
  });

  test("der Lauf beginnt erst auf dem Schirm; zwölf Karten mit Note, Gründen und echten Kerzen, sortiert; Quelle und Stand stehen da", async ({ page }) => {
    const { log, errors } = await open(page);
    await expect(section(page)).toBeAttached({ timeout: 30_000 });
    // noch nicht im Bild: kein einziger Abruf, ein ehrlicher Satz
    expect(log.binance).toEqual([]);
    await expect(section(page)).toHaveAttribute("data-phase", "idle");
    await expect(page.getByTestId("breakout-card")).toHaveCount(12);
    await scanned(page);
    expect([...log.binance].sort()).toEqual(Object.keys(BREAKOUT_SCENARIOS).sort());
    expect(log.bybit).toEqual([]);
    await expect(page.getByTestId("breakout-checked")).toHaveText("12/12");
    await expect(page.getByTestId("breakout-top")).toHaveText("3");
    expect((await order(page)).slice(0, 5)).toEqual(["LTCUSDT", "BNBUSDT", "SUIUSDT", "XRPUSDT", "DOGEUSDT"]);
    expect((await order(page))[11]).toBe("TONUSDT");

    const ltc = card(page, "LTCUSDT");
    await expect(ltc).toHaveAttribute("data-grade", "A+");
    await expect(ltc).toHaveAttribute("data-best", "");
    await expect(ltc).toContainText("Meiste Gründe");
    await expect(ltc).toContainText("Short-Ausbruch um 16:15");
    await expect(ltc).toContainText("Vol 4,0×");
    await expect(page.locator("[data-testid=breakout-card][data-best]")).toHaveCount(1);
    // der Mini-Chart: so viele Körper wie Kerzen, eine Spanne, ein Punkt
    const chart = ltc.getByTestId("breakout-chart");
    const bars = Number(await chart.getAttribute("data-bars"));
    expect(bars).toBeGreaterThan(20);
    await expect(chart.locator("rect.up, rect.dn")).toHaveCount(bars);
    await expect(chart.locator(".bo-mark")).toHaveCount(1);
    await expect(card(page, "TONUSDT")).toContainText("Keine Kerzen für diese Sitzung");
    await expect(card(page, "BTCUSDT")).toContainText("In der Spanne – noch kein Ausbruch");

    // die Zahlen der markierten Karte
    const detail = page.getByTestId("breakout-detail");
    await expect(detail).toHaveAttribute("data-symbol", "LTCUSDT");
    await expect(detail.getByTestId("breakout-fact-grade")).toHaveText("A+ · 3 von 3 Gründen, Volumen stark");
    await expect(detail.getByTestId("breakout-fact-volume")).toHaveText("4,0×");
    await expect(detail.getByTestId("breakout-fact-time")).toHaveText("16:15 Uhr");
    await expect(detail.getByTestId("breakout-fact-dist")).toHaveText(/^\+0,\d\d % · \d+,\d ATR$/);
    await expect(detail).toContainText("51,822");

    await expect(page.getByTestId("breakout-stand")).toHaveText(/^Quelle: Binance USDⓈ-M · Abruf 24\.11\. 17:3\d · letzter Schluss 5m 24\.11\. 17:30$/);
    // die Regeln sind aufklappbar und nennen die Schwellen
    await page.getByTestId("breakout-rules").locator("summary").click();
    await expect(page.getByTestId("breakout-rules")).toContainText("ab 1,5× gilt es als bestätigt, ab 2× als stark");
    await expect(page.getByTestId("breakout-rules")).toContainText("Die Note zählt Gründe – sie sagt nichts über einen Gewinn.");
    // kein Orderknopf im Block, der Hinweis am Seitenende
    const names = await section(page).locator("button").evaluateAll((els) => els.map((e) => `${e.textContent ?? ""} ${e.getAttribute("aria-label") ?? ""}`));
    for (const n of names) expect(n).not.toMatch(/kaufen|verkaufen|order|trade eröffnen/i);
    await expect(page.locator('[data-page="markt"] [data-testid=analysis-note]')).toContainText("Keine professionelle Finanzberatung.");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("eine andere Karte wählen; Sitzungswechsel rechnet neu ohne neuen Abruf; „Neu scannen“ lädt neu", async ({ page }) => {
    const { log } = await open(page);
    await scanned(page);
    await card(page, "BNBUSDT").click();
    await expect(card(page, "BNBUSDT")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("breakout-detail")).toHaveAttribute("data-symbol", "BNBUSDT");
    await expect(page.getByTestId("breakout-detail").getByRole("heading", { level: 4 })).toContainText("BNB · Long");
    const before = log.binance.length;
    await section(page).getByRole("radio", { name: "London 8:00" }).click();
    await expect(section(page)).toHaveAttribute("data-session", "london");
    await expect(section(page)).toHaveAttribute("data-phase", "done");
    await expect(section(page).locator(".bo-lead")).toContainText("London 8:00");
    expect(log.binance.length).toBe(before);
    await page.getByTestId("breakout-rescan").click();
    await expect.poll(() => log.binance.length).toBe(before + 12);
    await expect(section(page)).toHaveAttribute("data-phase", "done");
  });

  test("Binance nicht erreichbar: Bybit liefert und wird beim Namen genannt", async ({ page }) => {
    const { log } = await open(page, { mode: "bybit" });
    await scanned(page);
    // Binance wurde einmal gefragt, dann nicht mehr (kein Markt fragt eine gesperrte Börse erneut)
    expect(log.binance.length).toBeLessThanOrEqual(3);
    expect(log.bybit.length).toBe(12);
    await expect(page.getByTestId("breakout-stand")).toContainText("Quelle: Bybit USDT-Perp (Ersatzquelle, nicht Binance)");
    await expect(card(page, "LTCUSDT")).toHaveAttribute("data-grade", "A+");
  });

  test("keine Quelle erreichbar: ehrlicher Fehler ohne Ersatzdaten; „Erneut versuchen“ lädt, sobald es wieder geht", async ({ page }, info) => {
    const o = await open(page, { mode: "offline" });
    await scanned(page);
    const msg = page.getByTestId("breakout-msg");
    await expect(msg).toHaveAttribute("data-tone", "error");
    await expect(msg).toContainText("Keine Kerzen erhalten: Die Börse ist gerade nicht erreichbar. Ohne echte Kerzen prüft der Scanner nichts – es gibt keine Ersatzdaten.");
    await expect(page.getByTestId("breakout-chart")).toHaveCount(0);
    await expect(page.getByTestId("breakout-top")).toHaveText("0");
    await expect(page.getByTestId("breakout-stand")).toContainText("Quelle: keine Daten");
    await expect(page.getByTestId("breakout-detail")).toHaveAttribute("data-empty", "");
    await shot(page, info, "scanner-fehler");
    o.setMode("binance");
    await page.getByTestId("breakout-retry").click();
    await expect(card(page, "LTCUSDT")).toHaveAttribute("data-grade", "A+", { timeout: 30_000 });
    await expect(page.getByTestId("breakout-retry")).toHaveCount(0);
  });

  test("reduzierte Bewegung: der Endzustand steht sofort, nichts dreht oder wandert", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await scanned(page);
    const state = await page.locator("[data-testid=breakout-card]").evaluateAll((els) =>
      els.map((e) => {
        const cs = getComputedStyle(e);
        const li = getComputedStyle(e.parentElement!);
        return { running: e.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length, transform: cs.transform, liTransform: li.transform };
      }),
    );
    for (const s of state) {
      expect(s.running).toBe(0);
      expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(s.transform);
      expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(s.liTransform);
    }
    await expect(card(page, "LTCUSDT")).toHaveAttribute("data-best", "");
    await expect(page.locator("[data-fx=radar-sweep][data-scanning]")).toHaveCount(0);
  });

  test("„In den Rechner übernehmen“: Paar, Richtung, Einstieg und Stop stehen im Rechner – als Vorbelegung, das Journal bleibt unberührt", async ({ page }, info) => {
    const { errors } = await open(page);
    await scanned(page);
    const tradesBefore = await stored<unknown[]>(page, "tj2-trades");
    await page.getByTestId("breakout-to-calc").click();
    await expect(page.getByRole("heading", { level: 1, name: "Risiko" }).first()).toBeVisible({ timeout: 25_000 });
    const calc = page.getByTestId("risk-calc");
    await expect(calc).toBeInViewport({ timeout: 15_000 });
    await expect(field(calc, "Paar")).toHaveValue("LTCUSDT");
    await expect(field(calc, "Einstieg")).toHaveValue(/^51,6\d*$/);
    // Stop = andere Seite der Spanne: 51,9 × 1,0015 = 51,98
    await expect(field(calc, "Stop")).toHaveValue("51,98");
    await expect(field(calc, "Ziel")).toHaveValue("");
    await expect(calc.getByRole("radio", { name: "Short" })).toBeChecked();
    await expect(calc.getByTestId("risk-prefill-note")).toContainText("Aus dem Ausbruch-Scanner vorbelegt – nur eine Vorbelegung, kein Trade: LTCUSDT · Short");
    const bill = calc.getByTestId("risk-bill");
    await expect(bill).toBeVisible({ timeout: 15_000 });
    await expect(bill).toHaveAttribute("data-side", "short");
    await expect(bill.getByTestId("risk-bill-qty")).toContainText("LTC");
    // nichts wurde eingetragen oder geöffnet
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await stored<unknown[]>(page, "tj2-trades")).toEqual(tradesBefore);
    await shot(page, info, "rechner-aus-scanner", calc);
    expect(errors).toEqual([]);
  });
});

test.describe("Positionsgrößen-Rechner · Rechnung", () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright wants the fixtures object first
  test.beforeEach(({}, info) => {
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop + Galaxy-Tab");
  });

  test("Risiko in Prozent oder als Betrag, Fehleingaben mit klarer Meldung, die Rechnung mit Annahmen und Rundungshinweis", async ({ page }, info) => {
    const { errors } = await open(page, { url: "/#risiko", h1: "Risiko" });
    const calc = page.getByTestId("risk-calc");
    await calc.scrollIntoViewIfNeeded();
    await expect(calc.getByTestId("risk-bill")).toHaveCount(0);
    await field(calc, "Kapital").fill("10000");
    await field(calc, "Einstieg").fill("100");
    // Stop auf der falschen Seite: Meldung am Feld, keine Rechnung
    await field(calc, "Stop").fill("105");
    await expect(calc.getByRole("alert")).toHaveText("Stop liegt auf der falschen Seite: bei Long unter, bei Short über dem Einstieg.");
    await expect(calc.getByTestId("risk-bill")).toHaveCount(0);
    await field(calc, "Stop").fill("0");
    await expect(calc.getByRole("alert")).toHaveText("Stop fehlt, ist nicht größer als 0 oder liegt genau auf dem Einstieg.");
    await field(calc, "Stop").fill("95");
    await expect(calc.getByRole("alert")).toHaveCount(0);
    await field(calc, "Ziel").fill("110");
    const bill = calc.getByTestId("risk-bill");
    await expect(bill).toBeVisible({ timeout: 15_000 });
    // 1 % von 10 000 = 100 ÷ 5,145 = 19,44
    await expect(bill.getByTestId("risk-bill-qty")).toContainText("19,44");
    await expect(bill.locator("[data-row=cost]")).toContainText("3 USDT · 3 %");
    await expect(bill.locator("[data-row=gain]")).toContainText("+192 USDT");
    await expect(bill.getByTestId("risk-bill-assume")).toContainText("Gebühr 0,05 % je Seite, Slippage 0,05 % am Stop");
    await expect(bill.getByTestId("risk-bill-step")).toContainText("Beispiel mit Schritt 0,1: abgerundet 19,40");
    await expect(bill.locator("button")).toHaveCount(0);

    // als Betrag: derselbe Wert steht da, 250 = 2,5 %
    await calc.getByRole("radio", { name: "Betrag" }).click();
    await expect(field(calc, "Risiko-Betrag")).toHaveValue("100");
    await field(calc, "Risiko-Betrag").fill("250");
    await expect(calc.getByTestId("risk-amount-pct")).toHaveText("Das sind 2,50 % deines Kapitals.");
    await expect(bill.getByTestId("risk-bill-qty")).toContainText("48,59");
    await expect(bill).toHaveAttribute("data-tone", "bad");
    await field(calc, "Risiko-Betrag").fill("0");
    await expect(calc.getByRole("alert")).toHaveText("Der Risiko-Betrag muss über 0 liegen und darf das Kapital nicht übersteigen.");
    await expect(calc.getByTestId("risk-bill")).toHaveCount(0);
    await field(calc, "Risiko-Betrag").fill("-50");
    await expect(calc.getByRole("alert")).toHaveCount(1);
    await field(calc, "Risiko-Betrag").fill("100");
    await expect(bill).toBeVisible();
    // Ziel auf der falschen Seite
    await field(calc, "Ziel").fill("90");
    await expect(calc.getByRole("alert")).toHaveText("Ziel liegt auf der falschen Seite: bei Long über, bei Short unter dem Einstieg.");
    await expect(bill.locator("[data-row=gain]")).toContainText("Ziel auf der falschen Seite");
    await field(calc, "Ziel").fill("110");
    await expect(bill).toHaveAttribute("data-tone", "ok");
    await shot(page, info, "rechner", calc);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});

// Bilder für die Durchsicht (nur mit BREAKOUT_SHOTS): beide Teile, hell und dunkel, in der Breite des Projekts
for (const theme of ["dark", "light"] as const) {
  test(`Bilder ${theme}: Scanner und Rechner`, async ({ page }, info) => {
    test.skip(!SHOTS, "nur mit BREAKOUT_SHOTS");
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop + Galaxy-Tab");
    test.setTimeout(120_000);
    await open(page, { theme });
    await scanned(page);
    await shot(page, info, `scanner-${theme}`);
    await page.getByTestId("breakout-to-calc").click();
    const calc = page.getByTestId("risk-calc");
    await expect(calc.getByTestId("risk-bill")).toBeVisible({ timeout: 25_000 });
    await field(calc, "Kapital").fill("10000");
    await field(calc, "Ziel").fill("51");
    await expect(calc.locator("[data-row=gain]")).toContainText("USDT");
    await shot(page, info, `rechner-${theme}`, calc);
  });
}
