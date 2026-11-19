/**
 * Termine, Morgenbriefing und Ereignisphasen (F43) end to end on the Markt page (own lazy chunk, `seed(page)` = the legacy
 * journal fixture and the market mock):
 *
 * - the calendar: the next Funding with its countdown, the kinds as chips (Funding off by default, on adds one folded line per
 *   day), the month grid with Monday first and a month switch, the zone of the times (UTC: the Funding grid 00 / 08 / 16 Uhr);
 * - an own appointment: entered in the chosen zone, shown in the list with its source „Eigener Eintrag“, stored in
 *   `settings.events` (the other settings untouched), still there after a reload, deletable;
 * - „Heute wichtig“: every line names its source and a time or says there is none; what is missing is „keine Daten“;
 * - „Ereignisphasen“: six phases with the sample inside and outside, the chance note, the last backtest honestly empty;
 * - the „Inhalt“ strip of the page knows the three cards; the assistant answers „Morgenbriefing“ and opens the card;
 * - no console errors, no horizontal scroll at 390 px, touch targets ≥ 44 px on touch.
 *
 * No clock jumps and no expectation that depends on the time of day (the Funding grid, the number of day cells and the
 * structure of the cards are fixed; the own appointment is placed two days ahead of whatever "now" is).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, screenshot, seed, stored } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";

const PROJECTS = ["mobile", "desktop"];

async function openMarkt(page: Page): Promise<void> {
  await openRoute(page, "/#markt", "Markt");
  await expect(page.getByTestId("termine-card")).toBeAttached({ timeout: 40_000 });
}

/**
 * The card and everything around it is really painted. A reveal that never fires (an element taller than the screen never gets
 * the 15 % in view it waits for) leaves its wrapper at opacity 0 – `toBeVisible` does not notice, a screenshot does.
 */
async function expectPainted(card: Locator): Promise<void> {
  await expect
    .poll(() => card.evaluate((el) => { for (let n: Element | null = el; n; n = n.parentElement) if (Number(getComputedStyle(n).opacity) < 0.99) return false; return true; }), { timeout: 15_000 })
    .toBe(true);
}

