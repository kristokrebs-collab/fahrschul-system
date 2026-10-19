/**
 * F62 "Chart spiegeln / Bias prüfen" end to end on the production build: the Markt box chart (real BTCUSDT 4h / 1D bars
 * of the Box fixture) and the trade replay (synthetic market).
 *
 * - The switch turns ONLY the price axis: the boxes' vertical order reverses, the bars and boxes handed to the chart are
 *   byte-identical, and flipping twice puts every box back where it was.
 * - Layers one by one (Boxen, RSI); the RSI legend never says 100−RSI unless that option is ticked.
 * - The guided test: market name covered + other cards hidden, the picture frozen at the last CLOSED bar, the first answer
 *   STORED (still without a second one) before the chart turns, the second stored before the original returns, both answers
 *   side by side without a score; the history takes the outcome later.
 * - The replay: the same panel; the frozen picture shows no exit / target and no P&L readouts.
 * - No console errors, no horizontal scroll at 390 px.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, fixture, isMobile, openRoute, seed } from "./helpers";
import { synthPrice } from "./mocks/synth";

const HOUR = 3_600_000;
const PROJECTS = ["mobile", "desktop"];
const MARKT = "/#markt";

interface Snapshot {
  bars: string;
  boxes: string;
  /** ids ordered by the vertical centre of their box on screen (top first) */
  order: string[];
  centres: Record<string, number>;
  lastBarSec: number;
  barCount: number;
}

/**
 * The picture is upside down relative to `ref`: some box moved vertically, and every pair of boxes that sat apart on
 * `ref` (a narrow phone shows only one box) now sits in the opposite order.
 */
function isTurned(ref: Record<string, number>, now: Record<string, number>): boolean {
  const ids = Object.keys(ref);
  if (!ids.some((id) => Math.abs((now[id] ?? ref[id]!) - ref[id]!) > 8)) return false;
  for (const a of ids) for (const b of ids) if (ref[b]! - ref[a]! > 8 && !(now[b]! - now[a]! < -8)) return false;
  return true;
}

/** What the Markt chart holds and draws right now (the read-only box hook of the chart host). */
async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="markt-chart"] [role="img"][aria-label="Kerzenchart"]') as
      | (Element & { __tjBoxes?: { geometry(): { id: string; y1: number; y2: number }[]; boxes(): unknown[]; bars(): { time: number }[] } })
      | null;
    const hook = host?.__tjBoxes;
    if (!hook) throw new Error("no chart hook");
    const bars = hook.bars();
    const centres: Record<string, number> = {};
    for (const g of hook.geometry()) centres[g.id] = (g.y1 + g.y2) / 2;
    return {
      bars: JSON.stringify(bars),
      boxes: JSON.stringify(hook.boxes()),
      order: Object.keys(centres).sort((a, b) => centres[a]! - centres[b]!),
      centres,
      lastBarSec: bars[bars.length - 1]?.time ?? 0,
      barCount: bars.length,
    };
  });
}

async function openMarkt(page: Page): Promise<void> {
  await seed(page, { boxes: true });
  await openRoute(page, MARKT, "Markt");
  await expect(page.getByTestId("markt-view")).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  const chart = page.getByTestId("markt-chart");
  await chart.scrollIntoViewIfNeeded();
  await expect(chart.locator("[data-ready=true]")).toBeVisible({ timeout: 20_000 });
  await expect(chart.locator("[data-settled]").first()).toHaveAttribute("data-settled", "true", { timeout: 20_000 });
}

const controls = (page: Page) => page.getByTestId("markt-chart").getByTestId("bias-controls");
const biasTests = (page: Page) => page.evaluate(() => (window as unknown as { __tjJournal: { getState(): { settings: { biasTests?: { tests?: Record<string, unknown>[] } } } } }).__tjJournal.getState().settings.biasTests?.tests ?? []);

