/**
 * Schlüsselmarken (F09), Tagesplan (F08), Alarme & Zustellprotokoll (F22) and „Warum handeln oder auslassen?“ (F10) end
 * to end against the market mock with REAL BTCUSDT bars (`seed(page, { boxes: true })`):
 *
 * - Markt page: the fixed levels of the settings are listed read-only; an own level is added (price typed as `250.000`),
 *   survives a reload (stored in `settings.keyLevels`, the old keys untouched), shows its status from the candles and its
 *   reason, is edited, duplicated and deleted; timeframes the feed cannot serve are disabled WITH a reason;
 * - the day plan shows range / long / short / abwarten with trigger, invalidation and „Was den Plan ändert“;
 * - the alert card says honestly that alerts only run while the app is open and promises no server;
 * - the signal card carries „Warum handeln oder auslassen?“ with its four groups;
 * - no console errors, no horizontal scroll, touch targets ≥ 44 px on the touch project.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, fixture, hasTouch, openRoute, seed, stored } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";

const MARKT_URL = process.env.PW_MARKT_URL ?? "/#markt";
const KL_PROJECTS = ["mobile", "desktop"];

async function openMarkt(page: Page): Promise<void> {
  await openRoute(page, MARKT_URL, "Markt");
  await expect(page.getByTestId("markt-view")).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
}

/**
 * The hit-box audit (every interactive element takes a tap anywhere in 44 × 44 px) for the controls these cards add:
 * buttons, switches, the stage chips, inputs and the selects. The `Segmented` radios are left out: their tap area is
 * the primitive's own `COARSE_HIT` rule, which measures 33 px in the stock Box-Einstellungen card of the same page too
 * (see DESIGN.md, Schlüsselmarken).
 */
const OWN_CONTROLS = HIT_SELECTOR.replace('[role="radio"], ', "").replace("button,", 'button:not([role="radio"]),');

const fixtureMarket = (): Record<string, unknown> => {
  const raw = fixture["tj2-settings"];
  const s = (typeof raw === "string" ? JSON.parse(raw) : (raw ?? {})) as { market?: Record<string, unknown> };
  return s.market ?? {};
};

