/**
 * F28 Signal-Posteingang, F25 Signalbilanz, F27 Daten- und Alarmqualität (Coach) and F60 Monatsnutzen (Berichte) end to end
 * (no cloud, no API key, no market data needed).
 *
 * The Coach test is seeded relative to the browser's own clock (no fake clock): one closed long on BTC/USDT yesterday and four
 * stored signal events (one inside the window of that trade, a fresh entry, a missed Box short, a breakout that is no entry).
 * Checked: the inbox statuses, the „Ausgelassen – Grund“ mark persisting in the stored archive, filtering, collapsing, the Bilanz
 * and the Qualität cards with their honest hints (alerts only while the app is open), the presence trace, the month card with its
 * limits text – and the automatic outcomes: the Bilanz states „Wird automatisch ausgewertet.“, the run ends by itself (no click),
 * the status line names time and source, „Neu berechnen“ runs again. No horizontal scroll at 390 px, no console errors. No clock
 * jumps, no outcome numbers (those depend on market candles and are covered by the unit tests).
 */
import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, pinClock, seed, stored } from "./helpers";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
const PINNED = Date.UTC(2026, 9, 14, 10, 30);

const BERLIN = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const local = (ms: number): string => BERLIN.format(new Date(ms)).replace(" ", "T");

function trade(id: string, at: number, r: number): Record<string, unknown> {
  const entry = 60_000;
  const d = entry * 0.01;
  return {
    account: "scalp",
    timeframe: "1h",
    target: null,
    fees: 1,
    pnlManual: null,
    checks: {},
    conviction: 3,
    followedPlan: true,
    emotion: "Ruhig",
    reason: "",
    notes: "geprüft",
    chart: "",
    pnl: null,
    r: null,
    mistakes: [],
    id,
    side: "long",
    status: "closed",
    date: local(at),
    exitDate: local(at + 90 * MIN),
    pair: "BTC/USDT",
    entry,
    stop: entry - d,
    exit: Math.round(entry + r * d),
    size: 30_000,
    leverage: 3,
    setups: [],
    createdAt: new Date(at).toISOString(),
    updatedAt: new Date(at + 90 * MIN).toISOString(),
  };
}

const event = (key: string, at: number, over: Record<string, unknown>) => ({
  id: `s_${key}`,
  key,
  at,
  source: "entry",
  kind: "entry",
  entry: true,
  symbol: "BTCUSDT",
  side: "long",
  tf: "1h",
  label: `Starker Long-Einstieg ${key}`,
  detail: "Score 85",
  strength: 3,
  score: 85,
  ref: null,
  watch: false,
  ...over,
});

