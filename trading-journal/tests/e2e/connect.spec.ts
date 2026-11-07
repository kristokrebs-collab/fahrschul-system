/**
 * Verbindungen (Paket Verbindungen) end to end, mobile + desktop, ALL AGAINST MOCKS (no real Binance, TradingView or Supabase):
 *
 * 1. default build (no cloud): Einstellungen → Verbindungen lists every service and says honestly that it is not set up;
 *    the dialog explains it; no partner link; touch targets ≥ 44 px; no sideways scroll.
 * 2. cloud build against the Supabase mock (`CLOUD_URL`, `npm run build:e2e-cloud`), the connection functions faked in this
 *    file: the Binance wizard (rights refused, a warning that must be confirmed, success, first import with progress, no
 *    secret in the DOM), the placeholder's states, the TradingView assistant (address, test signal, receipt, rotate).
 *
 * Nothing here says the live exchange works – the report lists what is mock only.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { cloudUrl, collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, seed } from "./helpers";
import { mockSupabase } from "./mocks/supabase";

const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function expectAccessible(page: Page, include: string, what: string): Promise<void> {
  await page.waitForTimeout(1200);
  const res = await new AxeBuilder({ page }).include(include).withTags(TAGS).analyze();
  const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(lines, `${what}: axe violations`).toEqual([]);
}
const EMAIL = "trader@example.com";
const PASSWORD = "richtig-geheim-42";
const KEY = "bnk9f3a1c2d4e5f60718293a4b5c6d7e";
const SECRET = "bns0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c";
const TV_TOKEN = `tj_${"Q".repeat(43)}`;

interface Mock {
  connects: Record<string, unknown>[];
  hooks: { url: string; body: string }[];
  calls: string[];
  conn: Record<string, unknown> | null;
  tvToken: string | null;
  receipts: Record<string, unknown>[];
}

interface MockOptions {
  /** how the connect call answers */
  connect?: (body: Record<string, unknown>) => { status: number; body: unknown };
  unconfigured?: boolean;
  notEntitled?: boolean;
  invalid?: boolean;
  connected?: boolean;
  egressIp?: string | null;
  /** status reads until a started first import reports `ok` */
  backfillPolls?: number;
}

const CONN = (over: Record<string, unknown> = {}) => ({
  id: "c0ffee00-0000-4000-8000-0000000000b2",
  exchange: "binance",
  label: "Futures",
  keyLast4: KEY.slice(-4),
  permissions: ["read"],
  status: "active",
  lastSyncAt: new Date(Date.now() - 12 * 60_000).toISOString(),
  lastError: null,
  journalAccount: "scalp",
  syncEnabled: true,
  createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  market: "futures",
  ...over,
});