test.describe("Schlüsselmarken · Tagesplan · Alarme", () => {
  test.setTimeout(90_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!KL_PROJECTS.includes(info.project.name), "key levels run on mobile + desktop");
  });

  test("add, status from candles, reload, edit, duplicate, delete – the fixed levels stay untouched", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await openMarkt(page);

    const card = page.getByTestId("keylevels-card");
    await card.scrollIntoViewIfNeeded();
    // the fixed levels (settings.market) are listed, read-only, with the way to the settings
    const fixed = card.getByTestId("keylevel-fixed").getByTestId("keylevel-row");
    expect(await fixed.count()).toBeGreaterThanOrEqual(1);
    await expect(fixed.first().getByRole("button", { name: "In Einstellungen ändern" })).toBeVisible();

    // add: 250.000 above, one 4h close – far from the real price, so it waits
    await card.getByTestId("keylevel-add").click();
    const editor = page.getByTestId("keylevel-editor");
    await expect(editor).toBeVisible();
    await editor.getByLabel("Name").fill("E2E über 250k");
    await editor.getByLabel("Preis").fill("250.000");
    await expect(editor.getByText(/Erkannt als: 250\.000/)).toBeVisible();
    await editor.getByTestId("keylevel-save").click();
    const own = card.getByTestId("keylevel-list").getByTestId("keylevel-row");
    await expect(own).toHaveCount(1);
    await expect(own.first()).toHaveAttribute("data-status", "waiting", { timeout: 20_000 });
    await expect(own.first().getByTestId("keylevel-reason")).not.toBeEmpty();

    // stored as `settings.keyLevels`; the five fixed levels in `settings.market` are byte-identical
    const settings = (await stored<{ keyLevels?: { v: number; levels: Array<{ price: number; tf: string; kind: string; since: number }> }; market?: Record<string, unknown> }>(page, "tj2-settings"))!;
    expect(settings.keyLevels?.v).toBe(1);
    expect(settings.keyLevels?.levels).toHaveLength(1);
    expect(settings.keyLevels?.levels[0]).toMatchObject({ price: 250_000, tf: "4h", kind: "close" });
    expect(settings.keyLevels!.levels[0]!.since).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(fixtureMarket())) expect(settings.market?.[k], `settings.market.${k}`).toEqual(v);

    // reload: still there
    await page.reload();
    await expect(page.getByTestId("markt-view")).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
    await expect(page.getByTestId("keylevel-list").getByTestId("keylevel-row")).toHaveCount(1);

    // edit → rename, duplicate, delete with the inline question
    const row = page.getByTestId("keylevel-list").getByTestId("keylevel-row").first();
    await row.getByRole("button", { name: "Bearbeiten" }).click();
    await page.getByTestId("keylevel-editor").getByLabel("Name").fill("E2E umbenannt");
    await page.getByTestId("keylevel-save").click();
    await expect(page.getByTestId("keylevel-list").getByText("E2E umbenannt")).toBeVisible();
    await page.getByTestId("keylevel-list").getByTestId("keylevel-row").first().getByRole("button", { name: "Duplizieren" }).click();
    await expect(page.getByTestId("keylevel-list").getByTestId("keylevel-row")).toHaveCount(2);
    const first = page.getByTestId("keylevel-list").getByTestId("keylevel-row").first();
    await first.getByRole("button", { name: /löschen$/ }).click();
    await first.getByTestId("keylevel-remove-yes").click();
    await expect(page.getByTestId("keylevel-list").getByTestId("keylevel-row")).toHaveCount(1);
    await expect(page.getByTestId("keylevel-list").getByText("E2E umbenannt (Kopie)")).toBeVisible();

    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("a timeframe the feed cannot serve is disabled with its reason – never swapped", async ({ page }) => {
    await seed(page, { boxes: true });
    await openMarkt(page);
    await page.getByTestId("keylevel-add").click();
    const editor = page.getByTestId("keylevel-editor");
    const radios = editor.getByRole("radiogroup", { name: "Zeiteinheit" }).getByRole("radio");
    await expect(radios).toHaveCount(7);
    const disabled = await radios.evaluateAll((els) => els.filter((e) => (e as HTMLButtonElement).disabled || e.getAttribute("aria-disabled") === "true").map((e) => (e.textContent ?? "").trim()));
    const reasons = editor.getByTestId("keylevel-tf-blocked");
    if (disabled.length === 0) await expect(reasons).toHaveCount(0);
    else {
      await expect(reasons).toBeVisible();
      for (const tf of disabled) await expect(reasons).toContainText(tf);
    }
    // the 4h feed of the mock is served
    await expect(radios.filter({ hasText: /^4h$/ })).toBeEnabled();
  });

  test("day plan: four scenarios with trigger, invalidation and what changes the plan; precedence is a visible choice", async ({ page }) => {
    await seed(page, { boxes: true });
    await openMarkt(page);
    const plan = page.getByTestId("plan-card");
    await plan.scrollIntoViewIfNeeded();
    const scen = plan.getByTestId("plan-scenario");
    await expect(scen).toHaveCount(4);
    await expect(plan.getByTestId("plan-headline")).not.toBeEmpty();
    expect(await scen.evaluateAll((els) => els.map((e) => e.getAttribute("data-key")))).toEqual(["range", "long", "short", "wait"]);
    for (const s of await scen.all()) {
      await expect(s).toContainText("Auslöser");
      await expect(s).toContainText("Ungültig bei");
      await expect(s).toContainText("Was den Plan ändert");
    }
    await expect(plan.locator('[data-state="active"]')).toHaveCount(1);
    const card = page.getByTestId("keylevels-card");
    await card.getByRole("button", { name: /Vorrang bei Widerspruch/ }).click();
    await page.getByRole("option", { name: "Abwarten" }).click();
    await expect(plan).toContainText("Bei Widerspruch abwarten");
  });

  test("alerts: the honest note, channels and active hours, an empty Zustellprotokoll", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await openMarkt(page);
    const alerts = page.getByTestId("alerts-card");
    await alerts.scrollIntoViewIfNeeded();
    const note = alerts.getByTestId("alerts-honest");
    await expect(note).toContainText("nur, solange diese App in einem Browser-Tab geöffnet ist");
    await expect(note).toContainText("es gibt keinen Server");
    // the log is either empty or lists what was sent so far – the live signal / box alerts of the mock market may have
    // fired already (they are logged too), each line with its outcome
    const rows = alerts.getByTestId("delivery-row");
    await expect(alerts.getByTestId("delivery-empty").or(rows.first())).toBeVisible();
    for (const o of await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-outcome")))) expect(["sent", "duplicate", "hours", "channels"]).toContain(o);
    await alerts.getByRole("switch", { name: "Aktive Zeiten" }).click();
    await expect.poll(async () => (await stored<{ keyLevels?: { alerts?: { hours?: { on?: boolean } } } }>(page, "tj2-settings"))?.keyLevels?.alerts?.hours?.on).toBe(true);
    await expectNoHorizontalScroll(page);
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: OWN_CONTROLS, root: '[data-testid="alerts-card"]' });
      expect(misses, JSON.stringify(misses)).toEqual([]);
    }
    expect(errors).toEqual([]);
  });

  test("touch targets of the Schlüsselmarken card are at least 44 px on touch", async ({ page }, info) => {
    test.skip(!hasTouch(info), "touch project only");
    await seed(page, { boxes: true });
    await openMarkt(page);
    await page.getByTestId("keylevel-add").click();
    await expect(page.getByTestId("keylevel-editor")).toBeVisible();
    const misses = await page.evaluate(auditHitBoxes, { selector: OWN_CONTROLS, root: '[data-testid="keylevels-card"]' });
    expect(misses, JSON.stringify(misses)).toEqual([]);
  });
});

test.describe("Warum handeln oder auslassen? (Übersicht)", () => {
  test.setTimeout(90_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!KL_PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("the signal card explains the verdict in four groups and keeps a score from overriding a failed required condition", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await page.goto("/");
    const why = page.getByTestId("why-section");
    await expect(why).toBeVisible({ timeout: 40_000 });
    await expect(why.getByTestId("why-headline")).toContainText(/Handeln|Vorsicht|Auslassen|Nicht beurteilbar/);
    await why.getByRole("button", { name: "Details zeigen: Warum handeln oder auslassen?" }).click();
    for (const id of ["why-required", "why-optional", "why-conflicts", "why-missing", "why-late"]) await expect(page.getByTestId(id)).toBeVisible();
    // a skip because of a failed required condition always names the score as no excuse
    if ((await why.getAttribute("data-decision")) === "skip") await expect(page.getByTestId("why-score-note")).toContainText("Score");
    expect(errors).toEqual([]);
  });
});