test.describe("Signal-Kette", () => {
  test.setTimeout(120_000);

  test("Posteingang, Ausgelassen mit Grund, Bilanz mit automatischen Ausgängen und Qualität", async ({ page }) => {
    const errors = collectErrors(page);
    const now = Date.now();
    const tradeAt = now - DAY - 7 * HOUR;
    const items = [
      event("traded", tradeAt + 10 * MIN, {}),
      event("fresh", now - 2 * HOUR, { barClose: now - 2 * HOUR - 70_000 }),
      event("missed-box", now - 30 * HOUR, { side: "short", source: "box", kind: "setup", tf: "4h", symbol: "ETHUSDT", strength: null, grade: "A+", label: "A+-Setup · Range-Short", detail: "Einstieg 2.400" }),
      event("breakout", now - 5 * HOUR, { source: "box", kind: "breakout", entry: false, strength: null, label: "Ausbruch ↑ · BTCUSDT 4h" }),
    ];
    await seed(page, { extra: { "tj2-trades": [trade("e_sc_1", tradeAt, 1.5)], "tj2-signal-events": { v: 1, items } } });
    await openRoute(page, "/#coach", "Coach", { attached: true });

    // Posteingang: four entries, statuses from the journal and the clock
    const inbox = page.getByTestId("inbox-card");
    await inbox.scrollIntoViewIfNeeded();
    await expect(inbox).toHaveAttribute("data-total", "4");
    const rows = inbox.getByTestId("inbox-row");
    await expect(rows).toHaveCount(4);
    await expect(inbox.locator("[data-testid=inbox-row][data-status=gehandelt]")).toHaveCount(1);
    await expect(inbox.locator("[data-testid=inbox-row][data-status=neu]")).toHaveCount(2);
    await expect(inbox.locator("[data-testid=inbox-row][data-status=abgelaufen]")).toHaveCount(1);
    await expect(page.getByTestId("inbox-order")).toContainText("Reihenfolge");
    await expectNoHorizontalScroll(page);

    // „Ausgelassen – Grund“ on the missed Box short: a short list, the mark is stored
    const missed = inbox.locator("[data-testid=inbox-row][data-status=abgelaufen]");
    await missed.getByTestId("inbox-skip").click();
    await expect(missed.getByTestId("inbox-skip-panel")).toBeVisible();
    await missed.getByTestId("inbox-skip-context").click();
    await expect(inbox.locator("[data-testid=inbox-row][data-status=ausgelassen]")).toContainText("Ausgelassen: Marktlage passt nicht");
    await expect
      .poll(async () => ((await stored<{ items: { key: string; skip: string | null }[] }>(page, "tj2-signal-events"))?.items ?? []).find((e) => e.key === "missed-box")?.skip)
      .toBe("context");

    // Ansehen marks a new entry as seen and shows its detail
    const fresh = inbox.locator("[data-testid=inbox-row][data-status=neu]").first();
    await fresh.getByTestId("inbox-view").click();
    await expect(inbox.getByTestId("inbox-detail")).toBeVisible();
    await expect(inbox.locator("[data-testid=inbox-row][data-status=angesehen]")).toHaveCount(1);

    // filters, collapse
    await inbox.getByTestId("inbox-filter-entries").click();
    await expect(rows).toHaveCount(3);
    await inbox.getByTestId("inbox-toggle").click();
    await expect(inbox).toHaveAttribute("data-open", "false");
    await expect(inbox.getByTestId("inbox-summary")).toBeVisible();
    await inbox.getByTestId("inbox-toggle").click();
    await expect(inbox).toHaveAttribute("data-open", "true");

    // Bilanz: the counts at once, the outcomes by themselves – the button is „Neu berechnen“, not a start
    const balance = page.getByTestId("balance-card");
    await balance.scrollIntoViewIfNeeded();
    await expect(balance).toHaveAttribute("data-signals", "3");
    await expect(balance.getByTestId("balance-compare")).toContainText("Deine Trades gegen alle Signale");
    await expect(balance.getByTestId("balance-selection")).toContainText("Auswahl");
    await expect(balance.getByTestId("outcome-run")).toHaveText(/Neu berechnen|Rechne/);
    await expect(balance.getByTestId("outcome-auto")).toContainText(/Wird automatisch ausgewertet\.|Automatische Auswertung pausiert/);
    // no click: the run ends by itself and the status line names time and source
    const control = balance.getByTestId("outcome-control");
    await expect(control).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    const stand = balance.getByTestId("outcome-stand");
    await expect(stand).toContainText("Zuletzt berechnet:");
    await expect(stand).toContainText("(automatisch)");
    await expect(stand).toContainText("Quelle:");
    await expect(balance).not.toContainText("Ausgänge berechnen");
    // „Neu berechnen“ reads again on request
    await balance.getByTestId("outcome-run").click();
    await expect(stand).toContainText("(von dir gestartet)");
    await expect(control).toHaveAttribute("data-status", "done");
    await expectNoHorizontalScroll(page);

    // Qualität: the standing hint, the delivery log, the presence trace written by the host
    const quality = page.getByTestId("quality-card");
    await quality.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("quality-banner")).toContainText("Alarme laufen nur bei offener App");
    await expect(quality.getByTestId("quality-delays")).toContainText("Median");
    await expect.poll(async () => (await stored<{ v: number; segs: unknown[] }>(page, "tj2-presence"))?.segs.length ?? 0).toBeGreaterThanOrEqual(1);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("Monatsnutzen im Monatsbericht: gezählt, nicht geschätzt", async ({ page }) => {
    const errors = collectErrors(page);
    const c = await pinClock(page, PINNED);
    const now = c.now();
    await seed(page, { clock: c.now, extra: { "tj2-trades": [trade("e_sc_2", now - 21 * DAY, 1.2), trade("e_sc_3", now - 20 * DAY, -1)] } });
    await openRoute(page, "/#berichte", "Berichte");
    await page.getByRole("radio", { name: "Monat" }).click();
    const card = page.getByTestId("benefit-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Geprüfte Einstiege");
    await expect(card.getByTestId("benefit-review")).toContainText("Trades mit Review");
    await expect(card.getByTestId("benefit-limits-text")).toContainText("Regelverstöße, die du vermieden hast, lassen sich nicht zählen");
    await expect(card.getByTestId("benefit-alerts")).toContainText("Signalarchiv");
    await expectNoHorizontalScroll(page);
    // other report kinds do not carry the card
    await page.getByRole("radio", { name: "Woche" }).click();
    await expect(page.getByTestId("benefit-card")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
