/**
 * F29 Screenshot-Import with a Bitunix order history („Vertragsaufträge › Auftragshistorie“) – NO network: the function
 * `/api/v1/shot-extract` answers with the `report_trades` input the model would deliver for the transcribed cards
 * (`tests/fixtures/orderhistory-bitunix-report.json`): two CLOSING orders whose openings are not in the picture
 * („Long schließen“, „Short schließen“) and one filled opening („Long Öffnen“).
 *
 * Walks the user's case: the preview offers all three (two closed ones with „Einstieg fehlt im Bild“, one open), the
 * entry computed from the realised PnL is an explicit button with both readings and never applied unasked, the time
 * zone stays an assumption with an override, a probable duplicate is not pre-selected, the editor refuses a closed
 * trade without an entry – and nothing is saved by the import itself. Plus the honest failure texts (server without key,
 * rejected key, platform timeout).
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { cloudUrl, collectErrors, expectNoHorizontalScroll, fixture, openRoute, seed } from "./helpers";
import { mockSupabase } from "./mocks/supabase";

const REPORT = { ...JSON.parse(readFileSync(new URL("../fixtures/orderhistory-bitunix-report.json", import.meta.url), "utf8")), model: "claude-opus-5-5" };
const PROJECTS = ["mobile", "desktop"];
const EMAIL = "trader@example.com";
const PASSWORD = "richtig-geheim-42";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

interface MockOptions {
  enabled?: boolean;
  reply?: unknown;
  fail?: { status: number; code: string; message: string };
}

async function mockExtract(page: Page, opts: MockOptions = {}): Promise<{ posts: unknown[] }> {
  const state = { posts: [] as unknown[] };
  await page.route("**/api/v1/shot-extract", async (route: Route) => {
    const req = route.request();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (req.method() === "GET") return json(200, { enabled: opts.enabled !== false, maxImages: 4, maxLongEdge: 1600, maxImageBytes: 1572864 });
    state.posts.push(req.postDataJSON());
    if (opts.fail) return json(opts.fail.status, { error: { code: opts.fail.code, message: opts.fail.message } });
    return json(200, opts.reply ?? REPORT);
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

const fab = (page: Page) => page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Trade eintragen" });
type Journal = { __tjJournal: { getState(): { trades: Record<string, unknown>[] } } };
const journalCount = (page: Page) => page.evaluate(() => (window as unknown as Journal).__tjJournal.getState().trades.length);

async function start(page: Page, ex: MockOptions = {}, extraTrades: unknown[] = []) {
  const errors = collectErrors(page);
  await mockSupabase(page);
  const mock = await mockExtract(page, ex);
  await seed(page, { extra: extraTrades.length ? { "tj2-trades": [...(fixture["tj2-trades"] as unknown[]), ...extraTrades] } : undefined });
  await openRoute(page, cloudUrl("konto"), "Konto", { timeout: 30_000 });
  await signIn(page);
  return { errors, mock };
}

async function readOrderHistory(page: Page) {
  await fab(page).click();
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });
  await expect(editor).toBeVisible();
  await expect(editor.locator("[inert] #f-entry")).toHaveCount(0);
  await editor.locator('input[type="file"]').setInputFiles({ name: "auftragshistorie.png", mimeType: "image/png", buffer: PNG });
  await expect(editor.getByRole("button", { name: "Screenshot 1 öffnen" })).toBeVisible();
  const open = editor.getByTestId("extract-open");
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await page.getByTestId("extract-read").click();
  return editor;
}

