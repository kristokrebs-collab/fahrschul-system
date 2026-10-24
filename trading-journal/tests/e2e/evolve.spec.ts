/**
 * F66 Hintergrund-Optimierer end to end on the routed page `/#labor` of the production build against the market mock with REAL
 * BTCUSDT bars (no network, no clock jumps). Only the stable paths: the section is there and says what it is (runs only while the
 * app is open, never changes anything by itself), a run can be started, paused, resumed and stopped, ends with proposals or an
 * honest "nothing found", the protocol drawer opens, nothing was saved or started without a click – on mobile (390 px) and desktop
 * (1280 px) without horizontal scroll and without console errors.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, scrollUntilVisible, screenshot, seed, stored } from "./helpers";

const LABOR_URL = process.env.PW_LABOR_URL ?? "/#labor";
const PROJECTS = ["mobile", "desktop"];

async function open(page: Page, info: TestInfo): Promise<string[]> {
  test.skip(!PROJECTS.includes(info.project.name), "Optimierer runs on mobile + desktop");
  if (info.project.name === "desktop") await page.setViewportSize({ width: 1280, height: 800 });
  const errors = collectErrors(page);
  await seed(page, { boxes: true, extra: { "tj2-labor": { strategy: "custom", symbol: "BTCUSDT", period: "6m", funding: "none" } } });
  await openRoute(page, LABOR_URL, "Labor");
  return errors;
}

test.describe("Labor · Hintergrund-Optimierer", () => {
  test.setTimeout(180_000);

  test("Karte sichtbar, sagt was sie ist, Start → Pause → Fortsetzen → Stopp, Ergebnis ehrlich, nichts ohne Klick", async ({ page }, info) => {
    const errors = await open(page, info);
    const panel = page.getByTestId("evolve-panel");
    await scrollUntilVisible(page, panel);
    await expect(page.getByRole("heading", { name: "Hintergrund-Optimierer", level: 2 }).first()).toBeVisible();
    await expect(page.getByTestId("evolve-open-note")).toContainText("Läuft nur, solange die App offen ist.");
    await expect(page.getByTestId("evolve-open-note")).toContainText("Ändert nie von selbst");
    await expect(page.getByTestId("evolve-strategy").first()).toContainText("Freiheitsgrade");
    await expect(panel).toHaveAttribute("data-status", "idle");
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "evolve-idle");

    // "Schonend" (duty cycle 20 %) keeps the short run slow enough to pause and resume it on a fast desktop, too
    await page.getByRole("radiogroup", { name: "Tempo" }).getByRole("radio", { name: "Schonend" }).click();
    await page.getByTestId("evolve-start").click();
    // the candles are loaded with the lab's loader, then the run starts
    await expect(panel).toHaveAttribute("data-status", /^(starting|running)$/, { timeout: 90_000 });
    await expect(page.getByTestId("evolve-progress")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("evolve-progress").getByRole("progressbar")).toBeVisible();
    await expect(page.getByTestId("evolve-throttle")).toContainText(/Web Worker|Zeitscheiben/);
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "evolve-running");

    await page.getByTestId("evolve-pause").click();
    await expect(panel).toHaveAttribute("data-status", "paused");
    await expect(page.getByTestId("evolve-throttle")).toContainText("Pausiert");
    await page.getByTestId("evolve-resume").click();
    // the search ends by itself once nothing better turns up, which a fast machine can reach right after "Fortsetzen": both ends are right
    await expect(panel).toHaveAttribute("data-status", /^(running|done)$/);

    // "Stopp" ends the run early; when the run was faster than the click there is no button any more and the run is done anyway
    await page.getByTestId("evolve-stop").click({ timeout: 4_000 }).catch(() => undefined);
    await expect(panel).toHaveAttribute("data-status", "done", { timeout: 90_000 });
    await expect(page.getByTestId("evolve-leaderboard").first()).toBeVisible();
    await expect(page.getByTestId("evolve-windows").first()).toContainText("Bestätigung");
    // proposals, or the honest statement that nothing better was found – never an empty gap
    await expect(page.getByTestId("evolve-proposal").or(page.getByTestId("evolve-nothing")).first()).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "evolve-done");
    await page.getByTestId("evolve-proposal").or(page.getByTestId("evolve-nothing")).first().scrollIntoViewIfNeeded();
    await screenshot(page, info, "evolve-proposal");

    // nothing was saved, started or changed by the run itself
    const settings = await stored<{ forward?: { accounts?: unknown[] }; evolve?: { proposals?: { decision: string }[]; lineages?: Record<string, { trials: number }> } }>(page, "tj2-settings");
    expect(settings?.forward?.accounts ?? []).toEqual([]);
    expect((settings?.evolve?.proposals ?? []).every((p) => p.decision === "open")).toBe(true);
    const drafts = await stored<{ items?: unknown[] }>(page, "tj2-labor-drafts");
    expect(drafts?.items ?? []).toEqual([]);

    // the protocol drawer
    await page.getByTestId("evolve-protocol-open").click();
    const drawer = page.getByTestId("evolve-protocol");
    await expect(drawer).toBeVisible({ timeout: 20_000 });
    await expect(drawer).toContainText("Varianten getestet");
    await expect(drawer.getByTestId("evolve-protocol-row").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();

    // the learning card is there, with its honesty about missing data
    await scrollUntilVisible(page, page.getByTestId("evolve-learned"));
    await expect(page.getByTestId("evolve-learned")).toContainText("Was habe ich gelernt?");
    await expect(page.getByTestId("evolve-learned")).toContainText("Keine professionelle Finanzberatung");
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "evolve-learned");
    expect(errors).toEqual([]);
  });
});
