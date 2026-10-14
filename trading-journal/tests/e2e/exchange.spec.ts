/**
 * P11 Börse end to end against the Supabase mock (`mocks/supabase.ts`) and the exchange mock (`mocks/exchange.ts`, real
 * Bitunix mapping over the documented payloads): sign in → "Börse verbinden" (read-only guide, masked key, wrong secret,
 * check, first import in the background) → trades arrive in the journal over the cloud sync; manual sync, dry run with
 * the P&L check, inbox (one-tap feeling, "Passt so"), broker reconciliation (merge by hold), disconnect; CSV import
 * (detected format and the mapping assistant); API token; the live positions contract; honest states (server not set
 * up, plan without sync, no cloud).
 *
 * Runs on `/#konto` of the cloud edition (the production build against the mock project, `cloudUrl` in helpers.ts),
 * where P14 mounted the exchange cards; the live positions are checked where P05 consumes them (Risiko → Exposure),
 * the CSV import is opened from the Börse card (signed out) or from Einstellungen → Daten → Backup importieren (the
 * default build without cloud). `PW_BOERSE_URL` overrides the cloud URL; `P11_SHOTS_DIR` writes review screenshots.
 */
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { cloudUrl, collectErrors, expectNoHorizontalScroll, openRoute, seed } from "./helpers";
import { mockBilling } from "./mocks/billing";
import { mockExchange, WRONG_SECRET, type MockExchangeOptions } from "./mocks/exchange";
import { mockSupabase } from "./mocks/supabase";

const URL_ = process.env.PW_BOERSE_URL ?? cloudUrl("konto");
const SHOTS = process.env.P11_SHOTS_DIR;
const EMAIL = "trader@example.com";
const PASSWORD = "richtig-geheim-42";
const PROJECTS = ["mobile", "desktop"];

async function shot(page: Page, info: TestInfo, name: string, target?: Locator): Promise<void> {
  if (!SHOTS) return;
  // Cards reveal (blur → sharp) when they enter the viewport: scroll first, then let the entrance settle.
  if (target) await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const path = `${SHOTS}/P11-exchange-${name}-${info.project.name === "mobile" ? "390" : "1440"}.png`;
  if (target) await target.screenshot({ path, animations: "disabled" });
  else await page.screenshot({ path, animations: "disabled" });
}

async function open(page: Page, url = URL_): Promise<void> {
  await openRoute(page, url, "Konto", { timeout: 30_000 });
}

/** Switches the page inside the running app (the hash router – no reload). */
async function goTo(page: Page, hash: string, h1: string): Promise<void> {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await expect(page.locator('[data-page-role="current"] h1', { hasText: h1 }).first()).toBeVisible({ timeout: 20_000 });
}

