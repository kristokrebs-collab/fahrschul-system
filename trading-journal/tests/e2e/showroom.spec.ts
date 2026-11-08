/**
 * Showroom (Paket S) end to end – the SHOWROOM build (`npm run build:showroom`, served by `vite preview --outDir dist-showroom`; point the suite at it with
 * `PW_SHOWROOM_BASE_URL`, e.g. `PW_SHOWROOM_BASE_URL=http://127.0.0.1:4470 npx playwright test tests/e2e/showroom.spec.ts --project=mobile --project=desktop`).
 * Without that variable the whole file is skipped (the default and cloud builds have no showroom). Accounts, payment, coach and mail run against the
 * in-page mock backend: no Supabase, Stripe or Anthropic host is reached (asserted), nothing is proven against a real service. Market data is NOT mocked
 * (Rücknahme R5): Binance / Bybit go to the real network as in the normal build – what the market cards show depends on where the browser is (the
 * sandbox gets 451 / 403), so this file asserts the card and its texts, never market numbers.
 *
 * Covered: the fixed banner (no control, the footer's legal links stay clear of it), the panel (closed until its pill is clicked) and a working jump for every
 * entry (sign-in, registration → simulated mail link → wizard, order window Premium yearly → the demo card page with its choreography → "Tarif aktiv", Markt ›
 * Top-Trader-Karte with "Was ist ein Flip?", the coach's "Mit KI formulieren", the weekly close, the wizard, the share fan, the motion settings), the declined
 * demo card, the payment error case, sign-in with the demo access, password reset by the simulated link, axe (dark, panel + payment page), reduced motion,
 * nothing wider than the screen.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll } from "./helpers";
import { expectNotInert } from "./cloudSignIn";

const SHOWROOM = process.env.PW_SHOWROOM_BASE_URL;
const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DEMO_MAIL = "demo@showroom.test";
const DEMO_PW = "demo-konto-1234";

test.skip(!SHOWROOM, "needs the showroom build (PW_SHOWROOM_BASE_URL)");
test.use({ baseURL: SHOWROOM ?? "http://127.0.0.1:4470" });
test.describe.configure({ mode: "serial" });

test.beforeEach(({ page }, info) => {
  void page;
  test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop");
});

/** Hosts of the services the Showroom mocks – a request to one of them must never leave the page. */
const MOCKED_HOST = /(^|\.)(supabase\.co|supabase\.com|stripe\.com|anthropic\.com)$|^showroom\.invalid$/;
/** Hosts of the real market data (Rücknahme R5: not mocked; what they answer depends on the browser's location). */
const MARKET = /binance|bybit|okx|data-api\.binance\.vision/i;

/** Requests to a mocked service that leave the site (must stay empty). Market data may go out – it is real. */
function foreignRequests(page: Page): string[] {
  const out: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith("http") && MOCKED_HOST.test(u.hostname)) out.push(r.url());
  });
  return out;
}

/** The app's own errors: without the browser's notes on the real market hosts (451 / 403 / CORS from a blocked region). */
const appOnly = (errors: readonly string[]): string[] => errors.filter((e) => !MARKET.test(e));

async function open(page: Page, opts: { path?: string; panel?: "open" | "closed" | "fresh" } = {}): Promise<void> {
  const panel = opts.panel ?? "open";
  await page.addInitScript((panel) => {
    sessionStorage.setItem("tj2-intro", "1");
    if (panel !== "fresh" && !localStorage.getItem("tj2-showroom-panel")) localStorage.setItem("tj2-showroom-panel", panel);
  }, panel);
  await page.goto(opts.path ?? "/");
  await expect(page.getByTestId("showroom-banner")).toBeVisible();
  await expect(page.getByTestId(panel === "open" ? "sr-panel" : "sr-open")).toBeVisible({ timeout: 30_000 });
}

/** Opens the panel again (a jump folds it away) and waits for the signed-in demo state when `signedIn`. */
async function reopenPanel(page: Page): Promise<void> {
  if (!(await page.getByTestId("sr-panel").isVisible())) await page.getByTestId("sr-open").click();
  await expect(page.getByTestId("sr-panel")).toBeVisible();
}

const jump = async (page: Page, id: string): Promise<void> => {
  await reopenPanel(page);
  await page.getByTestId(`sr-jump-${id}`).click();
};

async function waitSignedIn(page: Page): Promise<void> {
  await expect(page.getByTestId("sr-state")).toContainText("Angemeldet", { timeout: 30_000 });
}