test.describe("Chart spiegeln", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("nur die Achse kippt: Reihenfolge der Boxen kehrt sich um, Daten identisch, zweimal spiegeln = Original", async ({ page }, info) => {
    const errors = collectErrors(page);
    await openMarkt(page);
    const ctl = controls(page);
    await expect(ctl).toHaveAttribute("data-flipped", "false");
    const plain = await snapshot(page);
    expect(plain.order.length).toBeGreaterThan(0);

    await ctl.getByTestId("bias-flip").click();
    await expect(ctl).toHaveAttribute("data-flipped", "true");
    await expect.poll(async () => isTurned(plain.centres, (await snapshot(page)).centres), { timeout: 20_000 }).toBe(true);
    const flipped = await snapshot(page);
    // nothing but the axis: the bars and the boxes (prices, times) are byte-identical
    expect(flipped.bars).toBe(plain.bars);
    expect(flipped.boxes).toBe(plain.boxes);
    expect(flipped.lastBarSec).toBe(plain.lastBarSec);
    await expect(ctl.getByTestId("bias-flip-note")).toContainText("Kurse und Zeiten sind unverändert");

    await ctl.getByTestId("bias-flip").click();
    await expect(ctl).toHaveAttribute("data-flipped", "false");
    await expect
      .poll(
        async () => {
          const s = await snapshot(page);
          return Object.keys(plain.centres).every((id) => Math.abs(s.centres[id]! - plain.centres[id]!) < 1.5);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    const back = await snapshot(page);
    expect(back.bars).toBe(plain.bars);
    expect(back.boxes).toBe(plain.boxes);
    if (isMobile(info)) await expectNoHorizontalScroll(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Ebenen einzeln; der RSI wird nie still mitgespiegelt, 100−RSI nur auf Wunsch und beschriftet", async ({ page }) => {
    const errors = collectErrors(page);
    await openMarkt(page);
    const chart = page.getByTestId("markt-chart");
    const ctl = controls(page);
    await expect(chart.getByTestId("rsi-legend")).toContainText(/^RSI 14\s*\d+,\d/);

    // boxes off → none drawn, none handed to the chart; on again → back
    const hasBoxes = () => snapshot(page).then((s) => s.order.length);
    expect(await hasBoxes()).toBeGreaterThan(0);
    await ctl.getByRole("button", { name: "Boxen" }).click();
    await expect.poll(hasBoxes, { timeout: 20_000 }).toBe(0);
    await ctl.getByRole("button", { name: "Boxen" }).click();
    await expect.poll(hasBoxes, { timeout: 20_000 }).toBeGreaterThan(0);

    // the RSI option exists only on a flipped chart, is off, and the legend keeps saying RSI
    await expect(ctl.getByTestId("bias-rsi-option")).toHaveCount(0);
    await ctl.getByTestId("bias-flip").click();
    const option = ctl.getByTestId("bias-rsi-mirror");
    await expect(option).not.toBeChecked();
    await expect(chart.getByTestId("rsi-legend")).not.toContainText("100−RSI");
    await option.check();
    await expect(chart.getByTestId("rsi-legend")).toContainText(/^100−RSI 14\s*\d+,\d/);
    await option.uncheck();
    await expect(chart.getByTestId("rsi-legend")).not.toContainText("100−RSI");

    // RSI pane off
    await ctl.getByRole("button", { name: "RSI", exact: true }).click();
    await expect(chart.getByTestId("rsi-legend")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Bias-Test: verdeckt, eingefroren auf der letzten geschlossenen Kerze, erst speichern – dann spiegeln – dann aufdecken", async ({ page }, info) => {
    const errors = collectErrors(page);
    await openMarkt(page);
    const ctl = controls(page);
    const before = await snapshot(page);
    // a card of the page that tells the direction
    await expect(page.getByTestId("best-setup").first()).toBeVisible();
    const status = page.getByTestId("markt-status");
    await expect(status).not.toContainText("Markt verdeckt");

    await ctl.getByTestId("bias-start").click();
    const setup = ctl.getByTestId("bias-setup");
    await setup.getByLabel("Marktnamen verdecken").check();
    await setup.getByLabel("Long-/Short-Farben neutralisieren").check();
    await setup.getByTestId("bias-begin").click();

    // step 1: name covered, the page shows only the chart, the picture ends at a CLOSED bar, nothing stored yet
    const first = ctl.getByTestId("bias-first");
    await expect(first).toBeVisible();
    await expect(status).toContainText("Markt verdeckt");
    await expect(page.getByTestId("best-setup")).toHaveCount(0);
    await expect(page.getByTestId("bias-focus-note")).toBeVisible();
    await expect(ctl).toHaveAttribute("data-flipped", "false");
    expect(await biasTests(page)).toHaveLength(0);
    await expect.poll(async () => (await snapshot(page)).barCount, { timeout: 20_000 }).toBeLessThanOrEqual(before.barCount);
    const frozen = await snapshot(page);
    const nowMs = await page.evaluate(() => Date.now());
    expect(frozen.lastBarSec * 1000 + 4 * HOUR).toBeLessThanOrEqual(nowMs);

    // an empty answer is refused and says what is missing
    await first.getByTestId("bias-submit-first").click();
    await expect(first.getByTestId("bias-gaps")).toContainText("Richtung wählen");
    expect(await biasTests(page)).toHaveLength(0);

    await first.getByRole("radio", { name: "Long" }).click();
    await first.getByTestId("bias-conditions").fill("4h-Schluss über der Oberkante der Box");
    await first.getByTestId("bias-invalidation").fill("Schluss zurück in der Box");
    await first.getByTestId("bias-submit-first").click();

    // the first answer is stored (with its time, WITHOUT a second one) and the chart is turned
    const second = ctl.getByTestId("bias-second");
    await expect(second).toBeVisible();
    await expect(ctl).toHaveAttribute("data-flipped", "true");
    const mid = await biasTests(page);
    expect(mid).toHaveLength(1);
    expect(mid[0]).toMatchObject({ first: { direction: "long", conditions: "4h-Schluss über der Oberkante der Box" }, context: { surface: "markt", interval: "4h" } });
    expect(mid[0]!.second).toBeUndefined();
    expect(typeof (mid[0]!.first as { at: string }).at).toBe("string");
    await expect.poll(async () => isTurned(frozen.centres, (await snapshot(page)).centres), { timeout: 20_000 }).toBe(true);
    // still the same bars, still ending at the anchor
    const turned = await snapshot(page);
    expect(turned.bars).toBe(frozen.bars);
    expect((mid[0]!.context as { anchorMs: number }).anchorMs).toBe(frozen.lastBarSec * 1000);
    await page.screenshot({ path: info.outputPath(`bias-flipped-${info.project.name}.png`) });

    await second.getByRole("radio", { name: "Short" }).click();
    await second.getByTestId("bias-conditions").fill("Auf dem Kopf sieht das nach Abverkauf aus");
    await second.getByTestId("bias-invalidation").fill("Neues Hoch über der Box");
    await second.getByTestId("bias-submit-second").click();

    // revealed: original orientation, name and cards back, both answers side by side – and no score
    const revealed = ctl.getByTestId("bias-revealed");
    await expect(revealed).toBeVisible();
    await expect(ctl).toHaveAttribute("data-flipped", "false");
    await expect(status).not.toContainText("Markt verdeckt");
    await expect(page.getByTestId("best-setup").first()).toBeVisible();
    await expect(revealed.getByTestId("bias-comparison")).toHaveAttribute("data-relation", "mirrored");
    await expect(revealed.getByTestId("bias-headline")).toContainText("passen zusammen");
    await expect(revealed).toContainText("4h-Schluss über der Oberkante der Box");
    await expect(revealed).toContainText("Auf dem Kopf sieht das nach Abverkauf aus");
    expect((await revealed.innerText()).toLowerCase()).not.toMatch(/score|voreingenommen/);
    const done = await biasTests(page);
    expect(done[0]).toMatchObject({ second: { direction: "short" } });
    expect(done[0]!.revealedAt).toBeTruthy();
    // the live chart is back (same data series type, original axis)
    await expect
      .poll(
        async () => {
          const now = (await snapshot(page)).centres;
          return Object.keys(frozen.centres).every((id) => Math.abs((frozen.centres[id] ?? 0) - (now[id] ?? 1e9)) < 2);
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    await revealed.getByTestId("bias-done").click();
    await expect(ctl.getByTestId("bias-panel")).toHaveCount(0);

    // history: the outcome is recorded later, by the trader
    await ctl.getByTestId("bias-history-toggle").click();
    const row = ctl.getByTestId("bias-history-row").first();
    await row.getByRole("button", { name: "Details" }).click();
    await row.getByRole("radio", { name: "Preis fiel" }).click();
    await row.getByRole("button", { name: "Ergebnis eintragen" }).click();
    await expect.poll(async () => (await biasTests(page))[0]!.outcome).toMatchObject({ value: "down" });
    if (isMobile(info)) await expectNoHorizontalScroll(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("Chart spiegeln · Trade-Replay", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  const berlin = (ms: number): string => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  };

  test("Replay: dasselbe Panel, eingefroren ohne Ausstieg und P&L, Blindmodus verdeckt Markt und Position", async ({ page }, info) => {
    const errors = collectErrors(page);
    const anchor = Date.now();
    const at = (h: number) => Math.floor((anchor - h * HOUR) / (15 * 60_000)) * 15 * 60_000;
    const price = (t: number) => Math.round(synthPrice(t, anchor) * 10) / 10;
    const e = at(40);
    const x = at(30);
    const trade = {
      id: "t_mirror",
      account: "scalp",
      side: "long",
      status: "closed",
      pair: "BTC/USDT",
      timeframe: "1h",
      date: berlin(e),
      exitDate: berlin(x),
      entry: price(e),
      stop: Math.round(price(e) * 0.99 * 10) / 10,
      target: null,
      exit: price(x),
      size: Math.round(price(e) * 0.2 * 10) / 10,
      leverage: 5,
      fees: 2,
      pnlManual: null,
      setups: [],
      checks: {},
      conviction: 4,
      followedPlan: true,
      emotion: "Ruhig",
      reason: "",
      notes: "",
      chart: "",
      pnl: null,
      r: null,
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:00:00.000Z",
    };
    await seed(page, { synth: { anchor }, extra: { "tj2-trades": [...(fixture["tj2-trades"] as unknown[]), trade] } });
    await page.goto("/#trades");
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    await page.locator('[data-trade-id="t_mirror"]:visible').first().click();
    const detail = page.getByRole("dialog", { name: "Trade-Details" });
    await expect(detail).toBeVisible();
    await detail.getByRole("button", { name: "Replay" }).click();
    // the title carries the market name until a blind test covers it – the locator must survive that
    const replay = page.getByRole("dialog", { name: /^Replay/ });
    await expect(page.getByRole("dialog", { name: "Replay · BTC/USDT" })).toBeVisible();
    await expect(replay.locator('[data-ready="true"]')).toBeVisible({ timeout: 20_000 });
    const ctl = replay.getByTestId("bias-controls");
    await expect(ctl).toBeVisible();
    // the replay has only its own trade as a layer
    await expect(ctl.getByTestId("bias-layers").getByRole("button")).toHaveCount(1);

    // free flip
    await ctl.getByTestId("bias-flip").click();
    await expect(ctl).toHaveAttribute("data-flipped", "true");
    await ctl.getByTestId("bias-flip").click();

    // blind test: step the playhead to the middle of the trade first
    await replay.getByRole("slider", { name: "Replay-Zeitleiste" }).press("Home");
    for (let i = 0; i < 12; i++) await replay.getByRole("slider", { name: "Replay-Zeitleiste" }).press("ArrowRight");
    await ctl.getByTestId("bias-start").click();
    const setup = ctl.getByTestId("bias-setup");
    await setup.getByLabel("Marktnamen verdecken").check();
    await setup.getByLabel("Eigene Position verdecken").check();
    await setup.getByLabel("P&L verdecken").check();
    await setup.getByTestId("bias-begin").click();
    const first = ctl.getByTestId("bias-first");
    await expect(first).toBeVisible();
    // covered: title, position, readouts and the timeline (no future to scrub into)
    await expect(page.getByRole("dialog", { name: "Replay", exact: true })).toBeVisible();
    await expect(replay.getByRole("group", { name: "Replay-Werte" })).toHaveCount(0);
    await expect(replay.getByRole("slider", { name: "Replay-Zeitleiste" })).toHaveCount(0);
    await expect(replay.getByText("▲ Long")).toHaveCount(0);
    await expect(replay.getByText("▼ Short")).toHaveCount(0);

    await first.getByRole("radio", { name: "Neutral" }).click();
    await first.getByTestId("bias-conditions").fill("Seitwärts, keine klare Struktur");
    await first.getByTestId("bias-submit-first").click();
    const second = ctl.getByTestId("bias-second");
    await expect(second).toBeVisible();
    const stored = await biasTests(page);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ context: { surface: "replay", tradeId: "t_mirror" }, first: { direction: "neutral" } });
    expect(stored[0]!.second).toBeUndefined();
    await second.getByRole("radio", { name: "Neutral" }).click();
    await second.getByTestId("bias-conditions").fill("Auch gespiegelt keine Struktur");
    await second.getByTestId("bias-submit-second").click();
    await expect(ctl.getByTestId("bias-revealed")).toBeVisible();
    await expect(ctl.getByTestId("bias-comparison")).toHaveAttribute("data-relation", "both-neutral");
    await ctl.getByTestId("bias-done").click();
    // the replay is back with its timeline and readouts
    await expect(replay.getByRole("slider", { name: "Replay-Zeitleiste" })).toBeVisible();
    await expect(replay.getByRole("group", { name: "Replay-Werte" })).toBeVisible();
    if (isMobile(info)) await expectNoHorizontalScroll(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