async function setup(page: Page, ex: MockExchangeOptions = {}, docs?: NonNullable<Parameters<typeof mockSupabase>[1]>["docs"]) {
  const errors = collectErrors(page);
  const sb = await mockSupabase(page, docs ? { docs } : {});
  const mx = await mockExchange(page, sb, ex);
  await seed(page);
  return { sb, mx, errors };
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

const card = (page: Page) => page.getByTestId("exchange-card");
const journalIds = (page: Page) =>
  page.evaluate(() => {
    const j = (
      window as unknown as {
        __tjJournal: { getState(): { trades: { id: string; notes: string; emotion: string; account?: string; pnlManual: number | null }[] } };
      }
    ).__tjJournal;
    return j
      .getState()
      .trades.filter((t) => t.id.startsWith("t_bx_") || t.id.startsWith("t_csv_"))
      .map((t) => ({ id: t.id, notes: t.notes, emotion: t.emotion, account: t.account, pnl: t.pnlManual }));
  });

test.describe("Börse (P11)", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop only");
    void page;
  });

  test("Bitunix verbinden: Anleitung, maskierter Key, falsches Secret, Prüfung, Erstimport im Hintergrund", async ({ page }, info) => {
    const { mx, errors } = await setup(page);
    await open(page);
    await signIn(page);
    await expect(page.getByTestId("exchange-hero")).toBeVisible();
    await card(page).scrollIntoViewIfNeeded();
    await shot(page, info, "hero", card(page));
    await expectNoHorizontalScroll(page);

    await page.getByTestId("exchange-connect").click();
    const sheet = page.getByRole("dialog", { name: "Bitunix verbinden" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Nur Leserechte")).toBeVisible();
    await expect(sheet.getByText("IP-Bindung leer lassen")).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Bitunix-API-Seite öffnen" })).toHaveAttribute("href", "https://www.bitunix.com/account/apiManagement");
    await shot(page, info, "connect-guide");
    await sheet.getByTestId("connect-next").click();

    // key masked as ••••last4 once the field is left
    await sheet.getByLabel("API-Key").fill("bx9a25209b66004da404d9ddcb48d17e2d");
    await sheet.getByLabel("Secret-Key").click();
    await expect(sheet.getByTestId("key-mask")).toContainText("7e2d");
    await sheet.getByLabel("Secret-Key").fill(WRONG_SECRET);
    // read-only confirmation is required
    await sheet.getByTestId("connect-submit").click();
    await expect(sheet.getByTestId("connect-error")).toContainText("nur Leserechte");
    await sheet.getByTestId("connect-readonly").check();
    await sheet
      .getByRole("radio", { name: "Makro" })
      .click()
      .catch(async () => sheet.getByText("Makro", { exact: true }).click());
    await sheet.getByTestId("connect-submit").click();
    await expect(sheet.getByTestId("connect-error")).toContainText("Signatur ungültig");
    await shot(page, info, "connect-error");

    await sheet.getByLabel("Secret-Key").fill("bxs0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c");
    await sheet.getByTestId("connect-submit").click();
    await expect(sheet.getByTestId("connect-ok")).toBeVisible();
    await expect(sheet.getByText("USDT verfügbar")).toBeVisible();
    await shot(page, info, "connect-ok");
    expect(mx.connects.at(-1)).toMatchObject({ exchange: "bitunix", readOnlyConfirmed: true });
    // the secret never comes back to the page
    expect(await page.content()).not.toContain("bxs0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c");

    await sheet.getByTestId("connect-import").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("exchange-connected")).toBeVisible();
    await expect(page.getByTestId("exchange-backfill")).toBeVisible();
    await expect(page.getByTestId("exchange-backfill")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId("exchange-counters")).toContainText("5");
    // the five Bitunix positions are in the journal (cloud sync → Realtime)
    await expect.poll(async () => (await journalIds(page)).length, { timeout: 15_000 }).toBe(5);
    const ids = await journalIds(page);
    expect(ids.find((t) => t.id === "t_bx_1844291077356544000")).toMatchObject({ pnl: 59.1829 });
    await card(page).scrollIntoViewIfNeeded();
    await shot(page, info, "connected", card(page));
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("verbunden: Probelauf mit P&L-Prüfung, Sync, Inbox, Abgleich mit Merge, Live-Positionen, Trennen", async ({ page }, info) => {
    // a hand-typed copy of the BTC long (05.10. 09:31, entry 62 010) – the reconciliation must find it
    const manual = {
      id: "t_hand_btc",
      account: "scalp",
      side: "long",
      status: "closed",
      date: "2026-10-05T09:31",
      pair: "BTC/USDT",
      timeframe: "15m",
      entry: 62010,
      stop: 61200,
      target: 64000,
      exit: 63230,
      size: 3100.5,
      leverage: 10,
      fees: null,
      pnlManual: null,
      setups: ["s_mtf"],
      checks: {},
      conviction: 4,
      followedPlan: true,
      emotion: "Ruhig",
      reason: "Ausbruch über die Box",
      notes: "Von Hand eingetragen",
      chart: "",
      pnl: 61,
      r: 1.5,
      createdAt: "2026-10-05T11:10:00.000Z",
      updatedAt: "2026-10-05T11:10:00.000Z",
    };
    const { errors } = await setup(page, { connected: true }, [{ kind: "trade", id: manual.id, data: manual }]);
    await open(page);
    await signIn(page);
    await expect(page.getByTestId("exchange-connected")).toBeVisible();

    // dry run: nothing written, convention verified on the real numbers
    await page.getByTestId("exchange-dry").click();
    const dry = page.getByRole("dialog", { name: "Probelauf" });
    await expect(dry).toBeVisible();
    await expect(dry.getByTestId("dry-convention")).toContainText("ohne Gebühren");
    await expect(dry.getByTestId("dry-row").first()).toBeVisible();
    await shot(page, info, "dryrun");
    expect((await journalIds(page)).length).toBe(0);
    await dry.getByTestId("dry-import").click();
    await expect.poll(async () => (await journalIds(page)).length, { timeout: 15_000 }).toBe(5);

    // inbox: the biggest results first; one tap on a feeling, "Passt so" dissolves
    const inbox = page.getByTestId("sync-inbox");
    await inbox.scrollIntoViewIfNeeded();
    await expect(inbox.getByTestId("inbox-card").first()).toBeVisible();
    await shot(page, info, "inbox", inbox);
    // phones get the top three, larger screens up to six – the badge counts all open ones
    await expect(inbox.getByTestId("inbox-card")).toHaveCount(info.project.name === "mobile" ? 3 : 5);
    await expect(inbox.getByTestId("inbox-count")).toHaveText("5");
    await inbox.getByTestId("inbox-done").first().click();
    await expect(inbox.getByTestId("inbox-count")).toHaveText("4", { timeout: 5_000 });

    // reconciliation: the hand-typed BTC long is the synced one → merge by hold keeps notes, setup, feeling
    const recon = page.getByTestId("reconcile-card");
    await recon.scrollIntoViewIfNeeded();
    await expect(recon.getByTestId("recon-pair")).toHaveCount(1);
    await shot(page, info, "reconcile", recon);
    const merge = recon.getByTestId("recon-merge");
    const box = (await merge.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1500);
    await page.mouse.up();
    // nothing left to reconcile → the card leaves the page ("trade the best": no empty reconciliation)
    await expect(page.getByTestId("reconcile-card")).toHaveCount(0, { timeout: 10_000 });
    const merged = (await journalIds(page)).find((t) => t.id === "t_bx_1844291077356544000")!;
    expect(merged).toMatchObject({ notes: "Von Hand eingetragen", emotion: "Ruhig", pnl: 59.1829 });
    const all = await page.evaluate(() =>
      (window as unknown as { __tjJournal: { getState(): { trades: { id: string }[] } } }).__tjJournal.getState().trades.map((t) => t.id),
    );
    expect(all).not.toContain("t_hand_btc");

    // live positions (P05 contract): the Risiko page's exposure lists the venue's open position
    await goTo(page, "#risiko", "Risiko");
    await expect(page.getByTestId("exposure-legs")).toContainText("BTCUSDT", { timeout: 20_000 });
    await goTo(page, "#konto", "Konto");
    await expect(page.getByTestId("exchange-connected")).toBeVisible();

    // manual sync: nothing new
    await page.getByTestId("exchange-sync").click();
    await expect(page.getByText("Alles aktuell")).toBeVisible();
    await expectNoHorizontalScroll(page);

    // disconnect (click asks first)
    await page.getByTestId("exchange-disconnect").click();
    await page.getByRole("button", { name: "Trennen", exact: true }).click();
    await expect(page.getByTestId("exchange-hero")).toBeVisible();
    expect((await journalIds(page)).length).toBe(5);
    expect(errors).toEqual([]);
  });

  test("CSV-Import: erkanntes Format und Mapping-Assistent", async ({ page }, info) => {
    const { errors } = await setup(page);
    await open(page);
    // signed out, the Börse card offers the CSV import
    const csvButton = card(page).getByRole("button", { name: "CSV importieren" });
    await csvButton.click();
    const sheet = page.getByRole("dialog", { name: "CSV importieren" });
    await expect(sheet).toBeVisible();
    await shot(page, info, "csv-empty");
    const binance = `Date(UTC),Symbol,Side,Price,Quantity,Amount,Fee,Realized Profit
2026-10-05 07:30:12,BTCUSDT,BUY,62000,0.03,1860,0.744 USDT,0
2026-10-05 07:45:00,BTCUSDT,BUY,61800,0.02,1236,0.4944 USDT,0
2026-10-05 11:02:45,BTCUSDT,SELL,63240,0.05,3162,1.2648 USDT,63.6
2026-10-06 13:15:00,ETHUSDT,SELL,2450.5,1.2,2940.6,1.17624,0
2026-10-06 16:40:31,ETHUSDT,BUY,2482.1,1.2,2978.52,1.191408,-37.92
`;
    await sheet.getByTestId("csv-file").setInputFiles({ name: "binance-trades.csv", mimeType: "text/csv", buffer: Buffer.from(binance) });
    await expect(sheet.getByTestId("csv-detected")).toContainText("Binance");
    await expect(sheet.getByTestId("csv-row")).toHaveCount(2);
    await shot(page, info, "csv-detected");
    await sheet.getByTestId("csv-run").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(async () => (await journalIds(page)).length).toBe(2);

    // the same export again (review F7): the preview says so and offers nothing to import
    await csvButton.click();
    await sheet.getByTestId("csv-file").setInputFiles({ name: "binance-trades.csv", mimeType: "text/csv", buffer: Buffer.from(binance) });
    await expect(sheet.getByTestId("csv-known")).toContainText("schon importiert");
    await expect(sheet.getByTestId("csv-run")).toBeDisabled();
    await expect(sheet.getByTestId("csv-run")).toContainText("Alles schon im Journal");
    await sheet.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await journalIds(page)).length).toBe(2);

    // unknown German export → mapping assistant pre-filled from the header
    await csvButton.click();
    const de = `Datum;Paar;Richtung;Einstieg;Ausstieg;Menge;Gebühren;Gewinn
05.10.2026 09:30;SOL/USDT;Long;148,2;151,65;40;4,80;131,95
`;
    await sheet.getByTestId("csv-file").setInputFiles({ name: "journal.csv", mimeType: "text/csv", buffer: Buffer.from(de) });
    await expect(sheet.getByTestId("csv-mapping")).toBeVisible();
    await expect(sheet.getByTestId("csv-row")).toHaveCount(1);
    await shot(page, info, "csv-mapping");
    await expectNoHorizontalScroll(page);
    await sheet.getByTestId("csv-run").click();
    await expect.poll(async () => (await journalIds(page)).length).toBe(3);
    expect(errors).toEqual([]);
  });

  test("API-Token: einmal sichtbar, mit Webhook-URL und Vorlage", async ({ page }, info) => {
    const { errors } = await setup(page);
    await mockBilling(page, { plan: { plan: "premium", status: "active", trialEnd: null } });
    await open(page);
    await signIn(page);
    const api = page.getByTestId("api-card");
    await api.scrollIntoViewIfNeeded();
    await api.getByRole("button", { name: "Token erstellen" }).click();
    await expect(api.getByTestId("api-fresh")).toBeVisible();
    await expect(api.getByTestId("api-token-value")).toContainText("tj_e2e");
    await expect(api.getByText("/api/v1/hooks/tradingview/tj_e2e", { exact: false })).toBeVisible();
    // separate entry / exit templates; the entry carries a size (no size → no P&L) and no constant Pine order id
    await expect(api.getByTestId("tv-template-open")).toContainText('"qty":{{strategy.order.contracts}}');
    await expect(api.getByTestId("tv-template-open")).not.toContainText("strategy.order.id");
    await expect(api.getByTestId("tv-template-close")).toContainText('"action":"close"');
    await expect(api.getByTestId("api-token")).toHaveCount(1);
    await shot(page, info, "api", api);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("ehrlich: Server ohne Schlüssel", async ({ page }, info) => {
    const { errors } = await setup(page, { unconfigured: true });
    await open(page);
    await signIn(page);
    await expect(card(page)).toContainText("noch nicht eingerichtet");
    await expect(card(page).getByRole("button", { name: "CSV importieren" })).toBeVisible();
    await shot(page, info, "unconfigured", card(page));
    expect(errors).toEqual([]);
  });

  test("ehrlich: Tarif ohne Börsen-Sync", async ({ page }, info) => {
    const { errors } = await setup(page, { notEntitled: true });
    await open(page);
    await signIn(page);
    await expect(card(page)).toContainText("ab Pro dabei");
    await expect(card(page).getByRole("button", { name: "Pro freischalten" })).toBeVisible();
    await shot(page, info, "upgrade", card(page));
    expect(errors).toEqual([]);
  });

  test("ohne Cloud: keine Börsen-Karten, CSV-Import geht trotzdem", async ({ page }) => {
    const { errors } = await setup(page);
    // the default build has no cloud: Konto shows no exchange cards …
    await open(page, "/#konto");
    await expect(page.getByTestId("exchange-card")).toHaveCount(0);
    // … and the CSV import is one tap from Einstellungen → Daten → Backup importieren
    await goTo(page, "#settings", "Einstellungen");
    await page.getByRole("button", { name: "Backup importieren" }).click();
    await page.getByTestId("import-csv").click();
    await expect(page.getByRole("dialog", { name: "CSV importieren" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
