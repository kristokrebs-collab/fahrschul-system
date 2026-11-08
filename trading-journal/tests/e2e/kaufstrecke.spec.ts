/**
 * Kaufstrecke (B4) end to end against the Supabase mock and the billing / (FAKE) Stripe mock: choice → login → the payment window of Paket V
 * (this build has no publishable key, so it hands over to Checkout; exact button text, both boxes) → fake Stripe Checkout → return → result
 * page in all five states; the locked flow; cancel
 * and withdraw WITHOUT a login; hit boxes, layout shift of the order button, accessibility (axe, dark + light).
 *
 * Everything runs on the cloud edition against mocks: it proves the browser flow, NOT a real Stripe account, a real webhook
 * delivery or a real mail. `PW_PREISE_URL` overrides the cloud URL like in `preise.spec.ts`.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { blockExternalNetwork, completeSignIn, expectNotInert } from "./cloudSignIn";
import { cloudUrl, collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { mockBilling, mockSubscription, type MockBillingOptions } from "./mocks/billing";
import { mockSupabase } from "./mocks/supabase";

const PREISE = process.env.PW_PREISE_URL ?? cloudUrl("preise");
const KONTO = process.env.PW_KONTO_URL ?? cloudUrl("konto");
const EMAIL = "trader@example.com";
const PASSWORD = "richtig-geheim-42";
const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function setup(page: Page, billing: MockBillingOptions = {}) {
  const errors = collectErrors(page);
  await blockExternalNetwork(page);
  await mockSupabase(page);
  const bill = await mockBilling(page, billing);
  await seed(page);
  return { bill, errors };
}

async function ready(sheet: Locator): Promise<void> {
  await expect(sheet).toBeVisible();
  // the form is usable once neither the e-mail field nor its ancestors are inert (the morphing login keeps hidden views inert)
  await expectNotInert(sheet.getByLabel("E-Mail"));
}

async function signInViaSheet(page: Page): Promise<void> {
  const sheet = page.getByRole("dialog", { name: /Anmelden|Konto erstellen|Registrieren/ }).first();
  await ready(sheet);
  // the card opens the registration: switch to the login of the existing account (the footer link; the band runs back)
  const toLogin = sheet.getByTestId("auth-to-signin");
  if (await toLogin.count()) {
    await toLogin.click();
    await expect(page.getByRole("dialog", { name: "Anmelden" })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.aw-col[data-side="b"]')).toHaveCount(0, { timeout: 3_000 });
  }
  await sheet.getByLabel("E-Mail").fill(EMAIL);
  await sheet.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
  await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
  // in the order flow the order summary opens right after the login: only the login dialogs must be gone (the header flow asserts "no dialog" itself)
  await completeSignIn(page, { synced: true, expectNext: true });
}

async function signInHeader(page: Page): Promise<void> {
  await page.locator('[data-cloud-pill="signin"]').click();
  await signInViaSheet(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function tick(sheet: Locator): Promise<void> {
  await sheet.getByTestId("order-terms").getByRole("checkbox").check();
  await sheet.getByTestId("order-immediate").getByRole("checkbox").check();
}

async function axe(page: Page, include: string, what: string): Promise<void> {
  await page.waitForTimeout(1300);
  const res = await new AxeBuilder({ page }).include(include).withTags(TAGS).analyze();
  const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(lines, `${what}: axe violations`).toEqual([]);
}

test.describe("Kaufstrecke", () => {
  test.setTimeout(150_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "B4 runs on mobile + desktop");
  });

  test("Auswahl → Login → Bestellung kommt mit genau dieser Auswahl zurück → Pflichtkästchen → Stripe (Fake) → Ergebnis bestätigt", async ({ page }) => {
    const { bill, errors } = await setup(page, { outcome: "active" });
    await openRoute(page, PREISE, "Preise", { timeout: 30_000 });
    // monthly + Team with 3 seats, signed out: the card leads to the login, the choice is noted for the way back
    await page.getByRole("radio", { name: "Monatlich" }).click();
    const team = page.getByTestId("plan-team");
    await team.scrollIntoViewIfNeeded();
    await team.getByRole("button", { name: "Einen Sitz mehr" }).click();
    await page.getByTestId("cta-team").click();
    await signInViaSheet(page);
    // back at the order: exactly plan, interval and seats of the choice
    const sheet = page.getByTestId("order-sheet");
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    await expect(sheet).toHaveAttribute("data-plan", "team");
    await expect(sheet).toHaveAttribute("data-interval", "month");
    await expect(sheet).toHaveAttribute("data-seats", "3");
    await expect(sheet.getByTestId("order-total")).toContainText("57 €");
    await expect(sheet.getByTestId("order-tax")).toContainText("Steuer wird im nächsten Schritt von Stripe berechnet.");
    await expect(sheet.getByTestId("order-first")).toContainText("Tage kostenlos testen – heute zahlst du nichts");
    await expect(sheet.getByTestId("order-first")).toContainText("57 € pro Monat");
    await expect(sheet.getByTestId("order-renewal")).toContainText("verlängert sich automatisch");
    const dialog = page.getByRole("dialog", { name: "Deine Bestellung" });
    const pay = dialog.getByRole("button", { name: "Zahlungspflichtig bestellen", exact: true });
    await expect(pay).toBeVisible();
    await expectNoHorizontalScroll(page);
    // a click with open boxes sends nothing
    await pay.click();
    await expect(page.getByText("Bitte bestätige zuerst die AGB.")).toBeVisible();
    expect(bill.checkouts).toHaveLength(0);
    await tick(sheet);
    await pay.click();
    await page.waitForURL(/checkout\.stripe\.com/);
    expect(bill.checkouts).toHaveLength(1);
    expect(bill.checkouts[0]).toMatchObject({ plan: "team", interval: "month", seats: 3, consents: { terms: true, immediateStart: true } });
    expect(bill.checkouts[0]!.orderId).toMatch(/^[0-9a-f-]{36}$/);
    await page.getByRole("link", { name: "Jetzt abonnieren" }).click();
    const result = page.getByTestId("order-result");
    await expect(result).toHaveAttribute("data-state", "confirmed", { timeout: 30_000 });
    await expect(page.getByTestId("result-title")).toContainText("Dein Abo ist aktiv");
    // the success glow of the plan card belongs to this server-confirmed state and to nothing earlier
    await expect(page.getByTestId("plan-card-art")).toHaveAttribute("data-tone", "confirmed");
    expect(page.url()).not.toContain("billing=");
    expect(errors).toEqual([]);
  });

  test("Bezahlfenster (Paket V) ohne Publishable Key: Aufbau wie im Vorbild (Schrittband, Karte links, Formular rechts), bestellt wird über Stripe Checkout", async ({ page }) => {
    await setup(page);
    await openRoute(page, PREISE, "Preise", { timeout: 30_000 });
    await signInHeader(page);
    await page.getByTestId("cta-premium").click();
    const sheet = page.getByTestId("order-sheet");
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    // this build has no VITE_STRIPE_PUBLISHABLE_KEY: the same window, the card fields are Stripe's own page (the hand-over)
    await expect(sheet).toHaveAttribute("data-source", "redirect");
    await expect(page.getByTestId("order-steps")).toContainText("Auswahl");
    await expect(page.getByTestId("order-steps")).toContainText("Zahlung");
    await expect(page.getByTestId("pay-card")).toBeVisible();
    await expect(page.getByTestId("order-handover")).toContainText("im nächsten Schritt bei Stripe");
    await expect(sheet.getByTestId("order-total")).toContainText("240 €");
    await page.getByRole("radio", { name: "Monatlich" }).click();
    await expect(sheet.getByTestId("order-total")).toContainText("24 €");
    // without the key nothing of Stripe.js is loaded
    expect(await page.evaluate(() => Array.from(document.querySelectorAll("script")).some((s) => s.src.includes("js.stripe.com")))).toBe(false);
    await expectNoHorizontalScroll(page);
  });

  test("Ergebnisseite: in Bearbeitung, solange der Server nichts weiß – die Rückkehr-URL allein bestätigt nie", async ({ page }) => {
    const { errors } = await setup(page, { outcome: "never" });
    await openRoute(page, PREISE, "Preise", { timeout: 30_000 });
    await signInHeader(page);
    await page.getByTestId("cta-pro").click();
    const sheet = page.getByTestId("order-sheet");
    await tick(sheet);
    await page.getByRole("dialog", { name: "Deine Bestellung" }).getByTestId("order-pay").click();
    await page.waitForURL(/checkout\.stripe\.com/);
    await page.getByRole("link", { name: "Jetzt abonnieren" }).click();
    const result = page.getByTestId("order-result");
    await expect(result).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(4000); // several polls later
    await expect(result).toHaveAttribute("data-state", "pending");
    await expect(page.getByTestId("result-title")).not.toContainText(/aktiv/i);
    await expect(page.getByTestId("result-text")).not.toContainText(/freigeschaltet/);
    expect(errors).toEqual([]);
  });

  test("Ergebnisseite: das Abo meldet sich erst nach ein paar Anfragen – dann, und erst dann, steht dort „aktiv“", async ({ page }) => {
    await setup(page, { outcome: "trialing", webhookAfterStatusCalls: 3 });
    await openRoute(page, PREISE, "Preise", { timeout: 30_000 });
    await signInHeader(page);
    await page.getByTestId("cta-pro").click();
    await tick(page.getByTestId("order-sheet"));
    await page.getByRole("dialog", { name: "Deine Bestellung" }).getByTestId("order-pay").click();
    await page.waitForURL(/checkout\.stripe\.com/);
    await page.getByRole("link", { name: "Jetzt abonnieren" }).click();
    const result = page.getByTestId("order-result");
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toHaveAttribute("data-state", "confirmed", { timeout: 40_000 });
  });

  for (const [outcome, state] of [
    ["incomplete", "action"],
    ["unpaid", "failed"],
  ] as const) {
    test(`Ergebnisseite: ${state === "action" ? "Bestätigung nötig (incomplete)" : "fehlgeschlagen (unpaid)"}`, async ({ page }) => {
      await setup(page, { outcome });
      await openRoute(page, PREISE, "Preise", { timeout: 30_000 });
      await signInHeader(page);
      await page.getByTestId("cta-pro").click();
      await tick(page.getByTestId("order-sheet"));
      await page.getByRole("dialog", { name: "Deine Bestellung" }).getByTestId("order-pay").click();
      await page.waitForURL(/checkout\.stripe\.com/);
      await page.getByRole("link", { name: "Jetzt abonnieren" }).click();
      await expect(page.getByTestId("order-result")).toHaveAttribute("data-state", state, { timeout: 30_000 });
      if (state === "action") await expect(page.getByTestId("result-pay")).toHaveText("Zahlung abschließen");
      else {
        await expect(page.getByTestId("result-text")).toContainText("kein aktives Abo");
        await expect(page.getByTestId("result-title")).not.toContainText("Dein Abo ist aktiv");
      }
    });
  }

  test("Ergebnisseite: abgebrochen – nichts berechnet; „Bestellung wieder öffnen“ bringt dieselbe Auswahl zurück", async ({ page }) => {
    const { bill } = await setup(page);
    await openRoute(page, PREISE, "Preise", { timeout: 30_000 });
    await signInHeader(page);
    await page.getByRole("radio", { name: "Monatlich" }).click();
    await page.getByTestId("cta-premium").click();
    await tick(page.getByTestId("order-sheet"));
    await page.getByRole("dialog", { name: "Deine Bestellung" }).getByTestId("order-pay").click();
    await page.waitForURL(/checkout\.stripe\.com/);
    await page.getByRole("link", { name: "Zurück" }).click();
    const result = page.getByTestId("order-result");
    await expect(result).toHaveAttribute("data-state", "canceled", { timeout: 30_000 });
    await expect(page.getByTestId("result-text")).toContainText("Es wurde nichts berechnet und kein Vertrag geschlossen");
    expect(bill.state.subscription).toBeNull();
    await page.getByTestId("result-retry").click();
    const sheet = page.getByTestId("order-sheet");
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    await expect(sheet).toHaveAttribute("data-plan", "premium");
    await expect(sheet).toHaveAttribute("data-interval", "month");
  });

  test("gesperrt: ohne Rechtstexte des Betreibers kann nichts bestellt werden – ehrlich „nicht bestellbar“", async ({ page }) => {
    const { bill, errors } = await setup(page, { purchaseOpen: false });
    await openRoute(page, PREISE, "Preise", { timeout: 30_000 });
    await signInHeader(page);
    for (const p of ["pro", "premium", "team"]) {
      await expect(page.getByTestId(`cta-${p}`)).toHaveCount(0);
      await expect(page.getByTestId(`note-${p}`)).toHaveText("Noch nicht bestellbar");
    }
    await page.getByTestId("details-pro").click();
    const detail = page.getByTestId("detail-sheet");
    await expect(detail).toBeVisible();
    await page.getByTestId("detail-order").click();
    await expect(page.getByTestId("order-sheet")).toHaveCount(0);
    expect(bill.checkouts).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  test("Tarif im Detail: Nutzen, Grenzen, Freischaltung – mit Weg zur Bestellung", async ({ page }) => {
    await setup(page);
    await openRoute(page, PREISE, "Preise", { timeout: 30_000 });
    await signInHeader(page);
    await page.getByTestId("details-premium").click();
    const detail = page.getByTestId("detail-sheet");
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId("detail-limits")).toContainText("Screenshot-Speicher");
    await expect(detail.getByTestId("detail-unlocks")).toBeVisible();
    await expect(detail.getByTestId("detail-price")).toContainText("Jährlich −17 %");
    await expectNoHorizontalScroll(page);
    await page.getByTestId("detail-order").click();
    await expect(page.getByTestId("order-sheet")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("order-sheet")).toHaveAttribute("data-plan", "premium");
  });

  test("Kündigung OHNE Anmeldung: Link im Fußbereich/Menü → Bestätigungsseite → Eingang mit Datum und Uhrzeit; per Mail-Link ausgeführt", async ({ page }) => {
    const { bill, errors } = await setup(page);
    await openRoute(page, PREISE, "Preise", { timeout: 30_000 });
    // not signed in; the public link on the page
    await page.getByTestId("legal-cancel").click();
    const sheet = page.getByTestId("contract-sheet");
    await expect(sheet).toHaveAttribute("data-kind", "cancel");
    await page.getByTestId("contract-email").fill(EMAIL);
    await page.getByTestId("contract-next").click();
    await expect(sheet).toHaveAttribute("data-step", "confirm");
    await expect(sheet).not.toContainText(/pausieren|Grund|Angebot/);
    await page.getByRole("button", { name: "Jetzt kündigen", exact: true }).click();
    await expect(sheet).toHaveAttribute("data-step", "done");
    await expect(page.getByTestId("contract-received")).toContainText(/Eingegangen am \d\d\.\d\d\.\d{4}, \d\d:\d\d:\d\d Uhr/);
    await expect(page.getByTestId("contract-after")).toContainText("Link in der E-Mail");
    expect(bill.contracts).toEqual([{ kind: "cancel", email: EMAIL }]);
    expect(errors).toEqual([]);

    // the link of the mail: a deep link with the token; one more click executes
    await page.goto(cloudUrl("preise", `?kuendigen=${"k".repeat(43)}`));
    const linkSheet = page.getByTestId("contract-sheet");
    await expect(linkSheet).toHaveAttribute("data-step", "link", { timeout: 30_000 });
    expect(page.url()).not.toContain("kuendigen");
    await page.getByTestId("contract-link-confirm").click();
    await expect(page.getByTestId("contract-result")).toHaveAttribute("data-status", "done");
    expect(bill.confirmed).toEqual(["k".repeat(43)]);
  });

  test("Widerruf ohne Anmeldung: /?widerruf, Name Pflicht, Bestätigungsseite „Widerruf bestätigen“", async ({ page }) => {
    const { bill } = await setup(page);
    await page.goto(cloudUrl("preise", "?widerruf"));
    const sheet = page.getByTestId("contract-sheet");
    await expect(sheet).toHaveAttribute("data-kind", "withdraw", { timeout: 30_000 });
    await page.getByTestId("contract-email").fill(EMAIL);
    await page.getByTestId("contract-next").click();
    await expect(page.getByText("Bitte gib deinen Namen an.")).toBeVisible();
    await page.getByTestId("contract-name").fill("Erika Muster");
    await page.getByTestId("contract-next").click();
    await page.getByRole("button", { name: "Widerruf bestätigen", exact: true }).click();
    await expect(sheet).toHaveAttribute("data-step", "done");
    expect(bill.contracts[0]).toMatchObject({ kind: "withdraw", email: EMAIL, name: "Erika Muster" });
  });

  test("ohne E-Mail-Versand sagt die Seite es ehrlich (keine versprochene Mail)", async ({ page }) => {
    await setup(page, { mailReady: false });
    await page.goto(cloudUrl("preise", "?kuendigen"));
    await expect(page.getByTestId("contract-sheet")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("contract-email").fill(EMAIL);
    await page.getByTestId("contract-next").click();
    await page.getByTestId("contract-confirm").click();
    await expect(page.getByTestId("contract-after")).toContainText("E-Mail-Versand noch nicht eingerichtet");
  });

  test("Konto › Abo verwalten: Fakten, Portal, Kündigen, Widerruf (erste 14 Tage)", async ({ page }) => {
    await setup(page, {
      plan: { plan: "pro", status: "active", trialEnd: null },
      subscription: mockSubscription({ status: "active", trialEnd: null, startedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }),
    });
    await openRoute(page, KONTO, "Konto", { timeout: 30_000 });
    await signInHeader(page);
    await page.getByTestId("manage-open").click();
    const manage = page.getByTestId("manage-sheet");
    await expect(manage).toBeVisible();
    await expect(manage.getByTestId("manage-facts")).toContainText("Trade Journal Pro");
    await expect(manage.getByTestId("manage-switch")).toContainText("Auf jährlich wechseln");
    await expect(manage.getByTestId("manage-cancel")).toHaveText("Verträge hier kündigen");
    await manage.getByTestId("manage-withdraw").click();
    await expect(page.getByTestId("contract-sheet")).toHaveAttribute("data-kind", "withdraw");
    await expectNoHorizontalScroll(page);
  });

  test("Tippflächen ≥ 44 px (Touch), der Bestell-Knopf ändert beim Laden seine Breite nicht, das Bestellfenster seine Größe auch nicht", async ({ page }, info) => {
    const { bill } = await setup(page);
    // slow Stripe: the button stays in its "works" state long enough to measure
    await page.route(/\/api\/v1\/billing\/checkout$/, async (route) => {
      await new Promise((r) => setTimeout(r, 7000));
      await route.fallback();
    });
    await openRoute(page, PREISE, "Preise", { timeout: 30_000 });
    await signInHeader(page);
    await page.getByTestId("cta-pro").click();
    const sheet = page.getByTestId("order-sheet");
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[role="dialog"]' });
      expect(misses, JSON.stringify(misses)).toEqual([]);
    }
    await tick(sheet);
    const pay = page.getByTestId("order-pay");
    const panel = page.getByRole("dialog", { name: "Deine Bestellung" });
    const before = await pay.boundingBox();
    const panelBefore = await panel.boundingBox();
    await pay.click();
    await expect(pay).toHaveAttribute("data-phase", /confirming|redirecting/);
    const during = await pay.boundingBox();
    expect(during!.width).toBeCloseTo(before!.width, 0);
    expect(during!.height).toBeCloseTo(before!.height, 0);
    await expect(pay.getByTestId("button-orbs")).toBeAttached();
    // the window keeps its size while the button works (the hand-over: the card stays where it is, nothing flies)
    await expect(page.getByTestId("pay-stage")).toHaveCount(0);
    const panelDuring = await panel.boundingBox();
    expect(Math.abs(panelDuring!.height - panelBefore!.height), "the order window does not change its height while the order is sent").toBeLessThanOrEqual(2);
    expect(Math.abs(panelDuring!.width - panelBefore!.width)).toBeLessThanOrEqual(1);
    // a second click while it works sends no second request
    await pay.click({ force: true, timeout: 2000 }).catch(() => undefined);
    await page.waitForURL(/checkout\.stripe\.com/);
    expect(bill.checkouts).toHaveLength(1);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`Barrierefreiheit (axe, ${theme}): Tarifkarten, Tarif im Detail, Bestellübersicht, Kündigungsseite`, async ({ page }) => {
      await setup(page);
      await openRoute(page, PREISE, "Preise", { timeout: 30_000 });
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
      }, theme);
      await signInHeader(page);
      await page.getByTestId("plan-premium").scrollIntoViewIfNeeded();
      await axe(page, '[aria-labelledby="preise-tarife"]', "Tarifkarten (Glas)");
      await page.getByTestId("details-pro").click();
      await expect(page.getByTestId("detail-sheet")).toBeVisible();
      await axe(page, '[data-testid="detail-sheet"]', "Tarif im Detail");
      await page.getByTestId("detail-order").click();
      await expect(page.getByTestId("order-sheet")).toBeVisible({ timeout: 20_000 });
      await axe(page, '[data-testid="order-sheet"]', "Bestellübersicht");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("order-sheet")).toHaveCount(0);
      await page.getByTestId("legal-cancel").click();
      await expect(page.getByTestId("contract-sheet")).toBeVisible();
      await axe(page, '[data-testid="contract-sheet"]', "Kündigungsseite");
    });
  }
});
