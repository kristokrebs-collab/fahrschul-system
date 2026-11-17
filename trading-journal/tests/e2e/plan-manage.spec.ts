/**
 * Handelsplan · Verwaltung nach dem Einstieg (F65) im echten Build, mobil 390 + Desktop. Dieselben festen Kerzen wie `plan.spec.ts`
 * (Einstieg 100.380, Stop 100.065, Risiko 315, Ziel 101.010, 0,037 BTC). Gemessen: Break-even / Teilziel / Trailing planen mit den
 * Preisen der Handrechnung, das Ticket trägt die Zeilen, „Plan → 4 Alarme“, nichts wird gesendet, kein seitliches Scrollen,
 * Touch-Ziele, axe in beiden Themen. Keine Uhr-Sprünge: die Sitzung liegt in der Vergangenheit.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";
import { clippedTexts, collectErrors, expectNoHorizontalScroll, hasTouch, screenshot, seed, shot } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { PLAN_DAY, planKlineRows } from "./mocks/planCandles";
import { themeSettled } from "./uxHarness";

const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const KLINES = /^https:\/\/fapi\.binance\.com\/fapi\/v1\/klines\?/;

const layer = (page: Page) => page.locator('[data-page="plan"][data-page-role="current"]');
const tid = (page: Page, id: string) => layer(page).getByTestId(id);

async function openPlan(page: Page, opts: { theme?: "dark" | "light" } = {}): Promise<{ writes: string[] }> {
  const writes: string[] = [];
  page.on("request", (r: Request) => {
    if (r.method() !== "GET" && r.method() !== "HEAD" && r.method() !== "OPTIONS" && !r.url().startsWith("data:")) writes.push(`${r.method()} ${r.url()}`);
  });
  const extra: Record<string, unknown> = { "tj2-plan-form": { day: PLAN_DAY } };
  if (opts.theme) extra["tj2-theme"] = JSON.stringify(opts.theme);
  await seed(page, { extra });
  await page.route(KLINES, async (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.get("symbol") !== "BTCUSDT" || u.searchParams.get("interval") !== "5m") return route.fallback();
    const from = Number(u.searchParams.get("startTime"));
    const to = Number(u.searchParams.get("endTime"));
    const limit = Number(u.searchParams.get("limit") ?? 500);
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(planKlineRows(from, to, limit)) });
  });
  await page.goto("/#plan");
  await expect(layer(page).locator("h1").first()).toHaveText("Handelsplan", { timeout: 30_000 });
  await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
  await expect(tid(page, "hplan-progress")).toHaveAttribute("data-done", "5", { timeout: 30_000 });
  return { writes };
}

/** switches the three rules on (Teilziel bei 1,5 R) */
async function planManagement(page: Page): Promise<void> {
  const card = tid(page, "hplan-manage");
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("checkbox", { name: /^Break-even/ }).click();
  await card.getByRole("checkbox", { name: /^Teilziel/ }).click();
  const atR = tid(page, "hplan-manage-pa-r");
  await atR.fill("1,5");
  await atR.blur();
  await card.getByRole("checkbox", { name: /^Trailing-Stop/ }).click();
  await expect(tid(page, "hplan-manage-steps").locator("[data-step=partial]")).toContainText("100.852,5", { timeout: 15_000 });
}

