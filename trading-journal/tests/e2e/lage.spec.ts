/**
 * Lage-Ampel (decisions 19 / 23) end to end:
 * - the default market (real daily closes): green with the wobble chip, the EMA ladder, Details with the method; the
 *   manual scenario box and the "Long-Trigger in" row are gone; lg+ shows the panel as the hero's band, below inside
 *   the market panel; the provider's daily feed is listed in Live-Daten (`Kerzen 1D`);
 * - the synthetic fall (`mocks/synth.ts`, daily closes far under the 1D-EMA 21): red → a long entry is shown faded
 *   (`Kaufsignal · Lage rot – zählt nicht (fällt noch)`, strength 0, no fresh-entry badge, no notification), the
 *   falling-knife filter counts 0/2; `Nur Warnung` (settings, applied at once) lets it count with the warning line;
 * - switched off: the entry counts, the panel stays as information.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, fixture, pinClock, seed, stored, toast, utcToday, verdictLabel } from "./helpers";

const baseSettings = fixture["tj2-settings"] as Record<string, unknown>;
const MIN = 60_000;

declare global {
  interface Window {
    __notes?: { title: string; body?: string }[];
  }
}

/** System notifications are recorded (permission granted, the page counts as "not in front" so they are sent). */
async function stubNotifications(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__notes = [];
    class FakeNotification {
      static permission = "granted";
      static requestPermission = () => Promise.resolve("granted");
      constructor(title: string, opts?: { body?: string }) {
        window.__notes!.push({ title, body: opts?.body });
      }
      close() {}
    }
    Object.defineProperty(window, "Notification", { value: FakeNotification, configurable: true, writable: true });
    Document.prototype.hasFocus = () => false;
  });
}

const wide = (page: Page): boolean => (page.viewportSize()?.width ?? 0) >= 1024;

