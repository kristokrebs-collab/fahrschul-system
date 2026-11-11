/**
 * Paket P (docs/PSYCHOLOGIE.md) end to end, no cloud: the weekly closing in Berichte (behaviour + a lesson, no result, closes and
 * re-opens, survives a reload), the opt-in reminder (OFF by default, one quiet toast per week, never in the quiet hours), the setup
 * wizard's real progress and its own rule (IKEA), the two optional feedback channels (OFF) and that finishing a process step shows ONE
 * quiet confirmation – under reduced motion without a single dot. Mobile + desktop, axe on the new cards.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, pinClock, seed, stored } from "./helpers";

const DAY = 86_400_000;
const MIN = 60_000;
/** Wed 2026-10-14 12:30 Berlin: the newest finished week is KW 41. */
const WED = Date.UTC(2026, 9, 14, 10, 30);
/** Sun 2026-10-18 18:30 Berlin (CEST): the running week is KW 42, the reminder's default time (18:00) has come. */
const SUN_EVENING = Date.UTC(2026, 9, 18, 16, 30);
/** Sun 2026-10-18 22:30 Berlin: inside the default quiet hours (22–08). */
const SUN_NIGHT = Date.UTC(2026, 9, 18, 20, 30);
const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const BERLIN = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const local = (ms: number): string => BERLIN.format(new Date(ms)).replace(" ", "T");

/** A few closed trades on each of the last days, wins and losses alike – enough for a week with trades. */
function journal(now: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let d = 1; d <= 9; d++) {
    const at = now - d * DAY - 5 * 3_600_000;
    const win = d % 3 !== 0;
    const entry = 60_000;
    out.push({
      id: `p_${d}`,
      account: "scalp",
      timeframe: "1h",
      target: null,
      fees: 1,
      pnlManual: null,
      checks: { "g:trigger": true, "g:stop": true },
      conviction: 3,
      followedPlan: true,
      emotion: "Ruhig",
      reason: "",
      notes: "",
      chart: "",
      pnl: null,
      r: null,
      mistakes: [],
      side: "long",
      status: "closed",
      date: local(at),
      exitDate: local(at + 60 * MIN),
      pair: "BTC/USDT",
      entry,
      stop: entry - 600,
      exit: win ? entry + 900 : entry - 600,
      size: 5000,
      leverage: 3,
      setups: ["s_bo"],
      createdAt: new Date(at).toISOString(),
      updatedAt: new Date(at + 60 * MIN).toISOString(),
    });
  }
  return out;
}

async function openWeek(page: Page, now: number, extra: Record<string, unknown> = {}): Promise<void> {
  const clock = await pinClock(page, now);
  await seed(page, { clock: clock.now, extra: { "tj2-trades": journal(clock.now()), ...extra } });
}

async function expectAccessible(page: Page, selector: string, what: string): Promise<void> {
  await page.waitForTimeout(900);
  const res = await new AxeBuilder({ page }).include(selector).withTags(TAGS).analyze();
  const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(lines, `${what}: axe violations`).toEqual([]);
}

