/**
 * Die vier Alarme (C2) end to end – Einstellungen › Benachrichtigungen › Alarme, against the Supabase mock and canned `/api/v1/alerts/*`
 * answers (no server, no Twilio, no mail: nothing real is called – an honest "nur Mock geprüft").
 *
 * - the fold is closed on a first visit and its card (own chunk) is fetched only when it is opened
 * - Free / Pro: the plan's channel count is named, the phone says "ab Premium" with the next step; a channel beyond the limit stays off
 * - Premium: the phone from "Fehlt" to "Verbunden" – number with country code, explicit consent first, SMS code (wrong, then right), test
 *   call, opt-out – and the phone events become switchable only after that
 * - the Zustellprotokoll names every outcome and its reason; a dead letter is visible; a server that is not set up says "Einrichtung nötig"
 * - 390 px and desktop: no horizontal scroll, touch targets ≥ 44 px on the touch project, no serious accessibility violation
 * `ALARME_SHOTS_DIR` also writes screenshots.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { cloudUrl, collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, seed, waitForStableLayout } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { mockBilling } from "./mocks/billing";
import { mockSupabase } from "./mocks/supabase";

const SHOTS = process.env.ALARME_SHOTS_DIR;
const EMAIL = "trader@example.com";
const PASSWORD = "richtig-geheim-42";

const OFF = { green_warn: false, green_confirm: false, red_warn: false, red_confirm: false };
const prefs = (over: Record<string, unknown> = {}) => ({
  v: 1,
  lang: "de",
  channels: { browser: OFF, email: OFF, phone: OFF },
  quiet: { on: true, from: "22:00", to: "07:00" },
  cooldownMin: 360,
  sources: {
    industry: { on: false, markets: [], params: { warn: 2, confirm: 0, hyst: 0.5 } },
    whale: { on: false, markets: ["BTCUSDT"], params: { warn: 3, confirm: 2, hyst: 1 } },
    keylevel: { on: false, markets: [], params: { warn: 0, confirm: 0, hyst: 0 } },
  },
  ...over,
});

interface Srv {
  view: Record<string, unknown> & { prefs: ReturnType<typeof prefs>; phone: Record<string, unknown>; limits: Record<string, number>; email: Record<string, unknown> };
  feed: Record<string, unknown>;
  puts: { prefs: ReturnType<typeof prefs> }[];
  starts: string[];
  checks: string[];
  phoneTests: number;
  emailTests: number;
  revokes: number;
  putFail: { status: number; code: string; message: string } | null;
}

function newSrv(plan: "free" | "pro" | "premium", over: Partial<Srv["view"]> = {}): Srv {
  const limits = plan === "free" ? { alertChannels: 1, phoneCallsPerMonth: 0 } : plan === "pro" ? { alertChannels: 2, phoneCallsPerMonth: 0 } : { alertChannels: 3, phoneCallsPerMonth: 30 };
  return {
    view: { prefs: prefs(), plan, limits, tz: "Europe/Berlin", email: { configured: true, hasEmail: true, confirmed: true }, phone: { configured: true, verifyConfigured: true, status: "none", masked: null }, lastRun: { at: Date.now() - 120_000, ok: true, code: null }, ...over },
    feed: { events: [], other: [], browser: [] },
    puts: [],
    starts: [],
    checks: [],
    phoneTests: 0,
    emailTests: 0,
    revokes: 0,
    putFail: null,
  };
}

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const err = (route: Route, status: number, code: string, message: string) => json(route, status, { error: { code, message } });

async function mockAlertFns(page: Page, s: Srv): Promise<void> {
  await page.route(/\/api\/v1\/alerts\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const body = req.postData() ? (JSON.parse(req.postData()!) as Record<string, unknown>) : {};
    if (url.pathname.endsWith("/alerts/prefs")) {
      if (method === "PUT") {
        if (s.putFail) return err(route, s.putFail.status, s.putFail.code, s.putFail.message);
        s.puts.push(body as { prefs: ReturnType<typeof prefs> });
        s.view.prefs = (body as { prefs: ReturnType<typeof prefs> }).prefs;
      }
      return json(route, 200, s.view);
    }
    if (url.pathname.endsWith("/alerts/feed")) return json(route, 200, method === "POST" ? { acked: 1 } : s.feed);
    if (url.pathname.endsWith("/alerts/email-test")) {
      s.emailTests += 1;
      return json(route, 200, { sent: true });
    }
    if (url.pathname.endsWith("/alerts/phone")) {
      if (method === "DELETE") {
        s.revokes += 1;
        s.view.phone = { ...s.view.phone, status: "revoked", masked: null };
        return json(route, 200, { status: "revoked" });
      }
      if (body.action === "start") {
        if (!body.consent) return err(route, 422, "invalid_body", "Eingaben unvollständig oder ungültig.");
        s.starts.push(String(body.number));
        s.view.phone = { ...s.view.phone, status: "pending", masked: "+49 ••• ••67" };
        return json(route, 200, { status: "pending", masked: "+49 ••• ••67" });
      }
      if (body.action === "check") {
        s.checks.push(String(body.code));
        if (body.code !== "123456") return err(route, 422, "code_wrong", "Der Code stimmt nicht.");
        s.view.phone = { ...s.view.phone, status: "verified", masked: "+49 ••• ••67" };
        return json(route, 200, { status: "verified", masked: "+49 ••• ••67" });
      }
      if (body.action === "test") {
        s.phoneTests += 1;
        return json(route, 200, { status: "queued", reason: null, reasonText: null });
      }
    }
    return err(route, 404, "not_found", "Nicht gefunden.");
  });
}

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/alarme-${name}-${info.project.name}.png`, animations: "disabled" });
}

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

const card = (page: Page) => page.getByTestId("alerts-settings");
const sw = (page: Page, channel: string, event: string) => page.getByTestId(`ev-${channel}-${event}`);

/** Opens the settings page signed in and waits for the alarm card (the fold is open by default in the seed). */
async function open(page: Page, s: Srv, opts: { foldsClosed?: boolean } = {}): Promise<void> {
  await mockSupabase(page);
  await mockBilling(page, { enabled: false });
  await mockAlertFns(page, s);
  await seed(page, { foldsClosed: opts.foldsClosed });
  await openRoute(page, cloudUrl("settings"), "Einstellungen");
  await signIn(page);
  if (opts.foldsClosed) return;
  await card(page).scrollIntoViewIfNeeded();
  await expect(card(page)).toHaveAttribute("data-state", "ok", { timeout: 20_000 });
}

