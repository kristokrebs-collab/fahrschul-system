/**
 * Handelsplan (`#plan`) im echten Build, mobil 390 + Desktop. Die Kerzen kommen aus einem festen Mock
 * (`mocks/planCandles.ts`: BTCUSDT, New Yorker Sitzung vom Montag 19.10.2026, ein Tag in der Vergangenheit – nichts hängt an der
 * Uhr, keine Uhr-Sprünge). Gemessen wird der ganze Ablauf mit der Handrechnung des Mocks:
 *   Range 99.880 – 100.250 (Mitte 100.065) · Signal Long 100.380 um 9:55 New Yorker Zeit · Stop 100.065 · Ziel 2R 101.010 ·
 *   0,037 BTC (der Positionsdeckel bindet) · Verlust am Stop 17,21 USDT · Ampel grün.
 * Aktien (`describe "Handelsplan · Aktien"`): der Link `#plan?symbol=AAPL&side=long`, die Kerzen einer nachgebauten Aktien-Quelle
 * (`mocks/planStockCandles.ts`, Handrechnung dort: 20 Stück, Stop 185,05, Ziel 187,60, 22,56 USD), die Zeitmaschine auf Stunden- und
 * Tageskerzen, der Ausfall der Quelle, ein ungültiger Link. Der Tag ist ein junger Handelstag, den die Quelle noch ausliefert (aus der
 * Uhr gerechnet, die Zahlen hängen nicht daran).
 * Dazu: eine Regel wechseln, Plan speichern → 3 Alarme → Journal-Entwurf → verwerfen, der Ladefehler mit „Neu laden“, der Satz
 * „Keine professionelle Finanzberatung.“ mit Quelle + Stand an jedem Schritt, kein seitliches Scrollen, abgeschnittene Texte,
 * Touch-Ziele, axe in beiden Themen. Die App sendet nie etwas an eine Börse – auch das wird gemessen.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";
import { clippedTexts, collectErrors, expectNoHorizontalScroll, hasTouch, screenshot, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { PLAN_DAY, planKlineRows } from "./mocks/planCandles";
import { recentTradingDay, stockHistoryBars, stockOpen, stockSessionBars } from "./mocks/planStockCandles";
import { themeSettled } from "./uxHarness";

const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const STEPS = ["entry", "exit", "size", "risk", "ticket"] as const;
const KLINES = /^https:\/\/fapi\.binance\.com\/fapi\/v1\/klines\?/;

const layer = (page: Page) => page.locator('[data-page="plan"][data-page-role="current"]');
const tid = (page: Page, id: string) => layer(page).getByTestId(id);

interface Rig {
  /** 5-minute requests of BTCUSDT the page made */
  calls: URL[];
  /** while true the exchange is not reachable */
  fail: boolean;
  /** every request that is not a plain GET (an order would be one) */
  writes: string[];
}

/** Routes the 5-minute klines of BTCUSDT to the fixed candles; anything else keeps the shared market mock. */
async function rig(page: Page): Promise<Rig> {
  const state: Rig = { calls: [], fail: false, writes: [] };
  page.on("request", (r: Request) => {
    if (r.method() !== "GET" && r.method() !== "HEAD" && r.method() !== "OPTIONS" && !r.url().startsWith("data:")) state.writes.push(`${r.method()} ${r.url()}`);
  });
  await page.route(KLINES, async (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.get("symbol") !== "BTCUSDT" || u.searchParams.get("interval") !== "5m") return route.fallback();
    state.calls.push(u);
    if (state.fail) return route.abort("failed");
    const from = Number(u.searchParams.get("startTime"));
    const to = Number(u.searchParams.get("endTime"));
    const limit = Number(u.searchParams.get("limit") ?? 500);
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(planKlineRows(from, to, limit)) });
  });
  return state;
}

/** Opens the page on the fixed day (the stored form of this device) and waits until the page is up. */
async function openPlan(page: Page, opts: { fail?: boolean; theme?: "dark" | "light" } = {}): Promise<Rig> {
  const extra: Record<string, unknown> = { "tj2-plan-form": { day: PLAN_DAY } };
  if (opts.theme) extra["tj2-theme"] = JSON.stringify(opts.theme);
  // the shared market mock first (seed), then ours – a later route wins
  await seed(page, { extra });
  const state = await rig(page);
  state.fail = !!opts.fail;
  await page.goto("/#plan");
  await expect(layer(page).locator("h1").first()).toHaveText("Handelsplan", { timeout: 30_000 });
  await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
  return state;
}