test.describe("Lage-Ampel", () => {
  test("default market: green with the wobble chip and the EMA ladder; no manual scenario; Details; Kerzen 1D in Live-Daten", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    const lage = page.getByTestId("lage-panel");
    await expect(lage).toHaveAttribute("data-state", "green", { timeout: 30_000 });
    await expect(lage).toHaveAttribute("data-gate", "on");
    await expect(lage.getByTestId("lage-word")).toHaveText("Grün");
    await expect(lage.getByTestId("lage-title")).toHaveText(/^(Aufwärtstrend intakt|Umkehr bestätigt)$/);
    await expect(lage.getByTestId("lage-meaning")).toContainText("Kaufsignale zählen");
    await expect(lage.getByTestId("lage-chips")).toContainText("Trend wackelt");
    await expect(lage.getByTestId("lage-ladder")).toContainText("1D-EMA 21");
    await expect(lage.getByTestId("lage-ladder")).toContainText("Kurs");
    // the reversal signs only show while the daily trend is down
    await expect(lage.getByTestId("lage-signs")).toHaveCount(0);
    // lg+: the hero's band under both columns; below: inside the market panel
    const panel = page.getByTestId("market-panel");
    if (wide(page)) {
      await expect(lage).toHaveAttribute("data-band", "");
      await expect(panel.getByTestId("lage-panel")).toHaveCount(0);
    } else await expect(panel.getByTestId("lage-panel")).toHaveCount(1);
    // the manual scenario is gone (stored levels only draw chart lines)
    await expect(page.getByTestId("scenario-box")).toHaveCount(0);
    await expect(page.getByText(/Long-Trigger in [+−-]/)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await lage.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("lage-green.png"), animations: "disabled" });

    await lage.getByRole("button", { name: "Lage-Ampel: Details" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("So entscheidet die Ampel");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.goto("/#settings");
    await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
    const daily = page.locator("td", { hasText: /^Kerzen 1D/ });
    await daily.scrollIntoViewIfNeeded();
    await expect(daily).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("settings-lage")).toHaveAttribute("data-mode", "block");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("red Lage: the long entry is shown faded and never announced", async ({ page }, info) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    await stubNotifications(page);
    // 10:20 UTC: the turn sits on the forming 30m candle; it closes 10:30
    const at = utcToday(10, 20);
    const clock = await pinClock(page, at);
    await seed(page, { synth: { ratios: "whale-long", anchor: at }, clock: clock.now, lage: true, extra: { "tj2-settings": { ...baseSettings, signals: { notify: true } } } });
    await page.goto("/#overview");
    const lage = page.getByTestId("lage-panel");
    await expect(lage).toHaveAttribute("data-state", "red", { timeout: 30_000 });
    await expect(lage.getByTestId("lage-title")).toHaveText("Fällt noch · abwarten");
    await expect(lage.getByTestId("lage-meaning")).toContainText("Kaufsignale zählen nicht");
    await expect(lage.getByTestId("lage-signs")).toContainText("0/4");

    const card = page.getByTestId("signal-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    const verdict = card.getByTestId("signal-verdict").first();
    await expect(verdict).toHaveAttribute("data-lage", "red", { timeout: 15_000 });

    // the base candle closes with the turn: the entry is confirmed — and held back
    await clock.forward(10 * MIN + 30_000);
    await expect(verdict).toHaveAttribute("data-blocked", "", { timeout: 30_000 });
    await expect(verdictLabel(card)).toHaveText("Kaufsignal · Lage rot – zählt nicht (fällt noch)");
    await expect(card.getByRole("img", { name: /^Stärke 0 von 4, gesperrt \(sonst \d\)$/ })).toBeVisible();
    await expect(card.getByText(/zählt nicht \(Lage rot\) · \d von 4 Timeframes/)).toBeVisible();
    await expect(card.getByTestId("signal-fresh")).toHaveCount(0);
    if (wide(page)) await expect(page.getByTestId("signal-strip")).toHaveAccessibleName(/^Einstiegs-Check: Kaufsignal · Lage rot – zählt nicht \(fällt noch\)/);
    // falling-knife filter: Tagestrend + 4H signs counted, both open
    await expect(page.getByTestId("knife-card")).toHaveAttribute("data-n", "0");
    await expect(page.getByTestId("knife-card")).toContainText("/2");
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("lage-red-faded.png"), animations: "disabled" });
    // no notification after the repaint hold, no Lage toast (the state did not change since the first load)
    await clock.forward(61_000);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__notes?.length ?? -1)).toBe(0);
    await expect(toast(page).getByText(/^Lage:/)).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  // `clock.forward` (page.clock.fastForward) leaves the fake animation frames behind, so a page switch after it never
  // finishes its animation: the settings radio is therefore exercised without a clock jump, the warn mode is seeded
  test("Nur Warnung: the settings radio applies at once and is stored additively in settings.signals.lage", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page, { lage: true, extra: { "tj2-settings": { ...baseSettings, signals: { notify: true } } } });
    await page.goto("/#settings");
    const settingsCard = page.getByTestId("settings-lage");
    await settingsCard.scrollIntoViewIfNeeded();
    await expect(settingsCard).toHaveAttribute("data-mode", "block");
    await settingsCard.getByRole("radio", { name: "Nur Warnung" }).click();
    await expect(settingsCard).toHaveAttribute("data-mode", "warn");
    const s = await stored<{ signals?: { notify?: boolean; lage?: { on?: boolean; mode?: string } } }>(page, "tj2-settings");
    expect(s?.signals).toMatchObject({ notify: true, lage: { on: true, mode: "warn" } });
    await page.goto("/#overview");
    await expect(page.getByTestId("lage-panel")).toHaveAttribute("data-mode", "warn", { timeout: 30_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("red Lage with Nur Warnung: the confirmed long counts, with the warning line", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await stubNotifications(page);
    const at = utcToday(10, 20);
    const clock = await pinClock(page, at);
    await seed(page, { synth: { ratios: "whale-long", anchor: at }, clock: clock.now, lage: true, extra: { "tj2-settings": { ...baseSettings, signals: { notify: true, lage: { on: true, mode: "warn" } } } } });
    await page.goto("/#overview");
    await expect(page.getByTestId("lage-panel")).toHaveAttribute("data-state", "red", { timeout: 30_000 });
    await expect(page.getByTestId("lage-panel")).toHaveAttribute("data-mode", "warn");
    const card = page.getByTestId("signal-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    await clock.forward(10 * MIN + 30_000);
    const verdict = card.getByTestId("signal-verdict").first();
    await expect(verdictLabel(card)).toHaveText("Sehr starker Long-Einstieg", { timeout: 30_000 });
    await expect(verdict).not.toHaveAttribute("data-blocked", "");
    await expect(verdict.getByTestId("signal-lage")).toHaveText("Lage rot – nur Warnung (fällt noch)");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("switched off: the entry counts, the panel stays as information without a light", async ({ page }) => {
    const errors = collectErrors(page);
    const at = utcToday(6, 3);
    const clock = await pinClock(page, at);
    const signals = { lage: { on: false, mode: "block" } };
    await seed(page, { synth: { ratios: "whale-long", anchor: at - MIN }, clock: clock.now, lage: true, extra: { "tj2-settings": { ...baseSettings, signals } } });
    await page.goto("/#overview");
    const lage = page.getByTestId("lage-panel");
    await expect(lage).toHaveAttribute("data-gate", "off", { timeout: 30_000 });
    await expect(lage).toHaveAttribute("data-state", "red", { timeout: 30_000 });
    const card = page.getByTestId("signal-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    await expect(verdictLabel(card)).toHaveText("Sehr starker Long-Einstieg", { timeout: 15_000 });
    await expect(card.getByTestId("signal-verdict").first()).not.toHaveAttribute("data-lage", /.+/);
    await expect(card.getByTestId("signal-lage")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