test.describe("Vier Alarme", () => {
  test.setTimeout(120_000);

  test("the card is its own chunk: the fold is closed on a first visit and nothing is fetched until it is opened", async ({ page }) => {
    const errors = collectErrors(page);
    const requested: string[] = [];
    page.on("request", (r) => {
      if (/AlertSettingsCard/.test(r.url())) requested.push(r.url());
    });
    const s = newSrv("premium");
    await open(page, s, { foldsClosed: true });
    const fold = page.locator('[data-fold="settings-alarme"]');
    await fold.scrollIntoViewIfNeeded();
    await expect(fold).toBeVisible();
    await expect(fold).not.toHaveAttribute("open", "");
    expect(requested).toEqual([]);
    await fold.locator("summary").click();
    await expect(card(page)).toHaveAttribute("data-state", "ok", { timeout: 20_000 });
    expect(requested.length).toBeGreaterThan(0);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("Free: one channel – the second stays off with the plan's sentence and the way to the plans; phone says 'ab Premium'; save reaches the server", async ({ page }, info) => {
    const errors = collectErrors(page);
    const s = newSrv("free");
    await open(page, s);

    await expect(page.getByTestId("channel-count")).toHaveText("0 von 1 Kanälen in deinem Tarif");
    await expect(page.getByTestId("gate-notes")).toContainText("Anrufe gibt es ab Premium.");
    await expect(sw(page, "phone", "green_warn")).toBeDisabled();
    await expect(card(page).getByRole("button", { name: "Testanruf" })).toBeDisabled();

    await sw(page, "browser", "green_warn").click();
    await expect(sw(page, "browser", "green_warn")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("channel-count")).toHaveText("1 von 1 Kanälen in deinem Tarif");
    await sw(page, "email", "green_warn").click();
    await expect(sw(page, "email", "green_warn")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("limit-note")).toContainText("Dein Tarif erlaubt 1 Kanal gleichzeitig");

    // a second event of the SAME channel is no second channel
    await sw(page, "browser", "red_confirm").click();
    await expect(sw(page, "browser", "red_confirm")).toHaveAttribute("aria-checked", "true");

    await expectNoHorizontalScroll(page);
    await shot(page, info, "free");

    await page.getByTestId("alert-save-row").getByRole("button", { name: "Speichern" }).click();
    await expect.poll(() => s.puts.length).toBe(1);
    expect(s.puts[0]!.prefs.channels.browser).toMatchObject({ green_warn: true, red_confirm: true, green_confirm: false });
    expect(s.puts[0]!.prefs.channels.email).toEqual(OFF);
    await expect(page.getByTestId("alert-save-row").getByRole("button", { name: "Speichern" })).toBeDisabled(); // nothing unsaved any more
    // the browser flag is set so the app fetches the host that picks up browser alerts
    expect(await page.evaluate(() => localStorage.getItem("tj2-alerts-browser"))).toBe("1");

    // the next step is one tap away
    await sw(page, "email", "green_warn").click();
    await page.getByTestId("limit-note").getByRole("button", { name: "Tarife ansehen" }).click();
    await expect(page).toHaveURL(/#preise/);
    expect(errors).toEqual([]);
  });

  test("a save the server refuses (plan) shows its sentence and the way to the plans", async ({ page }) => {
    const s = newSrv("pro");
    await open(page, s);
    await sw(page, "browser", "green_warn").click();
    s.putFail = { status: 402, code: "limit_reached", message: "Dein Tarif erlaubt 2 Kanäle gleichzeitig. Schalte einen anderen Kanal aus, oder wechsle den Tarif." };
    await page.getByTestId("alert-save-row").getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByTestId("alert-save-error")).toContainText("Dein Tarif erlaubt 2 Kanäle gleichzeitig");
    await expect(page.getByTestId("alert-save-error").getByRole("button", { name: "Tarife ansehen" })).toBeVisible();
  });

  test("Premium: the phone goes from 'Fehlt' to 'Verbunden' – consent first, SMS code (wrong, then right), test call, opt-out", async ({ page }, info) => {
    const errors = collectErrors(page);
    const s = newSrv("premium");
    await open(page, s);

    const slot = page.getByTestId("alert-slot-phone");
    await expect(slot).toHaveAttribute("data-state", "missing");
    await expect(slot).toContainText("Bestätige zuerst deine Nummer.");
    await expect(sw(page, "phone", "green_warn")).toBeEnabled(); // the plan has calls …
    await slot.getByRole("button", { name: "Nummer bestätigen" }).click();

    // … but no call without a confirmed number: consent and a valid number first
    const send = slot.getByRole("button", { name: "Code senden" });
    await expect(send).toBeDisabled();
    await expect(page.getByTestId("phone-consent-text")).toContainText("Ich bin einverstanden, dass die App mich unter dieser Nummer automatisch anruft");
    await slot.getByLabel("Telefonnummer").fill("0170 1234567");
    await expect(slot).toContainText("Schreibe sie mit Ländervorwahl");
    await slot.getByLabel("Telefonnummer").fill("+49 170 1234567");
    await expect(send).toBeDisabled(); // still no consent
    await slot.getByRole("checkbox", { name: "Einwilligung zu Anrufen" }).click();
    await expect(send).toBeEnabled();
    await shot(page, info, "phone-number");
    await send.click();

    // the code: wrong first
    await expect(page.getByTestId("phone-code")).toBeVisible();
    await expect(slot).toHaveAttribute("data-state", "pending");
    expect(s.starts).toEqual(["+49 170 1234567"]);
    await slot.getByLabel("Code aus der SMS").fill("000000");
    await slot.getByRole("button", { name: "Bestätigen" }).click();
    await expect(slot).toContainText("Der Code stimmt nicht.");
    await slot.getByLabel("Code aus der SMS").fill("123456");
    await slot.getByRole("button", { name: "Bestätigen" }).click();
    await expect(slot).toHaveAttribute("data-state", "connected", { timeout: 15_000 });
    await expect(page.getByTestId("phone-verified")).toContainText("+49 ••• ••67");
    await expect(page.getByTestId("phone-verified")).not.toContainText("1701234567");
    expect(s.checks).toEqual(["000000", "123456"]);
    await expectNoHorizontalScroll(page);
    await shot(page, info, "phone-verified");

    // the test call
    await page.getByTestId("test-phone").click();
    await expect(page.getByTestId("test-result")).toContainText("Der Testanruf ist unterwegs");
    expect(s.phoneTests).toBe(1);

    // phone events on, saved
    await sw(page, "phone", "green_confirm").click();
    await page.getByTestId("alert-save-row").getByRole("button", { name: "Speichern" }).click();
    await expect.poll(() => s.puts.length).toBe(1);
    expect(s.puts[0]!.prefs.channels.phone.green_confirm).toBe(true);

    // opt-out: two steps, at once
    await slot.getByRole("button", { name: "Abmelden und Nummer löschen" }).click();
    await expect(slot).toContainText("Nummer löschen und Anrufe beenden?");
    await slot.getByRole("button", { name: "Ja, abmelden" }).click();
    await expect(slot).toHaveAttribute("data-state", "missing", { timeout: 15_000 });
    expect(s.revokes).toBe(1);
    await expect(slot).not.toContainText("+49 ••• ••67");
    expect(errors).toEqual([]);
  });

  test("a test mail and a browser test: one button each, with an answer", async ({ page }) => {
    const s = newSrv("pro");
    await open(page, s);
    await page.getByTestId("test-email").click();
    await expect(page.getByTestId("test-result")).toContainText("Die Testmail ist unterwegs");
    expect(s.emailTests).toBe(1);
    await page.getByTestId("test-browser").click();
    await expect(page.getByTestId("test-result")).toContainText(/Testalarm wurde gezeigt|Als Hinweis in der App gezeigt/);
  });

  test("a server that is not set up says 'Einrichtung nötig' and offers nothing that cannot work", async ({ page }) => {
    const s = newSrv("premium", { phone: { configured: false, verifyConfigured: false, status: "none", masked: null }, email: { configured: false, hasEmail: true, confirmed: true } });
    await open(page, s);
    await expect(page.getByTestId("gate-notes")).toContainText("Das Telefon ist auf diesem Server nicht eingerichtet – Einrichtung nötig.");
    await expect(page.getByTestId("gate-notes")).toContainText("Der E-Mail-Versand ist auf diesem Server nicht eingerichtet – Einrichtung nötig.");
    await expect(sw(page, "phone", "green_warn")).toBeDisabled();
    await expect(sw(page, "email", "green_warn")).toBeDisabled();
    await expect(page.getByTestId("alert-slot-phone")).toHaveAttribute("data-state", "unavailable");
    await expect(page.getByTestId("test-phone")).toBeDisabled();
    await expect(page.getByTestId("test-email")).toBeDisabled();
    await expect(sw(page, "browser", "green_warn")).toBeEnabled(); // the browser needs no server setup beyond the schedule
  });

  test("the Zustellprotokoll: every outcome with its reason, the dead letter visible, a held-back event explained", async ({ page }, info) => {
    const errors = collectErrors(page);
    const s = newSrv("premium");
    const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
    s.feed = {
      events: [
        {
          id: "e1",
          source: "industry",
          market: "Software",
          event: "green_confirm",
          value: null,
          detail: "Datenstand 30.10.2026 · Regel: drin",
          suppressed: null,
          at: at(10),
          deliveries: [
            { id: "d1", channel: "email", status: "sent", reason: null, attempts: 1, at: at(9) },
            { id: "d2", channel: "phone", status: "failed", reason: "no_answer", attempts: 1, at: at(9) },
            { id: "d3", channel: "browser", status: "skipped", reason: "quiet_hours", attempts: 0, at: at(10) },
          ],
        },
        { id: "e2", source: "whale", market: "BTCUSDT", event: "red_warn", value: 1.2, detail: "Top-Trader (Binance, nach Positionen): 49,2 % long", suppressed: "cooldown", at: at(120), deliveries: [] },
        { id: "e3", source: "keylevel", market: "Wochenhoch", event: "green_warn", value: null, detail: null, suppressed: null, at: at(300), deliveries: [{ id: "d4", channel: "email", status: "dead", reason: "resend_5xx", attempts: 5, at: at(200) }] },
      ],
      other: [{ id: "t1", kind: "test", channel: "phone", status: "answered", reason: null, attempts: 1, at: at(1) }],
      browser: [],
    };
    await open(page, s);
    const rows = page.getByTestId("alert-protocol-row");
    await expect(rows).toHaveCount(4);
    await expect(page.getByTestId("alert-protocol")).toContainText("Grün-Bestätigung · Software");
    await expect(page.getByTestId("alert-protocol")).toContainText("Telefon: fehlgeschlagen – Nicht abgenommen");
    await expect(page.getByTestId("alert-protocol")).toContainText("E-Mail: gesendet");
    await expect(page.getByTestId("alert-protocol")).toContainText("Browser: übersprungen – Ruhezeit");
    await expect(page.getByTestId("alert-protocol")).toContainText("Zurückgehalten: dasselbe Ereignis kam kurz vorher schon an");
    await expect(page.getByTestId("alert-protocol")).toContainText("E-Mail: verworfen nach 5 Versuchen – Der Versanddienst antwortet nicht");
    await expect(page.getByTestId("alert-dead-note")).toContainText("Eine Zustellung ist nach allen Versuchen verworfen worden");
    await expect(page.getByTestId("alert-protocol")).toContainText("Test · Telefon");
    await expect(page.getByTestId("alert-protocol")).toContainText("Telefon: angenommen");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "protocol");
    expect(errors).toEqual([]);
  });

  test("sources and thresholds: switching a source on shows its pickers; the save carries them", async ({ page }) => {
    const s = newSrv("premium");
    await open(page, s);
    await page.locator("#src-industry").click();
    const picker = page.getByTestId("industry-picker");
    await expect(picker).toBeVisible();
    await picker.locator("summary").click();
    await picker.getByLabel("Computer", { exact: true }).check();
    await page.locator("#p-industry-warn").fill("1,5");
    await page.locator("#src-whale").click();
    await page.locator("#symbol-add").fill("ethusdt");
    await page.getByTestId("symbol-picker").getByRole("button", { name: "Hinzufügen" }).click();
    await expect(page.getByTestId("symbol-picker")).toContainText("ETHUSDT");
    await page.getByTestId("alert-save-row").getByRole("button", { name: "Speichern" }).click();
    await expect.poll(() => s.puts.length).toBe(1);
    const p = s.puts[0]!.prefs;
    expect(p.sources.industry.on).toBe(true);
    expect(p.sources.industry.markets.length).toBe(1);
    expect(p.sources.industry.params.warn).toBe(1.5);
    expect(p.sources.whale.markets).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  test("layout: no horizontal scroll, touch targets of at least 44 px, no serious accessibility violation", async ({ page }, info) => {
    const s = newSrv("premium", { phone: { configured: true, verifyConfigured: true, status: "verified", masked: "+49 ••• ••67" } });
    await open(page, s);
    await page.locator("#src-industry").click();
    await expect(page.getByTestId("alert-protocol")).toContainText("Noch nichts zugestellt"); // the list has loaded: nothing moves under the audit
    await waitForStableLayout(page);
    await expectNoHorizontalScroll(page);
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="alerts-settings"]' });
      expect(misses, JSON.stringify(misses.slice(0, 5))).toEqual([]);
    }
    const res = await new AxeBuilder({ page }).include('[data-testid="alerts-settings"]').analyze();
    const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    await shot(page, info, "layout");
  });
});