/** the flow is complete: five steps done, the numbers of the hand calculation on the page */
async function expectCalculated(page: Page): Promise<void> {
  await expect(tid(page, "hplan-progress")).toHaveAttribute("data-done", "5", { timeout: 30_000 });
}

test.describe("Handelsplan", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("der ganze Ablauf mit der Handrechnung: Einstieg, Ausstieg, Größe, Risiko, Ticket", async ({ page }, info) => {
    const errors = collectErrors(page);
    const r = await openPlan(page);
    await expectCalculated(page);

    // 1 Einstieg: Range, Signal, in Worten
    await expect(tid(page, "hplan-entry-headline")).toHaveText("Signal Long: Schluss 100.380,0 um 09:55 Uhr über dem Hoch der Range.");
    const range = tid(page, "hplan-range");
    await expect(range).toContainText("100.250,0");
    await expect(range).toContainText("99.880,0");
    await expect(range).toContainText("100.065,0");
    await expect(tid(page, "hplan-signal")).toContainText("Long");
    await expect(tid(page, "hplan-entry-reasons")).toContainText("Die Kerze 09:50 ist um 09:55 Uhr geschlossen.");
    await expect(tid(page, "hplan-candle-state")).toContainText("Rückblick: die Sitzung ist vorbei");

    // 2 Ausstieg
    await expect(tid(page, "hplan-stop")).toContainText("100.065,0");
    await expect(tid(page, "hplan-target")).toContainText("101.010,0");
    await expect(tid(page, "hplan-rr")).toContainText("2");

    // 3 Größe: der Positionsdeckel bindet, sonst keine Grenze
    await expect(tid(page, "hplan-qty")).toContainText("0,037");
    await expect(tid(page, "hplan-maxloss")).toContainText("17,21");
    await expect(tid(page, "hplan-binding")).toContainText("Der Deckel für den Positionswert bindet");
    await expect(tid(page, "hplan-limit-position")).toHaveAttribute("data-binding", "true");
    await expect(tid(page, "hplan-limit-loss")).not.toHaveAttribute("data-binding");

    // 4 Risiko: grün, jede Zeile hat einen Zustand
    await expect(tid(page, "hplan-ampel")).toHaveAttribute("data-light", "green");

    // 5 Ticket: Zeilen, Text, CSV – zum Kopieren, nichts wird gesendet
    const ticket = tid(page, "hplan-ticket-text");
    await expect(ticket).toContainText("HANDELSPLAN – Ticket zum Kopieren");
    await expect(ticket).toContainText("die App sendet nichts an eine Börse und platziert keine Order");
    await expect(ticket).toContainText("Quelle: Binance USDⓈ-M · Kerzen bis ");
    await expect(tid(page, "hplan-ticket-rows")).toContainText("0,037 BTC");
    await expect(layer(page).getByRole("button", { name: /senden|order|kaufen|verkaufen/i })).toHaveCount(0);

    // die Kerzen kamen von der Börse (REST, 5m, BTCUSDT) – und sonst ging nichts hinaus
    expect(r.calls.length, "the page asked the exchange for its candles").toBeGreaterThan(0);
    for (const u of r.calls) {
      expect(u.searchParams.get("symbol")).toBe("BTCUSDT");
      expect(Number(u.searchParams.get("limit"))).toBeLessThanOrEqual(1500);
    }
    expect(r.writes, "no order, nothing written to any server").toEqual([]);
    await screenshot(page, info, "plan-flow", true);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("jeder Schritt zeigt, was angenommen wurde, endet mit dem Satz und nennt Quelle und Stand der Kerzen", async ({ page }) => {
    await openPlan(page);
    await expectCalculated(page);
    for (const id of STEPS) {
      const card = tid(page, `hplan-${id}`);
      await expect(card).toBeVisible();
      await expect(tid(page, `hplan-${id}-assumed`)).toBeAttached();
      await expect(tid(page, `hplan-${id}-state`)).toHaveAttribute("data-status", "done");
      const note = tid(page, `hplan-${id}-note`);
      await expect(note).toContainText("Keine professionelle Finanzberatung.");
      await expect(note).toContainText("Quelle: Binance USDⓈ-M · Kerzen bis ");
    }
    // der Satz der ganzen Seite steht genau einmal am Ende (die Selbstprüfung der App verlangt das)
    const notes = layer(page).getByTestId("analysis-note");
    await expect(notes).toHaveCount(1);
    await expect(notes).toContainText("Keine professionelle Finanzberatung.");
    const after = await layer(page).evaluate((root) => {
      const note = root.querySelector('[data-testid="analysis-note"]') as HTMLElement;
      return Array.from(root.querySelectorAll<HTMLElement>("*")).filter((el) => note.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && !note.contains(el) && el.offsetHeight > 0 && !el.closest('[data-layer], [role="dialog"]')).length;
    });
    expect(after, "visible content after the page note").toBe(0);
  });

  test("eine Regel wechseln rechnet alles neu: Stop am Range-Tief → Ziel 2R darüber, größere Menge nicht erlaubt", async ({ page }) => {
    await openPlan(page);
    await expectCalculated(page);
    await layer(page).getByRole("radiogroup", { name: "Stop-Regel" }).getByRole("radio", { name: "Range-Tief" }).click();
    // Stop 99.880 → Risiko je Einheit 500 → Ziel 2R = 100.380 + 1.000 = 101.380
    await expect(tid(page, "hplan-stop")).toContainText("99.880,0");
    await expect(tid(page, "hplan-target")).toContainText("101.380,0");
    // der Verlust am Stop wächst mit dem Abstand (0,037 × (500 + Gebühr und Slippage)) – der Deckel bindet weiter
    await expect(tid(page, "hplan-qty")).toContainText("0,037");
    await expect(tid(page, "hplan-maxloss")).not.toContainText("17,21");
    await expect(tid(page, "hplan-progress")).toHaveAttribute("data-done", "5");
    await expect(tid(page, "hplan-ticket-text")).toContainText("99.880,0");
    // und zurück
    await layer(page).getByRole("radiogroup", { name: "Stop-Regel" }).getByRole("radio", { name: "Range-Mitte" }).click();
    await expect(tid(page, "hplan-stop")).toContainText("100.065,0");
    await expect(tid(page, "hplan-target")).toContainText("101.010,0");
  });

  test("speichern, 3 Alarme, Journal-Entwurf, verwerfen – und der Plan übersteht das Neuladen", async ({ page }, info) => {
    const errors = collectErrors(page);
    await openPlan(page);
    await expectCalculated(page);
    const levels = () => page.evaluate(() => (window as unknown as { __tjJournal: { getState(): { settings: { keyLevels?: { levels?: unknown[] } } } } }).__tjJournal.getState().settings.keyLevels?.levels?.length ?? 0);
    const trades = () => page.evaluate(() => (window as unknown as { __tjJournal: { getState(): { trades: unknown[] } } }).__tjJournal.getState().trades.length);
    const tradesBefore = await trades();

    // nichts ist angelegt, bevor man klickt
    expect(await levels()).toBe(0);
    await expect(tid(page, "hplan-actions")).toContainText("legt an: einen Alarm beim Stop (100.065,0), einen beim Ziel (101.010,0)");

    await tid(page, "hplan-save").click();
    await expect(tid(page, "hplan-save")).toContainText("Plan gespeichert", { timeout: 15_000 });
    await expect(tid(page, "hplan-saved-state")).toContainText("Gespeichert am ");
    await expect(layer(page).locator('[data-testid^="hplan-open-"]').first()).toBeVisible();

    await tid(page, "hplan-alarms").click();
    await expect(tid(page, "hplan-alarms-state")).toContainText("3 Alarme: Stop 100.065,0 und Ziel 101.010,0 als Schlüsselmarken", { timeout: 15_000 });
    expect(await levels()).toBe(2);
    await expect(tid(page, "hplan-alarms-remove")).toBeVisible();
    await screenshot(page, info, "plan-saved", true);

    // Journal: der Editor öffnet mit einem Entwurf, gespeichert wird nichts
    await tid(page, "hplan-journal").click();
    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText("Einstieg und Größe sind geplant, nicht ausgeführt.");
    expect(await trades()).toBe(tradesBefore);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });

    // Neuladen: der Plan und die Marken sind noch da
    await page.reload();
    await expect(layer(page).locator("h1").first()).toHaveText("Handelsplan", { timeout: 30_000 });
    await expect(tid(page, "hplan-saved-note")).toBeAttached({ timeout: 30_000 });
    await expect(layer(page).locator('[data-testid^="hplan-open-"]').first()).toBeVisible();
    expect(await levels()).toBe(2);

    // der geöffnete Plan wird gemerkt: es ist derselbe Plan, nicht ein zweiter – Verwerfen nimmt Plan und Marken mit
    await expectCalculated(page);
    await expect(tid(page, "hplan-save")).toContainText("Plan gespeichert");
    await tid(page, "hplan-discard").click();
    await expect(tid(page, "hplan-saved-empty")).toBeVisible({ timeout: 15_000 });
    expect(await levels()).toBe(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("die Börse ist nicht erreichbar: der Schritt sagt es, „Neu laden“ holt die Kerzen nach", async ({ page }, info) => {
    const errors = collectErrors(page);
    const r = await openPlan(page, { fail: true });
    await expect(tid(page, "hplan-entry-headline")).toContainText("Keine Kerzen geladen:", { timeout: 30_000 });
    await expect(tid(page, "hplan-entry-state")).toHaveAttribute("data-status", "blocked");
    await expect(tid(page, "hplan-exit-headline")).toContainText("Wartet auf Schritt 1");
    await expect(tid(page, "hplan-progress")).toHaveAttribute("data-done", "0");
    await screenshot(page, info, "plan-error");

    r.fail = false;
    await tid(page, "hplan-reload").click();
    await expectCalculated(page);
    await expect(tid(page, "hplan-entry-headline")).toContainText("Signal Long");
    // die Abbrüche des Mocks sind Umgebung, kein App-Fehler (die Konsole zeigt „Failed to load resource“, ignoriert)
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("kein seitliches Scrollen, nichts abgeschnitten, alle Schritte über die Abschnittsleiste erreichbar", async ({ page }, info) => {
    await openPlan(page);
    await expectCalculated(page);
    await page.waitForTimeout(700);
    await expectNoHorizontalScroll(page);
    const clipped = await clippedTexts(layer(page));
    expect(clipped, "texts cut off by their own box").toEqual([]);
    // the section strip reaches every step
    for (const [id, label] of [["hplan-size", "3 Größe"], ["hplan-ticket", "5 Ticket"]] as const) {
      await layer(page).getByRole("button", { name: label }).first().click();
      await expect(tid(page, id)).toBeInViewport({ timeout: 10_000 });
    }
    await screenshot(page, info, "plan-top");
  });

  test("Touch-Ziele ≥ 44 px bei grobem Zeiger", async ({ page }, info) => {
    test.skip(!hasTouch(info), "touch projects");
    await openPlan(page);
    await expectCalculated(page);
    await page.waitForTimeout(600);
    // open the "Mehr" blocks so their fields are measured too
    for (const d of await layer(page).locator("details").all()) await d.evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.waitForTimeout(300);
    const exempt = (m: { where: string; w: number }) => m.where === "section-nav" || m.w <= 1;
    const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-page="plan"][data-page-role="current"]' });
    const problems = misses.filter((m) => !exempt(m)).map((m) => `${m.where} · ${m.name} ${m.w}×${m.h} → ${m.ew}×${m.eh} (taken by ${m.stolenBy})`);
    expect(problems).toEqual([]);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`axe (WCAG 2.1 A + AA, Kontrast) im ${theme === "dark" ? "dunklen" : "hellen"} Thema`, async ({ page }) => {
      test.setTimeout(120_000);
      await openPlan(page, { theme });
      await themeSettled(page);
      await expectCalculated(page);
      // alles aufklappen, damit auch die Felder unter „Mehr“ geprüft werden
      for (const d of await layer(page).locator("details").all()) await d.evaluate((el) => ((el as HTMLDetailsElement).open = true));
      await page.waitForTimeout(1200);
      const res = await new AxeBuilder({ page }).include('[data-page="plan"][data-page-role="current"]').include("header").include("footer").withTags(TAGS).analyze();
      const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      expect(lines, `axe ${theme}`).toEqual([]);
    });
  }
});


/* ============================================================================================================ Aktien */

const STOCK_BARS = /\/api\/v1\/stocks\/bars/;
const JSON_HEADERS = { "content-type": "application/json" };

interface StockRig {
  /** requests to the stock bars function, as the page made them */
  calls: URL[];
  /** while true the source answers "blocked" */
  fail: boolean;
  /** every request that is not a plain GET (an order would be one) */
  writes: string[];
  /** the New York day of the fixed session */
  day: string;
}

/** The stock functions of the page as a mock: the fixed AAPL session on `day`, hourly / daily history before it – or a blocked source. */
async function stockRig(page: Page, day: string): Promise<StockRig> {
  const state: StockRig = { calls: [], fail: false, writes: [], day };
  page.on("request", (r: Request) => {
    if (r.method() !== "GET" && r.method() !== "HEAD" && r.method() !== "OPTIONS" && !r.url().startsWith("data:")) state.writes.push(`${r.method()} ${r.url()}`);
  });
  await page.route(STOCK_BARS, async (route) => {
    const u = new URL(route.request().url());
    state.calls.push(u);
    if (state.fail) {
      return route.fulfill({ status: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: { code: "stock_upstream_blocked", message: "Die Quelle verweigert die Abrufe dieses Servers. Sie ist inoffiziell und kann ohne Vorwarnung sperren." } }) });
    }
    const interval = u.searchParams.get("interval") ?? "5m";
    const symbols = (u.searchParams.get("symbols") ?? "").split(",").filter(Boolean);
    const open = stockOpen(state.day);
    const results: Record<string, unknown> = {};
    for (const s of symbols) {
      const bars = interval === "5m" ? stockSessionBars(state.day) : stockHistoryBars(interval === "1d" ? "1d" : "1h", state.day, interval === "1d" ? 400 : 60);
      results[s] = { ok: true, bars, meta: { name: "Apple Inc.", currency: "USD", exchange: "NasdaqGS", price: 186, prevClose: 185, volume: 1_000_000, marketTime: open + 390 * 60_000 } };
    }
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ source: "yahoo", interval, range: u.searchParams.get("range"), fetchedAt: Date.now(), results }) });
  });
  return state;
}

