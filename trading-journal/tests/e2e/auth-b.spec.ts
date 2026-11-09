/**
 * Paket B end to end (cloud edition against the Supabase mock and the billing / (FAKE) Stripe mock), with the login window of Paket V (the
 * landscape card after the reference recording: the dark band crosses the card once when Anmelden ↔ Registrieren switch, no tabs, no order
 * card in it): Premium · jährlich chosen signed out → the "mail sent" step is neutral → the confirmation link opens a NEW tab (empty
 * sessionStorage) and the sign-in there lands on exactly this order; "Kostenlos starten" drops an earlier choice; the band run (≈ 900 ms,
 * the card keeps its height, field 1 has the focus); offline said before anything is sent; the setup wizard once after a registration.
 *
 * It proves the browser flow, NOT a delivered mail, a real Stripe account or a webhook (docs/BETREIBER-AUFGABEN.md: what the
 * operator must supply). `PW_PREISE_URL` overrides the cloud URL like in `preise.spec.ts`.
 */
import { expect, test, type Page } from "@playwright/test";
import { bandSettled, blockExternalNetwork, entryGate, expectNotInert, openGated, signInViaSheet } from "./cloudSignIn";
import { cloudUrl, collectErrors, expectNoHorizontalScroll, openRoute, seed } from "./helpers";
import { mockBilling } from "./mocks/billing";
import { mockSupabase, type MockSupabaseOptions } from "./mocks/supabase";

const PREISE = process.env.PW_PREISE_URL ?? cloudUrl("preise");
const KONTO = process.env.PW_KONTO_URL ?? cloudUrl("konto");
const EMAIL = "neu@example.com";
const PASSWORD = "Ein-langer-Satz-42!";
const PROJECTS = ["mobile", "desktop"];

async function setup(page: Page, supa: MockSupabaseOptions = {}, opts: { empty?: boolean } = {}) {
  const errors = collectErrors(page);
  await blockExternalNetwork(page);
  const supabase = await mockSupabase(page, supa);
  const bill = await mockBilling(page, { outcome: "active" });
  await seed(page, opts.empty ? { empty: true } : {});
  return { supabase, bill, errors };
}

/** This browser had a session before (Konto-Pflicht: the entry gate then opens on „Anmelden“ instead of „Konto erstellen“). */
async function returningBrowser(page: Page) {
  await page.addInitScript(() => localStorage.setItem("tj2-cloud-known", "1"));
}

/** Fills the registration card (the sheet body is inert until its morph settled) and ticks the consent box when the build has one. */
async function register(page: Page, email = EMAIL) {
  const sheet = page.getByRole("dialog", { name: "Konto erstellen" });
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expectNotInert(sheet.getByLabel("E-Mail"));
  await sheet.getByLabel("E-Mail").fill(email);
  await sheet.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
  const consent = sheet.getByTestId("signup-consent").getByRole("checkbox");
  if (await consent.count()) await consent.check();
  await sheet.getByRole("button", { name: "Konto erstellen", exact: true }).click();
  return sheet;
}

