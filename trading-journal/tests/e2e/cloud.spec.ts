/**
 * P09 Konto & Cloud end to end against the Supabase / functions mock (`mocks/supabase.ts`): login (wrong password →
 * shake + message, right one → welcome + first sync of the local journal), realtime from another device, 2FA set-up
 * and the step-up at the next login, export, account deletion (journal stays local), the honest "Cloud nicht
 * eingerichtet" state, 390-px layout.
 *
 * The app must be built / served with the mock project as its cloud:
 *   VITE_SUPABASE_URL=https://e2e-mock.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_e2e
 * Until P14 registers the `konto` page the spec opens the dev harness `/dev/konto.html` (vite dev server); set
 * `PW_KONTO_URL=/#konto` once the page is routed. `P09_SHOTS_DIR` also writes review screenshots.
 */
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, fixture, seed, stored, toast } from "./helpers";
import { mockSupabase, TOTP_CODE, type MockSupabase } from "./mocks/supabase";

const KONTO_URL = process.env.PW_KONTO_URL ?? "/dev/konto.html";
const SHOTS = process.env.P09_SHOTS_DIR;
const EMAIL = "trader@example.com";
const PASSWORD = "richtig-geheim-42";
const FIXTURE_TRADES = (typeof fixture["tj2-trades"] === "string" ? JSON.parse(fixture["tj2-trades"]) : fixture["tj2-trades"]) as Array<{ id: string; notes?: string }>;

/** The spec covers the phone and the desktop layout (the tablets share the desktop cards). */
const P09_PROJECTS = ["mobile", "desktop"];

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.waitForTimeout(1500); // let the entrances settle (JS animations are not frozen by `animations: "disabled"`)
  await page.screenshot({ path: `${SHOTS}/P09-cloud-${name}-${info.project.name}.png`, animations: "disabled" });
}