/** Fakes the connection functions (registered AFTER `mockSupabase`; Playwright runs the newest route first). */
async function mockConnections(page: Page, o: MockOptions = {}): Promise<Mock> {
  const m: Mock = { connects: [], hooks: [], calls: [], conn: o.connected ? CONN(o.invalid ? { status: "invalid", lastError: "Binance lehnt den Key ab: falscher Key, nicht erlaubte IP oder fehlendes Recht." } : {}) : null, tvToken: null, receipts: [] };
  let backfill: { id: string; reads: number } | null = null;
  const send = (route: Route, status: number, body?: unknown) =>
    route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: body === undefined ? "" : JSON.stringify(body) });

  await page.route(/\/api\/v1\/exchange\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    m.calls.push(`${method} ${url.pathname}`);
    if (url.pathname.endsWith("/exchange/sync") && method === "GET") {
      let runs: unknown[] = [];
      if (backfill) {
        backfill.reads++;
        const done = backfill.reads > (o.backfillPolls ?? 1);
        runs = [{ id: backfill.id, connectionId: m.conn?.id ?? null, exchange: "binance", kind: "backfill", status: done ? "ok" : "running", startedAt: new Date().toISOString(), finishedAt: done ? new Date().toISOString() : null, fetched: done ? 3 : 2, inserted: done ? 3 : 0, updated: 0, unchanged: 0, skipped: 0, error: null, more: false, dryRun: false }];
      }
      return send(route, 200, {
        configured: !o.unconfigured,
        cron: { enabled: true, everyMin: 30, nextAt: new Date(Date.now() + 600_000).toISOString() },
        plan: { plan: o.notEntitled ? "free" : "pro", entitled: !o.notEntitled, limit: o.notEntitled ? 0 : 5, gated: true, autoSync: !o.notEntitled },
        connections: m.conn ? [m.conn] : [],
        runs,
        binance: { egressIp: o.egressIp ?? null },
      });
    }
    if (url.pathname.endsWith("/exchange/connect") && method === "POST") {
      const body = req.postDataJSON() as Record<string, unknown>;
      m.connects.push(body);
      const answer = (o.connect ?? (() => ({ status: 201, body: { connection: CONN(), account: { marginCoin: "USDT", available: 800.5, margin: 0, unrealizedPnl: 0 } } })))(body);
      if (answer.status === 201) m.conn = CONN();
      return send(route, answer.status, answer.body);
    }
    if (url.pathname.endsWith("/exchange/backfill")) {
      const b = req.postDataJSON() as { runId: string };
      backfill = { id: b.runId, reads: 0 };
      return route.fulfill({ status: 202, body: "" });
    }
    if (url.pathname.endsWith("/exchange/disconnect")) {
      m.conn = null;
      return send(route, 200, { ok: true });
    }
    return send(route, 404, { error: { code: "not_found", message: "Unbekannt." } });
  });

  await page.route(/\/api\/v1\/connections\/tradingview/, async (route) => {
    const method = route.request().method();
    m.calls.push(`${method} /connections/tradingview`);
    if (method === "GET")
      return send(route, 200, {
        hasToken: !!m.tvToken,
        token: m.tvToken ? { id: "t1", prefix: m.tvToken.slice(0, 8), createdAt: new Date().toISOString(), lastUsedAt: null } : null,
        receipts: m.receipts,
        receiptsAvailable: true,
        tradeAlerts: { allowed: false, plan: "free" },
        origin: null,
      });
    if (method === "POST") {
      const action = (route.request().postDataJSON() as { action: string }).action;
      m.tvToken = action === "rotate" ? `tj_${"R".repeat(43)}` : TV_TOKEN;
      return send(route, 201, { token: m.tvToken, path: `/api/v1/hooks/tradingview/${m.tvToken}`, info: {} });
    }
    m.tvToken = null;
    return send(route, 200, { ok: true });
  });

  await page.route(/\/api\/v1\/hooks\/tradingview\//, async (route) => {
    const body = route.request().postData() ?? "";
    m.hooks.push({ url: route.request().url(), body });
    m.receipts = [{ id: `r${m.receipts.length + 1}`, kind: "test", via: body.includes('"source":"app"') ? "app" : "extern", symbol: "TEST", detail: null, receivedAt: new Date().toISOString() }, ...m.receipts];
    return send(route, 200, { ok: true, result: "test" });
  });

  await page.route(/\/api\/v1\/alerts\/test/, (route) => send(route, 200, { configured: false, entitled: true, hasEmail: true, emailConfirmed: true, lastRun: null, intervalMin: 5 }));
  return m;
}

/**
 * Signs in through the header pill. Two things this waits for on purpose (CI failure: "Alles synchron." never showed):
 * - the sheet body is `inert` until the panel's morph has settled (`src/motion/Sheet.tsx`), and Playwright's `fill` on an
 *   inert input "succeeds" without writing anything: on slow runners the e-mail was lost while the dialog already counted
 *   as visible. So: wait until nothing in the dialog is inert, fill, and check that the values really stuck.
 * - the end of the login is the welcome VIEW (`data-auth-view="welcome"`), not the text of the first sync: whether that
 *   sync is already done is the cloud sync's business, not this spec's.
 */
