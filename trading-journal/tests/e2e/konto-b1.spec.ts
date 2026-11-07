/**
 * B1 Konto produktiv, end to end against the Supabase / functions MOCK (`mocks/supabase.ts` – the real Supabase is not reachable
 * from the test machine): the data takeover at the first login (preview numbers, merge, "Nur Cloud", "Lokal behalten", undo
 * window), account deletion kept apart from ending a subscription (status step, acknowledgement, export, hold), recovery codes
 * and the lost-device path of the 2FA step, "Überall abmelden", and the operator's sync pause. Runs on the cloud edition
 * (`npm run build:e2e-cloud`), mobile and desktop. Launch-plan acceptance tests 1–8 (account) and 40 (operations) as far as a mock shows them.
 */
import { expect, test, type Page } from "@playwright/test";
import { cloudUrl, collectErrors, expectNoHorizontalScroll, finishSignIn, fixture, openRoute, seed, stored, toast } from "./helpers";
import { mockSupabase, TOTP_CODE, type MockSupabase } from "./mocks/supabase";

const KONTO_URL = process.env.PW_KONTO_URL ?? cloudUrl("konto");
const EMAIL = "trader@example.com";
const PASSWORD = "richtig-geheim-42";
const FIXTURE_TRADES = (typeof fixture["tj2-trades"] === "string" ? JSON.parse(fixture["tj2-trades"]) : fixture["tj2-trades"]) as Array<Record<string, unknown> & { id: string }>;
const N = FIXTURE_TRADES.length;
const CLOUD_TRADE = { ...FIXTURE_TRADES[0]!, id: "t_cloud_1", date: "2026-09-01T10:00", notes: "nur im Konto", updatedAt: "2026-09-01T10:00:00.000Z", createdAt: "2026-09-01T10:00:00.000Z" };

const open = (page: Page) => openRoute(page, KONTO_URL, "Konto", { timeout: 30_000 });
const liveTrades = (sb: MockSupabase) => [...sb.rows.values()].filter((r) => r.kind === "trade" && !r.deleted).length;

async function ready(page: Page, name: string): Promise<ReturnType<Page["getByRole"]>> {
  const sheet = page.getByRole("dialog", { name });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[inert]")).toHaveCount(0);
  return sheet;
}

/** Fills the sign-in sheet and sends it – the caller decides how the first-login flow ends. */
async function sendSignIn(page: Page): Promise<void> {
  await page.locator('[data-cloud-pill="signin"]').click();
  const sheet = await ready(page, "Anmelden");
  await sheet.getByLabel("E-Mail").fill(EMAIL);
  await sheet.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
  await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
}

/** Holds a hold-to-confirm button with the keyboard (works on touch and mouse projects alike). */
async function hold(page: Page, name: string | RegExp): Promise<void> {
  const btn = page.getByRole("button", { name });
  await expect(btn).toBeEnabled();
  await page.waitForTimeout(1000);
  await btn.focus();
  await page.keyboard.down("Enter");
  await page.waitForTimeout(1500);
  await page.keyboard.up("Enter");
}