async function open(page: Page, query = ""): Promise<void> {
  await page.goto(`${KONTO_URL}${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Konto" })).toBeVisible({ timeout: 30_000 });
}

/** The sheet body is inert while the panel still morphs out of the pill – wait until it takes input. */
async function ready(sheet: Locator): Promise<void> {
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[inert]")).toHaveCount(0);
}

/** Signs in through the header pill and waits until the first sync is live. */
async function signIn(page: Page, sb: MockSupabase, opts: { mfa?: boolean } = {}): Promise<void> {
  await page.locator('[data-cloud-pill="signin"]').click();
  const sheet = page.getByRole("dialog", { name: "Anmelden" });
  await ready(sheet);
  await sheet.getByLabel("E-Mail").fill(EMAIL);
  await sheet.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
  await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
  if (opts.mfa) return;
  await expect(page.getByRole("dialog", { name: "Willkommen" })).toBeVisible();
  await expect(page.getByText("Alles synchron.", { exact: false })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Los geht’s" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => [...sb.rows.values()].filter((r) => r.kind === "trade").length).toBe(FIXTURE_TRADES.length);
}

/** Holds a hold-to-confirm button with the keyboard (works on touch and mouse projects alike). */
async function hold(page: Page, name: string | RegExp): Promise<void> {
  const btn = page.getByRole("button", { name });
  await expect(btn).toBeEnabled();
  // a hold that just completed shows its ✓ for `dwell.holdCheck` (0.9 s) and ignores presses meanwhile
  await page.waitForTimeout(1000);
  await btn.focus();
  await page.keyboard.down("Enter");
  await page.waitForTimeout(1500);
  await page.keyboard.up("Enter");
}

test.describe("Konto & Cloud", () => {
  test.setTimeout(90_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!P09_PROJECTS.includes(info.project.name), "P09 runs on mobile + desktop");
  });

  test("signed out → wrong password shakes, right password signs in, the local journal is uploaded", async ({ page }, info) => {
    const errors = collectErrors(page);
    const sb = await mockSupabase(page);
    await seed(page);
    await open(page);
    await expect(page.getByText("Ein Journal. Alle Geräte.")).toBeVisible();
    await expect(page.getByText("Melde dich an, dann ist dein Journal auf allen Geräten synchron.", { exact: false })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, info, "signed-out");

    await page.locator('[data-cloud-pill="signin"]').click();
    const sheet = page.getByRole("dialog", { name: "Anmelden" });
    await ready(sheet);
    await sheet.getByLabel("E-Mail").fill(EMAIL);
    await sheet.getByLabel("Passwort", { exact: true }).fill("falsch-falsch");
    await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(sheet.getByText("E-Mail oder Passwort stimmt nicht.")).toBeVisible();
    await shot(page, info, "login-error");

    await sheet.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
    await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
    const welcome = page.getByRole("dialog", { name: "Willkommen" });
    await expect(welcome).toBeVisible();
    await expect(welcome.getByText("Alles synchron.", { exact: false })).toBeVisible({ timeout: 20_000 });
    await shot(page, info, "welcome");
    await welcome.getByRole("button", { name: "Los geht’s" }).click();

    // every local trade is in the cloud, the settings row too; a safety snapshot was written before the merge
    await expect.poll(() => [...sb.rows.values()].filter((r) => r.kind === "trade").length).toBe(FIXTURE_TRADES.length);
    expect(sb.live("settings:settings")).toBeTruthy();
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys.some((k) => k.startsWith("tj2-backup-import-"))).toBe(true);
    expect(keys).toContain("tj2-sb-auth");
    await expect(page.getByTestId("sync-status")).toBeVisible();
    await expect(page.locator('[data-cloud-pill="account"]')).toBeVisible();
    expect(sb.audit.map((a) => a.action)).toContain("auth.signin");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "signed-in");
    expect(errors).toEqual([]);
  });

  test("local edits upload, a change from another device arrives via realtime", async ({ page }) => {
    const errors = collectErrors(page);
    const sb = await mockSupabase(page);
    await seed(page);
    await open(page);
    await signIn(page, sb);
    const first = FIXTURE_TRADES[0]!.id;

    // another device edits a trade → realtime → this browser's journal
    const cur = sb.live(`trade:${first}`) as Record<string, unknown>;
    await sb.emit("trade", first, { ...cur, notes: "vom Handy", updatedAt: "2026-10-12T09:30:00.000Z" });
    await expect.poll(async () => ((await stored<Array<{ id: string; notes: string }>>(page, "tj2-trades")) ?? []).find((t) => t.id === first)?.notes, { timeout: 10_000 }).toBe("vom Handy");

    // another device deletes one (tombstone) → gone here too
    const second = FIXTURE_TRADES[1]!.id;
    await sb.emit("trade", second, { deletedAt: "2026-10-12T09:31:00.000Z" }, true);
    await expect.poll(async () => ((await stored<Array<{ id: string }>>(page, "tj2-trades")) ?? []).some((t) => t.id === second), { timeout: 10_000 }).toBe(false);

    // a local write through the store API (as the trade editor does; the dev harness exposes the store) goes up at once
    const hooked = await page.evaluate(() => "__tjJournal" in window);
    if (hooked) {
      await page.evaluate(async (id) => {
        type Store = { getState(): { trades: Array<Record<string, unknown>>; saveTrade(t: unknown): Promise<void> } };
        const store = (window as unknown as { __tjJournal: Store }).__tjJournal;
        const t = store.getState().trades.find((x) => x.id === id)!;
        await store.getState().saveTrade({ ...t, notes: "am Rechner", updatedAt: new Date().toISOString() });
      }, first);
      await expect.poll(() => (sb.live(`trade:${first}`) as { notes?: string } | undefined)?.notes, { timeout: 10_000 }).toBe("am Rechner");
    }
    expect(errors).toEqual([]);
  });

  test("2FA: QR + code + hold to activate; the next login asks for the code", async ({ page }, info) => {
    const errors = collectErrors(page);
    const sb = await mockSupabase(page);
    await seed(page);
    await open(page);
    await signIn(page, sb);

    await page.getByRole("button", { name: "2FA einrichten" }).click();
    const enroll = page.getByTestId("mfa-enroll");
    await expect(enroll.getByRole("img", { name: "QR-Code für deine Authenticator-App" })).toBeVisible();
    await expect(enroll.getByText("JBSW Y3DP", { exact: false })).toBeVisible();
    const code = enroll.getByLabel("6-stelliger Code aus der App");
    await code.fill("000000");
    await hold(page, "Halten zum Aktivieren");
    await expect(enroll.getByText("Der Code stimmt nicht.", { exact: false })).toBeVisible();
    await code.fill(TOTP_CODE);
    await shot(page, info, "mfa-enroll");
    await hold(page, "Halten zum Aktivieren");
    await expect(page.getByText("Aktiv", { exact: true })).toBeVisible({ timeout: 10_000 });
    expect(sb.users[0]!.factors.some((f) => f.status === "verified")).toBe(true);
    await expect(page.getByTestId("session-list").getByText("Dieses Gerät")).toBeVisible();
    await shot(page, info, "security");

    // sign out, sign in again → the code is asked for; a wrong code shakes, the right one finishes the login
    await page.getByRole("button", { name: "Abmelden", exact: true }).first().click();
    await expect(page.locator('[data-cloud-pill="signin"]')).toBeVisible();
    await signIn(page, sb, { mfa: true });
    const mfa = page.getByRole("dialog", { name: "Zwei-Faktor-Code" });
    await expect(mfa).toBeVisible();
    await mfa.getByLabel("2FA-Code").fill("111111");
    await expect(mfa.getByText("Der Code stimmt nicht.", { exact: false })).toBeVisible();
    await mfa.getByLabel("2FA-Code").fill(TOTP_CODE);
    await expect(page.getByRole("dialog", { name: "Willkommen" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Daten: export, cloud backups, delete with LÖSCHEN + hold – the journal stays in this browser", async ({ page }, info) => {
    const errors = collectErrors(page);
    const sb = await mockSupabase(page);
    await seed(page);
    await open(page);
    await signIn(page, sb);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Daten exportieren" }).click();
    expect((await download).suggestedFilename()).toMatch(/^trade-journal-konto-\d{4}-\d{2}-\d{2}\.json$/);
    await expect(page.getByRole("heading", { name: "Cloud-Backups" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sicherheitsprotokoll" })).toBeVisible();
    await expect(page.getByText("Daten exportiert")).toBeVisible();

    await page.getByLabel("Tippe LÖSCHEN zur Bestätigung").fill("löschen");
    await page.getByRole("button", { name: "Halten zum Löschen" }).scrollIntoViewIfNeeded();
    await shot(page, info, "delete");
    await hold(page, "Halten zum Löschen");
    await expect(toast(page).getByText("Konto gelöscht")).toBeVisible({ timeout: 10_000 });
    expect(sb.deletedAccounts).toHaveLength(1);
    await expect(page.getByText("Ein Journal. Alle Geräte.")).toBeVisible();
    // local-first: nothing local was deleted
    expect(((await stored<unknown[]>(page, "tj2-trades")) ?? []).length).toBe(FIXTURE_TRADES.length);
    expect(errors).toEqual([]);
  });

  test("without cloud config: an honest card, no login anywhere", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await open(page, "?cloud=off");
    await expect(page.getByText("Login und Sync sind in dieser Version nicht aktiv.", { exact: false })).toBeVisible();
    await expect(page.locator("[data-cloud-pill]")).toHaveCount(0);
    await expect(page.getByText("Öffne das Journal über claude.ai", { exact: false })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, info, "unavailable");
    expect(errors).toEqual([]);
  });
});