async function signIn(page: Page): Promise<void> {
  const pill = page.locator('[data-cloud-pill="signin"]');
  const sheet = page.getByRole("dialog", { name: "Anmelden" });
  await expect(pill).toBeVisible({ timeout: 20_000 });
  // the first click can land before the page's handlers are attached (loaded machine): click again until the sheet is there
  await expect(async () => {
    if (!(await sheet.isVisible())) await pill.click();
    await expect(sheet).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 25_000 });
  await expect(sheet.locator("[inert]")).toHaveCount(0, { timeout: 20_000 });
  const email = sheet.getByLabel("E-Mail");
  const password = sheet.getByLabel("Passwort", { exact: true });
  await expect(async () => {
    await email.fill(EMAIL);
    await password.fill(PASSWORD);
    await expect(email).toHaveValue(EMAIL, { timeout: 1_000 });
    await expect(password).toHaveValue(PASSWORD, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page.locator('[data-auth-view="welcome"]')).toBeVisible({ timeout: 45_000 });
  const go = page.getByRole("button", { name: "Los geht’s" });
  await expect(go).toBeVisible();
  await go.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

/** Hosts that belong to the test world: the preview itself and the Supabase mock. Everything else is not mocked. */
const isTestHost = (u: URL): boolean => u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname.endsWith("e2e-mock.supabase.co");

async function openCloud(page: Page, hash: string, h1: string, o: MockOptions = {}): Promise<Mock> {
  collectErrors(page);
  // Registered FIRST = asked last: only requests that no mock below answers land here. In CI they would go out to the real
  // internet and answer differently than behind the sandbox's proxy; here they fail at once, like offline.
  await page.route((u) => !isTestHost(u), (route) => route.abort("internetdisconnected"));
  await mockSupabase(page, {});
  const m = await mockConnections(page, o);
  await seed(page);
  await openRoute(page, cloudUrl(hash), h1, { timeout: 30_000 });
  await signIn(page);
  return m;
}

const slot = (page: Page, id: string) => page.getByTestId(`connect-slot-${id}`);
const dialog = (page: Page) => page.getByRole("dialog");

test.describe("Verbindungen · Standard-Ausgabe (kein Cloud-Konto im Build)", () => {
  test.setTimeout(90_000);
  test.beforeEach(({ page }, info) => {
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop only");
    void page;
  });

  test("Einstellungen → Verbindungen: sieben Dienste, jeder ehrlich „nicht eingerichtet“; der Dialog erklärt es; kein Partnerlink", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await openRoute(page, "/#settings", "Einstellungen");
    const hub = page.getByTestId("connections-hub");
    await hub.scrollIntoViewIfNeeded();
    for (const id of ["cloud", "binance-spot", "binance-futures", "bitunix", "tradingview", "alert-email", "alert-phone"]) {
      await expect(slot(page, id)).toBeVisible({ timeout: 20_000 });
      await expect(slot(page, id)).toHaveAttribute("data-state", "unconfigured");
    }
    await expect(slot(page, "alert-phone")).toContainText("noch nicht eingerichtet");
    await expectNoHorizontalScroll(page);

    // every placeholder is a real touch target (touch devices: the invisible tap area of `.touch-hit`)
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="connections-hub"]' });
      expect(misses, JSON.stringify(misses)).toEqual([]);
    }

    await slot(page, "binance-futures").click();
    const d = dialog(page);
    await expect(d).toBeVisible();
    await expect(d.getByTestId("connect-info")).toContainText("Betreiber");
    await expect(d.getByTestId("partner-box")).toHaveCount(0); // partner links are off unless the operator sets them
    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
    expect(errors.filter((e) => !/favicon|ERR_|Failed to load resource/.test(e))).toEqual([]);
  });

  test("Einstellungen: die Verbindungen-Karte bringt ihren Platz mit – sie wächst nach dem ersten Bild um weniger als 60 px", async ({ page }) => {
    await seed(page);
    await page.goto("/#settings");
    await expect(page.locator('[data-page="settings"][data-page-role="current"] h1').first()).toBeAttached({ timeout: 40_000 });
    const wrap = page.locator('[data-section="s-verbindungen"] > div').last();
    await wrap.scrollIntoViewIfNeeded();
    // the box exists (reserved) before the card is there; remember its height at the first look and again once the rows are in
    const heightOfBox = () => wrap.evaluate((el) => el.getBoundingClientRect().height);
    const first = await heightOfBox();
    await expect(page.getByTestId("connect-slot-cloud")).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(2500);
    const last = await heightOfBox();
    expect(last - first, `die Karte wuchs von ${first} auf ${last} px`).toBeLessThan(60);
    // the placeholders swap the same-size outline for the row: the rows do not move once they are there
    const tops = () => page.locator('[data-testid^="connect-slot-"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top - (e.closest('[data-section]') as HTMLElement).getBoundingClientRect().top)));
    const t1 = await tops();
    await page.waitForTimeout(1500);
    expect(await tops()).toEqual(t1);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`Barrierefreiheit der Verbindungen-Karte und des Dialogs (axe, ${theme === "dark" ? "dunkles" : "helles"} Thema)`, async ({ page }) => {
      await seed(page, { extra: { "tj2-theme": JSON.stringify(theme) } });
      await openRoute(page, "/#settings", "Einstellungen");
      const hub = page.getByTestId("connections-hub");
      await hub.scrollIntoViewIfNeeded();
      await expect(slot(page, "tradingview")).toBeVisible({ timeout: 30_000 });
      await expectAccessible(page, '[data-testid="connections-hub"]', `Verbindungen (${theme})`);
      await slot(page, "binance-spot").click();
      await expect(dialog(page).getByTestId("connect-info")).toBeVisible();
      await expectAccessible(page, '[data-testid="connect-dialog"]', `Dialog „nicht eingerichtet“ (${theme})`);
    });
  }

  test("Telefon-Alarm im Alarm-Bereich der Markt-Seite sagt ehrlich, dass es ihn noch nicht gibt", async ({ page }) => {
    await seed(page);
    await openRoute(page, "/#markt", "Markt");
    const s = slot(page, "alert-phone");
    await s.scrollIntoViewIfNeeded();
    await expect(s).toHaveAttribute("data-state", "unconfigured", { timeout: 30_000 });
    await expect(s).toContainText("noch nicht eingerichtet");
  });
});

test.describe("Verbindungen · mit Konto (Cloud-Build gegen die Mocks)", () => {
  test.setTimeout(150_000);
  test.beforeEach(({ page }, info) => {
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop only");
    void page;
  });

  async function toForm(page: Page) {
    const d = dialog(page);
    await expect(d).toBeVisible();
    await d.getByTestId("bn-next").click();
    await expect(d.getByTestId("bn-submit")).toBeVisible();
    return d;
  }

  async function fillAndSubmit(page: Page) {
    const d = dialog(page);
    await d.getByLabel("API-Key").fill(KEY);
    await d.getByLabel("Secret").fill(SECRET);
    await d.getByTestId("bn-readonly").check();
    await d.getByTestId("bn-submit").click();
    return d;
  }

  test("Binance Futures: ein Key mit Auszahlungsrecht wird abgelehnt – Befund in Klartext, nichts gespeichert, kein Secret im DOM", async ({ page }, info) => {
    const m = await openCloud(page, "konto", "Konto", {
      connect: () => ({
        status: 422,
        body: { error: { code: "rights_refused", message: "Der Key darf Geld abheben.", details: { issues: [{ code: "withdraw", level: "block", text: "Der Key darf Geld abheben („Enable Withdrawals“). So einen Key verbinden wir nicht – schalte das Recht bei Binance aus oder lege einen neuen Key an." }] } } },
      }),
      egressIp: "203.0.113.9",
    });
    await slot(page, "binance-futures").scrollIntoViewIfNeeded();
    await expect(slot(page, "binance-futures")).toHaveAttribute("data-state", "disconnected", { timeout: 20_000 });
    await slot(page, "binance-futures").click();
    const d = dialog(page);
    await expect(d.getByTestId("bn-ip-note")).toContainText("203.0.113.9");
    await expectNoHorizontalScroll(page);
    await toForm(page);
    await fillAndSubmit(page);
    const refused = d.getByTestId("bn-refused");
    await expect(refused).toBeVisible();
    await expect(refused).toContainText("Enable Withdrawals");
    expect(await page.content()).not.toContain(SECRET);
    expect(m.connects).toHaveLength(1);
    expect(m.connects[0]).toMatchObject({ exchange: "binance", market: "futures", readOnlyConfirmed: true });
    expect(m.conn).toBeNull();
    await expectAccessible(page, '[data-testid="connect-dialog"]', "Binance-Dialog (abgelehnt)");
    await expectNoHorizontalScroll(page);
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="connect-dialog"]' });
      expect(misses, JSON.stringify(misses)).toEqual([]);
    }
  });

  test("Binance Futures: die Futures-Warnung muss bestätigt werden, dann steht die Verbindung und der Erstimport zeigt Fortschritt", async ({ page }) => {
    const m = await openCloud(page, "konto", "Konto", {
      backfillPolls: 1,
      connect: (body) =>
        body.acceptWarnings
          ? { status: 201, body: { connection: CONN({ permissions: ["read", "futures_enabled"] }), account: { marginCoin: "USDT", available: 800.5, margin: 0, unrealizedPnl: 0 } } }
          : { status: 409, body: { error: { code: "rights_confirm", message: "Bitte prüfen.", details: { issues: [{ code: "futures_access", level: "warn", text: "Für Futures verlangt Binance das Recht „Futures“ – ein reines Lese-Recht gibt es dort nicht." }] } } } },
    });
    await slot(page, "binance-futures").click();
    await toForm(page);
    const d = await fillAndSubmit(page);
    await expect(d.getByTestId("bn-confirm")).toContainText("ein reines Lese-Recht gibt es dort nicht");
    await expect(d.getByTestId("bn-confirm-go")).toBeDisabled();
    await d.getByTestId("bn-accept").check();
    await expect(d.getByTestId("bn-confirm-go")).toBeEnabled();
    await d.getByTestId("bn-confirm-go").click();
    await expect(d.getByTestId("bn-done")).toBeVisible();
    await expect(d.getByTestId("bn-done")).toContainText("Futures-Zugang: an");
    expect(m.connects.map((c) => c.acceptWarnings)).toEqual([undefined, true]);
    expect(await page.content()).not.toContain(SECRET);

    await d.getByTestId("bn-import").click();
    await expect(d.getByTestId("bn-progress")).toContainText("Import läuft");
    await expect(d.getByTestId("bn-import-done")).toContainText("Fertig – 3 neue Trades", { timeout: 30_000 });
    await expectNoHorizontalScroll(page);
    await page.keyboard.press("Escape");
    await expect(slot(page, "binance-futures")).toHaveAttribute("data-state", "connected", { timeout: 15_000 });
  });

  test("Platzhalter verbunden: Zustand, Verwalten-Ansicht mit gelesenen Rechten, Trennen fragt nach", async ({ page }) => {
    const m = await openCloud(page, "konto", "Konto", { connected: true });
    await expect(slot(page, "binance-futures")).toHaveAttribute("data-state", "connected", { timeout: 20_000 });
    await expect(slot(page, "binance-spot")).toHaveAttribute("data-state", "disconnected");
    await slot(page, "binance-futures").click();
    const manage = dialog(page).getByTestId("bn-manage");
    await expect(manage).toContainText("Verbunden");
    await expect(manage).toContainText("Lesen: ja");
    await dialog(page).getByTestId("bn-disconnect").click();
    await expect(dialog(page)).toContainText("Der Key wird hier gelöscht");
    await dialog(page).getByTestId("bn-disconnect-yes").click();
    await expect.poll(() => m.conn).toBeNull();
    await page.keyboard.press("Escape");
    await expect(slot(page, "binance-futures")).toHaveAttribute("data-state", "disconnected", { timeout: 15_000 });
  });

  test("Platzhalter Fehler: abgelehnter Key steht im Klartext an der Zeile", async ({ page }) => {
    await openCloud(page, "konto", "Konto", { connected: true, invalid: true });
    await expect(slot(page, "binance-futures")).toHaveAttribute("data-state", "error", { timeout: 20_000 });
    await expect(slot(page, "binance-futures")).toContainText("Binance lehnt den Key ab");
  });

  test("Platzhalter nicht eingerichtet: der Server hat keinen Verschlüsselungsschlüssel – die Zeile und der Dialog sagen es", async ({ page }) => {
    await openCloud(page, "konto", "Konto", { unconfigured: true });
    await expect(slot(page, "binance-spot")).toHaveAttribute("data-state", "unconfigured", { timeout: 20_000 });
    await slot(page, "binance-spot").click();
    await expect(dialog(page).getByTestId("connect-info")).toContainText("Betreiber");
    await expect(dialog(page).getByTestId("bn-setup")).toHaveCount(0);
  });

  test("Platzhalter im höheren Tarif: ein Klick führt zur Tarif-Ansicht statt in einen Dialog", async ({ page }) => {
    await openCloud(page, "konto", "Konto", { notEntitled: true });
    await expect(slot(page, "binance-spot")).toHaveAttribute("data-state", "upgrade", { timeout: 20_000 });
    await expect(slot(page, "binance-spot")).toContainText("höheren Tarif");
  });

  test("TradingView: Zieladresse erstellen → Vorlagen → Testsignal senden → Empfang; neue Adresse ersetzt die alte", async ({ page }, info) => {
    const m = await openCloud(page, "settings", "Einstellungen");
    const s = slot(page, "tradingview");
    await s.scrollIntoViewIfNeeded();
    await expect(s).toHaveAttribute("data-state", "disconnected", { timeout: 25_000 });
    await s.click();
    const d = dialog(page);
    await expect(d.getByTestId("tv-honest")).toContainText("liest nichts aus deinem TradingView-Konto"); // B3: the OAuth way exists now (behind the operator's setup), the address itself still reads nothing
    await d.getByTestId("tv-create").click();
    await expect(d.getByTestId("tv-url")).toContainText(`/api/v1/hooks/tradingview/${TV_TOKEN}`);
    await d.getByTestId("tv-next").click();
    await expect(d.getByTestId("tv-tpl-test")).toContainText('"action":"test"');
    await expect(d.getByTestId("tv-tpl-pine")).toContainText("alertcondition");
    await d.getByTestId("tv-next").click();
    await expect(d.getByTestId("tv-waiting")).toBeVisible();
    await d.getByTestId("tv-send-test").click();
    await expect(d.getByTestId("tv-arrived")).toContainText("Die Zieladresse funktioniert", { timeout: 15_000 });
    expect(m.hooks).toHaveLength(1);
    expect(m.hooks[0]!.body).toContain('"action":"test"');
    expect(m.hooks[0]!.url).toContain(TV_TOKEN);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, '[data-testid="connect-dialog"]', "TradingView-Dialog (Testsignal)");
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="connect-dialog"]' });
      expect(misses, JSON.stringify(misses)).toEqual([]);
    }

    await page.keyboard.press("Escape");
    await expect(s).toHaveAttribute("data-state", "connected", { timeout: 15_000 });
    await s.click();
    await d.getByTestId("tv-rotate").click();
    await d.getByTestId("tv-rotate-yes").click();
    await expect(d.getByTestId("tv-url")).toContainText(`tj_${"R".repeat(43)}`);
  });
});