/** `datetime-local` value two days ahead at 12:00 – a fixed hour on a day that is within the list's three weeks. */
const twoDaysAhead = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const d = new Date(Date.now() + 2 * 86_400_000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T12:00`;
  });

const pickOption = async (page: Page, trigger: string, option: string): Promise<void> => {
  await page.getByTestId(trigger).click();
  await page.getByRole("listbox").getByRole("option", { name: option }).click();
};

test.describe("Termine", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("the calendar: next Funding, kinds, month, zone – no errors, no horizontal scroll, touch targets", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await openMarkt(page);
    const card = page.getByTestId("termine-card");
    await card.scrollIntoViewIfNeeded();
    await expectPainted(card);

    // the next Funding is always there: computed from the 8-hour grid
    await expect(card.getByTestId("next-funding")).toContainText("Nächstes Funding");
    await expect(card.getByTestId("next-funding")).toContainText("Standardraster 8 h");

    // kinds: Funding is off by default, switching it on adds the folded line of each day
    await expect(card.getByTestId("termine-chip-funding")).toHaveAttribute("aria-pressed", "false");
    await expect(card.getByText("Funding-Abrechnungen")).toHaveCount(0);
    await card.getByTestId("termine-chip-funding").click();
    await expect(card.getByTestId("termine-chip-funding")).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByText("Funding-Abrechnungen").first()).toBeVisible();
    // the list shows the next seven days; one button brings the rest of the three weeks
    await expect(card.getByText("Funding-Abrechnungen")).toHaveCount(7);
    await card.getByTestId("termine-more").click();
    // three weeks, one folded line a day (a day of a clock change may shift the window by an hour: 20 – 22)
    const folded = await card.getByText("Funding-Abrechnungen").count();
    expect(folded).toBeGreaterThanOrEqual(20);
    expect(folded).toBeLessThanOrEqual(22);

    // an entry opens its source
    const row = card.getByTestId("event-row").first();
    await row.getByRole("button").first().click();
    await expect(row.getByTestId("event-source")).toContainText("Quelle:");
    await expect(row.getByTestId("event-source")).toContainText("Regel:");

    // the zone: UTC shows the Funding grid at 00 / 08 / 16 Uhr
    await pickOption(page, "termine-zone", "UTC");
    await expect(card.getByTestId("termine-offset")).toHaveText("UTC+0");
    await expect(card.getByTestId("next-funding")).toContainText(/(00|08|16):00 Uhr/);

    // month: a Monday-first grid of 28, 35 or 42 day cells, and the month can be switched
    await card.getByRole("radio", { name: "Monat" }).click();
    const grid = card.getByTestId("month-grid");
    await expect(grid).toBeVisible();
    const cells = await grid.locator("[data-day]").count();
    expect([28, 35, 42]).toContain(cells);
    const label = (await card.getByTestId("month-label").textContent())!;
    await card.getByTestId("month-next").click();
    await expect(card.getByTestId("month-label")).not.toHaveText(label);
    await card.getByTestId("month-prev").click();
    await expect(card.getByTestId("month-label")).toHaveText(label);

    // the sources are listed with their rule and check date
    await card.getByTestId("termine-sources").getByText("Quellen der Termine").click();
    await expect(card.getByTestId("termine-sources")).toContainText("Deribit – Verfallstermine");
    await expect(card.getByTestId("termine-sources")).toContainText("Federal Reserve – FOMC");

    await screenshot(page, info, "termine-kalender");
    await expectNoHorizontalScroll(page);
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="termine-card"]' });
      expect(misses, JSON.stringify(misses)).toEqual([]);
    }
    expect(errors).toEqual([]);
  });

  test("an own appointment: entered, listed with its source, stored in settings.events, still there after a reload, deleted", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await openMarkt(page);
    const card = page.getByTestId("termine-card");
    await card.scrollIntoViewIfNeeded();
    const before = await stored<Record<string, unknown>>(page, "tj2-settings");

    await card.getByTestId("own-open").click();
    // an empty form says what is missing
    await card.getByTestId("own-save").click();
    await expect(card).toContainText("Gib dem Termin einen Namen.");
    await expect(card).toContainText("Wähle Datum und Uhrzeit.");
    await card.getByLabel("Name", { exact: true }).fill("E2E-Termin");
    await card.getByLabel("Zeit", { exact: true }).fill(await twoDaysAhead(page));
    await card.getByTestId("own-save").click();

    const mine = card.getByTestId("event-row").filter({ hasText: "E2E-Termin" });
    await expect(mine).toHaveCount(1);
    await expect(mine).toHaveAttribute("data-kind", "own");
    await expect(mine).toContainText("12:00");
    await mine.getByRole("button").first().click();
    await expect(mine.getByTestId("event-source")).toContainText("Eigener Eintrag");

    // stored as the versioned passthrough key; the other settings are untouched
    await expect
      .poll(async () => ((await stored<{ events?: { v: number; items: { title: string; importance: string }[] } }>(page, "tj2-settings"))?.events?.items ?? []).map((i) => [i.title, i.importance]))
      .toEqual([["E2E-Termin", "mittel"]]);
    const after = await stored<Record<string, unknown>>(page, "tj2-settings");
    expect((after as { events: { v: number } }).events.v).toBe(1);
    expect({ ...after, events: undefined }).toEqual({ ...before, events: undefined });

    // it survives a reload
    await page.reload();
    await expect(page.getByTestId("termine-card")).toBeAttached({ timeout: 40_000 });
    await page.getByTestId("termine-card").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("termine-card").getByTestId("event-row").filter({ hasText: "E2E-Termin" })).toHaveCount(1, { timeout: 20_000 });

    // and can be deleted
    const again = page.getByTestId("termine-card").getByTestId("event-row").filter({ hasText: "E2E-Termin" });
    await again.getByRole("button").first().click();
    await again.getByRole("button", { name: "Termin „E2E-Termin“ löschen" }).click();
    await expect(page.getByTestId("termine-card").getByTestId("event-row").filter({ hasText: "E2E-Termin" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("Heute wichtig: sections, every line with source and time, missing data as keine Daten, the sentence that it is no advice", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await openMarkt(page);
    const card = page.getByTestId("briefing-card");
    await card.scrollIntoViewIfNeeded();
    await expectPainted(card);
    for (const id of ["overview", "events", "markets", "levels", "alerts", "checkin", "watch"]) await expect(card.getByTestId(`briefing-${id}`)).toBeVisible();
    // ONE snapshot taken inside the page: the market lines arrive while the page settles and React reuses their <li> in place, so
    // a query that resolves the elements first and reads them in a second call (evaluateAll, allTextContents) can see a text of
    // the new state under the attribute of the old one
    const lines = await card.evaluate((root) =>
      Array.from(root.querySelectorAll('[data-testid="briefing-line"]')).map((e) => ({
        missing: e.getAttribute("data-missing") === "true",
        text: e.textContent ?? "",
        source: e.querySelector('[data-testid="briefing-source"]')?.textContent ?? "",
      })),
    );
    expect(lines.length).toBeGreaterThan(8);
    for (const l of lines) {
      // every line names its source and a time or says there is none; a line that says "keine Daten" is marked and has no time
      expect(l.source).toMatch(/^Quelle: .+ · (\d\d:\d\d Uhr|keine Zeit)$/);
      if (l.missing) {
        expect(l.text).toMatch(/keine Daten/);
        expect(l.source).toContain("keine Zeit");
      }
    }
    await expect(card.getByTestId("briefing-events")).toContainText(/Funding-Abrechnungen um /);
    await expect(card.getByTestId("briefing-stand")).toContainText("Stand ");
    await expect(card).not.toContainText("Finanzberatung"); // the one sentence stands at the end of the page
    await screenshot(page, info, "termine-briefing");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("Ereignisphasen: six phases with the sample, the chance note, and the last backtest honestly empty", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await openMarkt(page);
    const card = page.getByTestId("phasen-card");
    await card.scrollIntoViewIfNeeded();
    await expectPainted(card);
    await expect(card.getByTestId("phase-row")).toHaveCount(6);
    expect(await card.getByTestId("phase-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-phase")))).toEqual(["fundingPre", "fundingPost", "expiryDay", "fomcDay", "usOpenHour", "weekend"]);
    for (const v of await card.getByTestId("phase-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-verdict")))) expect(["klar", "tendenz", "offen", "wenig"]).toContain(v);
    await expect(card.getByTestId("phasen-total")).toContainText(/Trades/);
    await expect(card.getByTestId("phasen-chance")).toContainText("keine Ursachen und keine Prognose");
    await expect(card).not.toContainText("Finanzberatung"); // the one sentence stands at the end of the page

    await card.getByRole("radio", { name: "Letzter Backtest" }).click();
    await expect(card.getByTestId("phasen-empty")).toContainText("In dieser Sitzung ist kein Backtest gelaufen", { timeout: 20_000 });
    await card.getByRole("radio", { name: "Mein Journal" }).click();
    await expect(card.getByTestId("phase-row")).toHaveCount(6);
    await screenshot(page, info, "termine-phasen");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("the Inhalt strip knows the three cards, and the assistant answers „Morgenbriefing“ and opens the card", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await openMarkt(page);
    const nav = page.getByRole("navigation", { name: "Inhalt dieser Seite" });
    for (const name of ["Jetzt", "Einordnung", "Marken & Alarme", "Termine", "Beobachten"]) await expect(nav.getByRole("button", { name })).toBeVisible();
    await nav.getByRole("button", { name: "Termine" }).click();
    // the chip brings the part „Termine“ under the strip – its first card is the briefing
    await expect(page.getByTestId("briefing-card")).toBeInViewport({ timeout: 10_000 });

    await page.getByTestId("assistant-button").click();
    const dialog = page.getByRole("dialog", { name: "Assistent" });
    await expect(dialog).toBeVisible();
    await page.getByTestId("assistant-input").fill("Morgenbriefing");
    await page.getByTestId("assistant-send").click();
    const answer = dialog.getByTestId("assistant-answer").first();
    await expect(answer).toContainText("Heute wichtig", { timeout: 20_000 });
    await expect(answer).toContainText("Keine professionelle Finanzberatung.", { timeout: 20_000 });
    // every statement carries its source in brackets (this fixture has data for everything, so nothing reads "keine Daten")
    await expect(answer).toContainText("[Ereigniskalender");
    await expect(answer).toContainText("[Marktdaten]");
    await answer.getByRole("button", { name: "Briefing mit allen Quellen öffnen" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("briefing-card")).toBeInViewport({ timeout: 10_000 });
    expect(errors).toEqual([]);
  });
});