test.describe("Paket P: Verhaltenspsychologie, ehrlich", () => {
  test.setTimeout(150_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "Paket P runs on mobile + desktop");
  });

  test("Wochenabschluss: Verhalten statt Ergebnis, eigene Lektion, abschließen, wieder öffnen, nach Reload noch da", async ({ page }) => {
    const errors = collectErrors(page);
    await openWeek(page, WED);
    await openRoute(page, "/#berichte", "Berichte");
    await expect(page.getByTestId("berichte-view")).toHaveAttribute("data-key", "2026-W41");

    const card = page.getByTestId("week-close");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-state", "open");
    await expect(card.getByTestId("week-close-state")).toHaveText("Dein Rückblick für KW 41 ist noch offen.");
    // it ends on behaviour: no money, no verdict, no offer
    const text = (await card.innerText()).replace(/\s+/g, " ");
    expect(text).not.toMatch(/USDT|€|\$|Gewinn|Verlust|Netto|Upgrade|Premium|\bPro-|nur noch|verpass/i);
    await expect(card.getByTestId("week-close-behaviour")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, '[data-testid="week-close"]', "Wochenabschluss offen");

    await card.getByTestId("week-close-lesson").fill("Erst den Stop setzen, dann kaufen.");
    expect(await stored(page, "tj2-settings")).not.toHaveProperty("coach.reviews"); // nothing is stored before the click
    await card.getByTestId("week-close-done").click();
    await expect(card).toHaveAttribute("data-state", "closed");
    await expect(card.getByTestId("week-close-state")).toContainText("Rückblick für KW 41 abgeschlossen am");
    await expect(card.getByTestId("week-close-count")).toHaveText("Ein Wochenrückblick abgeschlossen.");
    // one quiet confirmation of the process step
    await expect(page.getByText("Wochenrückblick abgeschlossen", { exact: true }).first()).toBeVisible();
    await expect
      .poll(async () => (await stored<{ coach?: { reviews?: Record<string, { closed: boolean; lesson: string }> } }>(page, "tj2-settings"))?.coach?.reviews?.["2026-W41"])
      .toMatchObject({ closed: true, lesson: "Erst den Stop setzen, dann kaufen." });

    await page.reload();
    const again = page.getByTestId("week-close");
    await again.scrollIntoViewIfNeeded();
    await expect(again).toHaveAttribute("data-state", "closed", { timeout: 20_000 });
    await expect(again.getByTestId("week-close-lesson")).toHaveValue("Erst den Stop setzen, dann kaufen.");
    await expectAccessible(page, '[data-testid="week-close"]', "Wochenabschluss abgeschlossen");

    // taking it back is one click, the sentence stays
    await again.getByTestId("week-close-reopen").click();
    await expect(again).toHaveAttribute("data-state", "open");
    await expect(again.getByTestId("week-close-lesson")).toHaveValue("Erst den Stop setzen, dann kaufen.");
    await expect.poll(async () => (await stored<{ coach?: { reviews?: Record<string, { closed: boolean }> } }>(page, "tj2-settings"))?.coach?.reviews?.["2026-W41"]?.closed).toBe(false);
    expect(errors).toEqual([]);
  });

  test("Erinnerung: Standard AUS, Einstellung kommt von dir, Optionen erscheinen erst nach dem Einschalten", async ({ page }) => {
    await openWeek(page, WED);
    await openRoute(page, "/#berichte", "Berichte");
    const card = page.getByTestId("week-close");
    await card.scrollIntoViewIfNeeded();
    const sw = card.getByTestId("reminder-on");
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(card.getByTestId("reminder-options")).toHaveCount(0);
    expect(await stored(page, "tj2-review-reminder")).toBeNull();
    await expect(card.getByTestId("reminder")).toContainText("Aus – bis du sie einschaltest");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(card.getByTestId("reminder-options")).toBeVisible();
    await expect(card.getByTestId("reminder")).toContainText("Es gibt keine Push-Nachrichten");
    await card.getByTestId("reminder-day").selectOption("6");
    await expect.poll(() => stored(page, "tj2-review-reminder")).toMatchObject({ v: 1, on: true, day: 6, hour: 18, quietFrom: 22, quietTo: 8 });
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, '[data-testid="reminder"]', "Erinnerung");
  });

  test("Erinnerung: genau ein ruhiger Hinweis pro Woche, nie in den Ruhezeiten, nie ohne Einschalten", async ({ page }) => {
    const on = { v: 1, on: true, day: 0, hour: 18, quietFrom: 22, quietTo: 8, lastKey: "" };
    // 1 – switched on, Sunday 18:30: the fact, once
    await openWeek(page, SUN_EVENING, { "tj2-review-reminder": on });
    await page.goto("/");
    await expect(page.getByText("Dein Rückblick für KW 42 ist bereit")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Ansehen" }).first()).toBeVisible();
    await expect.poll(() => stored<{ lastKey: string }>(page, "tj2-review-reminder").then((s) => s?.lastKey)).toBe("2026-W42");
    // a reload does not bring it back this week
    await page.reload();
    await page.waitForTimeout(3500);
    await expect(page.getByText("Dein Rückblick für KW 42 ist bereit")).toHaveCount(0);
  });

  test("Erinnerung: nicht in den Ruhezeiten und nicht ohne Einschalten", async ({ page, browser }) => {
    await openWeek(page, SUN_NIGHT, { "tj2-review-reminder": { v: 1, on: true, day: 0, hour: 18, quietFrom: 22, quietTo: 8, lastKey: "" } });
    await page.goto("/");
    await page.waitForTimeout(4000);
    await expect(page.getByText(/Dein Rückblick für KW/)).toHaveCount(0);
    // never switched on: nothing, also in the evening
    const ctx = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE", colorScheme: "dark" });
    const p2 = await ctx.newPage();
    await openWeek(p2, SUN_EVENING);
    await p2.goto("/");
    await p2.waitForTimeout(4000);
    await expect(p2.getByText(/Dein Rückblick für KW/)).toHaveCount(0);
    expect(await stored(p2, "tj2-review-reminder")).toBeNull();
    await ctx.close();
  });

  test("Einrichtung: echter Fortschritt, „Weiter, wo du aufgehört hast“, eigene Regel, Fertig → eine ruhige Bestätigung", async ({ page }) => {
    const errors = collectErrors(page);
    await openWeek(page, WED, { "tj2-setup-wizard": { v: 1, status: "active", step: 2, data: "own", at: new Date().toISOString() } });
    await openRoute(page, "/#settings", "Einstellungen");
    const card = page.getByTestId("wizard-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId("wizard-status")).toHaveText("Begonnen – 2 von 4 Schritten durchgegangen, als Nächstes: Verbindung.");
    await expect(card.getByTestId("wizard-open")).toHaveText("Weiter, wo du aufgehört hast");
    await card.getByTestId("wizard-open").click();
    const wizard = page.getByRole("dialog", { name: "Einrichtung" });
    await expect(wizard).toBeVisible({ timeout: 20_000 });
    await expect(wizard.getByTestId("setup-wizard")).toHaveAttribute("data-step", "verbindung");

    // back to the decision: one rule of the person's own, counted honestly
    await wizard.getByTestId("wizard-back").click();
    await expect(wizard.getByTestId("setup-wizard")).toHaveAttribute("data-step", "daten");
    const count = wizard.getByTestId("wizard-rules-count");
    await expect(count).toHaveText("Deine Regeln: 5");
    await wizard.getByTestId("wizard-rule-input").fill("Kein Trade ohne Stop");
    await wizard.getByTestId("wizard-rule-add").click();
    await expect(count).toHaveText("Deine Regeln: 6");
    await expect(wizard.getByTestId("wizard-rules")).toContainText("Eine davon ist von dir.");
    await expect.poll(async () => (await stored<{ rules: { text: string }[] }>(page, "tj2-settings"))?.rules.map((r) => r.text)).toContain("Kein Trade ohne Stop");
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, '[role="dialog"]', "Einrichtung");

    // finish: "Alle 4 Schritte erledigt", one quiet confirmation, no number, no fanfare
    await wizard.getByTestId("wizard-next").click();
    await wizard.getByTestId("wizard-next").click();
    await expect(wizard.getByTestId("setup-wizard")).toHaveAttribute("data-step", "start");
    await wizard.getByTestId("wizard-finish").click();
    await expect(page.getByText("Einrichtung abgeschlossen", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("wizard-status")).toHaveText("Alle 4 Schritte erledigt.");
    expect(await stored(page, "tj2-setup-wizard")).toMatchObject({ status: "done" });
    expect(errors).toEqual([]);
  });

  test("Rückmeldung: Ton und Vibration sind AUS, nur du schaltest sie ein; Reduzierte Bewegung = keine Punkte", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWeek(page, WED, { "tj2-setup-wizard": { v: 1, status: "active", step: 3, data: "own", at: new Date().toISOString() } });
    await openRoute(page, "/#settings", "Einstellungen");
    const section = page.getByTestId("feedback-section");
    await section.scrollIntoViewIfNeeded();
    await expect(section).toContainText("Nie bei Gewinn, Verlust oder einem Trade");
    await expect(section.getByTestId("feedback-sound")).toHaveAttribute("aria-checked", "false");
    if (await section.getByTestId("feedback-haptic").count()) await expect(section.getByTestId("feedback-haptic")).toHaveAttribute("aria-checked", "false");
    expect(await stored(page, "tj2-feedback")).toBeNull();
    await section.getByTestId("feedback-sound").click();
    await expect.poll(() => stored(page, "tj2-feedback")).toMatchObject({ v: 1, sound: true, haptic: false });
    await section.getByTestId("feedback-sound").click();
    await expect.poll(() => stored(page, "tj2-feedback")).toMatchObject({ v: 1, sound: false });
    await expectAccessible(page, '[data-testid="feedback-section"]', "Rückmeldung");

    // a process step under reduced motion: the quiet island, not one dot
    await page.getByTestId("wizard-open").scrollIntoViewIfNeeded();
    await page.getByTestId("wizard-open").click();
    const wizard = page.getByRole("dialog", { name: "Einrichtung" });
    await expect(wizard.getByTestId("setup-wizard")).toHaveAttribute("data-step", "start", { timeout: 20_000 });
    await wizard.getByTestId("wizard-finish").click();
    await expect(page.getByText("Einrichtung abgeschlossen", { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(900);
    await expect(page.locator("[data-celebrate] [data-burst]")).toHaveCount(0);
  });

  test("Wachstum ist Disziplin: Serien belohnen Verhalten, nie Volumen – und kein „in Gefahr“", async ({ page }) => {
    await openWeek(page, WED);
    await openRoute(page, "/#wachstum", "Wachstum");
    const streaks = page.getByTestId("growth-streaks");
    await streaks.scrollIntoViewIfNeeded();
    await expect(streaks).toContainText("auch ein roter Tag kann grün sein"); // a "green day" is about limits kept, not about profit
    const body = (await page.getByTestId("wachstum-view").innerText()).replace(/\s+/g, " ");
    expect(body).not.toMatch(/in Gefahr|Serie (verlieren|reißt)|nicht verlieren|letzte Chance|nur noch/i);
  });
});
