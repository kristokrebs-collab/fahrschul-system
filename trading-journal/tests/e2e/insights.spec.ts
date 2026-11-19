/**
 * Auswertung (Übersicht, `InsightsSection`): P&L calendar month navigation, a day cell → day view (shared-layout
 * morph), the day note autosaves to `tj2-days` and survives a reload, the Edge-Score radar, and "Fehler-Kosten"
 * for tagged trades. Legacy fixture: closed trades from January to April 2026 (newest 26 April, +294).
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, fixture, screenshot, scrollUntilVisible, seed, stored } from "./helpers";

async function gotoCalendar(page: Page) {
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  const card = page.getByTestId("insights-calendar");
  await scrollUntilVisible(page, card);
  return card;
}

/** A day cell of the shown month (`data-day="YYYY-MM-DD"`; during a month slide the old grid is still mounted). */
const dayCell = (card: ReturnType<Page["getByTestId"]>, month: string, day: number) => card.getByRole("group", { name: month }).locator(`button[data-day$="-${String(day).padStart(2, "0")}"]`);

test.describe("Auswertung", () => {
  test("calendar: month navigation, a day → day view, back to the month", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    const card = await gotoCalendar(page);
    // opens on the month of the newest closed trade
    await expect(card.getByRole("group", { name: "April 2026" })).toBeVisible();
    await expect(dayCell(card, "April 2026", 26)).toHaveAttribute("aria-label", /^26\. \+294 USDT, 1 Trade$/);
    await expect(dayCell(card, "April 2026", 9)).toHaveAttribute("aria-label", /^9\. −27 USDT, 1 Trade$/);

    await card.getByRole("button", { name: "Vorheriger Monat" }).click();
    await expect(card.getByRole("group", { name: "März 2026" })).toBeVisible();
    await expect(dayCell(card, "März 2026", 8)).toHaveAttribute("aria-label", /\+628 USDT, 1 Trade/);
    await card.getByRole("button", { name: "Nächster Monat" }).click();
    await expect(card.getByRole("group", { name: "April 2026" })).toBeVisible();

    await dayCell(card, "April 2026", 26).click();
    const day = page.getByTestId("calendar-day");
    await expect(day).toBeVisible();
    await expect(day.getByRole("heading", { name: "Sonntag, 26. April 2026" })).toBeVisible();
    await expect(day).toContainText("+294");
    await screenshot(page, info, "insights-day-view");
    // trading-day navigation inside the day view
    await day.getByRole("button", { name: "Vorheriger Handelstag" }).click();
    await expect(day.getByRole("heading", { name: "Donnerstag, 9. April 2026" })).toBeVisible();
    await day.getByRole("button", { name: "Zurück zum Monat" }).click();
    await expect(day).toHaveCount(0);
    await expect(card.getByRole("group", { name: "April 2026" })).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("day note: autosaves to tj2-days, survives a reload, the cell shows `Notiz vorhanden`", async ({ page }) => {
    await seed(page);
    let card = await gotoCalendar(page);
    await dayCell(card, "April 2026", 9).click();
    let day = page.getByTestId("calendar-day");
    const note = day.getByLabel("Tagesnotiz");
    await note.fill("E2E: Plan gehalten, zu früh raus");
    await day.getByRole("radio", { name: "Gut", exact: true }).click();
    // the blur of the note field saves at once, the mood after the 700 ms typing pause
    await expect
      .poll(async () => (await stored<Record<string, { note?: string; mood?: number | null }>>(page, "tj2-days"))?.["2026-04-09"], { timeout: 5000 })
      .toMatchObject({ note: "E2E: Plan gehalten, zu früh raus", mood: 4 });
    await expect(day.getByText("Gespeichert")).toBeVisible();

    // a note typed and left at once (no pause): closing the day view still saves it
    await day.getByRole("button", { name: "Nächster Handelstag" }).click();
    await expect(day.getByRole("heading", { name: /20\. April|26\. April/ })).toBeVisible();
    await day.getByLabel("Tagesnotiz").fill("Schnell notiert");
    await day.getByRole("button", { name: "Zurück zum Monat" }).click();
    await expect.poll(async () => Object.values((await stored<Record<string, { note?: string }>>(page, "tj2-days")) ?? {}).some((d) => d.note === "Schnell notiert")).toBe(true);

    await page.reload();
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    card = page.getByTestId("insights-calendar");
    await scrollUntilVisible(page, card);
    await expect(dayCell(card, "April 2026", 9)).toHaveAttribute("aria-label", /Notiz vorhanden/);
    await dayCell(card, "April 2026", 9).click();
    day = page.getByTestId("calendar-day");
    await expect(day.getByLabel("Tagesnotiz")).toHaveValue("E2E: Plan gehalten, zu früh raus");
    await expect(day.getByRole("radio", { name: "Gut", exact: true })).toHaveAttribute("aria-checked", "true");
  });

  test("Edge-Score: score 0–100 and the six-axis radar", async ({ page }, info) => {
    await seed(page);
    await page.goto("/#overview");
    const card = page.getByTestId("insights-edge");
    await scrollUntilVisible(page, card);
    const score = card.getByLabel(/^Edge-Score \d+ von 100$/);
    await expect(score).toBeVisible();
    const n = Number(/\d+/.exec((await score.getAttribute("aria-label")) ?? "")?.[0]);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(100);
    const radar = card.getByRole("img").first();
    const axes = ((await radar.getAttribute("aria-label")) ?? "").split(", ");
    expect(axes, axes.join(" | ")).toHaveLength(6);
    await screenshot(page, info, "insights-edge");
  });

  test("Fehler-Kosten: tagged trades cost money against the clean ones; a row lists its trades", async ({ page }, info) => {
    const errors = collectErrors(page);
    // tag the two −100 trades "Zu früh rein" and a winner "Zu früh raus" (the other version's tag field)
    const tags: Record<string, string[]> = { t_b2c3d4e5f6g: ["Zu früh rein"], t_f6g7h8i9j0k: ["Zu früh rein"], t_g7h8i9j0k1l: ["Zu früh raus"] };
    const trades = (fixture["tj2-trades"] as Record<string, unknown>[]).map((t) => (tags[t.id as string] ? { ...t, mistakes: tags[t.id as string] } : t));
    await seed(page, { extra: { "tj2-trades": trades } });
    await page.goto("/#overview");
    const card = page.getByTestId("insights-mistakes");
    await scrollUntilVisible(page, card);
    await card.getByRole("radio", { name: "Markiert" }).click();
    await expect(card).toContainText("Größtes Leck: Zu früh rein");
    const row = card.getByRole("button", { name: /^Zu früh rein · 2×/ });
    await expect(row).toBeVisible();
    await expect(row.locator("span.num").first()).toHaveText(/^−\d/);
    await expect(card.getByRole("button", { name: /^Zu früh raus · 1×/ })).toBeVisible();
    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "true");
    const list = card.locator(`#${await row.getAttribute("aria-controls")}`);
    await expect(list.getByRole("button")).toHaveCount(2);
    // "Alle" adds the automatic mistakes (e.g. no setup chosen) on top of the tags
    await card.getByRole("radio", { name: "Alle" }).click();
    await expect(card.getByRole("button", { name: /· \d+× \(\d+ automatisch\)|Ohne Grundlage|Kein Stop/ }).first()).toBeVisible();
    await screenshot(page, info, "insights-mistakes");
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
