/**
 * P10 Preise & Abo end to end against the Supabase mock (`mocks/supabase.ts`) and the billing / Stripe mock
 * (`mocks/billing.ts`): the pricing page (hero, plan cards, Monat/Jahr, promotion code, ?ref landing), sign-in →
 * Stripe Checkout (redirect to the fake Stripe page) → return wipe → plan active, the Konto cards (plan, invoices,
 * referral), the in-app cancellation (§ 312k BGB) + undo, the customer portal round trip, a locked feature with its
 * UpgradeSheet, the dunning banner and the honest states without payments / without cloud.
 *
 * Needs the dev harness `/dev/preise.html` on a Vite DEV server built with the mock cloud:
 *   VITE_SUPABASE_URL=https://e2e-mock.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_e2e npx vite --port 4182
 *   PW_BASE_URL=http://127.0.0.1:4182 npx playwright test preise.spec.ts --project=mobile --project=desktop
 * Without the harness (production preview) the tests skip themselves. Set `PW_PREISE_URL=/#preise` /
 * `PW_KONTO_URL=/#konto` once P14 routed the pages. `P10_SHOTS_DIR` writes review screenshots.
 */
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, seed, toast } from "./helpers";
import { mockBilling, mockSubscription, type MockBillingOptions } from "./mocks/billing";
import { mockSupabase, type MockSupabase } from "./mocks/supabase";

const PREISE_URL = process.env.PW_PREISE_URL ?? "/dev/preise.html";
const KONTO_URL = process.env.PW_KONTO_URL ?? "/dev/preise.html#konto";
const SHOTS = process.env.P10_SHOTS_DIR;
const EMAIL = "trader@example.com";
const PASSWORD = "richtig-geheim-42";
const P10_PROJECTS = ["mobile", "desktop"];

async function shot(page: Page, info: TestInfo, name: string, fullPage = false): Promise<void> {
  if (!SHOTS) return;
  await page.waitForTimeout(1600); // entrances settle (JS animations are not frozen by `animations: "disabled"`)
  await page.screenshot({ path: `${SHOTS}/P10-billing-${name}-${info.project.name === "mobile" ? "390" : "1440"}.png`, fullPage, animations: "disabled" });
}

/** Opens a page of the harness; false (→ skip) where it is not served. */
async function openPage(page: Page, url: string, h1: "Preise" | "Konto"): Promise<boolean> {
  const res = await page.goto(url);
  if (!res || !res.ok()) return false;
  return page
    .getByRole("heading", { level: 1, name: h1 })
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
}

async function setup(
  page: Page,
  billing: MockBillingOptions = {},
): Promise<{ sb: MockSupabase; bill: Awaited<ReturnType<typeof mockBilling>>; errors: string[] }> {
  const errors = collectErrors(page);
  const sb = await mockSupabase(page);
  const bill = await mockBilling(page, {
    codes: { TRADER20: { percentOff: 20, duration: "repeating", durationInMonths: 3, message: "−20 % für 3 Monate" } },
    referrals: { FRIEND30: 30 },
    ...billing,
  });
  await seed(page);
  return { sb, bill, errors };
}

async function ready(sheet: Locator): Promise<void> {
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[inert]")).toHaveCount(0);
}