test.describe("Paket B: Anmeldung, Registrierung, Einrichtung", () => {
  test.setTimeout(150_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "Paket B runs on mobile + desktop");
  });

  test("Premium · jährlich → Registrierung → Mail-Schritt neutral → Bestätigungslink im NEUEN Tab → genau diese Bestellung", async ({ page, context }) => {
    const { errors } = await setup(page, { signupConfirm: true });
    // AUTH-06: the sign-up request carries the choice in the link of the mail (redirect_to) – plan.interval.seats, never a price
    const signupUrls: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/auth/v1/signup") signupUrls.push(r.url());
    });
    await openRoute(page, PREISE, "Preise", { timeout: 30_000 });
    // signed out: the card says what the click does
    const cta = page.getByTestId("cta-premium");
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toHaveText("Premium auswählen");
    await cta.click();
    // the registration: the sheet of before Paket B (no order card in it) – the choice is noted for the way back
    const sheet = await register(page);
    await expect(page.getByTestId("auth-order")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("tj2-return-to-order"))).toContain("premium.year.1");
    // the mail step: neutral (no "account exists"), resend waits
    await expect(page.getByRole("dialog", { name: "Schau in dein Postfach" })).toBeVisible({ timeout: 20_000 });
    const text = page.getByTestId("auth-sent-text");
    await expect(text).toContainText(EMAIL);
    await expect(text).toContainText("Wenn die Adresse frei ist, schicken wir dir eine Bestätigung");
    await expect(text).toContainText("Hast du schon ein Konto, melde dich an oder setze dein Passwort zurück");
    await expect(text).not.toContainText(/gibt es schon|existiert|bereits registriert/);
    expect(signupUrls).toHaveLength(1);
    const redirect = new URL(signupUrls[0]!).searchParams.get("redirect_to");
    expect(redirect).toMatch(/\/\?order=premium\.year\.1$/);
    expect(redirect).not.toMatch(/price|cent|amount/i);
    await expect(page.getByTestId("auth-resend")).toBeDisabled();
    await expectNoHorizontalScroll(page);
    void sheet;

    // the confirmation link opens a NEW tab: no sessionStorage, the same localStorage; the account is confirmed by then
    const tab = await context.newPage();
    await setup(tab, { users: [{ email: EMAIL, password: PASSWORD }] });
    await openRoute(tab, PREISE, "Preise", { timeout: 30_000 });
    await signInViaSheet(tab, { email: EMAIL, password: PASSWORD, expectNext: true, synced: true });
    const order = tab.getByTestId("order-sheet");
    await expect(order).toBeVisible({ timeout: 30_000 });
    await expect(order).toHaveAttribute("data-plan", "premium");
    await expect(order).toHaveAttribute("data-interval", "year");
    await expect(order).toHaveAttribute("data-seats", "1");
    await expect(order.getByTestId("order-total")).toContainText("240 €");
    expect(errors).toEqual([]);
  });

  test("Team · 2 Sitze: die Bestellung nach der Anmeldung zeigt 380 € pro Jahr (2 × 190 €)", async ({ page }) => {
    await setup(page, { users: [{ email: EMAIL, password: PASSWORD }] });
    await openRoute(page, PREISE, "Preise", { timeout: 30_000 });
    const team = page.getByTestId("plan-team");
    await team.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("team-total")).toHaveText("2 Sitze: 380 € pro Jahr");
    await page.getByTestId("cta-team").click();
    const sheet = page.getByRole("dialog", { name: "Konto erstellen" });
    await expectNotInert(sheet.getByLabel("E-Mail"));
    // an existing account: the footer link leads over to the login (the band runs back), the choice stays noted
    await sheet.getByTestId("auth-to-signin").click();
    await expect(page.getByRole("dialog", { name: "Anmelden" })).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => localStorage.getItem("tj2-return-to-order"))).toContain("team.year.2");
    await signInViaSheet(page, { fromPill: false, email: EMAIL, password: PASSWORD, expectNext: true, synced: true });
    const order = page.getByTestId("order-sheet");
    await expect(order).toBeVisible({ timeout: 30_000 });
    await expect(order).toHaveAttribute("data-plan", "team");
    await expect(order).toHaveAttribute("data-seats", "2");
    await expect(order.getByTestId("order-total")).toContainText("380 €");
  });

  test("Link der Mail mit ?order=: die Seite prüft die Auswahl erneut, nimmt den Parameter aus der Adresse, merkt sie nur vor – bestellt wird nichts", async ({ page }) => {
    const { bill, errors } = await setup(page, { users: [{ email: EMAIL, password: PASSWORD }] });
    // a link as the mail brings it: ?order=… and the sign-in code of Supabase (not ours to touch)
    await openRoute(page, cloudUrl("preise", "?order=premium.year.1"), "Preise", { timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => window.location.search)).toBe("");
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#preise");
    expect(await page.evaluate(() => localStorage.getItem("tj2-return-to-order"))).toContain("premium.year.1");
    // signed out: nothing opens by itself, nothing is ordered
    await page.waitForTimeout(800);
    await expect(page.getByTestId("order-sheet")).toHaveCount(0);
    await signInViaSheet(page, { email: EMAIL, password: PASSWORD, expectNext: true, synced: true });
    const order = page.getByTestId("order-sheet");
    await expect(order).toBeVisible({ timeout: 30_000 });
    await expect(order).toHaveAttribute("data-plan", "premium");
    await expect(order).toHaveAttribute("data-interval", "year");
    // the summary opens – the buy button is still the person's to press
    await expect(page.getByTestId("order-pay")).toHaveAttribute("data-phase", "idle");
    expect(bill.checkouts).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  test("Link der Mail mit fremdem ?order=: Preis, falscher Plan, Fremd-Adresse – nichts wird vorgemerkt, der Parameter ist trotzdem weg", async ({ page }) => {
    await setup(page, { users: [{ email: EMAIL, password: PASSWORD }] });
    for (const bad of ["pro.year.1%26price%3D1", "enterprise.year.1", "%2F%2Fevil.example", "premium.year.1.extra", "pro.year.999"]) {
      await page.goto(cloudUrl("preise", `?order=${bad}`));
      await expect(page.getByRole("heading", { level: 1, name: "Preise" }).first()).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => page.evaluate(() => window.location.search), { message: bad }).toBe("");
      expect(await page.evaluate(() => localStorage.getItem("tj2-return-to-order")), bad).toBeNull();
    }
    await signInViaSheet(page, { email: EMAIL, password: PASSWORD, synced: true });
    await page.waitForTimeout(800);
    await expect(page.getByTestId("order-sheet")).toHaveCount(0);
  });

  test("„Kostenlos starten“ trägt keine Bestellung – auch nicht die einer früher abgebrochenen Auswahl", async ({ page }) => {
    await setup(page);
    await openRoute(page, PREISE, "Preise", { timeout: 30_000 });
    await page.getByTestId("cta-premium").click();
    await expect(page.getByRole("dialog", { name: "Konto erstellen" })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => localStorage.getItem("tj2-return-to-order"))).toContain("premium.year.1");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByTestId("cta-free").scrollIntoViewIfNeeded();
    await page.getByTestId("cta-free").click();
    await expect(page.getByRole("dialog", { name: "Konto erstellen" })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => localStorage.getItem("tj2-return-to-order"))).toBeNull();
  });

  test("Anmelden ↔ Registrieren (Paket V): das Band läuft einmal über die Karte, die Seiten tauschen, die Karte behält ihre Höhe, Feld 1 hat den Fokus", async ({ page }, info) => {
    await setup(page);
    await returningBrowser(page);
    await openGated(page, KONTO);
    const card = page.getByTestId("auth-card");
    await expectNotInert(page.getByRole("dialog", { name: "Anmelden" }).getByLabel("E-Mail"));
    await expect(page.getByRole("dialog").getByRole("radio")).toHaveCount(0);
    await expect(card).toHaveAttribute("data-side", "a");
    const before = await card.boundingBox();
    if (info.project.name === "desktop") expect(Math.abs(before!.width / before!.height - 1030 / 621)).toBeLessThan(0.01);
    await page.getByTestId("auth-to-signup").click();
    // the band runs once: one 900 ms run on the measured curve (the Animations API says so), the old form is gone, the new one is there
    const run = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.id === "auth:band")
        .map((a) => ({ d: a.effect?.getComputedTiming().duration, e: (a.effect as KeyframeEffect).getTiming().easing })),
    );
    expect(run).toEqual([{ d: 900, e: "cubic-bezier(0.5, 0.14, 0.3, 1)" }]);
    const dialog = page.getByRole("dialog", { name: "Konto erstellen" });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(card).toHaveAttribute("data-side", "b");
    await expect(page.locator('.aw-col[data-side="a"]')).toHaveCount(0, { timeout: 3_000 });
    // field 1 (Name) has the focus; the card kept its height
    await expect(dialog.getByLabel("Name")).toBeFocused();
    const after = await card.boundingBox();
    expect(Math.abs(after!.height - before!.height)).toBeLessThan(1);
    await expect(dialog.getByLabel("Passwort", { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await dialog.getByTestId("auth-to-signin").click();
    await expect(page.getByRole("dialog", { name: "Anmelden" })).toBeVisible({ timeout: 5_000 });
    await bandSettled(page, 3_000);
    await expect(page.getByRole("dialog", { name: "Anmelden" }).getByLabel("E-Mail")).toBeFocused({ timeout: 3_000 });
  });

  test("offline: gesagt, bevor etwas gesendet wird – die Eingabe bleibt", async ({ page, context }) => {
    await setup(page);
    await returningBrowser(page);
    await openGated(page, KONTO);
    const sheet = entryGate(page).getByRole("dialog", { name: "Anmelden" });
    await expectNotInert(sheet.getByLabel("E-Mail"));
    await sheet.getByLabel("E-Mail").fill("trader@example.com");
    await sheet.getByLabel("Passwort", { exact: true }).fill("richtig-geheim-42");
    await context.setOffline(true);
    await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(sheet.getByText("Du bist offline.", { exact: false })).toBeVisible();
    await expect(sheet.getByLabel("E-Mail")).toHaveValue("trader@example.com");
    await context.setOffline(false);
    await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(page.locator('[data-auth-view="welcome"]')).toBeVisible({ timeout: 30_000 });
  });

  test("Einrichtung (4 Schritte) kommt EINMAL nach der Registrierung, speichert den Fortschritt und kehrt nach einem Reload nicht von selbst zurück", async ({ page }) => {
    await setup(page, {}, { empty: true });
    // first visit: the entry gate opens on „Konto erstellen“ by itself
    await openGated(page, KONTO);
    await expect(entryGate(page).getByRole("dialog", { name: "Konto erstellen" })).toBeVisible();
    await register(page);
    // registration without a confirmation round: signed in, welcome → "Los geht's" → the wizard (and not before)
    await expect(page.locator('[data-auth-view="welcome"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("setup-wizard")).toHaveCount(0);
    await page.getByRole("button", { name: "Los geht’s" }).click();
    const wizard = page.getByRole("dialog", { name: "Einrichtung" });
    await expect(wizard).toBeVisible({ timeout: 30_000 });
    await expect(wizard.getByTestId("wizard-rail").locator("li")).toHaveCount(4);
    await expect(wizard.getByTestId("wizard-account")).toContainText(EMAIL);
    await wizard.getByTestId("wizard-next").click();
    await expect(wizard.getByTestId("setup-wizard")).toHaveAttribute("data-step", "daten");
    await wizard.getByTestId("wizard-next").click(); // the one decision cannot be passed silently
    await expect(wizard.getByRole("alert")).toContainText("Wähle eine Startart");
    await wizard.getByRole("radio", { name: /Demo ausprobieren/ }).check();
    await wizard.getByTestId("wizard-next").click();
    await expect(wizard.getByTestId("setup-wizard")).toHaveAttribute("data-step", "verbindung");
    await expect(wizard.getByTestId("wizard-step-title")).toHaveText("Verbindung optional – zunächst Demo ausprobieren");
    await expectNoHorizontalScroll(page);
    // leave half-way: the place is kept, a reload does not bring the wizard back by itself
    await wizard.getByTestId("wizard-later").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("tj2-setup-wizard") ?? "null") as { status: string; step: number; data: string } | null);
    expect(stored).toMatchObject({ status: "active", step: 2, data: "demo" });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Konto" }).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByRole("dialog", { name: "Einrichtung" })).toHaveCount(0);
  });

  test("Einrichtung: bestehende Trader (Journal mit Trades) werden nicht gefragt", async ({ page }) => {
    await setup(page); // the seeded journal has trades
    await openGated(page, KONTO);
    await page.evaluate(() => localStorage.setItem("tj2-setup-wizard", JSON.stringify({ v: 1, status: "pending", step: 0, data: null, at: new Date().toISOString() })));
    await signInViaSheet(page, { email: "trader@example.com", password: "richtig-geheim-42", synced: true, choice: "keep" });
    await page.waitForTimeout(1200);
    await expect(page.getByRole("dialog", { name: "Einrichtung" })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tj2-setup-wizard") ?? "null")?.status)).toBe("skipped");
  });
});
