/**
 * P13 first-run tour end to end (the app's real routes, see `uxHarness.ts`): an empty journal starts the tour by
 * itself after the intro; Konten & Kapital writes the settings; Setups steps aside for the editor and comes back; the
 * Börse step tells the truth without the cloud; Ziel + "Halten zum Starten" (a real pointer hold) adds the goal,
 * celebrates and remembers "done" – a reload stays quiet. Skipping is remembered too, and the settings card starts the
 * tour again. A journal with trades is never interrupted. Mobile: the sheet fits (no horizontal scroll). No console errors.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, stored, toast } from "./helpers";
import { openUx, UX_PROJECTS } from "./uxHarness";

const tour = (page: Page) => page.getByRole("dialog", { name: "Einführung" });
const step = (page: Page) => page.getByTestId("onboarding");

async function next(page: Page, to: string): Promise<void> {
  await page.getByTestId("tour-next").click();
  await expect(step(page)).toHaveAttribute("data-step", to);
}

test.describe("Einführung", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "P13 runs on mobile + desktop");
  });

  test("first run: five steps with real writes, the hold starts the journal, a reload stays quiet", async ({ page }) => {
    const errors = collectErrors(page);
    await openUx(page, "app", "overview", { empty: true, firstRun: true });
    await expect(tour(page)).toBeVisible({ timeout: 20_000 });
    await expect(step(page)).toHaveAttribute("data-step", "start");
    await expect(tour(page).getByRole("list", { name: "Fortschritt der Einführung" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await next(page, "konten");
    await page.getByLabel(/Startkapital Makro/).fill("25.000");
    await page.getByLabel(/Startkapital Scalp/).fill("5000");
    await page.getByRole("radio", { name: "EUR" }).click();
    await expectNoHorizontalScroll(page);
    await next(page, "setups");
    const settings = await stored<{ capital: Record<string, number>; currency: string }>(page, "tj2-settings");
    expect(settings!.capital).toMatchObject({ makro: 25000, scalp: 5000 });
    expect(settings!.currency).toBe("EUR");

    // the setup editor takes over, the tour waits and comes back on the same step
    await page.getByRole("button", { name: /Eigene Grundlage anlegen/ }).click();
    await expect(tour(page)).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Neue Entscheidungsgrundlage" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tour(page)).toBeVisible({ timeout: 10_000 });
    await expect(step(page)).toHaveAttribute("data-step", "setups");

    await next(page, "boerse");
    await expect(page.getByTestId("tour-exchange-off")).toContainText("Du trägst Trades selbst ein");
    await next(page, "ziel");
    await page.getByRole("radio", { name: /Höchstens 3 Trades am Tag/ }).click();

    // "Halten zum Starten": a real press held for the full fill
    const hold = page.getByTestId("tour-finish");
    await hold.scrollIntoViewIfNeeded();
    const box = (await hold.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1600);
    await page.mouse.up();
    await expect(tour(page)).toBeHidden({ timeout: 10_000 });
    await expect(toast(page)).toContainText("Startklar");
    expect(await stored<{ status: string }>(page, "tj2-onboarding")).toMatchObject({ status: "done" });
    const goals = ((await stored<{ growth?: { goals?: { metric: string }[] } }>(page, "tj2-settings"))!.growth?.goals ?? []).map((g) => g.metric);
    expect(goals).toContain("tradesPerDay");

    await page.reload();
    await page.locator("main").waitFor();
    await page.waitForTimeout(2500);
    await expect(tour(page)).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("skip is remembered; the settings card starts the tour again; Zurück goes back", async ({ page }) => {
    const errors = collectErrors(page);
    await openUx(page, "app", "settings", { empty: true, firstRun: true });
    await expect(tour(page)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("tour-skip").click();
    await expect(tour(page)).toBeHidden();
    expect(await stored<{ status: string }>(page, "tj2-onboarding")).toMatchObject({ status: "skipped" });

    await page.goto("/#settings");
    await expect(page.getByTestId("onboarding-status")).toContainText("Übersprungen");
    await page.getByRole("button", { name: "Einführung starten" }).click();
    await expect(tour(page)).toBeVisible();
    await next(page, "konten");
    await page.getByTestId("tour-back").click();
    await expect(step(page)).toHaveAttribute("data-step", "start");
    await page.getByRole("button", { name: "Schließen" }).click();
    await expect(tour(page)).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("a journal with trades is never interrupted", async ({ page }) => {
    const errors = collectErrors(page);
    await openUx(page, "app", "overview", { firstRun: true });
    await page.waitForTimeout(3000);
    await expect(tour(page)).toBeHidden();
    expect(await stored<{ status: string }>(page, "tj2-onboarding")).toMatchObject({ status: "seen" });
    expect(errors).toEqual([]);
  });
});
