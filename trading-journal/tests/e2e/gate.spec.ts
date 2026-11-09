/**
 * Konto-Pflicht (`src/cloud/gate.ts`, `src/app/gate/EntryGate.tsx`) on the cloud build against the Supabase / billing mocks: a signed-out
 * visitor sees the login window of Paket V as the page in front of the app – first visit on „Konto erstellen“, a returning browser on
 * „Anmelden“. Registration → the confirmation mail's link (mock mailbox, PKCE code) → the app on Free → the upgrade opens the pay window.
 * Sign-out and an expired session lead back to the gate. Public without a login: the legal sheets, the contract pages (§ 312k / § 356a),
 * `#preise` read only, the share view. Accessibility: axe, keyboard, 390 px and the tablets.
 *
 * `GATE_SHOTS_DIR` also writes screenshots of the gate.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { blockExternalNetwork, entryGate, gateToSignIn, openGated, signInViaSheet } from "./cloudSignIn";
import { cloudUrl, collectErrors, expectNoHorizontalScroll, seed, toast } from "./helpers";
import { mockBilling } from "./mocks/billing";
import { mockSupabase, type MockSupabaseOptions, type SupabaseCore } from "./mocks/supabase";

const PROJECTS = ["mobile", "desktop", "tablet"];
const SHOTS = process.env.GATE_SHOTS_DIR;
const EMAIL = "neu@example.com";
const PASSWORD = "Ein-langer-Satz-42!";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function setup(page: Page, supa: MockSupabaseOptions = {}, opts: { empty?: boolean } = { empty: true }) {
  const errors = collectErrors(page);
  await blockExternalNetwork(page);
  // the e2e adapter hands out the whole core: its mailbox (`mails`, `openMail`) is the confirmation mail of a real project
  const sb = (await mockSupabase(page, supa)) as SupabaseCore;
  const bill = await mockBilling(page);
  await seed(page, opts.empty ? { empty: true } : {});
  return { sb, bill, errors };
}

test.describe("Konto-Pflicht: das Tor vor der App", () => {
  test.setTimeout(150_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "the gate runs on mobile, desktop and the Galaxy Tab");
  });

  test("erster Besuch → Konto erstellen → Bestätigungslink (Mock) → App auf Frei → Upgrade öffnet das Bezahlfenster", async ({ page }, info) => {
    const { sb, errors } = await setup(page, { signupConfirm: true, mailbox: true });
    await openGated(page, cloudUrl("overview"));
    const gate = entryGate(page);
    // nothing of the app before the account: no header, no dock, no page
    await expect(page.locator('[data-layer="Header"]')).toHaveCount(0);
    await expect(page.locator('[data-layer="Dock"]')).toHaveCount(0);
    const signup = gate.getByRole("dialog", { name: "Konto erstellen" });
    await expect(signup).toBeVisible();
    await expect(gate.getByRole("button", { name: "Schließen" })).toHaveCount(0);
    // the window's entrance focused field 1
    await expect(signup.getByLabel("Name")).toBeFocused({ timeout: 5_000 });
    // Escape does not close the gate
    await page.keyboard.press("Escape");
    await expect(signup).toBeVisible();
    await expectNoHorizontalScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/gate-erstbesuch-${info.project.name}.png` });

    await signup.getByLabel("E-Mail").fill(EMAIL);
    await signup.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
    const consent = signup.getByTestId("signup-consent").getByRole("checkbox");
    if (await consent.count()) await consent.check();
    await signup.getByRole("button", { name: "Konto erstellen", exact: true }).click();
    // the mail step stays in the gate (no session yet)
    await expect(gate.getByRole("dialog", { name: "Schau in dein Postfach" })).toBeVisible({ timeout: 20_000 });
    await expect(gate.getByTestId("auth-sent-text")).toContainText(EMAIL);

    // the confirmation mail's link (the mock records it, as the real project would send it) opens the app
    const mail = sb.mails.find((m) => m.kind === "confirm" && m.email === EMAIL);
    expect(mail, "a confirmation mail was sent").toBeTruthy();
    const link = sb.openMail(mail!.id);
    expect(link?.url).toMatch(/\?code=/);
    await page.goto(link!.url);
    // signed in by the link: the app (no gate); the registration armed the setup wizard, which opens once – after the welcome, if one shows
    const wizard = page.getByRole("dialog", { name: "Einrichtung" });
    const welcome = page.locator('[data-auth-view="welcome"]');
    await expect(wizard.or(welcome)).toBeVisible({ timeout: 30_000 });
    await expect(entryGate(page)).toHaveCount(0);
    if (await welcome.isVisible()) await page.getByRole("button", { name: "Los geht’s" }).click();
    await expect(wizard).toBeVisible({ timeout: 30_000 });
    await expect(wizard).toContainText(EMAIL);
    await wizard.getByTestId("wizard-later").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // the code is out of the address, the app is there
    expect(page.url()).not.toContain("code=");
    await expect(page.locator('[data-cloud-pill="account"]')).toBeVisible();

    // Free plan on the Konto page
    await page.goto(cloudUrl("konto"));
    await expect(page.getByRole("heading", { level: 1, name: "Konto" }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("plan-card").locator("[data-pill]").getByText("Free", { exact: true })).toBeVisible({ timeout: 20_000 });

    // upgrade: the plan's button opens the pay window (Paket V) with this choice – nothing is ordered before its own button
    await page.goto(cloudUrl("preise"));
    await expect(page.getByRole("heading", { level: 1, name: "Preise" }).first()).toBeVisible({ timeout: 30_000 });
    const cta = page.getByTestId("cta-pro");
    await cta.scrollIntoViewIfNeeded();
    await cta.click();
    const order = page.getByTestId("order-sheet");
    await expect(order).toBeVisible({ timeout: 20_000 });
    await expect(order).toHaveAttribute("data-plan", "pro");
    await expect(page.getByTestId("order-pay")).toHaveAttribute("data-phase", "idle");
    expect(errors).toEqual([]);
  });

  test("wiederkehrend: „Anmelden“ zuerst; Abmelden und eine abgelaufene Sitzung führen zurück zum Tor", async ({ page }, info) => {
    const { errors } = await setup(page, {}, { empty: true });
    await openGated(page, cloudUrl("konto"));
    await signInViaSheet(page, { synced: true });
    await expect(page.getByRole("heading", { level: 1, name: "Konto" }).first()).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => localStorage.getItem("tj2-cloud-known"))).toBe("1");

    // sign-out from the account panel → the gate, now on „Anmelden“; the page's route stays
    await page.locator('[data-cloud-pill="account"]').click();
    await page.getByRole("dialog", { name: "Konto" }).getByRole("button", { name: "Abmelden", exact: true }).click();
    const signin = entryGate(page).getByRole("dialog", { name: "Anmelden" });
    await expect(signin).toBeVisible({ timeout: 20_000 });
    await expect(toast(page).getByText("Abgemeldet", { exact: false })).toBeVisible();
    await expect(page.locator('[data-layer="Header"]')).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe("#konto");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/gate-wiederkehrend-${info.project.name}.png` });

    // a reload of a returning browser opens on „Anmelden“ as well
    await page.reload();
    await expect(entryGate(page).getByRole("dialog", { name: "Anmelden" })).toBeVisible({ timeout: 30_000 });

    // sign in again, then the session runs out (the refresh token is no longer valid): the next start lands at the gate
    await signInViaSheet(page, { synced: true });
    await expect(page.getByRole("heading", { level: 1, name: "Konto" }).first()).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => {
      const key = "tj2-sb-auth";
      const s = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
      localStorage.setItem(key, JSON.stringify({ ...s, expires_at: 1, refresh_token: "abgelaufen" }));
    });
    await page.reload();
    await expect(entryGate(page).getByRole("dialog", { name: "Anmelden" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Konto" })).toHaveCount(0);
    expect(errors.filter((e) => !/refresh|Refresh Token|400/i.test(e))).toEqual([]);
  });

  test("lokale Daten bleiben: das Tor sagt es, nach der Anmeldung fragt die Datenübernahme", async ({ page }) => {
    const { sb } = await setup(page, {}, { empty: false });
    await openGated(page, cloudUrl("overview"));
    await expect(entryGate(page).getByTestId("gate-local-note")).toContainText("bleibt erhalten");
    const before = await page.evaluate(() => (JSON.parse(localStorage.getItem("tj2-trades") ?? "[]") as unknown[]).length);
    expect(before).toBeGreaterThan(0);
    await signInViaSheet(page, { choice: "keep" });
    // „Lokal behalten“: nothing uploaded, nothing lost
    expect([...sb.rows.values()].filter((r) => r.kind === "trade")).toHaveLength(0);
    expect(await page.evaluate(() => (JSON.parse(localStorage.getItem("tj2-trades") ?? "[]") as unknown[]).length)).toBe(before);
  });

  test("öffentlich ohne Anmeldung: Rechtliches, Kündigen / Widerruf, Preise (nur lesen), geteilte Ansicht", async ({ page }) => {
    const { bill } = await setup(page);
    await openGated(page, cloudUrl("overview"));
    const foot = entryGate(page).getByTestId("gate-foot");
    for (const id of ["legal-impressum", "legal-datenschutz", "legal-agb", "legal-widerruf", "contract-link-cancel", "contract-link-withdraw", "gate-link-preise"]) await expect(foot.getByTestId(id)).toBeVisible();

    // Impressum over the gate
    await foot.getByTestId("legal-impressum").click();
    const legal = page.getByRole("dialog", { name: /Impressum/ });
    await expect(legal).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    await expect(legal).toHaveCount(0);
    await expect(entryGate(page)).toBeVisible();

    // § 312k: „Verträge hier kündigen“ works without an account, right on the gate
    await foot.getByTestId("contract-link-cancel").click();
    const sheet = page.getByTestId("contract-sheet");
    await expect(sheet).toHaveAttribute("data-kind", "cancel", { timeout: 20_000 });
    await page.getByTestId("contract-email").fill("trader@example.com");
    await page.getByTestId("contract-next").click();
    await page.getByRole("button", { name: "Jetzt kündigen", exact: true }).click();
    await expect(sheet).toHaveAttribute("data-step", "done");
    expect(bill.contracts).toEqual([{ kind: "cancel", email: "trader@example.com" }]);

    // § 356a deep link and the legal deep link on the gate (as a mail or Stripe brings them)
    await page.goto(cloudUrl("overview", "?widerruf"));
    await expect(page.getByTestId("contract-sheet")).toHaveAttribute("data-kind", "withdraw", { timeout: 30_000 });
    await page.goto(cloudUrl("overview", "?rechtliches=datenschutz"));
    await expect(page.getByRole("dialog", { name: /Datenschutz/ })).toBeVisible({ timeout: 30_000 });
    await expect(entryGate(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /Datenschutz/ })).toHaveCount(0);

    // #preise: read only – the pricing page, „Anmelden“ / „Konto erstellen“, no app around it; a plan's button leads to the registration
    await entryGate(page).getByTestId("gate-link-preise").click();
    await expect(page.getByRole("heading", { level: 1, name: "Preise" }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("public-pricing")).toBeVisible();
    await expect(page.locator('[data-layer="Dock"]')).toHaveCount(0);
    await expect(page.locator('[data-layer="Header"]')).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe("#preise");
    await expect(page.locator('[data-cloud-pill="signin"]')).toBeVisible();
    const cta = page.getByTestId("cta-premium");
    await cta.scrollIntoViewIfNeeded();
    await cta.click();
    await expect(page.getByRole("dialog", { name: "Konto erstellen" })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => localStorage.getItem("tj2-return-to-order"))).toContain("premium.year.1");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    // the share view of a link (`#share/<token>`) is public: no gate in front of it
    await page.goto(cloudUrl("share/abcdefghijklmnopqrstuv"));
    await expect(page.locator("[data-page-skeleton], main")).not.toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(800);
    await expect(entryGate(page)).toHaveCount(0);
  });

  test("Barrierefreiheit: axe ohne Verstöße, Tastatur erreicht Fenster und Links, kein Querscrollen", async ({ page }) => {
    await setup(page);
    await page.addInitScript(() => localStorage.setItem("tj2-cloud-known", "1"));
    await openGated(page, cloudUrl("overview"));
    const sheet = await gateToSignIn(page);
    await expect(sheet.getByLabel("E-Mail")).toBeFocused({ timeout: 5_000 });
    await page.waitForTimeout(1300);
    const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
    expect(lines).toEqual([]);
    // one h1 for the page, the window is named by its heading
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trade Journal");
    // Tab walks from the form to the links below the card (no trap)
    let reached = false;
    for (let i = 0; i < 30 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => !!document.activeElement?.closest('[data-testid="gate-foot"]'));
    }
    expect(reached, "the keyboard reaches the links under the card").toBe(true);
    await expectNoHorizontalScroll(page);
  });
});
