/**
 * F29 / F30 Screenshot-Import end to end – NO network: the function `/api/v1/shot-extract` is answered by a canned
 * response (`mockExtract`), the cloud is the Supabase mock. Runs on the cloud edition of the production build
 * (`cloudUrl`), where the import can be available (signed in); the default build (no cloud) must stay silent.
 *
 * Walks: pictures in the editor → „Aus Screenshot übernehmen“ → choose pictures → read → PREVIEW (confidence per
 * field, uncertain / missing highlighted, result difference, stop that is not the original, planned order, duplicate)
 * → fix the one uncertain value → drafts → the editor holds the draft and NOTHING is saved until „Speichern“ → the
 * second draft is offered by the queue pill. Plus the honest states: not signed in, server without key, server error.
 */
import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { cloudUrl, collectErrors, expectNoHorizontalScroll, fixture, openRoute, seed } from "./helpers";
import { mockSupabase } from "./mocks/supabase";

const PROJECTS = ["mobile", "desktop"];
/** `EXTRACT_SHOTS=<dir>` writes review screenshots of the preview. */
const SHOTS = process.env.EXTRACT_SHOTS;
async function snap(page: Page, info: TestInfo, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/extract-${name}-${info.project.name}.png`, animations: "disabled" });
}
const EMAIL = "trader@example.com";
const PASSWORD = "richtig-geheim-42";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const conf = (v: number, over: Record<string, number> = {}) => ({ market: v, side: v, entries: v, exits: v, stop: v, targets: v, leverage: v, fees: v, funding: v, realizedPnl: v, exchange: v, productType: v, status: v, ...over });
const base = { entries: [], exits: [], plannedEntry: null, stop: null, targets: [], leverage: null, fees: null, funding: null, realizedPnl: null, pnlCurrency: null, exchange: null, productType: null, unreadable: [] };

/** A closed BTC long with two partial entries, an exit read with low confidence and a stop on the position; a planned ETH long. */
const REPLY = {
  trades: [
    {
      ...base,
      market: "BTCUSDT",
      side: "long",
      entries: [
        { price: "67.250,5", qty: "0,03", time: "17.10.2026 14:32:08" },
        { price: "67.300", qty: "0,02", time: "17.10.2026 14:50:00" },
      ],
      exits: [{ price: "67.800", qty: "0,05", time: "17.10.2026 15:10:44" }],
      stop: "66.800",
      targets: ["68.500"],
      leverage: "10x",
      fees: "-1,35",
      realizedPnl: "+27,48",
      pnlCurrency: "USDT",
      exchange: "Bitunix",
      productType: "perp",
      status: "closed",
      confidence: conf(0.95, { exits: 0.5 }),
      sources: [0, 1],
    },
    {
      ...base,
      market: "ETH/USDT",
      side: "long",
      plannedEntry: "3.450",
      stop: "3.400",
      targets: ["3.550", "3.600"],
      leverage: "5x",
      status: "planned",
      confidence: conf(0.9),
      sources: [1],
    },
  ],
  timezone: null,
  notes: ["Bild 2 zeigt zusätzlich eine geplante Order."],
  model: "claude-opus-5-5",
};

interface MockExtractOptions {
  enabled?: boolean;
  reply?: unknown;
  /** Answer the POST with this error instead. */
  fail?: { status: number; code: string; message: string };
}
interface MockExtract {
  posts: { images: { mediaType: string; data: string }[]; hint?: { timezone?: string } }[];
}

/** Registers AFTER `mockSupabase` (the newest route wins). */
async function mockExtract(page: Page, opts: MockExtractOptions = {}): Promise<MockExtract> {
  const state: MockExtract = { posts: [] };
  await page.route("**/api/v1/shot-extract", async (route: Route) => {
    const req = route.request();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (req.method() === "GET") return json(200, { enabled: opts.enabled !== false, maxImages: 4, maxLongEdge: 1600, maxImageBytes: 1572864 });
    state.posts.push(req.postDataJSON());
    if (opts.fail) return json(opts.fail.status, { error: { code: opts.fail.code, message: opts.fail.message } });
    return json(200, opts.reply ?? REPLY);
  });
  return state;
}

async function signIn(page: Page): Promise<void> {
  await page.locator('[data-cloud-pill="signin"]').click();
  const sheet = page.getByRole("dialog", { name: "Anmelden" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[inert]")).toHaveCount(0);
  await sheet.getByLabel("E-Mail").fill(EMAIL);
  await sheet.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
  await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page.getByText("Alles synchron.", { exact: false })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Los geht’s" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

const fab = (page: Page) => page.locator('[data-layer="Dock"], [data-layer="Seitenleiste"]').getByRole("button", { name: "Trade eintragen" });
const journalCount = (page: Page) => page.evaluate(() => (window as unknown as { __tjJournal: { getState(): { trades: unknown[] } } }).__tjJournal.getState().trades.length);

async function openEditorWithShots(page: Page, n = 2) {
  await fab(page).click();
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });
  await expect(editor).toBeVisible();
  await expect(editor.locator("[inert] #f-entry")).toHaveCount(0);
  for (let i = 0; i < n; i++) {
    await editor.locator('input[type="file"]').setInputFiles({ name: `shot${i}.png`, mimeType: "image/png", buffer: PNG });
    await expect(editor.getByRole("button", { name: `Screenshot ${i + 1} öffnen` })).toBeVisible();
  }
  return editor;
}

async function start(page: Page, ex: MockExtractOptions = {}, extraTrades: unknown[] = [], signedIn = true) {
  const errors = collectErrors(page);
  await mockSupabase(page);
  const mock = await mockExtract(page, ex);
  await seed(page, { extra: extraTrades.length ? { "tj2-trades": [...(fixture["tj2-trades"] as unknown[]), ...extraTrades] } : undefined });
  await openRoute(page, cloudUrl("konto"), "Konto", { timeout: 30_000 });
  if (signedIn) await signIn(page);
  return { errors, mock };
}

test.describe("Screenshot-Import", () => {
  test.beforeEach(async ({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop only");
  });

  test("Vorschau → Entwurf: Unsicheres markiert, nur das Markierte korrigiert, nichts gespeichert, zweiter Entwurf per Pille", async ({ page }, info) => {
    const { errors, mock } = await start(page);
    const before = await journalCount(page);
    const editor = await openEditorWithShots(page);

    // the action is there once there is a picture
    const open = editor.getByTestId("extract-open");
    await open.scrollIntoViewIfNeeded();
    await expect(open).toBeVisible();
    await open.click();
    const sheet = page.getByTestId("extract-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "select");
    await expect(sheet).toContainText("nur zum Auslesen an die KI");
    await expect(page.getByTestId("extract-shot")).toHaveCount(2);
    await page.getByTestId("extract-read").click();

    // preview: two trades, one field needs a look
    await expect(sheet).toHaveAttribute("data-phase", "preview", { timeout: 15_000 });
    expect(mock.posts).toHaveLength(1);
    expect(mock.posts[0]!.images).toHaveLength(2);
    expect(mock.posts[0]!.images[0]).toMatchObject({ mediaType: "image/png", data: PNG.toString("base64") });
    expect(mock.posts[0]!.hint?.timezone).toBeTruthy();
    await expect(page.getByTestId("extract-summary")).toContainText("2 Trades erkannt");
    await expect(page.getByTestId("extract-summary")).toContainText("braucht deinen Blick");
    await expect(page.getByTestId("extract-zone-text")).toContainText("keine Zeitzone");
    const trades = page.getByTestId("extract-trade");
    await expect(trades).toHaveCount(2);
    const btc = trades.nth(0);
    const eth = trades.nth(1);
    await expect(btc).toContainText("BTC/USDT · Long");
    await expect(btc.getByTestId("extract-row-entry")).toContainText("Ø aus 2");
    await expect(btc.getByTestId("extract-row-entry")).toHaveAttribute("data-state", "ok");
    await expect(btc.getByTestId("extract-row-exit")).toHaveAttribute("data-state", "uncertain");
    await expect(btc.getByTestId("extract-row-exit")).toContainText("50 %");
    await expect(btc.getByTestId("extract-row-fees")).toContainText("1,35");
    await expect(btc.getByTestId("extract-row-stop")).toContainText("66.800");
    // the stop of a finished position is not assumed to be the original one; the result differs from the prices
    await expect(btc.locator('[data-check="stop_not_original"]')).toContainText("ob es der ursprüngliche war");
    await expect(btc.locator('[data-check="pnl_mismatch"]')).toContainText("Screenshot zeigt +27,48 USDT");
    await expect(btc.getByRole("button", { name: "Aus Preisen berechnen" })).toBeVisible();
    // the planned order: plan only
    await expect(eth).toContainText("Geplant");
    await expect(eth.getByTestId("extract-row-entry")).toContainText("3.450");
    await expect(eth.locator('[data-check="planned"]')).toBeVisible();
    await expect(eth.getByTestId("extract-row-exit")).toHaveCount(0);
    await expect(eth.getByTestId("extract-row-pnl")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await snap(page, info, "preview");

    // fix the one uncertain value only
    const exit = btc.getByTestId("extract-input-exit");
    await expect(exit).toBeVisible();
    await exit.fill("67800");
    await exit.press("Enter");
    await expect(btc.getByTestId("extract-row-exit")).toHaveAttribute("data-state", "ok");
    await expect(page.getByTestId("extract-summary")).toContainText("Nichts Unsicheres");

    // confirm: two drafts, the first opens in the editor – nothing is saved
    await page.getByTestId("extract-confirm").click();
    await expect(page.getByTestId("extract-sheet")).toHaveCount(0);
    const ed = page.getByRole("dialog", { name: "Trade eintragen" });
    await expect(ed).toBeVisible();
    await expect(ed.locator("#f-pair")).toHaveValue("BTC/USDT");
    await expect(ed.locator("#f-entry")).toHaveValue("67270,3"); // Ø of the two partial entries
    await expect(ed.locator("#f-exit")).toHaveValue("67800");
    await expect(ed.locator("#f-size")).toHaveValue("3363,51");
    await expect(ed.locator("#f-lev")).toHaveValue("10");
    await expect(ed.locator("#f-fees")).toHaveValue("1,35");
    await expect(ed.locator("#f-pnl")).toHaveValue("27,48"); // the exchange's number, because the prices disagree
    await expect(ed.locator("#f-stop")).toHaveValue(""); // never invented
    await expect(ed.locator("#f-notes")).toHaveValue(/Stop laut Screenshot: 66\.800/);
    await expect(ed.locator("#f-date")).toHaveValue("2026-10-17T14:32");
    await expect(ed.getByRole("button", { name: "Screenshot 1 öffnen" })).toBeVisible(); // the pictures stay attached
    await expect(ed.getByRole("button", { name: "Screenshot 2 öffnen" })).toBeVisible();
    await expect(ed.getByText("Screenshot-Import", { exact: true })).toBeVisible(); // the origin tag
    await snap(page, info, "draft")
    expect(await journalCount(page)).toBe(before);

    await ed.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(ed).toBeHidden();
    await expect.poll(() => journalCount(page)).toBe(before + 1);
    const saved = await page.evaluate(() => {
      const t = (window as unknown as { __tjJournal: { getState(): { trades: Record<string, unknown>[] } } }).__tjJournal.getState().trades.find((x) => x.pair === "BTC/USDT" && Array.isArray(x.tags) && (x.tags as string[]).includes("Screenshot-Import"));
      return t ? { stop: t.stop, pnlManual: t.pnlManual, fills: (t.fills as { kind: string }[]).map((f) => f.kind), shots: (t.screenshots as unknown[]).length, status: t.status } : null;
    });
    expect(saved).toEqual({ stop: null, pnlManual: 27.48, fills: ["entry", "add", "exit"], shots: 2, status: "closed" });

    // the second draft waits in the pill, never opens by itself
    const pill = page.getByTestId("extract-queue");
    await expect(pill).toContainText("Noch 1 Entwurf");
    await expectNoHorizontalScroll(page);
    await pill.getByTestId("extract-next").click();
    const ed2 = page.getByRole("dialog", { name: "Trade eintragen" });
    await expect(ed2).toBeVisible();
    await expect(ed2.locator("#f-pair")).toHaveValue("ETH/USDT");
    await expect(ed2.locator("#f-entry")).toHaveValue("3450");
    await expect(ed2.locator("#f-stop")).toHaveValue("3400"); // a planned order's stop is the plan
    await expect(ed2.locator("#f-exit")).toHaveValue("");
    await expect(ed2.locator("#f-notes")).toHaveValue(/Geplante Order/);
    await expect(pill).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(ed2).toBeHidden();
    expect(await journalCount(page)).toBe(before + 1); // the planned draft was never saved
    expect(errors).toEqual([]);
  });

  test("Dublette: wahrscheinlich schon vorhanden → nicht vorausgewählt, Warnung am Trade", async ({ page }) => {
    const existing = {
      id: "t_e2e_dup",
      account: "scalp",
      side: "long",
      status: "closed",
      date: "2026-10-17T14:35",
      pair: "BTC/USDT",
      timeframe: "1h",
      entry: 67250,
      stop: null,
      target: null,
      exit: 67800,
      size: 3362,
      leverage: null,
      fees: null,
      pnlManual: null,
      setups: [],
      checks: {},
      conviction: null,
      followedPlan: null,
      emotion: "",
      reason: "",
      notes: "",
      chart: "",
      pnl: null,
      r: null,
      createdAt: "2026-10-17T15:00:00.000Z",
      updatedAt: "2026-10-17T15:00:00.000Z",
    };
    const single = {
      ...REPLY,
      trades: [{ ...REPLY.trades[0]!, entries: [{ price: "67.250,5", qty: "0,05", time: "17.10.2026 14:32:08" }], confidence: conf(0.95), sources: [0] }],
    };
    await start(page, { reply: single }, [existing]);
    const editor = await openEditorWithShots(page, 1);
    await editor.getByTestId("extract-open").click();
    await page.getByTestId("extract-read").click();
    const card = page.getByTestId("extract-trade").first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText("Wahrscheinlich schon vorhanden");
    await expect(card.locator('[data-check="duplicate"]')).toContainText("BTC/USDT Long vom 2026-10-17 14:35");
    // not taken over unless the trader says so
    await expect(page.getByTestId("extract-confirm")).toBeDisabled();
    await card.getByRole("checkbox", { name: "In den Editor übernehmen" }).click();
    await expect(page.getByTestId("extract-confirm")).toBeEnabled();
  });

  test("Zeitzone: die Wahl rechnet die Zeiten um und sagt, was angenommen wurde", async ({ page }) => {
    await start(page);
    const editor = await openEditorWithShots(page, 1);
    await editor.getByTestId("extract-open").click();
    await page.getByTestId("extract-read").click();
    const btc = page.getByTestId("extract-trade").first();
    await expect(btc).toBeVisible({ timeout: 15_000 });
    await expect(btc.getByTestId("extract-row-date")).toContainText("17.10.2026 14:32:08");
    await page.getByTestId("extract-zone").selectOption("utc+8");
    await expect(page.getByTestId("extract-zone-text")).toContainText("UTC+8 (deine Wahl)");
    await expect(btc.getByTestId("extract-row-date")).toContainText("17.10.2026 08:32:08"); // Europe/Berlin is UTC+2 in October
  });

  test("Fehler vom Server: klare Meldung, nichts angelegt, Handeingabe bleibt", async ({ page }) => {
    await start(page, { fail: { status: 502, code: "shot_extract_failed", message: "Die KI antwortet gerade nicht – du kannst die Werte von Hand eintragen." } });
    const before = await journalCount(page);
    const editor = await openEditorWithShots(page, 1);
    await editor.getByTestId("extract-open").click();
    await page.getByTestId("extract-read").click();
    await expect(page.getByTestId("extract-message")).toContainText("von Hand eintragen", { timeout: 15_000 });
    await page.getByTestId("extract-cancel").click();
    await expect(page.getByTestId("extract-sheet")).toHaveCount(0);
    // the editor is untouched and fully usable
    await editor.locator("#f-entry").fill("100");
    await expect(editor.locator("#f-entry")).toHaveValue("100");
    expect(await journalCount(page)).toBe(before);
  });

  test("nichts erkannt: ehrliche Meldung statt erfundener Werte", async ({ page }) => {
    await start(page, { reply: { trades: [], timezone: null, notes: [], model: "m", reason: "empty" } });
    const editor = await openEditorWithShots(page, 1);
    await editor.getByTestId("extract-open").click();
    await page.getByTestId("extract-read").click();
    await expect(page.getByTestId("extract-message")).toContainText("kein Trade erkannt", { timeout: 15_000 });
    await expect(page.getByTestId("extract-manual")).toBeVisible();
    await expect(page.getByTestId("extract-trade")).toHaveCount(0);
  });

  test("ohne Anmeldung: kein Knopf, die Einstellungen erklären warum", async ({ page }) => {
    const { errors } = await start(page, {}, [], false);
    await page.goto(cloudUrl("settings"));
    const note = page.getByTestId("settings-shot-extract");
    await note.scrollIntoViewIfNeeded();
    await expect(note).toHaveAttribute("data-state", "signed-out");
    await expect(note).toContainText("Melde dich an");
    await expect(note).toContainText("Ohne den Import trägst du die Werte wie gewohnt von Hand ein");
    const editor = await openEditorWithShots(page, 1);
    await expect(editor.getByTestId("extract-open")).toHaveCount(0);
    // manual entry is untouched
    await editor.locator("#f-entry").fill("100");
    await expect(editor.locator("#f-entry")).toHaveValue("100");
    expect(errors).toEqual([]);
  });

  test("angemeldet, aber Server ohne KI-Schlüssel: kein Knopf, Hinweis in den Einstellungen", async ({ page }) => {
    await start(page, { enabled: false });
    await page.goto(cloudUrl("settings"));
    const note = page.getByTestId("settings-shot-extract");
    await note.scrollIntoViewIfNeeded();
    await expect(note).toHaveAttribute("data-state", "server-off", { timeout: 15_000 });
    await expect(note).toContainText("kein KI-Schlüssel");
    const editor = await openEditorWithShots(page, 1);
    await expect(editor.getByTestId("extract-open")).toHaveCount(0);
  });
});

test("Standard-Build (ohne Cloud): kein Knopf, manuelle Eingabe voll nutzbar", async ({ page }, info) => {
  test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop only");
  const errors = collectErrors(page);
  await seed(page);
  await page.goto("/#trades");
  await fab(page).click();
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });
  await expect(editor).toBeVisible();
  await editor.locator('input[type="file"]').setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG });
  await expect(editor.getByRole("button", { name: "Screenshot 1 öffnen" })).toBeVisible();
  await expect(editor.getByTestId("extract-open")).toHaveCount(0);
  await editor.locator("#f-entry").fill("100");
  await expect(editor.locator("#f-entry")).toHaveValue("100");
  expect(errors).toEqual([]);
});
