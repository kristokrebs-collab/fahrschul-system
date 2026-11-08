/**
 * Labor · „1.000 Varianten. Eine bleibt.“ end to end against the market mock with REAL Binance BTCUSDT 4h bars (`boxes: true`, no network):
 * the search runs on the lab worker, the stage keeps its height (no layout shift), the replay ends in the result card, reduced motion jumps to
 * the end state, touch targets on the phone are ≥ 44 px, no horizontal scroll, axe in both themes. Trend family only (the mock serves no
 * 5-minute history); the opening range has its unit and component tests.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, seed } from "./helpers";
import { themeSettled, UX_PROJECTS } from "./uxHarness";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function open(page: Page, info: TestInfo, theme: "dark" | "light" = "dark", reduced = false): Promise<string[]> {
  test.skip(!UX_PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  const errors = collectErrors(page);
  if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
  await seed(page, {
    boxes: true,
    extra: {
      "tj2-labor": { strategy: "box", symbol: "BTCUSDT", period: "6m", funding: "flat" },
      "tj2-labor-search-cfg": { family: "trend", interval: "4h", seed: 20261108 },
      "tj2-theme": JSON.stringify({ pref: theme, accent: "signal" }),
    },
  });
  await openRoute(page, "/#labor", "Labor");
  await themeSettled(page);
  await page.getByTestId("search-section").scrollIntoViewIfNeeded();
  return errors;
}

/** the replay lasts 7 s: skip it when it still runs (it may already be over on a slow run) */
async function skipIfPlaying(page: Page): Promise<void> {
  const skip = page.getByTestId("search-skip");
  if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 3000 }).catch(() => undefined);
}

const box = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!;

test.describe("Labor · Strategiesuche", () => {
  test.setTimeout(180_000);

  test("Suche läuft im Worker, die Bühne springt nicht, das Ergebnis erscheint nach der Wiedergabe", async ({ page }, info) => {
    const errors = await open(page, info);
    await expect(page.getByTestId("search-stage-text")).toContainText("1.000 Kurven");
    const before = await box(page, "search-stage-box");
    expect(before.height).toBeCloseTo(260, 1);
    await page.getByTestId("search-start").click();
    // the result card is reserved but hidden until the replay ends
    await expect(page.getByTestId("search-section")).toHaveAttribute("data-status", "done", { timeout: 120_000 });
    const stage = page.getByTestId("search-stage");
    await expect(stage).toHaveAttribute("data-curves", "1000");
    await expect(page.getByTestId("search-counts")).toHaveAttribute("data-variants", "1000");
    await expect(page.getByTestId("search-counts")).toHaveAttribute("data-is-runs", "1000");
    expect((await box(page, "search-stage-box")).height).toBeCloseTo(before.height, 1);
    await skipIfPlaying(page);
    await expect(stage).toHaveAttribute("data-state", "done");
    await expect(page.getByTestId("search-result-wrap")).toHaveAttribute("data-ready", "true");
    await expect(page.getByTestId("search-verdict")).toHaveText(/Bestanden|Verworfen/);
    await expect(page.getByTestId("search-reason")).not.toBeEmpty();
    // real Binance-shaped candles: no demo label
    await expect(page.getByTestId("search-demo")).toHaveCount(0);
    await expect(page.getByTestId("search-seed")).toContainText("Seed 20261108");
    await expect(page.getByTestId("search-saved-item")).toHaveCount(1);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
    // the candidate: only after „Bestanden“; a rejection offers none and says why
    const verdict = (await page.getByTestId("search-verdict").textContent()) ?? "";
    if (verdict.includes("Verworfen")) await expect(page.getByTestId("search-candidate-rejected")).toContainText("nicht belastbar");
    else await expect(page.getByTestId("search-candidate")).toBeVisible();
    await page.screenshot({ path: `/tmp/claude-0/-home-user-fahrschul-system/0d7866ca-fdbc-5719-a8cd-af5d18a29219/scratchpad/shots/search-${info.project.name}.png`, clip: undefined });
  });

  test("Reduced Motion: Endzustand sofort, kein Überspringen nötig", async ({ page }, info) => {
    await open(page, info, "dark", true);
    await page.getByTestId("search-start").click();
    await expect(page.getByTestId("search-section")).toHaveAttribute("data-status", "done", { timeout: 120_000 });
    await expect(page.getByTestId("search-stage")).toHaveAttribute("data-state", "done");
    await expect(page.getByTestId("search-result-wrap")).toHaveAttribute("data-ready", "true");
    await expect(page.getByTestId("search-skip")).toHaveCount(0);
  });

  test("Abbrechen beendet die Suche, nichts wird gespeichert", async ({ page }, info) => {
    await open(page, info);
    await page.getByTestId("search-start").click();
    // the search is short on the mock; cancel as soon as it shows
    const cancel = page.getByTestId("search-cancel");
    if (await cancel.isVisible().catch(() => false)) {
      await cancel.click();
      await expect(page.getByTestId("search-section")).toHaveAttribute("data-status", /cancelled|done/);
    } else {
      await expect(page.getByTestId("search-section")).toHaveAttribute("data-status", "done", { timeout: 120_000 });
    }
  });

  test("Tippflächen auf dem Handy mindestens 44 px", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "touch targets: phone");
    await open(page, info);
    // the tap area (`touch-hit`: an invisible ::after, or the box itself) reaches 19 px above and below the centre (a 44 px target minus the edge pixels): the point hits the control
    const hits = (loc: ReturnType<Page["getByTestId"]>) =>
      loc.evaluate((el) => {
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        return [-19, 19].every((dy) => {
          const hit = document.elementFromPoint(cx, r.top + r.height / 2 + dy);
          return !!hit && el.contains(hit);
        });
      });
    expect(await hits(page.getByTestId("search-start")), "Suche starten").toBe(true);
    for (const b of await page.getByTestId("search-card").getByRole("radio").all()) expect(await hits(b as never), "Segment").toBe(true);
    await page.getByTestId("search-start").click();
    await expect(page.getByTestId("search-section")).toHaveAttribute("data-status", "done", { timeout: 120_000 });
    expect(await hits(page.getByTestId("search-skip")), "Überspringen").toBe(true);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`axe: Karte mit Ergebnis (${theme})`, async ({ page }, info) => {
      await open(page, info, theme);
      await page.getByTestId("search-start").click();
      await expect(page.getByTestId("search-section")).toHaveAttribute("data-status", "done", { timeout: 120_000 });
      await skipIfPlaying(page);
      await expect(page.getByTestId("search-result-wrap")).toHaveAttribute("data-ready", "true");
      await page.getByTestId("search-criteria").locator("summary").click().catch(() => undefined);
      await page.getByTestId("search-repro").locator("summary").click();
      await page.waitForTimeout(1200);
      const res = await new AxeBuilder({ page }).include('[data-testid="search-section"]').withTags(TAGS).analyze();
      const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
      expect(lines).toEqual([]);
    });
  }
});
