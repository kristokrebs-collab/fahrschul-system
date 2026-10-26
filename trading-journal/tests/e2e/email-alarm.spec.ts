/**
 * E-Mail-Alarm bei geschlossener App (F21) end to end – the section of the Alarme card on the Markt page, against the
 * Supabase / functions mock (`mocks/supabase.ts`) and a canned `/api/v1/alerts/test`. Nothing real is sent.
 *
 * - default build (no cloud): the section is there and says so – switch off and disabled, what goes to the server is
 *   written down, the old honest line about the open tab stays;
 * - cloud edition: signed out → „Nur mit Konto“; signed in, server without Resend → „Einrichtung nötig“; configured →
 *   off → the switch reaches the (mock) database through the cloud sync, the status lines appear, the test mail is
 *   requested, what the SERVER writes into `settings.serverAlerts` arrives over realtime and survives the app's own
 *   writes (daily limit, switch off) – the merge never overwrites the other writer;
 * - plan without the alarm and an unreachable function are named;
 * - 390 px and desktop: no horizontal scroll, touch targets ≥ 44 px on the touch project.
 * `EMAIL_SHOTS_DIR` also writes screenshots.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { cloudUrl, collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, seed, toast } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { mockBilling } from "./mocks/billing";
import { mockSupabase, type MockSupabase } from "./mocks/supabase";

const SHOTS = process.env.EMAIL_SHOTS_DIR;
const EMAIL = "trader@example.com";
const PASSWORD = "richtig-geheim-42";
const PROJECTS = process.env.EMAIL_PROJECTS?.split(",") ?? ["mobile", "desktop"];

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/email-alarm-${name}-${info.project.name}.png`, animations: "disabled" });
}

async function waitMarkt(page: Page): Promise<void> {
  await expect(page.getByTestId("markt-view")).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  const section = page.getByTestId("email-alert");
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible();
}

async function openMarkt(page: Page, url: string): Promise<void> {
  await openRoute(page, url, "Markt");
  await waitMarkt(page);
}

const section = (page: Page) => page.getByTestId("email-alert");
const state = (page: Page, s: string) => expect(section(page)).toHaveAttribute("data-state", s, { timeout: 20_000 });
const theSwitch = (page: Page) => section(page).getByRole("switch", { name: "Per E-Mail benachrichtigen" });

/** The canned `/api/v1/alerts/test`: GET status (mutable) and POST test mail (counted). */
interface Server {
  configured: boolean;
  entitled: boolean;
  confirmed: boolean;
  /** `null`: answer with this HTTP status instead */
  fail: number | null;
  lastRunAgoMin: number | null;
  tests: number;
  /** answer the next test mail with this status */
  testFail: { status: number; message: string } | null;
}
const newServer = (): Server => ({ configured: true, entitled: true, confirmed: true, fail: null, lastRunAgoMin: 3, tests: 0, testFail: null });

async function mockAlertFn(page: Page, s: Server): Promise<void> {
  await page.route(/\/api\/v1\/alerts\/test/, async (route) => {
    const req = route.request();
    const send = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (s.fail) return send(s.fail, { error: { code: "bad_gateway", message: "Ein externer Dienst antwortet gerade nicht." } });
    if (req.method() === "POST") {
      s.tests += 1;
      if (s.testFail) return send(s.testFail.status, { error: { code: "alerts_send_failed", message: s.testFail.message } });
      return send(200, { sent: true });
    }
    return send(200, {
      configured: s.configured,
      entitled: s.entitled,
      hasEmail: true,
      emailConfirmed: s.confirmed,
      lastRun: s.lastRunAgoMin == null ? null : { at: Date.now() - s.lastRunAgoMin * 60_000, ok: true, code: null, accounts: 1, symbols: 1, mails: 0, source: "binance" },
      intervalMin: 5,
    });
  });
}

