/**
 * A4 Rückführung: wer im Finder nach einer Aufgabe fragt und an einer Anmeldung vorbeimuss, landet danach wieder bei seiner Aufgabe.
 * Läuft im Cloud-Build gegen den Supabase-Mock (`mocks/supabase.ts`, `cloudUrl` in helpers.ts) – dieselbe Anmeldung wie im Konto-Spec.
 *
 *   1. "Gruppe beitreten" ohne Konto: der Finder bringt zur Community, der Fundort-Hinweis sagt "dafür brauchst du ein Konto" und
 *      bietet "Anmelden" an; nach der Anmeldung steht die Karte "Gruppen" im Bild (die ursprüngliche Aufgabe), kein Toast.
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

const PROJECTS = ["mobile", "desktop"];
const EMAIL = "trader@example.com";
const PASSWORD = "richtig-geheim-42";
const RETURN_KEY = "tj2-return-to";

/** What the app has noted for the way back (this tab's `sessionStorage`, `src/store/returnTo.ts`). */
const pending = (page: Page): Promise<{ target: { kind: string; id?: string }; wait: { on: string } } | null> =>
  page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) ?? "null"), RETURN_KEY);

/** The toast island is one live region that is always in the DOM (empty at rest; pages have live regions of their own): "no toast" means it says nothing. */
const noToast = (page: Page) => expect(page.locator("[data-toast-island]").filter({ hasText: /\S/ })).toHaveCount(0);

const layer = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"]`);

async function setup(page: Page) {
  const errors = collectErrors(page);
  await mockSupabase(page);
  await mockBilling(page, { enabled: false });
  await mockSocial(page, {});
  await seed(page);
  return errors;
}

/** Signs in through the sheet that is open (or the header pill) and closes the welcome sheet once the first sync is live. */
async function signInInOpenSheet(page: Page): Promise<void> {
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

test.describe("Finder: zurück zur Aufgabe nach der Anmeldung", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("„Gruppe beitreten“ ohne Konto → Hinweis → Anmelden → die Karte „Gruppen“ steht im Bild", async ({ page }) => {
    const errors = await setup(page);
    await page.goto(cloudUrl("overview"));
    await expect(layer(page, "overview").locator("h1").first()).toBeAttached({ timeout: 30_000 });
    await page.getByRole("button", { name: /Navigation öffnen|Menü/ }).first().click();
    const nav = page.getByRole("dialog", { name: "Navigation" });
    await expect(nav).toBeVisible();
    const field = nav.getByRole("combobox", { name: "Was willst du tun?" });
    await field.fill("Gruppe beitreten");
    await expect(nav.getByRole("option").first()).toHaveAttribute("data-feature", "gruppen", { timeout: 15_000 });
    await field.press("Enter");

    // the page, and a note that says why the card is not there – with the way on
    await expect(page).toHaveURL(/#community$/);
    const note = page.getByTestId("arrival-note");
    await expect(note).toBeVisible({ timeout: 25_000 });
    await expect(note).toContainText("dafür brauchst du ein Konto");
    await noToast(page);
    await note.getByTestId("arrival-login").click();

    // the original task waits (this tab only) …
    await expect.poll(async () => (await pending(page))?.target?.id).toBe("gruppen");
    await signInInOpenSheet(page);

    // … and comes back: the card of the task is on the screen, the waiting note is gone
    await expect(page).toHaveURL(/#community$/);
    await expect(layer(page, "community").getByTestId("groups-card")).toBeInViewport({ timeout: 30_000 });
    expect(await pending(page)).toBeNull();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("#konto?returnTo=feature:backup merkt sich die Aufgabe, räumt die Adresse auf und führt nach der Anmeldung zu Backup", async ({ page }) => {
    const errors = await setup(page);
    await page.goto(cloudUrl("konto?returnTo=feature:backup"));
    await expect(layer(page, "konto").locator("h1").first()).toBeVisible({ timeout: 30_000 });
    // the address is clean; the task is in this tab's memory
    await expect(page).toHaveURL(/#konto$/);
    expect(await pending(page)).toMatchObject({ target: { kind: "feature", id: "backup" }, wait: { on: "signedIn" } });
    await page.locator('[data-cloud-pill="signin"]').click();
    await signInInOpenSheet(page);
    await expect(page).toHaveURL(/#settings$/, { timeout: 25_000 });
    await expect(layer(page, "settings").getByTestId("settings-data")).toBeInViewport({ timeout: 30_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("ein Fremdlink als returnTo wird verworfen: nach der Anmeldung geht nichts anderswohin", async ({ page }) => {
    const errors = await setup(page);
    await page.goto(cloudUrl("konto?returnTo=https://evil.example/phish"));
    await expect(layer(page, "konto").locator("h1").first()).toBeVisible({ timeout: 30_000 });
    expect(await pending(page)).toBeNull();
    await page.locator('[data-cloud-pill="signin"]').click();
    await signInInOpenSheet(page);
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/#konto$/);
    expect(new URL(page.url()).hostname).not.toContain("evil");
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
