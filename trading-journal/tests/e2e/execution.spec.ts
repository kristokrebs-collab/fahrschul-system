/**
 * „Ausführbarkeit jetzt (live)“ (F44) im Handelsplan, mobil 390 + Desktop: die Karte im Ticket-Schritt liest erst auf den Klick ein
 * Orderbuch (nichts vorher), zeigt Spread, den Durchlauf der geplanten Größe, den Stop-Ausstieg gegen die Annahme des Plans und den
 * Anteil am Tagesumsatz – mit Quelle, Stand und dem Satz „Keine professionelle Finanzberatung.“; eine gescheiterte Abfrage steht mit
 * Grund da und ist keine Freigabe; die App sendet nichts (kein Schreibzugriff). Der Plan ist der feste Mock von `plan.spec.ts`
 * (Long BTCUSDT 0,037 BTC, Einstieg 100.380, 5 bp Slippage angenommen), das Orderbuch eine feste Route:
 *   Käufer 100.379,9 × 0,5 · 100.379 × 1 · Verkäufer 100.380,1 × 0,02 · 100.381 × 0,02 · 100.390 × 5 → Spread 0,02 bp, Kauf Ø 100.380,5.
 * Keine Uhr-Sprünge, nichts hängt an der Tageszeit des Mocks.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, screenshot, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { PLAN_DAY, planKlineRows } from "./mocks/planCandles";
import { themeSettled } from "./uxHarness";

const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const KLINES = /^https:\/\/fapi\.binance\.com\/fapi\/v1\/klines\?/;
const DEPTH = /^https:\/\/fapi\.binance\.com\/fapi\/v1\/depth\?/;

const layer = (page: Page) => page.locator('[data-page="plan"][data-page-role="current"]');
const tid = (page: Page, id: string) => layer(page).getByTestId(id);

interface Rig {
  depth: URL[];
  failDepth: boolean;
  writes: string[];
}

async function rig(page: Page): Promise<Rig> {
  const state: Rig = { depth: [], failDepth: false, writes: [] };
  page.on("request", (r: Request) => {
    if (r.method() !== "GET" && r.method() !== "HEAD" && r.method() !== "OPTIONS" && !r.url().startsWith("data:")) state.writes.push(`${r.method()} ${r.url()}`);
  });
  await page.route(KLINES, async (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.get("symbol") !== "BTCUSDT" || u.searchParams.get("interval") !== "5m") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(planKlineRows(Number(u.searchParams.get("startTime")), Number(u.searchParams.get("endTime")), Number(u.searchParams.get("limit") ?? 500))),
    });
  });
  await page.route(DEPTH, async (route) => {
    const u = new URL(route.request().url());
    state.depth.push(u);
    if (state.failDepth) return route.abort("failed");
    const now = Date.now();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        lastUpdateId: 1,
        E: now,
        T: now - 40,
        bids: [["100379.90", "0.500"], ["100379.00", "1.000"]],
        asks: [["100380.10", "0.020"], ["100381.00", "0.020"], ["100390.00", "5.000"]],
      }),
    });
  });
  return state;
}

async function openPlan(page: Page, opts: { theme?: "dark" | "light" } = {}): Promise<Rig> {
  const extra: Record<string, unknown> = { "tj2-plan-form": { day: PLAN_DAY } };
  if (opts.theme) extra["tj2-theme"] = JSON.stringify(opts.theme);
  await seed(page, { extra });
  const state = await rig(page);
  await page.goto("/#plan");
  await expect(layer(page).locator("h1").first()).toHaveText("Handelsplan", { timeout: 30_000 });
  await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
  await expect(tid(page, "hplan-progress")).toHaveAttribute("data-done", "5", { timeout: 30_000 });
  await tid(page, "hplan-exec").scrollIntoViewIfNeeded();
  return state;
}

test.describe("Ausführbarkeit jetzt (F44)", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("erst auf den Klick: Spread, Durchlauf der Größe, Annahme, Umsatz – mit Quelle, Stand und dem Satz; nichts wird gesendet", async ({ page }, info) => {
    const errors = collectErrors(page);
    const r = await openPlan(page);
    const card = tid(page, "hplan-exec");
    await expect(card).toContainText("Ein Blick ins Orderbuch");
    await expect(tid(page, "hplan-exec-result")).toHaveCount(0);
    expect(r.depth, "nothing is read before the click").toHaveLength(0);
    await screenshot(page, info, "exec-before", false);

    await tid(page, "hplan-exec-run").click();
    await expect(tid(page, "hplan-exec-result")).toBeVisible({ timeout: 20_000 });
    expect(r.depth).toHaveLength(1);
    expect(r.depth[0]!.searchParams.get("symbol")).toBe("BTCUSDT");
    expect(r.depth[0]!.searchParams.get("limit")).toBe("1000");
    await expect(tid(page, "hplan-exec-result")).toHaveAttribute("data-tone", "ok");
    await expect(tid(page, "hplan-exec-headline")).toContainText("Das Orderbuch von jetzt trägt die Größe");
    await expect(tid(page, "hplan-exec-spread")).toContainText("Spread 0,02 bp (0,2) – Kauf 100.380,1, Verkauf 100.379,9 · eng");
    await expect(tid(page, "hplan-exec-entry")).toContainText("Einstieg (Kauf 0,037 BTC): Ø-Preis 100.380,5 · 0,04 bp über den besten Preis hinaus · 0,05 bp von der Mitte · 2 Stufen");
    await expect(tid(page, "hplan-exec-stop")).toContainText("Stop-Ausstieg (Verkauf 0,037 BTC): Ø-Preis 100.379,9");
    await expect(tid(page, "hplan-exec-assumption")).toContainText("Annahme im Plan: Slippage am Stop 5,00 bp. Das Orderbuch jetzt: 0,01 bp von der Mitte – die Annahme deckt es.");
    await expect(tid(page, "hplan-exec-turnover")).toContainText("des 24-h-Umsatzes");
    const stand = tid(page, "hplan-exec-stand");
    await expect(stand).not.toContainText("Finanzberatung");
    await expect(stand).toContainText("Quelle: Binance USDⓈ-M · Orderbuch /fapi/v1/depth (3 Stufen, direkt) · Stand ");
    await expect(stand).toContainText(" Uhr · abgerufen ");
    await expect(card).toContainText("Eine Momentaufnahme");
    await expect(tid(page, "hplan-exec-old")).toHaveCount(0);
    // the plan above is untouched and the page still has no way to send an order
    await expect(layer(page).getByRole("button", { name: /senden|order|kaufen|verkaufen/i })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "exec-result", false);
    expect(r.writes, "nothing is sent anywhere").toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("scheitert die Abfrage, steht der Grund da – keine Zahlen, keine Freigabe; ein neuer Versuch klappt", async ({ page }, info) => {
    const r = await openPlan(page);
    r.failDepth = true;
    await tid(page, "hplan-exec-run").click();
    const failed = tid(page, "hplan-exec-failed");
    await expect(failed).toBeVisible({ timeout: 20_000 });
    await expect(failed).toContainText("Das Orderbuch ließ sich nicht lesen:");
    await expect(failed).toContainText("Das ist keine Freigabe");
    await expect(failed).toContainText("Stand: keine Daten");
    await expect(tid(page, "hplan-exec-result")).toHaveCount(0);
    await screenshot(page, info, "exec-failed", false);
    r.failDepth = false;
    await expect(tid(page, "hplan-exec-run")).toContainText("Erneut prüfen");
    await tid(page, "hplan-exec-run").click();
    await expect(tid(page, "hplan-exec-result")).toBeVisible({ timeout: 20_000 });
    await expect(tid(page, "hplan-exec-failed")).toHaveCount(0);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`barrierefrei und mit großen Tippflächen (${theme})`, async ({ page }, info) => {
      await openPlan(page, { theme });
      await themeSettled(page);
      await tid(page, "hplan-exec-run").click();
      await expect(tid(page, "hplan-exec-result")).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1000);
      const res = await new AxeBuilder({ page }).include('[data-testid="hplan-exec"]').withTags(TAGS).analyze();
      const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      expect(lines, `axe ${theme}`).toEqual([]);
      if (hasTouch(info)) {
        const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="hplan-exec"]' });
        expect(misses, misses.map((m) => `${m.name} ${m.w}×${m.h} (${m.where})`).join("\n")).toEqual([]);
      }
    });
  }
});
