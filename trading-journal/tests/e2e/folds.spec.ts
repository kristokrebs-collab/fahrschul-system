/**
 * "Mehr anzeigen" (Etappe 1c, Seiten kürzen): the rarely used cards of Markt, Einstellungen and Berichte are folded into one row
 * each (`Fold`, a native `details`). Nothing is gone: the card stays in the DOM, the register's anchor opens the fold before it
 * scrolls there, a tap on the row opens it, the choice survives a reload. Specs that are not about folds start with every fold
 * open (`seed`), these start closed (`foldsClosed`), as a first visit sees the pages.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, seed } from "./helpers";

const PROJECTS = ["mobile", "desktop"];

const layer = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"]`);

interface Goal {
  feature: string;
  name: string;
  page: string;
  fold: string;
  testid?: string;
  heading?: string;
}

const GOALS: readonly Goal[] = [
  { feature: "squeeze-beobachtung", name: "Squeeze-Beobachtung", page: "markt", fold: "markt-squeeze", testid: "markt-squeeze" },
  { feature: "struktur", name: "Preis- & RSI-Struktur", page: "markt", fold: "markt-trend", testid: "markt-trend" },
  { feature: "aehnliche-situationen", name: "Ähnliche Situationen", page: "markt", fold: "markt-similar", testid: "markt-similar" },
  { feature: "alarme", name: "Alarme", page: "markt", fold: "markt-alarme", testid: "alerts-card" },
  { feature: "ereignisphasen", name: "Ereignisphasen", page: "markt", fold: "markt-phasen", testid: "phasen-card" },
  { feature: "box-einstellungen", name: "Box-Einstellungen", page: "markt", fold: "markt-box-settings", testid: "markt-settings" },
  { feature: "datenstatus", name: "Datenstatus", page: "settings", fold: "settings-live", heading: "Live-Daten" },
  { feature: "hyblock", name: "Hyblock-Connector", page: "settings", fold: "settings-hyblock", heading: "Hyblock-Connector" },
  { feature: "datenarchiv", name: "Datenarchiv", page: "settings", fold: "settings-archive", testid: "settings-archive-card" },
  { feature: "version-speicher", name: "Version & Speicher", page: "settings", fold: "settings-storage", testid: "settings-storage-card" },
  { feature: "transaktionsbuch", name: "Transaktionsbuch", page: "berichte", fold: "berichte-ledger", testid: "ledger-card" },
];

test.describe("Mehr anzeigen: eingeklappte Karten", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  for (const g of GOALS) {
    test(`${g.name}: der Funktionsfinder öffnet die Karte und scrollt hin`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = collectErrors(page);
      await seed(page, { foldsClosed: true });
      // warm up: the page's lazy chunks (Squeeze, Struktur, Termine …) are fetched once, so the jump below is about the fold, not about a slow chunk
      await page.goto(`/#${g.page}`);
      const anchor = g.testid ? layer(page, g.page).locator(`[data-testid="${g.testid}"]`) : layer(page, g.page).locator("h2, h3").filter({ hasText: new RegExp(`^\\s*${g.heading}`) });
      await expect(anchor.first()).toBeAttached({ timeout: 60_000 });
      await page.evaluate(() => (location.hash = "#funktionen"));
      await expect(layer(page, "funktionen").locator("h1").first()).toHaveText("Funktionen", { timeout: 25_000 });
      await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 25_000 });
      await layer(page, "funktionen").getByRole("searchbox", { name: "Was willst du tun?" }).fill(g.name);
      const hit = page.getByTestId("funktionen-results").locator(`[data-feature="${g.feature}"]`);
      await expect(hit).toBeVisible({ timeout: 15_000 });
      await hit.getByTestId("feature-open").click();
      await expect(page).toHaveURL(new RegExp(`#${g.page}$`));
      const fold = layer(page, g.page).locator(`details[data-fold="${g.fold}"]`);
      await expect(fold, "die Karte ist aufgeklappt").toHaveAttribute("open", "", { timeout: 20_000 });
      const target = g.testid
        ? layer(page, g.page).locator(`[data-testid="${g.testid}"]`).first()
        : layer(page, g.page).locator("h2, h3").filter({ hasText: new RegExp(`^\\s*${g.heading}`) }).first();
      await expect(target, `${g.name}: Ziel sichtbar`).toBeInViewport({ timeout: 20_000 });
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }

  test("Markt: zu Beginn alle zu, eine Zeile je Karte, ein Tipp klappt auf und zu, Reload merkt es sich", async ({ page }, info) => {
    test.setTimeout(90_000);
    await seed(page, { foldsClosed: true });
    await page.goto("/#markt");
    await expect(layer(page, "markt").locator("h1").first()).toHaveText("Markt", { timeout: 25_000 });
    await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 25_000 });
    const folds = layer(page, "markt").locator("details[data-fold]");
    // the Ereignisphasen come with the lazy Termine chunk
    await expect.poll(() => folds.count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(6);
    for (const f of await folds.all()) await expect(f).not.toHaveAttribute("open", "");

    const similar = layer(page, "markt").locator('details[data-fold="markt-similar"]');
    const row = similar.locator("summary");
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    expect(box!.height, "Zeile mindestens 44 px hoch").toBeGreaterThanOrEqual(44);
    await expect(layer(page, "markt").getByTestId("markt-similar")).toBeHidden();

    await row.click();
    await expect(similar).toHaveAttribute("open", "");
    await expect(layer(page, "markt").getByTestId("markt-similar")).toBeVisible();
    await expect(row).toContainText("Zuklappen: Ähnliche Situationen");
    await expectNoHorizontalScroll(page);

    // reload: the choice is kept
    await page.reload();
    await expect(layer(page, "markt").locator("h1").first()).toHaveText("Markt", { timeout: 25_000 });
    await expect(layer(page, "markt").locator('details[data-fold="markt-similar"]')).toHaveAttribute("open", "", { timeout: 15_000 });
    await expect(layer(page, "markt").locator('details[data-fold="markt-trend"]')).not.toHaveAttribute("open", "");

    // and closes again
    await layer(page, "markt").locator('details[data-fold="markt-similar"] > summary').click();
    await expect(layer(page, "markt").locator('details[data-fold="markt-similar"]')).not.toHaveAttribute("open", "");
    void info;
  });

  test("Tastatur: Enter auf der Zeile klappt auf, der Fokusring ist da", async ({ page }) => {
    test.setTimeout(90_000);
    await seed(page, { foldsClosed: true });
    await page.goto("/#settings");
    await expect(layer(page, "settings").locator("h1").first()).toBeAttached({ timeout: 30_000 });
    const fold = layer(page, "settings").locator('details[data-fold="settings-storage"]');
    const row = fold.locator("summary");
    await row.scrollIntoViewIfNeeded();
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(fold).toHaveAttribute("open", "");
  });
});
