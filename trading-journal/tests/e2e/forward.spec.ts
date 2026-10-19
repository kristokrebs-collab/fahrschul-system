/**
 * F23 Forward-Test · F15 Versionen · F13 / F45 Playbooks end to end on the routed page `/#labor` of the production build against
 * the market mock with REAL BTCUSDT bars (`boxes: true`, Binance `startTime` / `limit` paging – no network, no clock jumps):
 *
 * - a virtual account is started from the form, shows its honest "Stand", survives a reload (stored in `settings.forward`), brings
 *   candles that closed since its start into the numbers, pauses / resumes / ends / is deleted (the last two ask first);
 * - a saved draft gets a version per change with the change in plain language; the playbook of a draft is exported as text and
 *   read back through the strict import into a preview, and a malicious file is refused with its reason;
 * - no console errors, no horizontal scroll (mobile 390 px included).
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, scrollUntilVisible, seed, stored } from "./helpers";

const LABOR_URL = process.env.PW_LABOR_URL ?? "/#labor";
const PROJECTS = ["mobile", "desktop"];

interface StoredAccount {
  id: string;
  status: string;
  startMs: number;
  createdAt: number;
  cursor: { t: number | null; done: boolean };
  trades: unknown[];
  pauses: { from: number; to: number | null }[];
  endReason?: string;
}
const forwardOf = async (page: Page): Promise<StoredAccount[]> => ((await stored<{ forward?: { accounts?: StoredAccount[] } }>(page, "tj2-settings"))?.forward?.accounts ?? []) as StoredAccount[];

async function open(page: Page, info: TestInfo): Promise<string[]> {
  test.skip(!PROJECTS.includes(info.project.name), "Forward-Test runs on mobile + desktop");
  const errors = collectErrors(page);
  await seed(page, { boxes: true, extra: { "tj2-labor": { strategy: "custom", symbol: "BTCUSDT", period: "6m", funding: "none" } } });
  await openRoute(page, LABOR_URL, "Labor");
  return errors;
}

test.describe("Labor · Forward-Test", () => {
  test.setTimeout(150_000);

  test("Konto starten, Stand lesen, neu laden, pausieren, beenden, löschen", async ({ page }, info) => {
    const errors = await open(page, info);
    const section = page.getByTestId("forward-section");
    await scrollUntilVisible(page, section);
    await expect(section.getByText("Noch kein virtuelles Konto")).toBeVisible();
    await expect(page.getByTestId("forward-rules-text")).toContainText("Long wenn");
    await expectNoHorizontalScroll(page);

    await page.getByTestId("forward-start").click();
    const card = page.getByTestId("forward-account");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-status", "running");
    await expect(card.getByTestId("forward-status")).toHaveText("Läuft");
    // the account counts from the candle that contains the start: nothing has closed yet – and it says so
    await expect(card.getByTestId("forward-runtime")).toHaveAttribute("data-phase", "idle", { timeout: 60_000 });
    await expect(card.getByTestId("forward-stand")).toContainText(/Stand: noch keine Kerze seit dem Start geschlossen/);
    await expect(card.getByTestId("forward-sample")).toContainText("Erst 0 Trades");
    await expectNoHorizontalScroll(page);
    const [acc] = await forwardOf(page);
    expect(acc!.cursor.t).toBeNull();
    expect(acc!.trades).toEqual([]);

    // reload: the account is still there and still running
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Labor" })).toBeVisible();
    await scrollUntilVisible(page, page.getByTestId("forward-account"));
    await expect(page.getByTestId("forward-account")).toHaveAttribute("data-status", "running");
    await expectNoHorizontalScroll(page);

    // pause / resume
    await page.getByTestId("forward-pause").click();
    await expect(page.getByTestId("forward-account")).toHaveAttribute("data-status", "paused");
    await expect.poll(async () => (await forwardOf(page))[0]?.pauses.length).toBe(1);
    await page.getByTestId("forward-resume").click();
    await expect(page.getByTestId("forward-account")).toHaveAttribute("data-status", "running");
    await expect.poll(async () => (await forwardOf(page))[0]?.pauses[0]?.to != null).toBe(true);

    // end asks first
    await page.getByTestId("forward-end").click();
    await expect(page.getByTestId("forward-confirm")).toContainText("schließt eine offene Position");
    await page.getByTestId("forward-confirm-yes").click();
    await expect(page.getByTestId("forward-account")).toHaveAttribute("data-status", "ended");
    await expect.poll(async () => (await forwardOf(page))[0]?.cursor.done, { timeout: 60_000 }).toBe(true);

    // delete asks first and leaves nothing behind
    await page.getByTestId("forward-remove").click();
    await expect(page.getByTestId("forward-confirm")).toContainText("nicht rückgängig");
    await page.getByTestId("forward-confirm-yes").click();
    await expect(page.getByTestId("forward-account")).toHaveCount(0);
    expect(await forwardOf(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("Kerzen seit dem Start fließen in den Stand ein; der Rückblick-Vergleich nennt seine Zahlen", async ({ page }, info) => {
    const errors = await open(page, info);
    await scrollUntilVisible(page, page.getByTestId("forward-section"));
    await page.getByTestId("forward-start").click();
    await expect(page.getByTestId("forward-account")).toBeVisible();
    await expect(page.getByTestId("forward-runtime")).toHaveAttribute("data-phase", "idle", { timeout: 60_000 });

    // move the start three days back (the same effect as an account that has been running since then), then ask again
    await page.evaluate(async () => {
      const j = (window as unknown as { __tjJournal: { getState(): { settings: { forward: { accounts: { startMs: number; createdAt: number }[] } }; saveSettings(s: unknown): Promise<void> } } }).__tjJournal;
      const { settings, saveSettings } = j.getState();
      const back = 18 * 4 * 3_600_000;
      const accounts = settings.forward.accounts.map((a) => ({ ...a, startMs: a.startMs - back, createdAt: a.createdAt - back }));
      await saveSettings({ ...settings, forward: { ...settings.forward, accounts } });
    });
    await page.getByTestId("forward-refresh").click();
    const card = page.getByTestId("forward-account");
    await expect(card.getByTestId("forward-stand")).toContainText(/Stand: bis Kerzenschluss/, { timeout: 60_000 });
    await expect.poll(async () => (await forwardOf(page))[0]?.cursor.t, { timeout: 30_000 }).not.toBeNull();
    // every number carries its sample size
    await expect(card.getByTestId("forward-kpis")).toContainText("Stichprobe n =");
    await expectNoHorizontalScroll(page);

    // the comparison with the backtest of the same rules before the start
    await card.getByTestId("forward-compare-toggle").click();
    await card.getByTestId("forward-compare-run").click();
    const res = card.getByTestId("forward-compare-result");
    await expect(res).toBeVisible({ timeout: 90_000 });
    await expect(res.locator("tbody tr")).toHaveCount(6);
    await expect(res).toContainText("nie für beides");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});

test.describe("Labor · Versionen und Playbooks", () => {
  test.setTimeout(120_000);

  test("zwei Versionen eines Entwurfs mit der Änderung in Klartext; Playbook raus und wieder rein, Bösartiges wird abgewiesen", async ({ page }, info) => {
    const errors = await open(page, info);
    // a draft from a template, saved; a changed stop is a second version
    await page.getByTestId("labor-template-oversold-trend").click();
    await page.getByTestId("labor-draft-save").click();
    await expect(page.getByTestId("labor-draft")).toHaveCount(1);
    const level = page.getByTestId("labor-builder").getByRole("textbox", { name: "RSI Niveau: Niveau" });
    await level.fill("25");
    await level.press("Enter");
    await page.getByTestId("labor-draft-save").click();

    const versions = page.getByTestId("labor-versions");
    await scrollUntilVisible(page, versions);
    const items = versions.getByTestId("labor-version");
    await expect(items).toHaveCount(2);
    await expect(items.first()).toHaveAttribute("data-n", "2");
    await expect(items.first().getByTestId("labor-version-diff")).toContainText("RSI Niveau: 30 → 25");
    await expect(items.nth(1)).toContainText("Erste gespeicherte Fassung");
    await expect(versions.getByTestId("labor-compare-rows")).toBeVisible();
    await expectNoHorizontalScroll(page);

    // export: the text is a playbook; import it again → preview marked as foreign, nothing created before the click
    const card = page.getByTestId("labor-playbook");
    await scrollUntilVisible(page, card);
    const text = await card.getByTestId("playbook-text").inputValue();
    expect(JSON.parse(text)).toMatchObject({ format: "tj-playbook", version: 1 });
    await card.getByTestId("playbook-input").fill(text);
    await card.getByTestId("playbook-check").click();
    const preview = card.getByTestId("playbook-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("fremdes Playbook");
    await expect(page.getByTestId("labor-draft")).toHaveCount(1);
    await preview.getByTestId("playbook-create").click();
    await expect(preview.getByTestId("playbook-probe")).toBeVisible();
    if (!(await page.getByTestId("labor-drafts").isVisible())) await page.getByTestId("labor-drafts-toggle").click();
    await expect(page.getByTestId("labor-draft")).toHaveCount(2);
    await expect(page.getByTestId("labor-drafts").getByText("fremd", { exact: true })).toBeVisible();

    // a hostile file is refused with its reason and creates nothing
    const evil = text.replace('"title"', '"__proto__":{"polluted":true},"title"');
    await card.getByTestId("playbook-input").fill(evil);
    await card.getByTestId("playbook-check").click();
    await expect(card.getByTestId("playbook-errors")).toContainText("unzulässigen Schlüssel");
    await expect(card.getByTestId("playbook-preview")).toHaveCount(0);
    expect(await page.evaluate(() => ({}) as Record<string, unknown>).then((o) => o.polluted)).toBeUndefined();
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});