test.describe("Handelsplan · Verwaltung", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("Break-even, Teilziel und Trailing planen: die Preise der Handrechnung, im Ticket, nichts wird gesendet", async ({ page }, info) => {
    const errors = collectErrors(page);
    const rig = await openPlan(page);
    await expect(tid(page, "hplan-manage-off")).toContainText("Keine Verwaltung geplant");
    await planManagement(page);
    const steps = tid(page, "hplan-manage-steps");
    // Auslöser +1R = 100.380 + 315; Teilziel +1,5R = 100.380 + 472,5 (0,018 von 0,037 BTC)
    await expect(steps.locator("[data-step=breakEven]")).toContainText("100.695,0");
    await expect(steps.locator("[data-step=breakEven]")).toContainText("Stop von 100.065,0 auf 100.380,0");
    await expect(steps.locator("[data-step=partial]")).toContainText("0,018 BTC");
    await expect(steps.locator("[data-step=trail]")).toContainText("Trailing-Stop");
    // die Beispielrechnung zum ersten Stop ist der Verlust des Schritts 3 (17,21), nicht schöngerechnet
    await expect(tid(page, "hplan-manage-pnl-stop")).toContainText("−17,21 USDT");
    await expect(tid(page, "hplan-manage-assumed")).toBeAttached();
    // das Ticket trägt die Zeilen als Anweisung an dich selbst
    await expect(tid(page, "hplan-ticket-rows")).toContainText("Verwaltung · Break-even");
    await expect(tid(page, "hplan-ticket-text")).toContainText("die App ändert keine Order");
    await expect(tid(page, "hplan-alarms")).toContainText("Plan → 4 Alarme");
    await screenshot(page, info, "plan-manage", true);
    await tid(page, "hplan-manage").screenshot({ path: shot(info, "plan-manage-card"), animations: "disabled" });
    expect(rig.writes, "no order, nothing written to any server").toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Plan → 4 Alarme legt den Auslöser der Verwaltung als dritte Schlüsselmarke an", async ({ page }) => {
    await openPlan(page);
    await planManagement(page);
    const levels = () => page.evaluate(() => ((window as unknown as { __tjJournal: { getState(): { settings: { keyLevels?: { levels?: { name: string; price: number }[] } } } } }).__tjJournal.getState().settings.keyLevels?.levels ?? []).map((l) => `${l.name}@${l.price}`));
    expect(await levels()).toEqual([]);
    await tid(page, "hplan-alarms").click();
    await expect(tid(page, "hplan-alarms-state")).toContainText("4 Alarme: Stop 100.065,0, Auslöser der Verwaltung 100.695,0 und Ziel 101.010,0", { timeout: 15_000 });
    expect((await levels()).sort()).toEqual(["Plan-Stop BTCUSDT@100065", "Plan-Verwaltung BTCUSDT@100695", "Plan-Ziel BTCUSDT@101010"]);
    await tid(page, "hplan-discard").click();
    await expect(tid(page, "hplan-saved-empty")).toBeVisible({ timeout: 15_000 });
    expect(await levels()).toEqual([]);
  });

  test("kein seitliches Scrollen, nichts abgeschnitten", async ({ page }) => {
    await openPlan(page);
    await planManagement(page);
    await page.waitForTimeout(700);
    await expectNoHorizontalScroll(page);
    const clipped = await clippedTexts(tid(page, "hplan-manage"));
    expect(clipped, "texts cut off by their own box").toEqual([]);
  });

  test("Touch-Ziele ≥ 44 px bei grobem Zeiger", async ({ page }, info) => {
    test.skip(!hasTouch(info), "touch projects");
    await openPlan(page);
    await planManagement(page);
    await page.waitForTimeout(600);
    for (const d of await tid(page, "hplan-manage").locator("details").all()) await d.evaluate((el) => ((el as HTMLDetailsElement).open = true));
    const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="hplan-manage"]' });
    const problems = misses.filter((m) => m.w > 1).map((m) => `${m.where} · ${m.name} ${m.w}×${m.h} → ${m.ew}×${m.eh} (taken by ${m.stolenBy})`);
    expect(problems).toEqual([]);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`axe (WCAG 2.1 A + AA, Kontrast) im ${theme === "dark" ? "dunklen" : "hellen"} Thema`, async ({ page }) => {
      test.setTimeout(120_000);
      await openPlan(page, { theme });
      await themeSettled(page);
      await planManagement(page);
      for (const d of await tid(page, "hplan-manage").locator("details").all()) await d.evaluate((el) => ((el as HTMLDetailsElement).open = true));
      await page.waitForTimeout(1000);
      const res = await new AxeBuilder({ page }).include('[data-testid="hplan-manage"]').withTags(TAGS).analyze();
      const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      expect(lines, `axe ${theme}`).toEqual([]);
    });
  }
});