/** Signs in through the header pill and closes the welcome sheet once the first sync is live. */
async function signIn(page: Page): Promise<void> {
  await page.locator('[data-cloud-pill="signin"]').click();
  const sheet = page.getByRole("dialog", { name: "Anmelden" });
  await ready(sheet);
  await sheet.getByLabel("E-Mail").fill(EMAIL);
  await sheet.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
  await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page.getByText("Alles synchron.", { exact: false })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Los geht’s" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

const srPrice = (page: Page, plan: string) => page.getByTestId(`price-${plan}`).locator(".sr-only").first();

test.describe("Preise & Abo", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!P10_PROJECTS.includes(info.project.name), "P10 runs on mobile + desktop");
  });

  test("pricing page: hero, four plans, Monat/Jahr rolls the price, a code decodes the new price, ?ref landing", async ({ page }, info) => {
    const { errors } = await setup(page);
    test.skip(!(await openPage(page, `${PREISE_URL}?ref=friend30`, "Preise")), "dev harness only (Vite dev server)");
    await expect(page.getByTestId("preise-view")).toHaveAttribute("data-mode", "open");
    await expect(page.getByRole("region", { name: "Trade Journal Pro" })).toBeVisible();
    for (const p of ["free", "pro", "premium", "team"]) await expect(page.getByTestId(`plan-${p}`)).toBeVisible();
    // the invitation is read, validated and taken out of the address bar
    await expect(page.getByTestId("ref-banner")).toContainText("30 Tage gratis testen");
    expect(page.url()).not.toContain("ref=");
    expect(await page.evaluate(() => localStorage.getItem("tj2-billing-ref"))).toContain("FRIEND30");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "preise-top");

    // yearly is the default (per-month equivalent), monthly rolls to the monthly price
    await expect(srPrice(page, "pro")).toHaveText("10 €");
    await page.getByRole("radio", { name: "Monatlich" }).click();
    await expect(srPrice(page, "pro")).toHaveText("12 €");
    await expect(srPrice(page, "premium")).toHaveText("24 €");

    // a promotion code: invalid shakes with the reason, a valid one decodes the discounted price
    const code = page.getByLabel("Rabattcode");
    await code.fill("nope");
    await page.getByRole("button", { name: "Prüfen" }).click();
    await expect(page.getByText("Dieser Code ist ungültig oder abgelaufen.")).toBeVisible();
    await code.fill("trader20");
    await page.getByRole("button", { name: "Prüfen" }).click();
    await expect(page.getByText("Code aktiv")).toBeVisible();
    await expect(page.getByTestId("price-pro")).toContainText("9,60");
    await expect(page.getByTestId("price-pro")).toContainText("TRADER20: −20 % für 3 Monate");
    await page.getByTestId("plan-pro").scrollIntoViewIfNeeded();
    await shot(page, info, "preise-plans");

    // the matrix + FAQ + the always-visible cancel link
    await page.getByTestId("plan-comparison").scrollIntoViewIfNeeded();
    await expect(page.getByRole("table", { name: "Alle Funktionen im Vergleich" })).toBeAttached();
    await shot(page, info, "preise-compare");
    await page.getByRole("button", { name: "Kann ich jederzeit kündigen?" }).click();
    await expect(page.getByText("Vertrag hier kündigen", { exact: false }).first()).toBeVisible();
    await expect(page.getByTestId("legal-cancel")).toHaveText("Verträge hier kündigen");
    await expectNoHorizontalScroll(page);

    // signed out, the trial button opens the registration first
    await page.getByTestId("plan-pro").scrollIntoViewIfNeeded();
    await page.getByTestId("cta-pro").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("sign in → Stripe Checkout (redirect) → return wipe → Pro is active; the referral travels along", async ({ page }, info) => {
    const { bill, errors } = await setup(page);
    test.skip(!(await openPage(page, `${PREISE_URL}?ref=FRIEND30`, "Preise")), "dev harness only (Vite dev server)");
    await signIn(page);
    await expect(page.getByTestId("current-plan")).toContainText("Free");
    await page.getByTestId("plan-pro").scrollIntoViewIfNeeded();
    await page.getByTestId("cta-pro").click();
    // left the app for (the fake) Stripe Checkout
    await page.waitForURL(/checkout\.stripe\.com/);
    expect(bill.checkouts[0]).toMatchObject({ plan: "pro", interval: "year", ref: "FRIEND30", returnTo: expect.stringMatching(/^\/(dev\/preise\.html)?(#preise)?$/) });
    await page.getByRole("link", { name: "Jetzt abonnieren" }).click();
    // back in the journal: the wipe confirms the plan, the URL is clean
    const wipe = page.getByRole("dialog", { name: "Abo gestartet" });
    await expect(wipe).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("checkout-return")).toHaveAttribute("data-confirmed", "", { timeout: 15_000 });
    await expect(wipe.getByText("Willkommen bei Pro")).toBeAttached();
    await expect(wipe.getByText("Deine Testphase läuft bis", { exact: false })).toBeVisible();
    expect(page.url()).not.toContain("billing=");
    expect(page.url()).not.toContain("session_id");
    await shot(page, info, "checkout-return");
    await wipe.getByRole("button", { name: "Los geht’s" }).click();
    await expect(wipe).toHaveCount(0);
    await expect(page.getByTestId("current-plan")).toContainText("Pro");
    await expect(page.getByTestId("plan-pro")).toHaveAttribute("data-current", "");
    expect(errors).toEqual([]);
  });

  test("Konto: plan, invoices, referral – in-app cancellation with reason, then undo; portal round trip", async ({ page }, info) => {
    const { bill, errors } = await setup(page, {
      plan: { plan: "pro", status: "active", trialEnd: null },
      subscription: mockSubscription({ status: "active", trialEnd: null }),
      invoices: [
        {
          id: "in_1",
          number: "TJ-0042",
          status: "paid",
          total: 1200,
          currency: "eur",
          created: "2026-09-12T08:00:00Z",
          hostedUrl: "https://invoice.stripe.com/i/1",
          pdfUrl: "https://pay.stripe.com/invoice/1/pdf",
        },
      ],
    });
    test.skip(!(await openPage(page, KONTO_URL, "Konto")), "dev harness only (Vite dev server)");
    await signIn(page);
    const card = page.getByTestId("plan-card");
    await expect(card.getByRole("heading", { name: "Pro" })).toBeVisible();
    await expect(card.getByText("Aktiv")).toBeVisible();
    await expect(card.getByTestId("plan-next")).toContainText("Verlängert sich am");
    await expect(page.getByTestId("billing-card").getByText("TJ-0042")).toBeVisible();
    await expect(page.getByTestId("billing-card").getByRole("link", { name: "PDF" })).toHaveAttribute("href", "https://pay.stripe.com/invoice/1/pdf");
    await expect(page.getByTestId("referral-card").locator("#ref-link")).toHaveValue(/\/\?ref=TRADE24X$/);
    // the paid plan unlocks the gated feature
    await expect(page.getByTestId("montecarlo-demo")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await card.scrollIntoViewIfNeeded();
    await shot(page, info, "konto-plan");

    // § 312k: the button is there, the flow is reason → offer → confirm → done
    await card.getByTestId("cancel-contract").click();
    const sheet = page.getByRole("dialog", { name: "Abo kündigen" });
    await ready(sheet);
    await sheet.getByRole("radio", { name: "Zu teuer" }).click();
    await sheet.getByRole("button", { name: "Weiter zur Kündigung" }).click();
    await expect(sheet.getByText("1 Monat pausieren").first()).toBeVisible();
    await sheet.getByRole("button", { name: "Weiter zur Kündigung" }).click();
    await expect(sheet.getByText("Dein Abo endet am", { exact: false })).toBeVisible();
    await shot(page, info, "cancel-confirm");
    await sheet.getByTestId("cancel-now").click();
    await expect(sheet.getByText("Gekündigt", { exact: true })).toBeVisible();
    expect(bill.portals.at(-1)).toMatchObject({ action: "cancel", reason: "too_expensive" });
    await sheet.getByRole("button", { name: "Fertig" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(card.getByText("Gekündigt", { exact: true })).toBeVisible();
    await expect(card.getByTestId("plan-next")).toContainText("Gekündigt – läuft bis");
    await card.getByRole("button", { name: "Kündigung zurücknehmen" }).click();
    await expect(card.getByTestId("cancel-contract")).toBeVisible();
    expect(bill.portals.at(-1)).toMatchObject({ action: "resume" });

    // the Customer Portal is a redirect there and back
    await card.getByRole("button", { name: "Abo verwalten" }).click();
    await page.waitForURL(/billing\.stripe\.com/);
    await page.getByRole("link", { name: "Zurück zum Journal" }).click();
    await expect(toast(page).getByText("Zurück aus dem Kundenportal")).toBeVisible({ timeout: 30_000 });
    expect(page.url()).not.toContain("billing=");
    expect(errors).toEqual([]);
  });

  test("a locked feature: UpgradeTeaser → UpgradeSheet; failed payment → dunning banner", async ({ page }, info) => {
    const { errors } = await setup(page, {
      subscription: mockSubscription({ status: "past_due", trialEnd: null }),
      plan: { plan: "pro", status: "past_due", trialEnd: null },
    });
    test.skip(!(await openPage(page, KONTO_URL, "Konto")), "dev harness only (Vite dev server)");
    // signed out on a shop with payments: Free → the Pro feature is locked
    const teaser = page.getByTestId("upgrade-teaser");
    await teaser.scrollIntoViewIfNeeded();
    await expect(teaser).toContainText("Monte Carlo & Ruin-Risiko");
    await shot(page, info, "teaser");
    await teaser.getByRole("button", { name: "Freischalten" }).click();
    const sheet = page.getByRole("dialog", { name: "Freischalten" });
    await ready(sheet);
    await expect(sheet.getByTestId("upgrade-sheet")).toContainText("Enthalten in Pro");
    await expect(sheet.getByTestId("upgrade-cta")).toHaveText("Anmelden und testen");
    await shot(page, info, "upgrade-sheet");
    await sheet.getByRole("button", { name: "Schließen" }).first().click();
    await expect(sheet).toHaveCount(0);

    // signed in with a failed payment: the banner asks for a new payment method
    await signIn(page);
    await expect(page.getByTestId("billing-banner")).toContainText("Die letzte Zahlung ist fehlgeschlagen.");
    await expect(page.getByRole("button", { name: "Zahlung aktualisieren" }).first()).toBeVisible();
    // past_due keeps access during dunning
    await expect(page.getByTestId("montecarlo-demo")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("payments not set up: honest notice, plans still shown, nothing locked", async ({ page }, info) => {
    const { errors } = await setup(page, { enabled: false });
    test.skip(!(await openPage(page, PREISE_URL, "Preise")), "dev harness only (Vite dev server)");
    await expect(page.getByTestId("preise-view")).toHaveAttribute("data-mode", "closed");
    await expect(page.getByTestId("billing-closed")).toContainText("Zahlungen noch nicht eingerichtet");
    await expect(page.getByTestId("note-pro")).toHaveText("Noch nicht buchbar");
    await expect(page.getByTestId("cta-pro")).toHaveCount(0);
    await expect(page.getByLabel("Rabattcode")).toBeDisabled();
    await expectNoHorizontalScroll(page);
    await shot(page, info, "closed");
    await page.goto(KONTO_URL);
    await expect(page.getByTestId("montecarlo-demo")).toBeVisible();
    await expect(page.getByTestId("upgrade-teaser")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("without cloud: no abos in this version, everything unlocked", async ({ page }, info) => {
    const { errors } = await setup(page);
    test.skip(!(await openPage(page, `${PREISE_URL}?cloud=off`, "Preise")), "dev harness only (Vite dev server)");
    await expect(page.getByTestId("preise-view")).toHaveAttribute("data-mode", "off");
    await expect(page.getByTestId("billing-closed")).toContainText("Keine Abos in dieser Version");
    await expect(page.getByTestId("plan-pro")).toBeVisible();
    await expect(page.getByTestId("legal-cancel")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, info, "off");
    expect(errors).toEqual([]);
  });
});
