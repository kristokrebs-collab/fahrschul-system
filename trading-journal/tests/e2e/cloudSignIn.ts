/**
 * Shared sign-in for the cloud-edition specs (login sheet of `src/cloud/ui/AuthSheet.tsx` against the Supabase mock) and
 * the net guard they register first. One flow, so a slow runner cannot break it in one spec and not in the other:
 *
 * - The sheet body is `inert` until the panel's morph has settled (`src/motion/Sheet.tsx`). The dialog already counts as
 *   visible by then, and Playwright's `fill` on an inert input "succeeds" without writing anything (the e-mail got lost
 *   on slow CI runners). So: wait until nothing inside the dialog is inert, fill, and check that the values stuck –
 *   the whole fill is retried until they do.
 * - The end of the login is the welcome VIEW (`data-auth-view="welcome"`) – or, with data on both sides, the takeover
 *   question that comes first (answered with `choice`). Whether the first sync is already live ("Alles synchron.") is
 *   only asserted when a spec asks for it (`synced`, welcome path).
 */
import { expect, type Locator, type Page } from "@playwright/test";

export const SIGN_IN_EMAIL = "trader@example.com";
export const SIGN_IN_PASSWORD = "richtig-geheim-42";

/**
 * Waits until the login window's band run is over (Paket V, `AuthWindow.tsx`): during the 900 ms run the leaving half is still in
 * the DOM (covered by the band, `aria-hidden`, inert from the swap on), so a label locator would find its field too.
 */
export async function bandSettled(page: Page, timeout = 20_000): Promise<void> {
  await expect(page.locator(".aw-col[data-leaving]")).toHaveCount(0, { timeout });
}

/**
 * Waits until the control and none of its ancestors is `inert` (the sheet body is inert until its morph has settled, and the
 * morphing login keeps other, hidden views inert for good – so "no inert element anywhere in the dialog" is the wrong test).
 */
export async function expectNotInert(control: Locator, timeout = 20_000): Promise<void> {
  await bandSettled(control.page(), timeout);
  await expect.poll(() => control.evaluate((el) => el.closest("[inert]") === null), { timeout }).toBe(true);
}

export interface SignInOptions {
  email?: string;
  password?: string;
  /** Open the sheet through the header pill first (default). `false`: the "Anmelden" sheet is already open. */
  fromPill?: boolean;
  /** Additionally wait for the welcome text "Alles synchron." (the first sync is live). */
  synced?: boolean;
  /** Stop right after "Anmelden" was pressed (a second factor follows). */
  stopAfterSubmit?: boolean;
  /** An invitation opens another sheet right after the welcome sheet: only the welcome dialog has to be gone. */
  expectNext?: boolean;
  /** Time for the welcome view / the first sync (default 45 s: slow runners). */
  timeout?: number;
  /**
   * With data on both sides the first sign-in asks what to do with it (`takeover-choose`, `src/cloud/ui/TakeoverDialog.tsx`)
   * before the welcome view. Which answer to give (default: the dialog's preselected one).
   */
  choice?: "merge" | "local" | "cloud" | "keep";
}

export async function signInViaSheet(page: Page, o: SignInOptions = {}): Promise<void> {
  const email = o.email ?? SIGN_IN_EMAIL;
  const password = o.password ?? SIGN_IN_PASSWORD;
  const sheet = page.getByRole("dialog", { name: "Anmelden" });
  if (o.fromPill !== false) {
    const pill = page.locator('[data-cloud-pill="signin"]');
    await expect(pill).toBeVisible({ timeout: 20_000 });
    // the first click can land before the page's handlers are attached (loaded machine): click again until the sheet is there
    await expect(async () => {
      if (!(await sheet.isVisible())) await pill.click();
      await expect(sheet).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 25_000 });
  } else {
    await expect(sheet).toBeVisible({ timeout: 20_000 });
  }
  const mail = sheet.getByLabel("E-Mail");
  const pw = sheet.getByLabel("Passwort", { exact: true });
  await expectNotInert(mail);
  await expectNotInert(pw);
  await expect(async () => {
    await mail.fill(email);
    await pw.fill(password);
    await expect(mail).toHaveValue(email, { timeout: 1_000 });
    await expect(pw).toHaveValue(password, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
  if (o.stopAfterSubmit) return;
  await completeSignIn(page, o);
}

/**
 * Everything after "Anmelden" was pressed (also used by specs that press it themselves, e.g. after a wrong password): the
 * end of the login is the takeover question (B1: local data on this device, `takeover-choose`) or the welcome view.
 *
 * The welcome view can show BEFORE the question: the first sync reads both sides first, and only then knows whether it
 * has to ask. So with `synced` the end is the question or the text "Alles synchron." (never the bare welcome view), and
 * without `synced` the welcome view is given a short grace period to be replaced by the question before it is closed.
 */
export async function completeSignIn(page: Page, o: Pick<SignInOptions, "synced" | "expectNext" | "timeout" | "choice"> = {}): Promise<void> {
  const timeout = o.timeout ?? 45_000;
  const question = page.getByTestId("takeover-choose");
  const welcomeView = page.locator('[data-auth-view="welcome"]');
  const syncedText = page.getByText("Alles synchron.", { exact: false });
  const end = o.synced ? syncedText.first() : welcomeView;
  await expect.poll(async () => ((await question.isVisible()) ? "question" : (await end.isVisible()) ? "end" : "waiting"), { timeout, message: "neither the takeover question nor the end of the login appeared" }).not.toBe("waiting");
  if (!o.synced && !(await question.isVisible())) await question.waitFor({ state: "visible", timeout: 1_500 }).catch(() => undefined);
  if (await question.isVisible()) {
    // data on this device: answer the question, then the sheet closes (the welcome view is skipped)
    if (o.choice) await question.getByTestId(`takeover-${o.choice}`).check();
    await question.getByTestId("takeover-apply").click();
    if (o.choice !== "keep") {
      const done = page.getByTestId("takeover-done");
      await expect(done).toBeVisible({ timeout });
      await done.getByRole("button", { name: "Schließen" }).click();
    }
  } else {
    await page.getByRole("button", { name: "Los geht’s" }).click();
  }
  if (o.expectNext) await expect(page.getByRole("dialog", { name: "Willkommen" })).toHaveCount(0);
  else await expect(page.getByRole("dialog")).toHaveCount(0);
}

/** Hosts that belong to the test world: the preview itself and the Supabase mock. Everything else is not mocked. */
const isTestHost = (u: URL): boolean => u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname.endsWith("e2e-mock.supabase.co");

/**
 * Fails every request to a foreign host at once, like offline. Call it FIRST in a spec's setup: Playwright asks the newest
 * route first, so every mock registered afterwards still answers its own URLs and only the unmocked rest lands here. In CI
 * those requests would otherwise go to the real internet and answer differently than behind the sandbox's proxy.
 */
export async function blockExternalNetwork(page: Page): Promise<void> {
  await page.route((u) => !isTestHost(u), (route) => route.abort("internetdisconnected"));
}
