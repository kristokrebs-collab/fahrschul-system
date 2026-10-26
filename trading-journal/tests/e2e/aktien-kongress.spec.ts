/**
 * The Congress tracker end to end on the routed page `/#aktien` of the production build, with the two functions answered from the
 * specs (`mocks/congress.ts`: the rows are those of REAL House Clerk PDFs, the dates are moved relative to today – no clock jumps,
 * nothing here depends on the day it runs):
 *
 * - the section reads the reports once it is on screen, and shows the rows: member, owner, asset, ticker, side, option strike and
 *   expiry, trade and filing day, the delay in days, the amount range and the link to the PDF; the caveats and the Senate route are
 *   on screen all the time;
 * - the filters (member, ticker, buy / sell), the watchlist mark, "neu seit deinem letzten Besuch", a click on a ticker selects it
 *   on the page; a scanned paper form is "Nicht lesbar" with its link;
 * - the honest failure: a Clerk that is down is named with its reason and retried by one click;
 * - mobile + desktop: no horizontal scroll, touch targets ≥ 44 px on a coarse pointer, no console errors, axe (WCAG 2.1 A + AA incl.
 *   contrast, dark and light).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, seed, stored } from "./helpers";
import { mockCongress, WORLD } from "./mocks/congress";

const PROJECTS = ["mobile", "desktop"];
const SHOTS = process.env.AKTIEN_SHOTS_DIR;

async function open(page: Page, info: TestInfo, extra: Record<string, unknown> = {}): Promise<string[]> {
  test.skip(!PROJECTS.includes(info.project.name), "the Congress tracker runs on mobile + desktop");
  const errors = collectErrors(page);
  await seed(page, { extra });
  return errors;
}

async function go(page: Page): Promise<void> {
  await openRoute(page, "/#aktien", "Aktien");
  await expect(page.getByTestId("aktien-scanner")).toBeVisible();
  // the section comes into view like a trader's: through the section strip
  await page.getByRole("navigation", { name: "Inhalt dieser Seite" }).getByRole("button", { name: "Kongress" }).click();
  await expect(page.getByTestId("kongress-caveats")).toBeVisible();
}

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.getByTestId("aktien-kongress").scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  const width = info.project.use.viewport?.width ?? 0;
  await page.getByTestId("aktien-kongress").screenshot({ path: `${SHOTS}/${name}-${width}.png` });
}

const rows = (page: Page) => page.getByTestId("kongress-row");
/** the card has read every report it was asked for */
const readAll = async (page: Page, n: number): Promise<void> => {
  await expect(page.getByTestId("kongress-progress")).toContainText(`gelesen: ${n} von ${n}`, { timeout: 30_000 });
  await expect(page.getByTestId("kongress-refresh")).toBeEnabled();
};