test.describe("Showroom", () => {
  test.setTimeout(150_000);

  test("Banner: fest, ohne Schließen-Knopf, Rechtstexte frei; kein Konto-, Zahlungs- oder KI-Dienst erreicht; die Demo startet angemeldet; das Panel öffnet sich nicht von selbst", async ({ page }) => {
    const errors = collectErrors(page);
    const foreign = foreignRequests(page);
    // a first visit: the panel "Neu in dieser Version" stays closed – only its pill is there (Rücknahme R5)
    await open(page, { panel: "fresh" });
    await expect(page.getByTestId("sr-panel")).toHaveCount(0);
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("sr-panel")).toHaveCount(0);
    await page.getByTestId("sr-open").click();
    await expect(page.getByTestId("sr-panel")).toBeVisible();
    const bar = page.getByTestId("showroom-banner");
    await expect(bar).toHaveText("SHOWROOM · Demo-Daten · keine echten Konten oder Zahlungen");
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
    await expect(bar.locator("button, a, [role=button]")).toHaveCount(0);
    await waitSignedIn(page);
    await expect(page.getByTestId("sr-state")).toContainText("Demo-Konto Premium – keine echte Person");
    // the footer (legal links) ends above the band: scrolled to the end, nothing of it sits under the banner
    const footer = page.locator("footer").first();
    await expect(footer).toBeAttached();
    // scrolled to the very end (the page keeps growing while lazy cards arrive: scroll until the end stays the end)
    await expect
      .poll(async () => {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(400);
        return page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 2);
      }, { timeout: 20_000 })
      .toBe(true);
    const links = footer.getByRole("link");
    const barBox = (await bar.boundingBox())!;
    const n = await links.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const b = await links.nth(i).boundingBox();
      if (b && b.height > 0) expect(b.y + b.height, `footer link ${i} above the banner`).toBeLessThanOrEqual(barBox.y + 1);
    }
    // the panel can be closed and comes back as a pill (and stays closed after a reload)
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByTestId("sr-close").click();
    await expect(page.getByTestId("sr-open")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("sr-open")).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalScroll(page);
    expect(foreign, foreign.join("\n")).toEqual([]);
    expect(appOnly(errors), errors.join("\n")).toEqual([]);
  });

  test("Neu-Panel: jeder Sprung führt zum Ziel (Markt · Coach · Berichte · Wizard · Teilen · Bewegung)", async ({ page }) => {
    const errors = collectErrors(page);
    const foreign = foreignRequests(page);
    await open(page);
    await waitSignedIn(page);
    await expect(page.getByTestId("sr-panel").getByRole("button")).toHaveCount(11); // 9 jumps + close + reset

    // Markt › Top-Trader-Karte: the card with "Was ist ein Flip?" (text only – no chart and no marker of its own; the data is the real market's)
    await jump(page, "flip");
    const card = page.getByTestId("markt-trader-net");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole("heading", { name: "Was ist ein Flip?" })).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("flip-explainer-caption")).not.toBeEmpty({ timeout: 30_000 });
    await expect(card.getByText("Echte Daten")).toHaveCount(0);
    await expect(card.getByTestId("flip-explainer-chart")).toHaveCount(0);

    // Coach › Mit KI formulieren: the question is asked and "Mit KI formulieren" is pressed – "KI formuliert …", then the demo wording lands
    await jump(page, "voice");
    const ai = page.getByTestId("coach-ai").first();
    await expect(ai).toBeVisible({ timeout: 40_000 });
    await expect(ai.getByText("KI formuliert …")).toBeVisible({ timeout: 20_000 });
    await expect(ai.getByText(/Demo-Formulierung des Showrooms/)).toBeVisible({ timeout: 30_000 });

    // Berichte › Wochenabschluss
    await jump(page, "week");
    await expect(page.getByTestId("week-close")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("week-close-behaviour")).toBeVisible();

    // Teilen-Fächer (Berichte › Export › Weitergeben)
    await jump(page, "share");
    await expect(page.getByTestId("report-share").first()).toBeVisible({ timeout: 30_000 });

    // Einstellungen › Bewegung
    await jump(page, "motion");
    await expect(page.getByTestId("motion-section")).toBeVisible({ timeout: 30_000 });

    // Einrichtungs-Wizard
    await jump(page, "wizard");
    await expect(page.getByRole("dialog", { name: /Einrichtung|Willkommen|Los geht/i })).toBeVisible({ timeout: 20_000 });
    await expectNoHorizontalScroll(page);
    expect(foreign, foreign.join("\n")).toEqual([]);
    expect(appOnly(errors), errors.join("\n")).toEqual([]);
  });

  test("Anmelden: Demo-Zugang, Abmelden und wieder Anmelden; Passwort-Reset über den simulierten Link", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page);
    await waitSignedIn(page);
    await jump(page, "signin");
    const sheet = page.getByRole("dialog", { name: "Anmelden" });
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("sr-state")).toHaveCount(0); // the panel stepped aside
    const mail = sheet.getByLabel("E-Mail");
    const pw = sheet.getByLabel("Passwort", { exact: true });
    await expectNotInert(mail);
    await expect(mail).toHaveValue(DEMO_MAIL);
    await expect(async () => {
      await pw.fill(DEMO_PW);
      await expect(pw).toHaveValue(DEMO_PW, { timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(page.locator('[data-auth-view="welcome"]')).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Los geht’s" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // password reset: sign out, ask for a link, the knob "simulates" it, the new-password view opens
    await jump(page, "signin");
    const sheet2 = page.getByRole("dialog", { name: "Anmelden" });
    await expect(sheet2).toBeVisible({ timeout: 20_000 });
    await expectNotInert(sheet2.getByLabel("E-Mail"));
    await sheet2.getByRole("button", { name: "Passwort vergessen?" }).click();
    const reset = page.getByRole("dialog").getByRole("button", { name: /Link senden/ });
    await expect(reset).toBeVisible({ timeout: 10_000 });
    await reset.click();
    const knob = page.getByTestId("sr-mail-knob");
    await expect(knob).toBeVisible({ timeout: 20_000 });
    await expect(knob).toContainText("Demo · keine echte Mail");
    await page.getByTestId("sr-mail-open").click();
    await expect(page.getByRole("dialog").getByLabel(/Neues Passwort|Passwort/).first()).toBeVisible({ timeout: 30_000 });
    expect(appOnly(errors), errors.join("\n")).toEqual([]);
  });

  test("Registrieren: Mail-Schritt mit Demo-Knopf, simulierter Link, neues Konto landet im Einrichtungs-Wizard", async ({ page }) => {
    const errors = collectErrors(page);
    const foreign = foreignRequests(page);
    await open(page);
    await waitSignedIn(page);
    await jump(page, "signup"); // empty journal, signed out, page reloads and opens the sign-up sheet
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: /Konto erstellen/ }).first()).toBeVisible({ timeout: 40_000 });
    const mail = sheet.getByLabel("E-Mail");
    const pw = sheet.getByLabel("Passwort", { exact: true });
    await expectNotInert(mail);
    const email = `neu-${Date.now()}@showroom.test`;
    await expect(async () => {
      await mail.fill(email);
      await pw.fill("ein-langes-demo-passwort");
      await expect(mail).toHaveValue(email, { timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await sheet.getByRole("checkbox").check();
    await sheet.getByRole("button", { name: "Konto erstellen", exact: true }).click();
    // the "check your mail" step has the demo knob instead of a mail
    const knob = page.getByTestId("sr-mail-knob");
    await expect(knob).toBeVisible({ timeout: 30_000 });
    await expect(knob).toContainText(email);
    await expect(page.getByTestId("sr-mail-open")).toHaveText("Bestätigungslink simulieren");
    await page.getByTestId("sr-mail-open").click(); // the link: the page loads again with ?code=…, the session is exchanged
    // the fresh account (empty journal, signed in by the mail link) is led into the setup wizard – the link's own welcome sheet may come first
    const wizard = page.getByRole("dialog", { name: "Einrichtung" });
    const welcome = page.getByRole("button", { name: "Los geht’s" });
    await expect(wizard.or(welcome)).toBeVisible({ timeout: 45_000 });
    if (await welcome.isVisible()) await welcome.click();
    await expect(wizard).toBeVisible({ timeout: 30_000 });
    await expect(wizard).toContainText(email);
    await expect(wizard).toContainText("E-Mail bestätigt");
    expect(foreign, foreign.join("\n")).toEqual([]);
    expect(appOnly(errors), errors.join("\n")).toEqual([]);
  });

  test("Bezahlen: Premium jährlich → Bestellung → Demo-Karte (live, Flip beim CVC) → Prüfung → Bezahlt (Demo) → Tarif aktiv", async ({ page }) => {
    const errors = collectErrors(page);
    const foreign = foreignRequests(page);
    await open(page);
    await waitSignedIn(page);
    await jump(page, "order");
    const sheet = page.getByTestId("order-sheet");
    await expect(sheet).toBeVisible({ timeout: 40_000 });
    // the order window of before Paket B (Rücknahme R2): no path band, no stage
    await expect(page.getByTestId("order-steps")).toHaveCount(0);
    for (const box of await sheet.getByRole("checkbox").all()) await box.check();
    await page.getByTestId("order-pay").click();

    // the simulated hosted page: labelled as a demo, in the real purchase the card goes to Stripe
    const pay = page.getByTestId("demo-checkout");
    await expect(pay).toBeVisible({ timeout: 30_000 });
    await expect(pay).toContainText("Demo-Karte – nichts wird gespeichert oder gesendet");
    await expect(pay).toContainText("Im echten Kauf gibst du die Karte bei Stripe ein");
    // typing fills the card graphic live
    await page.getByTestId("demo-holder").fill("Ada Beispiel");
    await page.getByTestId("demo-number").fill("4242424242424242");
    await page.getByTestId("demo-expiry").fill("1234");
    await expect(page.getByTestId("demo-card-holder")).toHaveText("Ada Beispiel");
    await expect(page.getByTestId("demo-card-number")).toHaveText("4242 4242 4242 4242");
    await expect(page.getByTestId("demo-card-expiry")).toHaveText("12/34");
    // the CVC field turns the card over, leaving it turns it back
    await expect(page.getByTestId("demo-card")).toHaveAttribute("data-flipped", "0");
    await page.getByTestId("demo-cvc").focus();
    await expect(page.getByTestId("demo-card")).toHaveAttribute("data-flipped", "1");
    await page.getByTestId("demo-cvc").fill("123");
    await expect(page.getByTestId("demo-card-cvc")).toHaveText("123");
    await page.getByTestId("demo-holder").focus();
    await expect(page.getByTestId("demo-card")).toHaveAttribute("data-flipped", "0");
    await expectNoHorizontalScroll(page);
    await page.getByTestId("demo-pay").click();
    await expect(page.getByTestId("demo-auth")).toHaveAttribute("data-phase", "authorising");
    await expect(page.getByText("Die Bank wird gefragt …")).toBeVisible();
    await expect(page.getByTestId("demo-auth")).toHaveAttribute("data-phase", "done", { timeout: 20_000 });
    await expect(page.getByTestId("demo-result")).toContainText("Bezahlt (Demo)");
    await page.getByTestId("demo-continue").click();
    // back in the journal: the result page asks the mock server, the note says Demo
    await expect(page.getByText("Dein Abo ist aktiv").first()).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText("Demo: Tarif aktiv (simuliert)").first()).toBeVisible({ timeout: 20_000 });
    expect(foreign, foreign.join("\n")).toEqual([]);
    expect(appOnly(errors), errors.join("\n")).toEqual([]);
  });

  test("Bezahlen: die abgelehnte Demo-Karte (4000 0000 0000 0002) und der Fehlerfall nach der Prüfung", async ({ page }) => {
    await open(page);
    await waitSignedIn(page);
    await jump(page, "order");
    const sheet = page.getByTestId("order-sheet");
    await expect(sheet).toBeVisible({ timeout: 40_000 });
    for (const box of await sheet.getByRole("checkbox").all()) await box.check();
    await page.getByTestId("order-pay").click();
    await expect(page.getByTestId("demo-checkout")).toBeVisible({ timeout: 40_000 });
    await page.getByTestId("demo-pay").click(); // empty form: nothing happens but the hint
    await expect(page.getByTestId("demo-error")).toContainText("Bitte fülle alle Felder");
    await page.getByTestId("demo-fill-decline").click();
    await page.getByTestId("demo-pay").click();
    await expect(page.getByTestId("demo-error")).toContainText("abgelehnt", { timeout: 20_000 });
    await expect(page.getByTestId("demo-checkout")).toHaveAttribute("data-phase", "form");
    // the error case "payment fails after the check": the result page says so, nothing is activated
    await page.getByTestId("demo-fill-ok").click();
    await page.getByTestId("demo-outcome").selectOption("unpaid");
    await page.getByTestId("demo-pay").click();
    await expect(page.getByTestId("demo-result")).toContainText("gescheitert", { timeout: 20_000 });
    await page.getByTestId("demo-continue").click();
    await expect(page.getByText("Demo: Zahlung fehlgeschlagen (simuliert)").first()).toBeVisible({ timeout: 40_000 });
  });

  test("a11y: Hauptseite mit Panel und die Demo-Zahlungsseite (axe, dunkel); Reduced Motion: keine Drehung, das Ergebnis steht", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await waitSignedIn(page);
    const main = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(main.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    await jump(page, "order");
    const sheet = page.getByTestId("order-sheet");
    await expect(sheet).toBeVisible({ timeout: 40_000 });
    for (const box of await sheet.getByRole("checkbox").all()) await box.check();
    await page.getByTestId("order-pay").click();
    await expect(page.getByTestId("demo-checkout")).toBeVisible({ timeout: 40_000 });
    const checkout = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(checkout.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    expect(await page.getByTestId("demo-card").evaluate((el) => Number.parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(0.001);
    await page.getByTestId("demo-fill-ok").click();
    await page.getByTestId("demo-pay").click();
    await expect(page.getByTestId("demo-result")).toContainText("Bezahlt (Demo)", { timeout: 15_000 });
    expect(await page.getByTestId("demo-auth").evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length)).toBe(0);
    await expectNoHorizontalScroll(page);
  });
});
