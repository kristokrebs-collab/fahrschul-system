/**
 * Funktionsfinder, mit echten Klicks (Selbstprüfung): fünfzehn typische Ziele, gesucht in den Worten des Traders – einmal im
 * Suchfeld der Seite „Funktionen“, einmal im Finder der Befehlsnavigation (Menü). Der erste Treffer ist die erwartete
 * Funktion, ein Klick öffnet ihren Ort, und der Zielabschnitt steht danach wirklich im sichtbaren Bereich (oder, bei
 * Sheets, der Dialog ist offen). Ein Abschnitt, der erst nach einem Lauf entsteht, sagt das ehrlich in einer Meldung.
 * Keine Uhr-Sprünge, nichts, das an der Zeit der Markt-Mocks hängt.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, seed, toast } from "./helpers";

const PROJECTS = ["mobile", "desktop"];

interface Goal {
  name: string;
  query: string;
  /** id of the register entry that must be the first hit */
  feature: string;
  /** page the place lives on */
  page?: string;
  /** `data-testid` of the target section … */
  testid?: string;
  /** … or the start of its card heading */
  heading?: string;
  /** a sheet that must be open instead of a section */
  dialog?: string;
  /** the section only exists after an action: the honest toast says so */
  toast?: RegExp;
}

const GOALS: readonly Goal[] = [
  { name: "Strategie als Text", query: "Strategie als Text", feature: "strategie-studio", page: "studio", testid: "studio-editor" },
  { name: "Muster der Gewinner", query: "Muster der Gewinner", feature: "muster-entdecker", page: "labor", testid: "labor-discovery" },
  { name: "Optimierer", query: "Optimierer", feature: "hintergrund-optimierer", page: "labor", testid: "evolve-panel" },
  { name: "Screenshot importieren", query: "Screenshot importieren", feature: "screenshot-ocr", dialog: "Screenshot importieren" },
  { name: "Risiko berechnen", query: "Risiko berechnen", feature: "positionsrechner", page: "risiko", testid: "risk-calc" },
  { name: "Wochenbericht", query: "Wochenbericht", feature: "berichte", page: "berichte", testid: "berichte-view" },
  { name: "TradingView-Skript", query: "TradingView-Skript", feature: "pine-export", page: "labor", testid: "labor-pine" },
  { name: "Check-in", query: "Check-in", feature: "checkin", page: "wachstum", testid: "growth-checkin" },
  { name: "Schlüsselmarken", query: "Schlüsselmarken", feature: "schluesselmarken", page: "markt", testid: "keylevels-card" },
  { name: "Backtest", query: "Backtest", feature: "labor", page: "labor", testid: "labor-view" },
  { name: "Stresstest", query: "Stresstest", feature: "belastungstest", page: "labor", toast: /Belastung/ },
  { name: "Vorwärtstest", query: "Vorwärtstest", feature: "forward-test", page: "labor", testid: "forward-section" },
  { name: "Assistent", query: "Assistent", feature: "assistent", dialog: "Assistent" },
  { name: "Trainings-Modus", query: "Trainings-Modus", feature: "ueben", dialog: "Üben" },
  { name: "Backup", query: "Backup", feature: "backup", page: "settings", testid: "settings-data" },
];

const layer = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"]`);

async function expectPlace(page: Page, g: Goal): Promise<void> {
  if (g.dialog) {
    await expect(page.getByRole("dialog", { name: g.dialog })).toBeVisible({ timeout: 20_000 });
    return;
  }
  await expect(page).toHaveURL(new RegExp(`#${g.page}$`));
  await expect(layer(page, g.page!).locator("h1").first()).toBeAttached({ timeout: 30_000 });
  if (g.toast) {
    await expect(toast(page).filter({ hasText: g.toast })).toBeVisible({ timeout: 15_000 });
    return;
  }
  const target = g.testid ? layer(page, g.page!).locator(`[data-testid="${g.testid}"]`).first() : layer(page, g.page!).locator("h2, h3").filter({ hasText: new RegExp(`^\\s*${g.heading}`) }).first();
  await expect(target, `${g.name}: Zielabschnitt sichtbar`).toBeInViewport({ timeout: 20_000 });
}

test.describe("Funktionsfinder: fünfzehn Ziele mit echten Klicks", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  for (const g of GOALS) {
    test(`Seite „Funktionen“ – ${g.name}`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = collectErrors(page);
      await seed(page);
      await page.goto("/#funktionen");
      await expect(layer(page, "funktionen").locator("h1").first()).toHaveText("Funktionen", { timeout: 25_000 });
      await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 25_000 });
      await layer(page, "funktionen").getByRole("searchbox", { name: "Was willst du tun?" }).fill(g.query);
      const hits = page.getByTestId("funktionen-results").locator("[data-feature]");
      await expect(hits.first()).toBeVisible({ timeout: 15_000 });
      await expect(hits.first()).toHaveAttribute("data-feature", g.feature);
      await hits.first().getByTestId("feature-open").click();
      await expectPlace(page, g);
      expect(errors, errors.join("\n")).toEqual([]);
    });

    test(`Menü-Finder – ${g.name}`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = collectErrors(page);
      await seed(page);
      await page.goto("/#overview");
      await expect(layer(page, "overview").locator("h1").first()).toBeAttached({ timeout: 25_000 });
      await page.getByRole("button", { name: /Navigation öffnen|Menü/ }).first().click();
      const nav = page.getByRole("dialog", { name: "Navigation" });
      await expect(nav).toBeVisible();
      await nav.getByRole("searchbox", { name: "Was willst du tun?" }).fill(g.query);
      const hits = nav.getByTestId("nav-finder-results").locator("[data-feature]");
      await expect(hits.first()).toBeVisible({ timeout: 15_000 });
      await expect(hits.first()).toHaveAttribute("data-feature", g.feature);
      await hits.first().click();
      await expectPlace(page, g);
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }
});