test.describe("Kongress-Tracker", () => {
  test.setTimeout(120_000);

  test("liest die Meldungen und zeigt jede Zeile mit Eigentümer, Wertpapier, Art, Strike, Daten, Verzug, Spanne und Link", async ({ page }, info) => {
    const errors = await open(page, info);
    const mock = await mockCongress(page);
    await go(page);
    await readAll(page, WORLD.length);
    // the index first, then the reports newest first, four at a time
    expect(mock.calls[0]).toMatch(/^index:\d{4}$/);
    expect(mock.calls.filter((c) => c.startsWith("ptr:")).flatMap((c) => c.slice(4).split(","))).toEqual(["20035143", "9000001", "20035408", "20035024", "20034694"]);

    // the caveats and the Senate route are on screen all the time
    const cav = page.getByTestId("kongress-caveats");
    await expect(cav).toContainText("bis zu 45 Tage");
    await expect(cav).toContainText("Beträge sind Spannen");
    await expect(cav).toContainText("Mitglied ist nicht gleich Absicht");
    await expect(cav).toContainText("Die App sendet nie Orders");
    await expect(page.getByTestId("kongress-senate").getByRole("link", { name: /efdsearch\.senate\.gov/ })).toHaveAttribute("href", "https://efdsearch.senate.gov/search/");
    await expect(page.getByTestId("aktien-kongress").getByTestId("aktien-note")).toContainText("Keine professionelle Finanzberatung.");
    await expect(page.getByTestId("kongress-stand")).toContainText("Quelle: House Clerk");

    // one member: the skill's example, row by row
    await page.getByTestId("kongress-member").fill("pelosi");
    await expect(rows(page)).toHaveCount(7);
    const call = rows(page).filter({ has: page.getByTestId("kongress-option") }).first();
    await expect(call.getByTestId("kongress-who")).toContainText("Nancy Pelosi · CA11 · Ehepartner");
    await expect(call.getByTestId("kongress-ticker")).toHaveText(/BE/);
    await expect(call).toContainText("Kauf");
    await expect(call.getByTestId("kongress-option")).toHaveText("Call · 100 Kontrakte · Strike $100 · Verfall 17.06.2027");
    await expect(call.getByTestId("kongress-delay")).toHaveText("28 Tage");
    await expect(call.getByTestId("kongress-amount")).toHaveText("$1,000,001 – $5,000,000");
    await expect(call).toContainText("Betrag (Spanne)");
    await expect(call.getByTestId("kongress-pdf")).toHaveAttribute("href", /^https:\/\/disclosures-clerk\.house\.gov\/public_disc\/ptr-pdfs\/\d{4}\/20035143\.pdf$/);
    await expect(call.getByTestId("kongress-description")).toContainText("expiration date of 6/17/27");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "kongress-1-pelosi");
    expect(errors).toEqual([]);
  });

  test("Filter: Ticker, Kauf und Verkauf, Watchlist-Markierung, ein Klick auf den Ticker wählt ihn auf der Seite", async ({ page }, info) => {
    const errors = await open(page, info);
    // the stock functions of the watchlist card answer minimally (a quote and no headlines): only the list matters here
    await page.route(/\/api\/v1\/stocks\/(quote|news)/, async (route) => {
      const u = new URL(route.request().url());
      const symbols = (u.searchParams.get("symbols") ?? "").split(",").filter(Boolean);
      const isQuote = u.pathname.endsWith("/quote");
      const results = Object.fromEntries(symbols.map((s) => [s, isQuote ? { ok: true, name: `${s} Corp.`, currency: "USD", exchange: "NasdaqGS", price: 50, prevClose: 49, change: 1, changePct: 2, dayHigh: 51, dayLow: 48, volume: 1000, fiftyTwoWeekHigh: 60, fiftyTwoWeekLow: 40, marketTime: Date.now() - 3_600_000 } : { ok: true, items: [] }]));
      return route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ source: isQuote ? "yahoo" : "yahoo-rss", fetchedAt: Date.now(), results }) });
    });
    await mockCongress(page);
    await openRoute(page, "/#aktien", "Aktien");
    await page.getByTestId("aktien-watch-input").fill("intc");
    await page.getByTestId("aktien-watch-add").click();
    await expect(page.locator('[data-testid="aktien-watch-row"][data-symbol="INTC"]')).toBeVisible();
    await page.getByRole("navigation", { name: "Inhalt dieser Seite" }).getByRole("button", { name: "Kongress" }).click();
    await expect(page.getByTestId("kongress-caveats")).toBeVisible();
    await readAll(page, WORLD.length);

    await page.getByTestId("kongress-query").fill("INTC");
    await expect(rows(page)).toHaveCount(2);
    for (const r of await rows(page).all()) {
      await expect(r).toHaveAttribute("data-watched", "1");
      await expect(r).toContainText("Auf deiner Watchlist");
    }
    await page.getByTestId("kongress-query").fill("");
    await page.getByTestId("kongress-member").fill("pelosi");
    await expect(rows(page)).toHaveCount(7);
    await page.getByTestId("kongress-chip-watch").click();
    await expect(rows(page)).toHaveCount(2);
    await page.getByTestId("kongress-chip-watch").click();
    await page.getByRole("radio", { name: "Verkauf" }).click();
    await expect(page.getByTestId("kongress-nomatch")).toBeVisible(); // all of Pelosi's rows are purchases
    await page.getByRole("radio", { name: "Kauf" }).click();
    await expect(rows(page)).toHaveCount(7);

    // a click on the ticker selects it on the page
    await rows(page).first().getByTestId("kongress-ticker").click();
    await expect(page.getByTestId("kongress-selected")).toContainText("Auf der Seite gewählt:");
    await expect(rows(page).first().getByTestId("kongress-ticker")).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  });

  test("ein eingescanntes Papierformular ist „Nicht lesbar“ mit Grund und Link zum Original – nichts wird geraten", async ({ page }, info) => {
    const errors = await open(page, info);
    await mockCongress(page);
    await go(page);
    await readAll(page, WORLD.length);
    const bad = page.locator('[data-testid="kongress-row"][data-kind="unreadable"]');
    await expect(bad).toHaveCount(1);
    await expect(bad).toContainText("Nicht lesbar");
    await expect(bad).toContainText("Sam Scanner");
    await expect(bad).toContainText("Papierformular");
    await expect(bad.getByTestId("kongress-pdf")).toHaveAttribute("href", /9000001\.pdf$/);
    await page.getByTestId("kongress-chip-ticker").click();
    await expect(page.getByTestId("kongress-hidden-unreadable")).toContainText("1 nicht lesbare Zeile ist durch deine Filter ausgeblendet");
    expect(errors).toEqual([]);
  });

  test("„Neu seit deinem letzten Besuch“: nur, was der Index beim letzten Besuch noch nicht kannte", async ({ page }, info) => {
    const errors = await open(page, info, { "tj2-aktien-kongress-seen": { at: Date.now() - 86_400_000, docIds: ["20035408", "20035024", "20034694", "9000001"] } });
    await mockCongress(page);
    await go(page);
    await readAll(page, WORLD.length);
    await expect(page.getByTestId("kongress-visit")).toContainText("1 Meldung neu seit deinem letzten Besuch");
    await page.getByTestId("kongress-chip-new").click();
    await expect(rows(page)).toHaveCount(7);
    for (const r of await rows(page).all()) await expect(r).toHaveAttribute("data-new", "1");
    await page.getByTestId("kongress-markseen").click();
    await expect(page.getByTestId("kongress-visit")).toContainText("Nichts Neues seit deinem letzten Besuch");
    const seen = await stored<{ docIds: string[] }>(page, "tj2-aktien-kongress-seen");
    expect(seen?.docIds).toContain("20035143");
    expect(errors).toEqual([]);
  });

  test("ein House Clerk, der nicht antwortet, wird mit Grund benannt – und ein Klick versucht es noch einmal", async ({ page }, info) => {
    const errors = await open(page, info);
    const mock = await mockCongress(page);
    mock.failIndex = { status: 502, code: "congress_upstream", message: "Der House Clerk antwortete mit einem Fehler (HTTP 503)." };
    await go(page);
    const err = page.getByTestId("kongress-error");
    await expect(err).toBeVisible({ timeout: 20_000 });
    await expect(err).toContainText("Der House Clerk lässt sich gerade nicht lesen");
    await expect(err).toContainText("HTTP 503");
    await expect(err).toContainText("Behördenseite ohne Zusage");
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByTestId("kongress-caveats")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, info, "kongress-2-ausfall");
    mock.failIndex = null;
    await page.getByTestId("kongress-retry").click();
    await readAll(page, WORLD.length);
    await expect(err).toHaveCount(0);
    expect(errors.filter((e) => !/503|502/.test(e))).toEqual([]);
  });

  test("Layout: keine Seite breiter als der Bildschirm, Touch-Ziele mindestens 44 px", async ({ page }, info) => {
    const errors = await open(page, info);
    await mockCongress(page);
    await go(page);
    await readAll(page, WORLD.length);
    await expectNoHorizontalScroll(page);
    if (info.project.name === "mobile") {
      const targets = [page.getByTestId("kongress-chip-watch"), page.getByTestId("kongress-chip-new"), page.getByTestId("kongress-chip-ticker"), page.getByTestId("kongress-refresh"), rows(page).first().getByTestId("kongress-ticker"), rows(page).first().getByTestId("kongress-pdf")];
      for (const t of targets) {
        await t.scrollIntoViewIfNeeded();
        const box = await t.boundingBox();
        expect(box?.height ?? 0, await t.innerText()).toBeGreaterThanOrEqual(43.5);
      }
    }
    await shot(page, info, "kongress-0-liste");
    expect(errors).toEqual([]);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`Barrierefreiheit mit Zeilen, „Nicht lesbar“ und Filtern (axe, ${theme === "dark" ? "dunkles" : "helles"} Thema)`, async ({ page }, info) => {
      const errors = await open(page, info, { "tj2-theme": JSON.stringify(theme) });
      await mockCongress(page);
      await go(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await readAll(page, WORLD.length);
      await expect(rows(page).first()).toBeVisible();
      const results = await new AxeBuilder({ page }).include('[data-testid="aktien-kongress"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
});
