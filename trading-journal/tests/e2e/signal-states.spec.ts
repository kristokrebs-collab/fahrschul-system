/**
 * Candle-close states of the Einstiegs-Check (decisions 6 + 9) on the synthetic market with a pinned page clock:
 * at 10:20 UTC the turn sits on the FORMING 30m candle → "⚠ vorläufig · schließt in mm:ss" (desaturated, strength 0,
 * the strength it gets on the close outlined); the clock jumps across the 10:30 close → "bestätigt"; across the next
 * close → "stark bestätigt". Notifications (toast + system notification) only for the CONFIRMED entry, once per signal
 * bar, after the 60 s repaint hold; never while provisional. A trade saved while provisional stores `state:
 * "provisional"`, `valid: false`, `strength: 0` and the strength it would get (`provStrength`).
 * The clock jumps with `page.clock.fastForward` — the app sees a device that slept (resume, re-polls, reconnect).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { collectErrors, fixture, pinClock, seed, stored, toast, utcToday, verdictLabel, type FakeClock } from "./helpers";
import { expectedSignals } from "./mocks/synthOracle";

const LIVE_PRICE = 84_199;
const MIN = 60_000;
/** 10:20 UTC: 20 minutes into the 30m candle that carries the turn (anchor = now). */
const AT = () => utcToday(10, 20);

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

async function open(page: Page, extra?: Record<string, unknown>): Promise<{ card: Locator; clock: FakeClock; anchor: number }> {
  const at = AT();
  const clock = await pinClock(page, at);
  await seed(page, { synth: { ratios: "whale-long", anchor: at }, clock: clock.now, extra });
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  const card = page.getByTestId("signal-card");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
  return { card, clock, anchor: at };
}