async function openStockLink(page: Page, hash = "/#plan?symbol=AAPL&side=long", opts: { fail?: boolean; theme?: "dark" | "light" } = {}): Promise<StockRig> {
  const extra: Record<string, unknown> = {};
  if (opts.theme) extra["tj2-theme"] = JSON.stringify(opts.theme);
  await seed(page, { extra });
  const r = await stockRig(page, recentTradingDay(Date.now()));
  r.fail = !!opts.fail;
  await page.goto(hash);
  await expect(layer(page).locator("h1").first()).toHaveText("Handelsplan", { timeout: 30_000 });
  await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
  return r;
}

/** The link prefilled the form; the session of the fixed day is chosen by hand (the page itself shows the latest session). */
async function pickDay(page: Page, r: StockRig): Promise<void> {
  await tid(page, "hplan-day").fill(r.day);
}

test.describe("Handelsplan · Aktien", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("der Link füllt Aktie, Sitzung und Richtung vor – ohne etwas zu speichern; die Handrechnung auf den Kerzen der nachgebauten Quelle", async ({ page }, info) => {
    const errors = collectErrors(page);
    const r = await openStockLink(page);
    // vorgefüllt, gesagt, nichts gespeichert
    await expect(tid(page, "hplan-link-applied")).toContainText("Aus dem Link übernommen: Markt AAPL (US-Aktie) · Sitzung US-Börse (9:30 New York) · Richtung Long. Es wurde nichts gespeichert und nichts gesendet.");
    await expect(layer(page).getByRole("radio", { name: "AAPL" })).toBeChecked();
    await expect(layer(page).getByRole("radio", { name: "US-Börse (9:30 New York)" })).toBeChecked();
    await expect(layer(page).getByRole("radiogroup", { name: "Richtung des Signals" }).getByRole("radio", { name: "Long" })).toBeChecked();
    await expect(tid(page, "hplan-stocks-note")).toContainText("Yahoo Finance (inoffiziell, ohne Garantie, möglicherweise verzögert)");
    await expect(page).toHaveURL(/#plan\?symbol=AAPL&side=long$/);
    expect(await page.evaluate(() => localStorage.getItem("tj2-plan-form"))).toBeNull();
    expect(await page.evaluate(() => (JSON.parse(localStorage.getItem("tj2-settings") ?? "{}") as { plan?: unknown }).plan ?? null)).toBeNull();

    await pickDay(page, r);
    await expectCalculated(page);
    // 1 Einstieg
    await expect(tid(page, "hplan-entry-headline")).toHaveText("Signal Long: Schluss 185,90 um 09:55 Uhr über dem Hoch der Range.");
    await expect(tid(page, "hplan-range")).toContainText("185,60");
    await expect(tid(page, "hplan-range")).toContainText("184,50");
    await expect(tid(page, "hplan-range")).toContainText("185,05");
    await expect(tid(page, "hplan-candle-state")).toContainText("Rückblick: die Sitzung ist vorbei");
    await expect(tid(page, "hplan-feed-lag")).toHaveCount(0);
    // 2 Ausstieg
    await expect(tid(page, "hplan-stop")).toContainText("185,05");
    await expect(tid(page, "hplan-target")).toContainText("187,60");
    // 3 Größe: ganze Stück, Dollar, kein Hebel
    await expect(tid(page, "hplan-qty")).toHaveText("20");
    await expect(tid(page, "hplan-maxloss")).toContainText("22,56 USD");
    await expect(tid(page, "hplan-binding")).toContainText("Der Deckel für den Positionswert bindet");
    await expect(tid(page, "hplan-no-leverage")).toBeVisible();
    await expect(layer(page).getByRole("radiogroup", { name: "Hebel" })).toHaveCount(0);
    // 4 Risiko, 5 Ticket
    await expect(tid(page, "hplan-ampel")).toHaveAttribute("data-light", "green");
    await expect(tid(page, "hplan-ticket-rows")).toContainText("20 Stück (Positionswert 3.718,00 USD)");
    await expect(tid(page, "hplan-ticket-text")).toContainText("Quelle: Yahoo Finance (inoffiziell) · Kerzen bis ");
    await expect(tid(page, "hplan-ticket-text")).not.toContainText("Funding");
    await expect(layer(page).getByRole("button", { name: /senden|order|kaufen|verkaufen/i })).toHaveCount(0);
    // jeder Schritt: Satz, Quelle, Stand
    for (const id of STEPS) {
      const note = tid(page, `hplan-${id}-note`);
      await expect(note).toContainText("Keine professionelle Finanzberatung.");
      await expect(note).toContainText("Quelle: Yahoo Finance (inoffiziell) · Kerzen bis ");
    }
    // die Kerzen kamen von der Aktien-Quelle (5 Minuten, AAPL, ein Zeitraum von Yahoo), sonst ging nichts hinaus
    const asked = r.calls.filter((u) => u.searchParams.get("interval") === "5m");
    expect(asked.length, "the page asked the stock source for 5-minute candles").toBeGreaterThan(0);
    for (const u of asked) {
      expect(u.searchParams.get("symbols")).toBe("AAPL");
      expect(["1d", "5d", "1mo"]).toContain(u.searchParams.get("range"));
    }
    expect(r.writes, "no order, nothing written to any server").toEqual([]);
    await screenshot(page, info, "plan-stock-flow", true);

    // ändert die Person das Kürzel, geht der Link aus der Adresse
    await layer(page).getByTestId("hplan-symbol-input").fill("msft");
    await tid(page, "hplan-symbol-add").click();
    await expect(page).toHaveURL(/#plan$/);
    // und der Hinweis lässt sich schließen
    await tid(page, "hplan-link-close").click();
    await expect(tid(page, "hplan-link")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Erinnerung statt Marken-Alarme: speichern und „flat by close“ – es entstehen keine Schlüsselmarken; Journal-Entwurf für die Aktie", async ({ page }) => {
    const errors = collectErrors(page);
    const r = await openStockLink(page);
    await pickDay(page, r);
    await expectCalculated(page);
    const levels = () => page.evaluate(() => (window as unknown as { __tjJournal: { getState(): { settings: { keyLevels?: { levels?: unknown[] } } } } }).__tjJournal.getState().settings.keyLevels?.levels?.length ?? 0);
    await expect(tid(page, "hplan-alarms")).toContainText("Erinnerung „flat by close“");
    await expect(tid(page, "hplan-alarms-stocks")).toContainText("Preis-Alarme für Stop und Ziel gibt es für Aktien noch nicht");
    await tid(page, "hplan-alarms").click();
    await expect(tid(page, "hplan-alarms-state")).toContainText("Erinnerung: „flat by close“ um 15:55 Uhr", { timeout: 15_000 });
    expect(await levels()).toBe(0);
    await expect(layer(page).locator('[data-testid^="hplan-saved-p_"]').first()).toContainText("20 Stück");
    await tid(page, "hplan-journal").click();
    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText("Einstieg und Größe sind geplant, nicht ausgeführt.");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
    await tid(page, "hplan-discard").click();
    await expect(tid(page, "hplan-saved-empty")).toBeVisible({ timeout: 15_000 });
    expect(r.writes).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("die Quelle ist gesperrt: der Grund steht im Schritt, nichts wird erfunden – „Neu laden“ holt die Kerzen nach", async ({ page }, info) => {
    const errors = collectErrors(page);
    const r = await openStockLink(page, "/#plan?symbol=AAPL&side=long", { fail: true });
    await pickDay(page, r);
    await expect(tid(page, "hplan-entry-headline")).toContainText("Keine Kerzen geladen: Yahoo Finance (inoffiziell): Die Quelle verweigert die Abrufe dieses Servers.", { timeout: 30_000 });
    await expect(tid(page, "hplan-entry-state")).toHaveAttribute("data-status", "blocked");
    await expect(tid(page, "hplan-exit-headline")).toContainText("Wartet auf Schritt 1");
    await expect(tid(page, "hplan-progress")).toHaveAttribute("data-done", "0");
    await screenshot(page, info, "plan-stock-error");
    r.fail = false;
    await tid(page, "hplan-reload").click();
    await expectCalculated(page);
    await expect(tid(page, "hplan-entry-headline")).toContainText("Signal Long");
    // die Abbrüche des Mocks sind Umgebung, kein App-Fehler (die Konsole zeigt „Failed to load resource“, ignoriert)
    expect(errors.filter((e) => !/Failed to load resource|502/.test(e)), errors.join("\n")).toEqual([]);
  });

  test("ein ungültiger Link: übergangen und gesagt, der Markt bleibt, die Adresse wird sauber", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page, { extra: { "tj2-plan-form": { day: PLAN_DAY } } });
    await rig(page);
    await page.goto("/#plan?symbol=%40%40&side=up&x=1");
    await expect(layer(page).locator("h1").first()).toHaveText("Handelsplan", { timeout: 30_000 });
    await expect(tid(page, "hplan-link")).toBeVisible({ timeout: 30_000 });
    await expect(tid(page, "hplan-link-applied")).toContainText("Der Link enthielt nichts, was der Handelsplan übernehmen konnte. Es wurde nichts verändert.");
    const ignored = tid(page, "hplan-link-ignored");
    await expect(ignored).toHaveCount(3);
    await expect(ignored).toContainText(["„x“ im Link kennt der Handelsplan nicht", "Das Kürzel „@@“", "Die Richtung „up“"]);
    await expect(layer(page).getByRole("radio", { name: "BTCUSDT" })).toBeChecked();
    await expectCalculated(page);
    await expect(page).toHaveURL(/#plan$/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("ein Krypto-Paar im Link: die New-York-Sitzung statt der US-Börse; Richtung Short vorgefüllt", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page, { extra: { "tj2-plan-form": { day: PLAN_DAY, symbol: "BTCUSDT" } } });
    await rig(page);
    await page.goto("/#plan?symbol=BTCUSDT&side=short");
    await expect(layer(page).locator("h1").first()).toHaveText("Handelsplan", { timeout: 30_000 });
    await expect(tid(page, "hplan-link-applied")).toContainText("Markt BTCUSDT (Krypto) · Richtung Short");
    await expect(layer(page).getByRole("radiogroup", { name: "Richtung des Signals" }).getByRole("radio", { name: "Short" })).toBeChecked();
    await expect(tid(page, "hplan-stocks-note")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Zeitmaschine für die Aktie: Stunden-Kerzen vor dem Plan, die Rechnung läuft, ohne Funding", async ({ page }, info) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    const r = await openStockLink(page);
    await pickDay(page, r);
    await expectCalculated(page);
    // the card of the page and the slot inside it carry the same id: the inner one is the slot
    const slot = tid(page, "hplan-timemachine").last();
    await slot.scrollIntoViewIfNeeded();
    // vor dem Klick wird nichts geladen und gesagt, was kommt
    await expect(slot).toContainText("erst nach deinem Klick");
    await expect(slot).toContainText("Stunden-Kerzen von Yahoo Finance (inoffiziell)");
    expect(r.calls.filter((u) => u.searchParams.get("interval") === "1h" || u.searchParams.get("interval") === "1d")).toHaveLength(0);
    await tid(page, "hplan-timemachine-start").click();
    const card = slot.getByTestId("tm-card");
    await expect(card).toHaveAttribute("data-status", "done", { timeout: 120_000 });
    const hourly = r.calls.filter((u) => u.searchParams.get("interval") === "1h");
    expect(hourly).toHaveLength(1);
    expect(hourly[0]!.searchParams.get("range")).toBe("2y");
    await expect(card).toContainText("durchgespielt auf 420 Stunden-Kerzen (1h)");
    await expect(card).toContainText("Yahoo Finance (inoffiziell)");
    await expect(card.getByTestId("tm-verdict")).toBeVisible();
    await expect(card.getByTestId("tm-p-target")).toBeVisible();
    await expect(card.getByTestId("tm-expectancy")).toContainText("nach Gebühren und Slippage");
    expect((await card.getByTestId("tm-assumptions").textContent()) ?? "").not.toMatch(/Funding/);
    expect((await card.getByTestId("tm-expectancy").textContent()) ?? "").not.toMatch(/Funding/);
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "plan-stock-tm", true);
    expect(r.writes).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Zeitmaschine auf Tages-Kerzen: bis zu 5 Jahre, fünf Handelstage Zeitstopp", async ({ page }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    const r = await openStockLink(page);
    await pickDay(page, r);
    await expectCalculated(page);
    // the card of the page and the slot inside it carry the same id: the inner one is the slot
    const slot = tid(page, "hplan-timemachine").last();
    await slot.scrollIntoViewIfNeeded();
    await slot.getByRole("radio", { name: "Tages-Kerzen" }).click();
    await expect(slot).toContainText("Tages-Kerzen von Yahoo Finance (inoffiziell) (bis zu 5 Jahre)");
    await tid(page, "hplan-timemachine-start").click();
    const card = slot.getByTestId("tm-card");
    await expect(card).toHaveAttribute("data-status", "done", { timeout: 120_000 });
    const daily = r.calls.filter((u) => u.searchParams.get("interval") === "1d");
    expect(daily).toHaveLength(1);
    expect(daily[0]!.searchParams.get("range")).toBe("5y");
    await expect(card).toContainText("Eine Kerze ist ein ganzer Handelstag");
    await expect(card).toContainText("Kerzen: 1 Tag");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Aktien-Zustand: kein seitliches Scrollen, nichts abgeschnitten, Touch-Ziele ≥ 44 px", async ({ page }, info) => {
    const r = await openStockLink(page);
    await pickDay(page, r);
    await expectCalculated(page);
    await page.waitForTimeout(700);
    await expectNoHorizontalScroll(page);
    const clipped = await clippedTexts(layer(page));
    expect(clipped, "texts cut off by their own box").toEqual([]);
    if (hasTouch(info)) {
      for (const d of await layer(page).locator("details").all()) await d.evaluate((el) => ((el as HTMLDetailsElement).open = true));
      await page.waitForTimeout(300);
      const exempt = (m: { where: string; w: number }) => m.where === "section-nav" || m.w <= 1;
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-page="plan"][data-page-role="current"]' });
      const problems = misses.filter((m) => !exempt(m)).map((m) => `${m.where} · ${m.name} ${m.w}×${m.h} → ${m.ew}×${m.eh} (taken by ${m.stolenBy})`);
      expect(problems).toEqual([]);
    }
    await screenshot(page, info, "plan-stock-top");
  });

  for (const theme of ["dark", "light"] as const) {
    test(`Aktien-Zustand: axe (WCAG 2.1 A + AA, Kontrast) im ${theme === "dark" ? "dunklen" : "hellen"} Thema`, async ({ page }) => {
      test.setTimeout(120_000);
      const r = await openStockLink(page, "/#plan?symbol=AAPL&side=long", { theme });
      await pickDay(page, r);
      await themeSettled(page);
      await expectCalculated(page);
      for (const d of await layer(page).locator("details").all()) await d.evaluate((el) => ((el as HTMLDetailsElement).open = true));
      await page.waitForTimeout(1200);
      const res = await new AxeBuilder({ page }).include('[data-page="plan"][data-page-role="current"]').include("header").include("footer").withTags(TAGS).analyze();
      const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      expect(lines, `axe ${theme}`).toEqual([]);
    });
  }
});
