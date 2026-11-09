/**
 * A4 Rückführung: wer im Finder nach einer Aufgabe fragt und an einer Anmeldung vorbeimuss, landet danach wieder bei seiner Aufgabe.
 * Läuft im Cloud-Build gegen den Supabase-Mock (`mocks/supabase.ts`, `cloudUrl` in helpers.ts) – dieselbe Anmeldung wie im Konto-Spec.
 *
 *   1. "Gruppe beitreten": ohne Konto steht seit der Konto-Pflicht das Tor vor der App (der Finder ist erst danach erreichbar); nach der
 *      Anmeldung bringt der Finder zur Community, die Karte "Gruppen" steht im Bild (die Aufgabe), kein Toast, nichts bleibt vorgemerkt.
 *   2. Der Link `#konto?returnTo=feature:backup` merkt sich die Aufgabe, räumt die Adresse auf und führt nach der Anmeldung zu Backup.
 *   3. Ein Fremdlink als `returnTo` (https://…, unbekannte Seite) wird still verworfen: nach der Anmeldung geht nichts anderswohin.
 *
 * Nur gegen Mocks geprüft (kein echtes Supabase-Projekt, kein E-Mail-Versand).
 */
import { expect, test, type Page } from "@playwright/test";
import { cloudUrl, collectErrors, seed } from "./helpers";
import { mockBilling } from "./mocks/billing";
import { mockSocial } from "./mocks/social";
import { mockSupabase } from "./mocks/supabase";
import { blockExternalNetwork, entryGate, openGated, signInViaSheet } from "./cloudSignIn";

const PROJECTS = ["mobile", "desktop"];
const RETURN_KEY = "tj2-return-to";

/** What the app has noted for the way back (this tab's `sessionStorage`, `src/store/returnTo.ts`). */
const pending = (page: Page): Promise<{ target: { kind: string; id?: string }; wait: { on: string } } | null> =>
  page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) ?? "null"), RETURN_KEY);

/** The toast island is one live region that is always in the DOM (empty at rest; pages have live regions of their own): "no toast" means it says nothing. */
const noToast = (page: Page) => expect(page.locator("[data-toast-island]").filter({ hasText: /\S/ })).toHaveCount(0);

const layer = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"]`);

async function setup(page: Page) {
  const errors = collectErrors(page);
  await blockExternalNetwork(page);
  await mockSupabase(page);
  await mockBilling(page, { enabled: false });
  await mockSocial(page, {});
  await seed(page);
  return errors;
}

/** Signs in through the entry gate (Konto-Pflicht) and closes the welcome sheet once the first sync is live. */
async function signInAtGate(page: Page): Promise<void> {
  await expect(entryGate(page)).toBeVisible({ timeout: 30_000 });
  await signInViaSheet(page, { synced: true });
}

test.describe("Finder: zurück zur Aufgabe nach der Anmeldung", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("„Gruppe beitreten“: erst das Tor, nach der Anmeldung bringt der Finder zur Karte „Gruppen“", async ({ page }) => {
    const errors = await setup(page);
    // Konto-Pflicht: no finder, no page before the account
    await openGated(page, cloudUrl("overview"));
    await expect(page.getByRole("button", { name: /Navigation öffnen|Menü/ })).toHaveCount(0);
    await signInAtGate(page);
    await expect(layer(page, "overview").locator("h1").first()).toBeAttached({ timeout: 30_000 });
    await page.getByRole("button", { name: /Navigation öffnen|Menü/ }).first().click();
    const nav = page.getByRole("dialog", { name: "Navigation" });
    await expect(nav).toBeVisible();
    const field = nav.getByRole("combobox", { name: "Was willst du tun?" });
    await field.fill("Gruppe beitreten");
    await expect(nav.getByRole("option").first()).toHaveAttribute("data-feature", "gruppen", { timeout: 15_000 });
    await field.press("Enter");

    // signed in: the page of the task, no „dafür brauchst du ein Konto“, nothing waits for a login
    await expect(page).toHaveURL(/#community$/);
    await noToast(page);
    await expect(page.getByTestId("arrival-note").filter({ hasText: "dafür brauchst du ein Konto" })).toHaveCount(0);
    await expect(layer(page, "community").getByTestId("groups-card")).toBeInViewport({ timeout: 30_000 });
    expect(await pending(page)).toBeNull();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("#konto?returnTo=feature:backup merkt sich die Aufgabe, räumt die Adresse auf und führt nach der Anmeldung zu Backup", async ({ page }) => {
    const errors = await setup(page);
    await openGated(page, cloudUrl("konto?returnTo=feature:backup"));
    // the address is clean; the task is in this tab's memory while the entry gate asks for the account
    await expect(page).toHaveURL(/#konto$/);
    expect(await pending(page)).toMatchObject({ target: { kind: "feature", id: "backup" }, wait: { on: "signedIn" } });
    await signInAtGate(page);
    await expect(page).toHaveURL(/#settings$/, { timeout: 25_000 });
    await expect(layer(page, "settings").getByTestId("settings-data")).toBeInViewport({ timeout: 30_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("ein Fremdlink als returnTo wird verworfen: nach der Anmeldung geht nichts anderswohin", async ({ page }) => {
    const errors = await setup(page);
    await openGated(page, cloudUrl("konto?returnTo=https://evil.example/phish"));
    expect(await pending(page)).toBeNull();
    await signInAtGate(page);
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/#konto$/);
    await expect(layer(page, "konto").locator("h1").first()).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).hostname).not.toContain("evil");
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