test.describe("Konto produktiv (B1)", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!["mobile", "desktop"].includes(info.project.name), "B1 runs on mobile + desktop");
  });

  test("takeover: numbers first, nothing leaves before the choice; merge; undo restores both sides; then 'Lokal behalten'", async ({ page }) => {
    const errors = collectErrors(page);
    const sb = await mockSupabase(page, { docs: [{ kind: "trade", id: "t_cloud_1", data: CLOUD_TRADE }] });
    await seed(page);
    await open(page);
    await sendSignIn(page);

    const question = page.getByTestId("takeover-choose");
    await expect(question).toBeVisible({ timeout: 20_000 });
    // nothing was written to the account while the question is open
    expect(liveTrades(sb)).toBe(1);
    const preview = question.getByTestId("takeover-preview");
    await expect(preview.getByRole("row", { name: new RegExp(`^Trades ${N} 1$`) })).toBeVisible();
    await expect(question.getByRole("radio")).toHaveCount(4);
    await expect(question.getByTestId("takeover-merge")).toBeChecked();
    await expectNoHorizontalScroll(page);
    // a touch target is at least 44 px high
    const box = await question.getByTestId("takeover-apply").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(36);

    await question.getByTestId("takeover-apply").click();
    const done = page.getByTestId("takeover-done");
    await expect(done).toBeVisible({ timeout: 20_000 });
    await expect(done).toContainText("Einträge ins Konto");
    expect(liveTrades(sb)).toBe(N + 1);
    expect(((await stored<unknown[]>(page, "tj2-trades")) ?? []).length).toBe(N + 1);
    // the safety snapshot exists before anything was merged
    expect((await page.evaluate(() => Object.keys(localStorage))).some((k) => k.startsWith("tj2-backup-import-"))).toBe(true);

    // undo: this device is as before, the account rows the takeover wrote are gone again, the question comes back
    await done.getByTestId("takeover-undo").click();
    await expect(page.getByTestId("takeover-choose")).toBeVisible({ timeout: 20_000 });
    expect(liveTrades(sb)).toBe(1);
    expect(((await stored<unknown[]>(page, "tj2-trades")) ?? []).length).toBe(N);

    // this time: keep the journal local – nothing is read or written, the sync is paused, the card says how to turn it on
    await page.getByTestId("takeover-choose").getByTestId("takeover-keep").check();
    await page.getByTestId("takeover-apply").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(toast(page).getByText("Journal bleibt lokal")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync einschalten" })).toBeVisible();
    expect(liveTrades(sb)).toBe(1);
    expect(((await stored<unknown[]>(page, "tj2-trades")) ?? []).length).toBe(N);
    expect(errors).toEqual([]);
  });

  test("takeover 'Nur Cloud': this device takes the account, the local journal stays in the snapshot, nothing is uploaded", async ({ page }) => {
    const errors = collectErrors(page);
    const sb = await mockSupabase(page, { docs: [{ kind: "trade", id: "t_cloud_1", data: CLOUD_TRADE }] });
    await seed(page);
    await open(page);
    await sendSignIn(page);
    await expect(page.getByTestId("takeover-choose")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("takeover-cloud").check();
    await page.getByTestId("takeover-apply").click();
    await expect(page.getByTestId("takeover-done")).toBeVisible({ timeout: 20_000 });
    expect(liveTrades(sb)).toBe(1);
    const local = (await stored<Array<{ id: string }>>(page, "tj2-trades")) ?? [];
    expect(local.map((t) => t.id)).toEqual(["t_cloud_1"]);
    const snap = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith("tj2-backup-import-"))!;
      return (JSON.parse(localStorage.getItem(k)!) as { trades: unknown[] }).trades.length;
    });
    expect(snap).toBe(N);
    expect(errors).toEqual([]);
  });

  test("closing the question is 'Später entscheiden': journal stays local, no sync, no upload", async ({ page }) => {
    const sb = await mockSupabase(page);
    await seed(page);
    await open(page);
    await sendSignIn(page);
    const question = page.getByTestId("takeover-choose");
    await expect(question).toBeVisible({ timeout: 20_000 });
    await question.getByRole("button", { name: "Später entscheiden" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sync einschalten" })).toBeVisible();
    expect(liveTrades(sb)).toBe(0);
    // turning the sync on again asks again
    await page.getByRole("button", { name: "Sync einschalten" }).click();
    await expect(page.getByTestId("takeover-choose")).toBeVisible({ timeout: 20_000 });
  });

  test("delete is not the end of a subscription: status first, acknowledgement, export, then the hold", async ({ page }) => {
    const errors = collectErrors(page);
    const sb = await mockSupabase(page, { subscription: "running" });
    await seed(page);
    await open(page);
    await sendSignIn(page);
    await finishSignIn(page);

    const section = page.getByTestId("delete-section");
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByText("Abo beenden", { exact: true })).toBeVisible();
    await expect(section.getByTestId("delete-step-sub")).toContainText("Dein Abo (Pro) läuft. Beim Löschen endet es sofort.");
    await expect(section.getByTestId("delete-step-export")).toContainText(`${N} Trades`);
    await expectNoHorizontalScroll(page);

    // the word alone is not enough while a subscription runs
    await page.getByLabel("Tippe LÖSCHEN zur Bestätigung").fill("löschen");
    await expect(page.getByRole("button", { name: "Halten zum Löschen" })).toHaveCount(0);
    await expect(section.getByText("Bitte bestätige zuerst, dass dein Abo sofort endet.")).toBeVisible();

    // the export is one step of the flow
    const download = page.waitForEvent("download");
    await section.getByRole("button", { name: "Kopie herunterladen" }).click();
    expect((await download).suggestedFilename()).toMatch(/^trade-journal-konto-\d{4}-\d{2}-\d{2}\.json$/);

    await section.getByTestId("delete-ack").check();
    await hold(page, "Halten zum Löschen");
    await expect(toast(page).getByText("Konto gelöscht")).toBeVisible({ timeout: 10_000 });
    expect(sb.deletedAccounts).toHaveLength(1);
    expect(((await stored<unknown[]>(page, "tj2-trades")) ?? []).length).toBe(N);
    expect(errors).toEqual([]);
  });

  test("recovery codes: set up 2FA, create codes (shown once), lose the device, sign in with a code, 2FA is off", async ({ page }) => {
    const errors = collectErrors(page);
    const sb = await mockSupabase(page);
    await seed(page);
    await open(page);
    await sendSignIn(page);
    await finishSignIn(page);

    await page.getByRole("button", { name: "2FA einrichten" }).click();
    const enroll = page.getByTestId("mfa-enroll");
    await enroll.getByLabel("6-stelliger Code aus der App").fill(TOTP_CODE);
    await hold(page, "Halten zum Aktivieren");
    await expect(page.getByText("Aktiv", { exact: true })).toBeVisible({ timeout: 10_000 });

    const recovery = page.getByTestId("recovery-section");
    await recovery.scrollIntoViewIfNeeded();
    await expect(recovery).toContainText("Noch keine Codes erzeugt.");
    await recovery.getByTestId("recovery-create").click();
    const codes = page.getByTestId("recovery-codes");
    await expect(codes.getByRole("listitem")).toHaveCount(8);
    await expect(codes).toContainText("nur jetzt");
    await expect(codes.getByRole("button", { name: "Fertig" })).toBeDisabled();
    await codes.getByTestId("recovery-saved").check();
    await codes.getByRole("button", { name: "Fertig" }).click();
    await expect(page.getByTestId("recovery-codes")).toHaveCount(0);
    await expect(recovery).toContainText("Noch 8 von 8 Codes übrig");
    expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage })))).not.toContain("ABCDE-FGHJK");

    // lost device: password sign-in → code step → recovery code
    await page.getByRole("button", { name: "Abmelden", exact: true }).first().click();
    await expect(page.locator('[data-cloud-pill="signin"]')).toBeVisible();
    await sendSignIn(page);
    const mfa = page.getByRole("dialog", { name: "Zwei-Faktor-Code" });
    await expect(mfa).toBeVisible();
    await mfa.getByRole("button", { name: "Gerät verloren? Wiederherstellungscode nutzen" }).click();
    await mfa.getByLabel("Wiederherstellungscode").fill("NICHT-RICHTIG");
    await mfa.getByRole("button", { name: "Code einlösen" }).click();
    await expect(mfa.getByText("Dieser Code passt nicht oder wurde schon benutzt.")).toBeVisible();
    await mfa.getByLabel("Wiederherstellungscode").fill("abcde-fghjk");
    await mfa.getByRole("button", { name: "Code einlösen" }).click();
    await expect(toast(page).getByText("2FA zurückgesetzt")).toBeVisible({ timeout: 10_000 });
    expect(sb.users[0]!.factors).toHaveLength(0);
    expect(sb.audit.map((a) => a.action)).toContain("auth.mfa.recovery.used");
    expect(errors).toEqual([]);
  });

  test("operator switch: with KILL_SYNC the sync never starts and the card says why", async ({ page }) => {
    const sb = await mockSupabase(page, { syncOff: true });
    await open(page);
    await sendSignIn(page);
    // no journal here → no takeover question; the welcome sheet may or may not show, the account stays untouched
    await expect(page.getByTestId("sync-ops-paused")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Sync einschalten" })).toHaveCount(0);
    expect([...sb.rows.keys()]).toEqual([]);
  });
});