test.describe("Screenshot-Import: Orderhistorie (2 Schließungen + 1 Eröffnung)", () => {
  test.beforeEach(async ({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop only");
  });

  test("Vorschau: 3 Entwürfe, Einstieg fehlt im Bild, Vorschlag mit beiden Varianten – nichts ungefragt, nichts gespeichert", async ({ page }) => {
    const { errors, mock } = await start(page);
    const before = await journalCount(page);
    await readOrderHistory(page);
    const sheet = page.getByTestId("extract-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "preview", { timeout: 15_000 });
    expect(mock.posts).toHaveLength(1);

    await expect(page.getByTestId("extract-summary")).toContainText("3 Trades erkannt");
    // time zone: nothing in the picture → the assumption „deine Zeit“, with an override
    await expect(page.getByTestId("extract-zone-text")).toContainText("Der Screenshot nennt keine Zeitzone – angenommen: Europe/Berlin");
    const cards = page.getByTestId("extract-trade");
    await expect(cards).toHaveCount(3);
    const [long, short, open] = [cards.nth(0), cards.nth(1), cards.nth(2)];

    // (1) „Long schließen“: closed Long, exit and result read, the entry is MISSING (not invented)
    await expect(long).toContainText("BTC/USDT · Long");
    await expect(long).toHaveAttribute("data-status", "closed");
    await expect(long).toContainText("Einstieg fehlt im Bild");
    await expect(long.getByTestId("extract-row-entry")).toHaveAttribute("data-state", "missing");
    await expect(long.getByTestId("extract-row-entry")).toContainText("Einstieg fehlt im Bild – die Eröffnungsorder ist nicht zu sehen.");
    await expect(long.getByTestId("extract-row-exit")).toContainText("82.701,8");
    await expect(long.getByTestId("extract-row-qty")).toContainText("0,0562");
    await expect(long.getByTestId("extract-row-pnl")).toContainText("+7,576");
    await expect(long.locator('[data-check="entry_missing"]')).toContainText("nicht erfunden");
    const offer = long.locator('[data-check="entry_implied"]');
    await expect(offer).toContainText("Vorschlag, nicht gelesen");
    await expect(offer).toContainText("≈ 82.566,995 (PnL vor Gebühr)");
    await expect(offer).toContainText("≈ 82.546,32 (PnL nach Gebühr, Gebühr 1,16196029 USDT)");
    await expect(offer).toContainText("Unterschied: 1,16196029 USDT");
    await expect(long.getByTestId("extract-fix-gross")).toBeVisible();
    await expect(long.getByTestId("extract-fix-net")).toBeVisible();
    await expectNoHorizontalScroll(page);

    // (2) „Short schließen“: Short (the position), loss, other numbers
    await expect(short).toContainText("BTC/USDT · Short");
    await expect(short.getByTestId("extract-row-pnl")).toContainText(/18,48/);
    await expect(short.locator('[data-check="entry_implied"]')).toContainText("≈ 82.428,958 (PnL vor Gebühr)");
    await expect(short.locator('[data-check="entry_implied"]')).toContainText("≈ 82.449,66 (PnL nach Gebühr");

    // (3) the filled opening: an open trade, no closing, the order price flagged as unsure
    await expect(open).toContainText("BTC/USDT · Long");
    await expect(open).toHaveAttribute("data-status", "open");
    await expect(open).not.toContainText("Einstieg fehlt im Bild");
    await expect(open.getByTestId("extract-input-entry")).toHaveValue("82670"); // unsure → the field is open for a correction
    await expect(open.getByTestId("extract-row-entry")).toHaveAttribute("data-state", "uncertain");
    await expect(open.getByTestId("extract-unreadable")).toContainText("Durchschnittspreis");
    await expect(open.getByTestId("extract-row-exit")).toHaveCount(0);

    // nothing was applied by showing the offer
    await expect(long.getByTestId("extract-row-entry")).toHaveAttribute("data-state", "missing");
    expect(await journalCount(page)).toBe(before);

    // the time zone choice moves the times (Europe/Berlin is UTC+2 on this date)
    await expect(long.getByTestId("extract-row-exitDate")).toContainText("19.10.2026 09:47:27");
    await page.getByTestId("extract-zone").selectOption("utc+8");
    await expect(page.getByTestId("extract-zone-text")).toContainText("UTC+8 (deine Wahl)");
    await expect(long.getByTestId("extract-row-exitDate")).toContainText("19.10.2026 03:47:27");
    await page.getByTestId("extract-zone").selectOption("auto");
    await expect(long.getByTestId("extract-row-exitDate")).toContainText("19.10.2026 09:47:27");
    expect(errors).toEqual([]);
  });

  test("Knopf „ohne Gebühr“ setzt eine gekennzeichnete Annahme; Entwurf im Editor, erst „Speichern“ legt an; ohne Einstieg lässt sich nicht speichern", async ({ page }) => {
    const { errors } = await start(page);
    const before = await journalCount(page);
    await readOrderHistory(page);
    await expect(page.getByTestId("extract-sheet")).toHaveAttribute("data-phase", "preview", { timeout: 15_000 });
    const cards = page.getByTestId("extract-trade");
    const long = cards.nth(0);

    await long.getByTestId("extract-fix-gross").click();
    await expect(long.getByTestId("extract-input-entry")).toHaveValue("82566,995");
    await expect(long.getByTestId("extract-row-entry")).toContainText("Einstieg (berechnet)");
    await expect(long.getByTestId("extract-row-entry")).toHaveAttribute("data-state", "uncertain");
    await expect(long.getByTestId("extract-row-entry")).toContainText("Annahme: PnL vor Gebühr");
    await expect(long).toContainText("Einstieg berechnet (Annahme)");
    await expect(long.locator('[data-check="entry_assumed"]')).toContainText("berechnet, nicht gelesen");
    await expect(long.locator('[data-check="entry_missing"]')).toHaveCount(0);
    // the other reading, and dropping it again, are offered
    await expect(long.getByTestId("extract-fix-net")).toBeVisible();
    await expect(long.getByTestId("extract-fix-drop")).toBeVisible();
    await expect(page.getByTestId("extract-confirm")).toContainText("3 Entwürfe öffnen");

    // draft 1: the editor holds the assumption, with the note – nothing saved yet
    await page.getByTestId("extract-confirm").click();
    await expect(page.getByTestId("extract-sheet")).toHaveCount(0);
    const ed = page.getByRole("dialog", { name: "Trade eintragen" });
    await expect(ed).toBeVisible();
    await expect(ed.locator("#f-pair")).toHaveValue("BTC/USDT");
    await expect(ed.locator("#f-entry")).toHaveValue("82566,995");
    await expect(ed.locator("#f-exit")).toHaveValue("82701,8");
    await expect(ed.locator("#f-lev")).toHaveValue("15");
    await expect(ed.locator("#f-fees")).toHaveValue("1,16196029");
    await expect(ed.locator("#f-notes")).toHaveValue(/Einstieg 82\.566,995 berechnet aus Ausstieg, Menge und Realisiertem PnL \(Annahme: PnL vor Gebühr\) – nicht im Screenshot gelesen/);
    expect(await journalCount(page)).toBe(before);
    // the entry TIME is not in the picture either: the editor shows „jetzt“ and refuses an exit before the entry until it is set
    await ed.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(ed.getByText("Die Ausstiegszeit liegt vor dem Einstieg.")).toBeVisible();
    expect(await journalCount(page)).toBe(before);
    await ed.locator("#f-date").fill("2026-10-19T08:00");
    await ed.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(ed).toBeHidden();
    await expect.poll(() => journalCount(page)).toBe(before + 1);

    // draft 2 (Short, NO entry): the editor refuses to save it until the entry is typed
    const pill = page.getByTestId("extract-queue");
    await expect(pill).toContainText("Noch 2 Entwürfe");
    await pill.getByTestId("extract-next").click();
    const ed2 = page.getByRole("dialog", { name: "Trade eintragen" });
    await expect(ed2).toBeVisible();
    await expect(ed2.locator("#f-entry")).toHaveValue("");
    await expect(ed2.locator("#f-exit")).toHaveValue("82806,9");
    await expect(ed2.locator("#f-notes")).toHaveValue(/nur die Schließung/);
    await ed2.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(ed2.getByText("Bitte einen Einstiegspreis angeben.")).toBeVisible();
    expect(await journalCount(page)).toBe(before + 1);
    await ed2.locator("#f-entry").fill("82430");
    await ed2.locator("#f-date").fill("2026-10-19T05:30");
    await ed2.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(ed2).toBeHidden();
    await expect.poll(() => journalCount(page)).toBe(before + 2);

    // draft 3: the open trade
    await expect(pill).toContainText("Noch 1 Entwurf");
    await pill.getByTestId("extract-next").click();
    const ed3 = page.getByRole("dialog", { name: "Trade eintragen" });
    await expect(ed3.locator("#f-entry")).toHaveValue("82670");
    await expect(ed3.locator("#f-exit")).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(ed3).toBeHidden();
    expect(await journalCount(page)).toBe(before + 2); // the open draft was never saved

    const saved = await page.evaluate(() => {
      const list = (window as unknown as Journal).__tjJournal.getState().trades.filter((x) => Array.isArray(x.tags) && (x.tags as string[]).includes("Screenshot-Import"));
      return list.map((t) => ({ side: t.side, entry: t.entry, exit: t.exit, status: t.status, qty: t.qty })).sort((a, b) => String(a.side).localeCompare(String(b.side)));
    });
    expect(saved).toEqual([
      { side: "long", entry: 82566.995, exit: 82701.8, status: "closed", qty: 0.0562 },
      { side: "short", entry: 82430, exit: 82806.9, status: "closed", qty: 0.0489 },
    ]);
    expect(errors).toEqual([]);
  });

  test("die zweite Lesart („nach Gebühr“) ersetzt die erste, „verwerfen“ stellt „fehlt“ wieder her", async ({ page }) => {
    await start(page);
    await readOrderHistory(page);
    await expect(page.getByTestId("extract-sheet")).toHaveAttribute("data-phase", "preview", { timeout: 15_000 });
    const short = page.getByTestId("extract-trade").nth(1);
    await short.getByTestId("extract-fix-net").click();
    await expect(short.getByTestId("extract-input-entry")).toHaveValue("82449,66");
    await expect(short.getByTestId("extract-row-entry")).toContainText("Annahme: PnL nach Gebühr");
    await short.getByTestId("extract-fix-drop").click();
    await expect(short.getByTestId("extract-row-entry")).toHaveAttribute("data-state", "missing");
    await expect(short.locator('[data-check="entry_implied"]')).toBeVisible();
    // typing the real entry ends every assumption
    await short.getByTestId("extract-fix-gross").click();
    await short.getByTestId("extract-input-entry").fill("82431,5");
    await short.getByTestId("extract-input-entry").press("Enter");
    await expect(short.getByTestId("extract-row-entry")).toHaveAttribute("data-state", "ok");
    await expect(short.locator('[data-check="entry_assumed"]')).toHaveCount(0);
    await expect(short).not.toContainText("Einstieg berechnet (Annahme)");
  });

  test("Dublette: die bereits eingetragene Schließung wird am Ausstieg erkannt und nicht vorausgewählt", async ({ page }) => {
    const existing = {
      id: "t_e2e_dup_exit",
      account: "scalp",
      side: "long",
      status: "closed",
      date: "2026-10-19T08:10",
      exitDate: "2026-10-19T09:47",
      pair: "BTC/USDT",
      timeframe: "1h",
      entry: 82567,
      stop: null,
      target: null,
      exit: 82701.8,
      size: 4640,
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
      createdAt: "2026-10-19T09:50:00.000Z",
      updatedAt: "2026-10-19T09:50:00.000Z",
    };
    await start(page, {}, [existing]);
    await readOrderHistory(page);
    await expect(page.getByTestId("extract-sheet")).toHaveAttribute("data-phase", "preview", { timeout: 15_000 });
    const [long, short] = [page.getByTestId("extract-trade").nth(0), page.getByTestId("extract-trade").nth(1)];
    await expect(long).toContainText("Wahrscheinlich schon vorhanden");
    await expect(long.locator('[data-check="duplicate"]')).toContainText("verglichen am Ausstieg");
    await expect(short).not.toContainText("Wahrscheinlich schon vorhanden");
    await expect(page.getByTestId("extract-confirm")).toContainText("2 Entwürfe öffnen");
    await long.getByRole("checkbox", { name: "In den Editor übernehmen" }).click();
    await expect(page.getByTestId("extract-confirm")).toContainText("3 Entwürfe öffnen");
  });

  test("Fehler nennen den Grund: der Schlüssel des Servers wird abgelehnt", async ({ page }) => {
    await start(page, { fail: { status: 503, code: "shot_extract_key_rejected", message: "Der KI-Schlüssel auf dem Server wurde abgelehnt (ungültig, abgelaufen, ohne Guthaben oder ohne Zugriff auf das Modell). Der Betreiber muss ANTHROPIC_API_KEY prüfen." } });
    await readOrderHistory(page);
    const msg = page.getByTestId("extract-message");
    await expect(msg).toContainText("Der KI-Schlüssel auf dem Server wurde abgelehnt", { timeout: 15_000 });
    await expect(page.getByTestId("extract-message-code")).toContainText("shot_extract_key_rejected");
    await expect(page.getByTestId("extract-retry")).toBeVisible();
  });

  test("nichts erkannt: die KI-Hinweise stehen dabei, es wird nichts erfunden", async ({ page }) => {
    await start(page, { reply: { trades: [], timezone: null, notes: ["Das Bild zeigt nur eine Kontoübersicht."], model: "m", reason: "empty" } });
    await readOrderHistory(page);
    await expect(page.getByTestId("extract-message")).toContainText("kein Trade erkannt", { timeout: 15_000 });
    await expect(page.getByTestId("extract-message-notes")).toContainText("Das Bild zeigt nur eine Kontoübersicht.");
    await expect(page.getByTestId("extract-trade")).toHaveCount(0);
  });

  test("Einstellungen: ohne KI-Schlüssel steht der Grund da, der Knopf fehlt im Editor", async ({ page }) => {
    await start(page, { enabled: false });
    await page.goto(cloudUrl("settings"));
    const note = page.getByTestId("settings-shot-extract");
    await note.scrollIntoViewIfNeeded();
    await expect(note).toHaveAttribute("data-state", "server-off", { timeout: 15_000 });
    await expect(page.getByTestId("settings-shot-extract-state")).toContainText("kein KI-Schlüssel hinterlegt");
    await expect(page.getByTestId("settings-shot-extract-state")).toContainText("ANTHROPIC_API_KEY");
    await fab(page).click();
    const editor = page.getByRole("dialog", { name: "Trade eintragen" });
    await editor.locator('input[type="file"]').setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG });
    await expect(editor.getByRole("button", { name: "Screenshot 1 öffnen" })).toBeVisible();
    await expect(editor.getByTestId("extract-open")).toHaveCount(0);
  });

  test("Einstellungen: Server antwortet nicht → „Status unbekannt“ statt der Behauptung, es fehle ein Schlüssel", async ({ page }) => {
    const errors = collectErrors(page);
    void errors;
    await mockSupabase(page);
    await page.route("**/api/v1/shot-extract", (route) => route.abort("failed"));
    await seed(page);
    await openRoute(page, cloudUrl("konto"), "Konto", { timeout: 30_000 });
    await signIn(page);
    await page.goto(cloudUrl("settings"));
    const note = page.getByTestId("settings-shot-extract");
    await note.scrollIntoViewIfNeeded();
    await expect(note).toHaveAttribute("data-state", "server-error", { timeout: 15_000 });
    await expect(page.getByTestId("settings-shot-extract-state")).toContainText("nicht geantwortet");
    await expect(page.getByTestId("settings-shot-extract-state")).not.toContainText("kein KI-Schlüssel");
  });
});