/** `mm:ss` of a countdown text → seconds. */
const secs = (t: string): number => {
  const m = /(\d+):(\d\d)/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

test.describe("candle-close states", () => {
  test("vorläufig → bestätigt → stark bestätigt across the 30m closes; notified once, only when confirmed", async ({ page }, info) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    await stubNotifications(page);
    const settings = { ...(fixture["tj2-settings"] as Record<string, unknown>), signals: { notify: true } };
    const { card, clock, anchor } = await open(page, { "tj2-settings": settings });
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;

    // ---- 10:20 — provisional: the signal sits on the forming candle
    const exp0 = expectedSignals(anchor, clock.now(), LIVE_PRICE, "whale-long");
    expect(exp0.long.state, "oracle: provisional on the forming candle").toBe("provisional");
    expect(exp0.long.valid).toBe(false);
    const verdict = card.getByTestId("signal-verdict");
    await expect(verdict).toHaveAttribute("data-state", "provisional", { timeout: 15_000 });
    const state = verdict.getByTestId("signal-state");
    await expect(state).toHaveAttribute("data-state", "provisional");
    await expect(state).toHaveText(/^⚠vorläufig · schließt in \d{1,2}:\d\d$/);
    // the countdown runs on the shared clock (no re-render needed) and points at the 10:30 close
    const t1 = secs((await state.textContent()) ?? "");
    expect(t1, "≈ 10 min to the close").toBeGreaterThan(8 * 60);
    expect(t1).toBeLessThanOrEqual(10 * 60);
    await expect.poll(async () => secs((await state.textContent()) ?? ""), { timeout: 5_000 }).toBeLessThan(t1);
    // the label keeps "Vorläufig: " for screen readers only; strength 0, the close strength outlined
    await expect(verdictLabel(card)).toHaveText(exp0.long.label);
    expect(exp0.long.label).toBe("Vorläufig: Sehr starker Long-Einstieg");
    await expect(card.getByRole("img", { name: `Stärke 0 von 4, vorläufig ${exp0.long.provStrength}` })).toBeVisible();
    await expect(card.getByText(/ab Kerzenschluss · \d von 4 Timeframes/)).toBeVisible();
    await expect(card.getByTestId("signal-rung").first()).toHaveAttribute("data-state", "provisional");
    await expect(card.getByTestId("signal-rung").first().getByTestId("signal-rung-state")).toHaveText(/^⚠vorläufig·(schließt in)?\d{1,2}:\d\d$/);
    // bias bar: the entry's state with the countdown tag
    const bias = card.getByTestId("signal-bias");
    await expect(bias).toHaveAttribute("data-state", "provisional");
    await expect(bias).toHaveAttribute("data-provisional", "true");
    await expect(bias.getByTestId("bias-provisional")).toHaveText(/^⚠vorläufig · \d+:\d\d$/);
    if (wide) await expect(page.getByTestId("signal-strip").getByTestId("signal-state")).toHaveAttribute("data-state", "provisional");
    await page.screenshot({ path: info.outputPath("state-provisional.png"), animations: "disabled" });
    // nothing is announced for a provisional entry
    await page.waitForTimeout(1500);
    await expect(card.getByTestId("signal-fresh")).toHaveCount(0);
    expect(await page.evaluate(() => window.__notes?.length ?? -1)).toBe(0);

    // ---- 10:30:30 — the base candle closed with the signal: confirmed
    await clock.forward(10 * MIN + 30_000);
    await expect(verdict).toHaveAttribute("data-state", "confirmed", { timeout: 30_000 });
    await expect(state).toHaveText("✓bestätigt · 30m-Kerze geschlossen");
    await expect(verdictLabel(card)).toHaveText("Sehr starker Long-Einstieg");
    await expect(card.getByTestId("signal-rung").first()).toHaveAttribute("data-state", "confirmed");
    await expect(bias).toHaveAttribute("data-state", "confirmed");
    // a NEW valid entry: the card marks it at once …
    await expect(card.getByTestId("signal-fresh")).toContainText("Neuer Long-Einstieg");
    const exp1 = expectedSignals(anchor, clock.now(), LIVE_PRICE, "whale-long");
    expect(exp1.long.state).toBe("confirmed");
    await expect(card.getByRole("img", { name: `Stärke ${exp1.long.strength} von 4` })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: info.outputPath("state-confirmed.png"), animations: "disabled" });
    // … the notification waits for the 60 s repaint hold
    expect(await page.evaluate(() => window.__notes?.length ?? -1)).toBe(0);
    await clock.forward(61_000);
    await expect.poll(() => page.evaluate(() => window.__notes?.length ?? -1), { timeout: 15_000 }).toBe(1);
    const note = (await page.evaluate(() => window.__notes![0]!))!;
    expect(note.title).toBe("Sehr starker Long-Einstieg");
    expect(note.body).toContain("bestätigt");
    expect(note.body).toContain("Top-Trader 4/4");
    await expect(toast(page)).toContainText("Sehr starker Long-Einstieg");

    // ---- 11:01:30 — still lit after the next close, the move held: strong; no second notification (same signal bar)
    await clock.forward(30 * MIN);
    await expect(verdict).toHaveAttribute("data-state", "strong", { timeout: 30_000 });
    await expect(state).toHaveText(/^✓✓stark bestätigt · \d Schlüsse gehalten$/);
    await expect(card.getByTestId("signal-rung").first()).toHaveAttribute("data-state", "strong");
    if (wide) await expect(page.getByTestId("signal-strip").getByTestId("signal-state")).toHaveAttribute("data-state", "strong");
    await page.screenshot({ path: info.outputPath("state-strong.png"), animations: "disabled" });
    await clock.forward(61_000);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__notes?.length ?? -1), "one notification per signal bar").toBe(1);
    // persisted once per bar (a reload or a second tab does not repeat it)
    const last = await page.evaluate(() => Object.keys(localStorage).find((k) => k.endsWith("signal-last")) ?? null);
    expect(last).not.toBeNull();
    expect(Object.keys((await stored<Record<string, unknown>>(page, last!)) ?? {})).toEqual(["long"]);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a trade saved while the entry is provisional stores the provisional state (valid false, strength 0, provStrength)", async ({ page }) => {
    const errors = collectErrors(page);
    const { anchor, clock } = await open(page);
    const exp = expectedSignals(anchor, clock.now(), LIVE_PRICE, "whale-long");
    expect(exp.long.state).toBe("provisional");
    await page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Trade eintragen" }).click();
    const editor = page.getByRole("dialog", { name: "Trade eintragen" });
    await expect(editor).toBeVisible();
    const summary = editor.getByTestId("signal-summary");
    await expect(summary).toHaveAttribute("data-state", "provisional", { timeout: 15_000 });
    await expect(summary).toHaveAttribute("data-strength", "0");
    await expect(summary.getByTestId("signal-summary-state")).toHaveText(/^⚠vorläufig · schließt in \d{1,2}:\d\d$/);
    await expect(summary).toContainText("Sehr starker Long-Einstieg");
    await editor.locator("#f-entry").click();
    await editor.locator("#f-entry").fill("84100");
    await editor.locator("#f-stop").fill("83500");
    await editor.locator("#f-exit").fill("85300");
    await editor.locator("#f-size").fill("2000");
    await editor.locator("#f-reason").fill("E2E vorläufig");
    await editor.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(editor).toBeHidden();
    const trades = (await stored<{ reason?: string; signal?: Record<string, unknown> | null }[]>(page, "tj2-trades")) ?? [];
    const t = trades.find((x) => x.reason === "E2E vorläufig");
    expect(t?.signal, "snapshot").toBeTruthy();
    expect(t!.signal).toMatchObject({ side: "long", state: "provisional", valid: false, strength: 0, provStrength: exp.long.provStrength, mode: "live" });
    expect(String(t!.signal!.label)).toMatch(/^Vorläufig: /);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
