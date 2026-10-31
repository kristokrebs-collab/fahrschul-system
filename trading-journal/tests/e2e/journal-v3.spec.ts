/**
 * Journal v3 (P06): the trades page (more filters, `Top-Trades`, saved views, grouped positions / hedges), the editor's
 * new sections (Ausführung with fills, Tags & Bewertung, Psyche, Screenshots), the detail (execution facts, fills rail,
 * MAE / MFE measured from the market, chart drawing) and the trade replay. The market is the synthetic one (`synth`), so
 * candles exist for every past window; the seeded v3 trades sit on that price path (prices read from `synthPrice`).
 *
 * `P06_SHOTS=<dir>` additionally writes the named screenshots of the visual check.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, fixture, isMobile, seed, stored, toast } from "./helpers";
import { synthPrice } from "./mocks/synth";

const HOUR = 3_600_000;
const SHOTS = process.env.P06_SHOTS;

/** Local wall clock of `ms` in Europe/Berlin (the browser's zone) as `YYYY-MM-DDTHH:mm`. */
function berlin(ms: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Seeded v3 trades on the synthetic path (the last three days fall steadily → shorts win). */
function v3Trades(anchor: number) {
  const at = (h: number) => Math.floor((anchor - h * HOUR) / (15 * 60_000)) * 15 * 60_000;
  const p = (t: number) => round1(synthPrice(t, anchor));
  const base = { account: "scalp", timeframe: "1h", setups: [], checks: {}, conviction: 4, followedPlan: true, emotion: "Ruhig", reason: "", notes: "", chart: "", leverage: 5, fees: 2, pnlManual: null, pnl: null, r: null, createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z" };
  const e1 = at(40);
  const x1 = at(30);
  const sh = {
    ...base,
    id: "t_v3short",
    side: "short",
    status: "closed",
    pair: "BTC/USDT",
    date: berlin(e1),
    exitDate: berlin(x1),
    entry: p(e1),
    stop: round1(p(e1) * 1.01),
    target: round1(p(e1) * 0.97),
    exit: p(x1),
    size: round1(p(e1) * 0.2),
    market: "perp",
    exchange: "Bitunix",
    exchangeAccount: "Haupt",
    fundingFees: 1.2,
    tags: ["Breakdown", "London"],
    rating: 5,
    psych: { stress: 2, confidence: 4, flags: ["fomo"], exitReason: "Ziel erreicht", preNote: "Ruhig, Plan klar.", postNote: "Sauber gehalten." },
    fills: [
      { id: "f1", at: berlin(e1), side: "open", price: p(e1), qty: 0.1, fee: 1, kind: "entry" },
      { id: "f2", at: berlin(e1 + 2 * HOUR), side: "open", price: p(e1 + 2 * HOUR), qty: 0.1, fee: 1, kind: "add" },
      { id: "f3", at: berlin(e1 + 5 * HOUR), side: "close", price: p(e1 + 5 * HOUR), qty: 0.1, fee: 1, kind: "partial" },
      { id: "f4", at: berlin(x1), side: "close", price: p(x1), qty: 0.1, fee: 1, kind: "exit" },
    ],
  };
  // an automatic hedge: a long and a short on the same pair, overlapping in time
  const h1 = at(20);
  const h2 = at(19);
  const hedgeLong = { ...base, id: "t_v3hedgeL", side: "long", status: "closed", pair: "BTC/USDT", date: berlin(h1), exitDate: berlin(h1 + 6 * HOUR), entry: p(h1), stop: round1(p(h1) * 0.99), target: null, exit: p(h1 + 6 * HOUR), size: round1(p(h1) * 0.05), rating: 2 };
  const hedgeShort = { ...base, id: "t_v3hedgeS", side: "short", status: "closed", pair: "BTC/USDT", date: berlin(h2), exitDate: berlin(h2 + 3 * HOUR), entry: p(h2), stop: round1(p(h2) * 1.01), target: null, exit: p(h2 + 3 * HOUR), size: round1(p(h2) * 0.05), rating: 4, tags: ["Hedge"] };
  return [sh, hedgeLong, hedgeShort];
}

async function setup(page: Page) {
  const anchor = Date.now();
  const trades = [...(fixture["tj2-trades"] as unknown[]), ...v3Trades(anchor)];
  await seed(page, { synth: { anchor }, extra: { "tj2-trades": trades } });
}

async function shot(page: Page, info: TestInfo, name: string, fullPage = false) {
  if (!SHOTS) return;
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${SHOTS}/P06-journal-${name}-${info.project.name}.png`, fullPage, animations: "disabled" });
}

async function gotoTrades(page: Page) {
  await page.goto("/#trades");
  await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
}

const detail = (page: Page) => page.getByRole("dialog", { name: "Trade-Details" });

/** Opens the detail of trade `id` from the list (table row or card). */
async function openTrade(page: Page, id: string) {
  await page.locator(`[data-trade-id="${id}"]:visible`).first().click();
  await expect(detail(page)).toBeVisible();
}

test("trades: more filters, Top-Trades, a saved view and grouped hedges", async ({ page }, info) => {
  const errors = collectErrors(page);
  await setup(page);
  await gotoTrades(page);
  await expect(page.getByText("16 Trades", { exact: true })).toBeVisible();
  const bar = page.getByTestId("journal-filters");
  await expect(bar).toBeVisible();

  // trade the best: rating ≥ 4 only
  await bar.getByRole("button", { name: "★ Top-Trades" }).click();
  await expect(page.getByTestId("trade-count")).toContainText("2 Trades");
  // save it as a view; the name shows as the current view
  await bar.getByRole("button", { name: "+ Ansicht speichern" }).click();
  await bar.getByLabel("Name der Ansicht").fill("Beste");
  await bar.getByLabel("Name der Ansicht").press("Enter");
  await expect(bar.getByRole("button", { name: "Beste", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(bar.getByTestId("view-name")).toHaveText("Beste");
  const views = await stored<{ name: string }[]>(page, "tj2-views");
  expect(views?.map((v) => v.name)).toEqual(["Beste"]);
  await shot(page, info, "trades-view");
  if (isMobile(info)) await expectNoHorizontalScroll(page);

  // more filters: tags, then clear
  await bar.getByRole("button", { name: /Mehr Filter/ }).click();
  await bar.getByRole("button", { name: "#London" }).click();
  await expect(page.getByTestId("trade-count")).toContainText("1 Trade");
  await expect(bar.getByTestId("view-name")).toHaveText("Eigene Auswahl");
  await shot(page, info, "trades-filters");
  await bar.getByRole("button", { name: "Diese Filter leeren" }).click();
  await expect(page.getByTestId("trade-count")).toContainText("16 Trades");

  // grouping folds the automatic hedge into one row / card that unfolds its legs
  await bar.getByRole("switch", { name: "Positionen gruppieren" }).click();
  const group = page.locator('[data-group-id^="hedge:"]').first();
  await expect(group).toBeVisible();
  await expect(group).toContainText("Hedge");
  await (isMobile(info) ? group.getByRole("button").first() : group).click();
  await expect(page.locator('[data-group-member="t_v3hedgeS"]')).toBeVisible();
  await expect(page.locator('[data-group-member="t_v3hedgeL"]')).toBeVisible();
  await shot(page, info, "trades-grouped");
  if (isMobile(info)) await expectNoHorizontalScroll(page);
  // a leg opens its own detail
  await page.locator('[data-group-member="t_v3hedgeS"]').click();
  await expect(detail(page)).toBeVisible();
  await expect(detail(page)).toContainText("#Hedge");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("editor: Ausführung with fills, Tags & Bewertung, Psyche and a screenshot are saved and shown in the detail", async ({ page }, info) => {
  const errors = collectErrors(page);
  await setup(page);
  await gotoTrades(page);
  await page.locator('[data-layer="Dock"], [data-layer="Seitenleiste"]').getByRole("button", { name: "Trade eintragen" }).click();
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });
  await expect(editor).toBeVisible();
  await expect(editor.locator("[inert] #f-entry")).toHaveCount(0);
  await editor.locator("#f-stop").fill("83000");
  // fills: entry + DCA + exit → Einstieg / Größe / Ausstieg come from them
  await editor.getByRole("button", { name: "+ Einstieg" }).click();
  await editor.getByLabel("Fill 1 Preis").fill("84000");
  await editor.getByLabel("Fill 1 Menge").fill("0,1");
  await editor.getByRole("button", { name: "+ Nachkauf" }).click();
  await editor.getByLabel("Fill 2 Preis").fill("83600");
  await editor.getByLabel("Fill 2 Menge").fill("0,1");
  await editor.getByRole("button", { name: "+ Teil-Exit" }).click();
  await editor.getByLabel("Fill 3 Preis").fill("85000");
  await editor.getByLabel("Fill 3 Menge").fill("0,2");
  await expect(editor.locator("#f-entry")).toHaveValue("83800");
  await expect(editor.locator("#f-entry")).toBeDisabled();
  await expect(editor.locator("#f-exit")).toHaveValue("85000");
  await shot(page, info, "editor-fills");

  // tags & rating, psyche
  await editor.getByLabel("Neuer Tag").fill("Range-Low");
  await editor.getByLabel("Neuer Tag").press("Enter");
  await expect(editor.getByRole("button", { name: "Tag „Range-Low“ entfernen" })).toBeVisible();
  await editor.getByRole("radio", { name: "4 von 5 · Stark" }).click();
  await editor.getByRole("radio", { name: "2 · Locker" }).click();
  await editor.getByRole("group", { name: "Verhalten" }).getByRole("button", { name: "Tilt" }).click();
  await editor.getByRole("button", { name: "Ziel erreicht" }).click();
  await editor.getByRole("group", { name: "Verhalten" }).scrollIntoViewIfNeeded();
  await shot(page, info, "editor-psyche");

  // a screenshot from a file (1×1 PNG)
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await editor.locator('input[type="file"]').setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: png });
  await expect(editor.getByRole("button", { name: "Screenshot 1 öffnen" })).toBeVisible();
  await editor.getByTestId("shots-drop").scrollIntoViewIfNeeded();
  await shot(page, info, "editor-screens");

  await editor.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(toast(page)).toContainText("Trade gespeichert");
  const trades = (await stored<Record<string, unknown>[]>(page, "tj2-trades")) ?? [];
  const saved = trades.find((t) => Array.isArray(t.tags) && (t.tags as string[]).includes("Range-Low"));
  expect(saved).toBeTruthy();
  expect(saved).toMatchObject({ entry: 83800, exit: 85000, rating: 4, psych: { stress: 2, flags: ["tilt"], exitReason: "Ziel erreicht" } });
  expect((saved!.fills as { kind: string }[]).map((f) => f.kind)).toEqual(["entry", "add", "exit"]);
  expect((saved!.screenshots as { store: string }[])[0]?.store).toBe("idb");
  // (85000 − 83800) × 0.2 = 240 − fees (none) → +240
  expect(saved!.pnl as number).toBeCloseTo(240, 6);

  await openTrade(page, String(saved!.id));
  const d = detail(page);
  await expect(d).toContainText("#Range-Low");
  await expect(d.getByRole("list", { name: "Fills der Position" })).toBeVisible();
  await expect(d.getByRole("img", { name: /Bewertung: 4 von 5/ })).toBeVisible();
  await expect(d.locator('[aria-label="Verhalten"]')).toContainText("Tilt");
  await expect(d.getByRole("button", { name: "Screenshot 1 öffnen" })).toBeVisible();
  await d.getByRole("button", { name: "Screenshot 1 öffnen" }).click();
  const box = page.getByRole("dialog", { name: /Screenshot 1 von 1/ });
  await expect(box).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
  await expect(d).toBeVisible(); // Escape closed only the lightbox
  expect(errors, errors.join("\n")).toEqual([]);
});

test("detail: execution facts, fills rail, MAE / MFE from the market, a chart drawing and the replay", async ({ page }, info) => {
  const errors = collectErrors(page);
  await setup(page);
  await gotoTrades(page);
  await openTrade(page, "t_v3short");
  const d = detail(page);
  // the detail's own facts come first (P14: the coach panel further down lists the hold time too)
  await expect(d.getByText("Haltedauer").first()).toBeVisible();
  await expect(d.getByText("10 Std").first()).toBeVisible();
  await expect(d.getByText("Perp · Bitunix · Haupt")).toBeVisible();
  await expect(d.getByRole("list", { name: "Fills der Position" })).toBeVisible();
  // MAE / MFE: measured on demand (or already by the idle backfill)
  const measure = d.getByRole("button", { name: "MAE/MFE messen" });
  if (await measure.isVisible().catch(() => false)) await measure.click();
  await expect(d.getByText(/^MFE/).first()).toBeVisible({ timeout: 20_000 });
  const trades = (await stored<Record<string, unknown>[]>(page, "tj2-trades")) ?? [];
  const short = trades.find((t) => t.id === "t_v3short")!;
  expect(typeof short.mae).toBe("number");
  expect(typeof short.mfeR).toBe("number");
  expect(short.mfe as number).toBeGreaterThan(0);
  await expect(d.getByText(/Mitgenommen: (10[1-9]|1[1-9]\d|[2-9]\d\d|\d{4,}) %/)).toHaveCount(0); // never more than the best move
  await d.getByText(/^MFE/).first().scrollIntoViewIfNeeded();
  await shot(page, info, "detail");

  // chart drawing: a horizontal line, stored with the trade
  const chart = d.getByTestId("annotation-surface");
  await chart.scrollIntoViewIfNeeded();
  await expect(d.locator('[data-ready="true"]').first()).toBeVisible({ timeout: 15_000 });
  await d.getByRole("button", { name: "Linie", exact: true }).click();
  await chart.click({ position: { x: 60, y: 50 } });
  await expect(d.getByRole("img", { name: "Trade-Chart mit 1 Zeichnung" })).toBeVisible();
  await expect.poll(async () => ((await stored<Record<string, unknown>[]>(page, "tj2-trades")) ?? []).find((t) => t.id === "t_v3short")?.annotations).toHaveLength(1);
  await shot(page, info, "detail-drawing");

  // replay: the sheet plays the trade bar by bar
  await d.getByRole("button", { name: "Replay" }).click();
  const replay = page.getByRole("dialog", { name: "Replay · BTC/USDT" });
  await expect(replay).toBeVisible();
  await expect(replay.locator('[data-ready="true"]')).toBeVisible({ timeout: 20_000 });
  await expect(replay.getByRole("slider", { name: "Replay-Zeitleiste" })).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, info, "replay");
  await replay.getByRole("slider", { name: "Replay-Zeitleiste" }).press("End");
  await expect(replay.getByText("Nach dem Ausstieg")).toBeVisible();
  if (isMobile(info)) await expectNoHorizontalScroll(page);
  await page.keyboard.press("Escape");
  await expect(replay).toBeHidden();
  await expect(detail(page)).toBeVisible(); // the detail comes back
  expect(errors, errors.join("\n")).toEqual([]);
});