/** Signs in through the header pill and waits for the first sync (see cloud.spec.ts). */
async function signIn(page: Page): Promise<void> {
  await page.locator('[data-cloud-pill="signin"]').click();
  const sheet = page.getByRole("dialog", { name: "Anmelden" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[inert]")).toHaveCount(0);
  await sheet.getByLabel("E-Mail").fill(EMAIL);
  await sheet.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
  await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Willkommen" })).toBeVisible();
  await expect(page.getByText("Alles synchron.", { exact: false })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Los geht’s" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

type StoredAlerts = { email?: boolean; armedAt?: number; maxPerDay?: number; mails?: { day: string; n: number }; mem?: Record<string, unknown>; outbox?: unknown[] };
const liveAlerts = (sb: MockSupabase): StoredAlerts | undefined => (sb.live("settings:settings") as { serverAlerts?: StoredAlerts } | undefined)?.serverAlerts;

test.describe("E-Mail-Alarm bei geschlossener App", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "the e-mail alarm runs on mobile + desktop");
  });

  test("without a cloud: the section says so, the old honest line stays, nothing is promised", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await openMarkt(page, "/#markt");
    await state(page, "nocloud");
    await expect(section(page)).toContainText("E-Mail-Alarm bei geschlossener App");
    await expect(page.getByTestId("email-alert-note")).toContainText("braucht ein Konto");
    await expect(theSwitch(page)).toBeDisabled();
    await expect(page.getByTestId("email-alert-privacy")).toContainText("E-Mail-Adresse deines Kontos");
    await expect(page.getByTestId("email-alert-privacy")).toContainText("nicht deine Trades oder Notizen");
    await expect(page.getByTestId("alerts-honest")).toContainText("nur, solange diese App in einem Browser-Tab geöffnet ist");
    await expect(section(page)).not.toContainText(/rund um die Uhr|24\/7|garantiert/i);
    await expectNoHorizontalScroll(page);
    await shot(page, info, "nocloud");
    expect(errors).toEqual([]);
  });

  test("cloud: signed out → Einrichtung nötig → off → on (reaches the database) → test mail → what the server writes survives the app's writes → off", async ({ page }, info) => {
    const errors = collectErrors(page);
    const sb = await mockSupabase(page);
    await mockBilling(page, { enabled: false });
    const server = newServer();
    server.configured = false;
    await mockAlertFn(page, server);
    await seed(page, { boxes: true });
    await openMarkt(page, cloudUrl("markt"));

    // signed out
    await state(page, "signedout");
    await expect(section(page)).toContainText("Nur mit Konto");
    await expect(theSwitch(page)).toBeDisabled();
    await expectNoHorizontalScroll(page);
    await shot(page, info, "signedout");

    // signed in, but the server has no Resend key
    await signIn(page);
    await section(page).scrollIntoViewIfNeeded();
    await state(page, "setup");
    await expect(page.getByTestId("email-alert-note")).toContainText("RESEND_API_KEY und ALERT_FROM");
    await expect(theSwitch(page)).toBeDisabled();
    await expect(section(page).getByRole("button", { name: "Testmail senden" })).toHaveCount(0);
    await shot(page, info, "setup");

    // configured (the status is read again when the page is opened)
    server.configured = true;
    await page.reload();
    await waitMarkt(page);
    await state(page, "off");
    await expect(theSwitch(page)).toBeEnabled();
    await expect(section(page).getByRole("button", { name: "Testmail senden" })).toBeEnabled();
    await expect(section(page)).toContainText(`Empfänger: ${EMAIL}`);
    await expectNoHorizontalScroll(page);
    await shot(page, info, "off");

    // switch on → the flag reaches the database through the sync; the server's own state is a clean slate
    await theSwitch(page).click();
    await state(page, "on");
    await expect.poll(() => liveAlerts(sb)?.email).toBe(true);
    expect(typeof liveAlerts(sb)?.armedAt).toBe("number");
    expect(liveAlerts(sb)?.outbox).toEqual([]);
    const rows = page.getByTestId("email-alert-rows");
    await expect(rows).toBeVisible();
    await expect(page.getByTestId("email-alert-lastrun")).toContainText(/vor \d+ Min|gerade eben/);
    await expect(rows).toContainText("angekommen");
    await expect(rows).toContainText("Mails heute");
    await expect(rows).toContainText("0 von höchstens 6");
    await expect(rows).toContainText("noch nie");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "on");

    // test mail: requested once, a toast names the account's own address
    await section(page).getByRole("button", { name: "Testmail senden" }).click();
    await expect.poll(() => server.tests).toBe(1);
    await expect(toast(page)).toContainText(`Testmail an ${EMAIL} gesendet`);
    // a refusal shows the server's reason
    server.testFail = { status: 429, message: "Zu viele Anfragen – bitte kurz warten." };
    await section(page).getByRole("button", { name: "Testmail senden" }).click();
    await expect(toast(page)).toContainText("Zu viele Anfragen – bitte kurz warten.");

    // the SERVER writes its state into settings.serverAlerts (a mail went out) – it arrives over realtime …
    const day = await page.evaluate(() => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    });
    const current = sb.live("settings:settings") as { serverAlerts: Record<string, unknown> };
    await sb.emit("settings", "settings", {
      ...current,
      serverAlerts: { ...current.serverAlerts, mails: { day, n: 1 }, lastMailAt: Date.now() - 60_000, mem: { k1: { fp: "x", m: { cycle: 0, reached: 2, fired: {}, ever: {} } } } },
    });
    await expect(rows).toContainText("1 von höchstens 6");
    await expect(rows).toContainText(/Zuletzt gemailt\d{2}\.\d{2}\. \d{2}:\d{2}/);

    // … and the app's own writes (daily limit, switch off) keep it
    await section(page).getByRole("radio", { name: "12" }).click();
    await expect.poll(() => liveAlerts(sb)?.maxPerDay).toBe(12);
    expect(liveAlerts(sb)?.mails).toEqual({ day, n: 1 });
    expect(Object.keys(liveAlerts(sb)?.mem ?? {})).toEqual(["k1"]);
    await theSwitch(page).click();
    await state(page, "off");
    await expect.poll(() => liveAlerts(sb)?.email).toBe(false);
    expect(Object.keys(liveAlerts(sb)?.mem ?? {})).toEqual(["k1"]);
    expect(liveAlerts(sb)?.mails).toEqual({ day, n: 1 });

    // touch targets of the controls this section adds
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR.replace('[role="radio"], ', ""), root: '[data-testid="email-alert"]' });
      expect(misses, JSON.stringify(misses)).toEqual([]);
    }
    expect(errors).toEqual([]);
  });

  test("cloud: no horizontal scroll, no accessibility violations in the section (on, with the status lines)", async ({ page }) => {
    const sb = await mockSupabase(page);
    await mockBilling(page, { enabled: false });
    const server = newServer();
    await mockAlertFn(page, server);
    await seed(page, { boxes: true });
    await openMarkt(page, cloudUrl("markt"));
    await signIn(page);
    await section(page).scrollIntoViewIfNeeded();
    await state(page, "off");
    await theSwitch(page).click();
    await state(page, "on");
    await expect.poll(() => liveAlerts(sb)?.email).toBe(true);
    await expectNoHorizontalScroll(page);
    const results = await new AxeBuilder({ page }).include('[data-testid="email-alert"]').withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });

  test("cloud: a plan without the alarm and an unreachable function are named, the switch stays off", async ({ page }) => {
    await mockSupabase(page);
    await mockBilling(page, { plan: { plan: "free", status: "none", trialEnd: null } });
    const server = newServer();
    await mockAlertFn(page, server);
    await seed(page, { boxes: true });
    await openMarkt(page, cloudUrl("markt"));
    await signIn(page);
    await section(page).scrollIntoViewIfNeeded();
    await state(page, "upgrade");
    await expect(page.getByTestId("email-alert-note")).toContainText("Tarif Pro");
    await expect(theSwitch(page)).toBeDisabled();
    await expect(section(page).getByRole("button", { name: "Testmail senden" })).toHaveCount(0);
  });

  test("cloud: the function does not answer – „Server nicht erreichbar“ with the reason, nothing can be switched on", async ({ page }) => {
    await mockSupabase(page);
    await mockBilling(page, { enabled: false });
    const server = newServer();
    server.fail = 502;
    await mockAlertFn(page, server);
    await seed(page, { boxes: true });
    await openMarkt(page, cloudUrl("markt"));
    await signIn(page);
    await section(page).scrollIntoViewIfNeeded();
    await state(page, "unavailable");
    await expect(page.getByTestId("email-alert-note")).toContainText("Ein externer Dienst antwortet gerade nicht.");
    await expect(theSwitch(page)).toBeDisabled();
  });
});
