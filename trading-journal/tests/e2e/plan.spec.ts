/**
 * Handelsplan (`#plan`) im echten Build, mobil 390 + Desktop. Die Kerzen kommen aus einem festen Mock
 * (`mocks/planCandles.ts`: BTCUSDT, New Yorker Sitzung vom Montag 19.10.2026, ein Tag in der Vergangenheit – nichts hängt an der
 * Uhr, keine Uhr-Sprünge). Gemessen wird der ganze Ablauf mit der Handrechnung des Mocks:
 *   Range 99.880 – 100.250 (Mitte 100.065) · Signal Long 100.380 um 9:55 New Yorker Zeit · Stop 100.065 · Ziel 2R 101.010 ·
 *   0,037 BTC (der Positionsdeckel bindet) · Verlust am Stop 17,21 USDT · Ampel grün.
 * Dazu: eine Regel wechseln, Plan speichern → 3 Alarme → Journal-Entwurf → verwerfen, der Ladefehler mit „Neu laden“, der Satz
 * „Keine professionelle Finanzberatung.“ mit Quelle + Stand an jedem Schritt, kein seitliches Scrollen, abgeschnittene Texte,
 * Touch-Ziele, axe in beiden Themen. Die App sendet nie etwas an eine Börse – auch das wird gemessen.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";
import { clippedTexts, collectErrors, expectNoHorizontalScroll, hasTouch, screenshot, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { PLAN_DAY, planKlineRows } from "./mocks/planCandles";
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
