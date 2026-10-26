/**
 * Zusammenhang & Navigation (Feinschliff, Runde 8), mit echten Klicks, mobil 390 + Desktop:
 *  - die Befehlsnavigation: die fünf Dock-Seiten in Dock-Reihenfolge, dann vier Gruppen nach Aufgabe; die Zahlen 1–5 sind die Dock-
 *    Tabs, 6–9 Handelsplan, Aktien, Risiko, Analyse; "Neu" an den drei jüngsten Seiten, bis sie einmal offen waren;
 *  - die Tasten: `g` + Buchstabe (h, i, f …) und `[` / `]` in der Reihenfolge der Seiten;
 *  - "Siehe auch" zwischen Seiten: ein Klick öffnet die Stelle und bringt die Karte ins Bild;
 *  - der Finder (Menü und Suche `/`) findet die spät gekommenen Bereiche mit Worten des Traders;
 *  - Barrierefreiheit (axe) der Navigation und der Zeilen, dunkel und hell.
 * Keine Uhr-Sprünge, nichts, das an der Zeit der Markt-Mocks hängt.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, seed, toast } from "./helpers";
import { openUx, themeSettled, UX_PROJECTS } from "./uxHarness";

const layer = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"]`);
const navDialog = (page: Page) => page.getByRole("dialog", { name: "Navigation" });

async function openPage(page: Page, key: string): Promise<void> {
  await page.goto(`/#${key}`);
  await expect(layer(page, key).locator("h1").first()).toBeAttached({ timeout: 30_000 });
  await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
}

async function openNav(page: Page) {
  await page.getByRole("button", { name: /Navigation öffnen|Menü/ }).first().click();
  const nav = navDialog(page);
  await expect(nav).toBeVisible();
  return nav;
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
async function expectAccessible(page: Page, include: string, what: string): Promise<void> {
  // entrance animations settle first (contrast is measured on the final colours)
  await page.waitForTimeout(3200);
  const res = await new AxeBuilder({ page }).include(include).withTags(AXE_TAGS).analyze();
  const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(lines, `${what}: axe violations`).toEqual([]);
}

test.describe("Navigation: Reihenfolge, Gruppen, Zahlen, Tasten", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("the pages come in the order of the dock, then in four groups by task; the jüngsten carry 'Neu' until they were opened", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await seed(page);
    await openPage(page, "overview");
    const nav = await openNav(page);
    const pages = nav.getByRole("navigation", { name: "Seiten" });
    const hrefs = await pages.locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs).toEqual(["#overview", "#trades", "#setups", "#markt", "#settings", "#plan", "#aktien", "#risiko", "#analyse", "#berichte", "#coach", "#wachstum", "#labor", "#studio", "#community", "#cockpit", "#konto", "#preise", "#funktionen"]);
    const groups = await nav.getByTestId("cmd-group").evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-group"), name: e.getAttribute("aria-label"), n: e.querySelectorAll("a").length })));
    expect(groups).toEqual([
      { id: "handeln", name: "Planen & Handeln", n: 3 },
      { id: "lernen", name: "Auswerten & Lernen", n: 4 },
      { id: "strategien", name: "Strategien", n: 2 },
      { id: "mehr", name: "Mehr", n: 5 },
    ]);
    // "Neu" on exactly the three newest pages
    const fresh = await nav.getByTestId("cmd-new").evaluateAll((els) => els.map((e) => e.closest("a")?.getAttribute("href")));
    expect(fresh).toEqual(["#plan", "#aktien", "#studio"]);
    await expectNoHorizontalScroll(page);

    // the digits: 1–5 are the dock tabs, 6 is the first page of the groups
    await page.keyboard.press("4");
    await expect(page).toHaveURL(/#markt$/);
    await expect(navDialog(page)).toBeHidden({ timeout: 10_000 });
    const nav2 = await openNav(page);
    await page.keyboard.press("6");
    await expect(page).toHaveURL(/#plan$/);
    await expect(layer(page, "plan").locator("h1").first()).toHaveText("Handelsplan", { timeout: 30_000 });
    await expect(nav2).toBeHidden({ timeout: 10_000 });

    // after the visit "Neu" is gone for the Handelsplan, not for the others
    const nav3 = await openNav(page);
    const fresh2 = await nav3.getByTestId("cmd-new").evaluateAll((els) => els.map((e) => e.closest("a")?.getAttribute("href")));
    expect(fresh2).toEqual(["#aktien", "#studio"]);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("g + letter opens the pages of the late areas; [ and ] walk the pages in their order", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await seed(page);
    await openPage(page, "settings");
    // the shortcut host mounts right after the first commit: press the chord until it is listening
    await expect(async () => {
      await page.locator("body").press("g");
      await page.locator("body").press("h");
      await expect(page).toHaveURL(/#plan$/, { timeout: 1500 });
    }).toPass({ timeout: 15_000 });
    await page.locator("body").press("g");
    await page.locator("body").press("i");
    await expect(page).toHaveURL(/#aktien$/);
    // `]` goes on to the next page in the order of the navigation: Aktien → Risiko → Analyse; `[` goes back
    await page.locator("body").press("]");
    await expect(page).toHaveURL(/#risiko$/);
    await page.locator("body").press("]");
    await expect(page).toHaveURL(/#analyse$/);
    await page.locator("body").press("[");
    await expect(page).toHaveURL(/#risiko$/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the shortcut sheet lists every page's chord in the order of the pages", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await openPage(page, "overview");
    await expect(async () => {
      await page.locator("body").press("?");
      await expect(page.getByRole("dialog", { name: /Tastenkürzel/ })).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15_000 });
    const sheet = page.getByRole("dialog", { name: /Tastenkürzel/ });
    for (const label of ["Zu Handelsplan", "Zu Aktien", "Zu Strategie-Studio", "Zu Funktionen"]) await expect(sheet.getByText(label, { exact: true })).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("Siehe auch: ein Klick bringt dich zur nächsten Karte", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  const CASES: readonly { name: string; page: string; at: string; link: string; to: string; testid: string }[] = [
    { name: "Handelsplan → Aktien-Scanner", page: "plan", at: "plan.page", link: "aktien-scanner", to: "aktien", testid: "aktien-scanner" },
    { name: "Aktien → Handelsplan", page: "aktien", at: "aktien.page", link: "handelsplan-einstieg", to: "plan", testid: "hplan-entry" },
    { name: "Tagesplan → Handelsplan", page: "markt", at: "markt.plan", link: "handelsplan-einstieg", to: "plan", testid: "hplan-entry" },
    { name: "Positionsrechner → Handelsplan", page: "risiko", at: "risiko.calc", link: "handelsplan-groesse", to: "plan", testid: "hplan-size" },
    { name: "Datenarchiv → Squeeze-Beobachtung", page: "settings", at: "settings.archive", link: "squeeze-beobachtung", to: "markt", testid: "markt-squeeze" },
  ];

  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = collectErrors(page);
      await seed(page);
      await openPage(page, c.page);
      const row = layer(page, c.page).locator(`[data-testid="see-also"][data-at="${c.at}"]`);
      await row.scrollIntoViewIfNeeded({ timeout: 20_000 });
      await expect(row).toBeVisible({ timeout: 20_000 });
      // one calm row: at most three links
      expect(await row.locator("button").count()).toBeLessThanOrEqual(3);
      await expectNoHorizontalScroll(page);
      await row.locator(`[data-feature-link="${c.link}"]`).click();
      await expect(page).toHaveURL(new RegExp(`#${c.to}$`));
      await expect(layer(page, c.to).locator("h1").first()).toBeAttached({ timeout: 30_000 });
      await expect(layer(page, c.to).locator(`[data-testid="${c.testid}"]`).first()).toBeInViewport({ timeout: 20_000 });
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }

  test("the help card names the new areas and opens them; the demo button is there", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await seed(page);
    await openPage(page, "settings");
    const news = layer(page, "settings").getByTestId("onboarding-news");
    await news.scrollIntoViewIfNeeded();
    await expect(news).toBeVisible();
    for (const name of ["Handelsplan", "Aktien", "Zeitmaschine", "Datenarchiv"]) await expect(news.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
    await expect(layer(page, "settings").getByTestId("onboarding-demo")).toBeVisible();
    await news.locator('[data-feature-link="handelsplan-einstieg"]').click();
    await expect(page).toHaveURL(/#plan$/);
    await expect(layer(page, "plan").getByTestId("hplan-entry")).toBeInViewport({ timeout: 20_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("Finder: die spät gekommenen Bereiche in den Worten des Traders", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  interface Goal {
    query: string;
    feature: string;
    page?: string;
    testid?: string;
    dialog?: string;
  }
  const GOALS: readonly Goal[] = [
    { query: "Kongress", feature: "aktien-kongress", page: "aktien", testid: "aktien-kongress" },
    { query: "Zeitmaschine", feature: "zeitmaschine", page: "labor", testid: "tm-section" },
    { query: "Datenarchiv", feature: "datenarchiv", page: "settings", testid: "settings-archive-card" },
    { query: "Aktien scannen", feature: "aktien-scanner", page: "aktien", testid: "aktien-scanner" },
    { query: "Verwaltung planen", feature: "verwaltung-planen", page: "plan", testid: "hplan-exit" },
    { query: "Demo ausprobieren", feature: "produktdemo", dialog: "Demo mit Beispieldaten" },
  ];

  for (const g of GOALS) {
    test(`Menü-Finder: „${g.query}“`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = collectErrors(page);
      await seed(page);
      await openPage(page, "overview");
      const nav = await openNav(page);
      await nav.getByRole("searchbox", { name: "Was willst du tun?" }).fill(g.query);
      const hits = nav.getByTestId("nav-finder-results").locator("[data-feature]");
      await expect(hits.first()).toBeVisible({ timeout: 15_000 });
      await expect(hits.first()).toHaveAttribute("data-feature", g.feature);
      await hits.first().click();
      if (g.dialog) {
        await expect(page.getByRole("dialog", { name: g.dialog })).toBeVisible({ timeout: 20_000 });
      } else {
        await expect(page).toHaveURL(new RegExp(`#${g.page}$`));
        await expect(layer(page, g.page!).locator(`[data-testid="${g.testid}"]`).first()).toBeInViewport({ timeout: 25_000 });
      }
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }

  test("the search (/) finds 'Handelsplan erstellen' among the functions and opens the plan", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await seed(page);
    await openPage(page, "overview");
    await page.locator("body").press("/");
    const dialog = page.getByRole("dialog", { name: "Suche" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("combobox", { name: "Suche" }).fill("Handelsplan erstellen");
    const feature = dialog.locator('[role="option"][data-search-kind="feature"]').first();
    await expect(feature).toBeVisible({ timeout: 15_000 });
    await expect(feature).toContainText("Handelsplan");
    await expectNoHorizontalScroll(page);
    await feature.click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/#plan$/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("nonsense finds nothing sure – and says so", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await seed(page);
    await openPage(page, "overview");
    const nav = await openNav(page);
    await nav.getByRole("searchbox", { name: "Was willst du tun?" }).fill("Pizza bestellen");
    await expect(nav.getByTestId("nav-finder-results")).toBeVisible({ timeout: 15_000 });
    await expect(nav.getByTestId("nav-finder-results").locator("[data-feature]")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the assistant opens a function from 'Starte die Demo' and says where the late areas are", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await seed(page);
    await openPage(page, "overview");
    await page.getByTestId("assistant-button").click();
    const sheet = page.getByRole("dialog", { name: "Assistent" });
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await sheet.getByTestId("assistant-input").fill("Starte die Demo");
    await sheet.getByTestId("assistant-send").click();
    await expect(page.getByRole("dialog", { name: "Demo mit Beispieldaten" })).toBeVisible({ timeout: 20_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("Barrierefreiheit der Navigation und der Siehe-auch-Zeilen (axe)", () => {
  test.setTimeout(150_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  for (const theme of ["dark", "light"] as const) {
    test(`Befehlsnavigation mit Gruppen und Neu-Marken (${theme})`, async ({ page }) => {
      await openUx(page, "app", "overview", { theme });
      await themeSettled(page);
      await openNav(page);
      await expectAccessible(page, '[role="dialog"][aria-label="Navigation"]', "Navigation");
    });

    test(`Siehe-auch-Zeile unter dem Seitenkopf (${theme})`, async ({ page }) => {
      await openUx(page, "app", "aktien", { theme });
      await themeSettled(page);
      const row = layer(page, "aktien").locator('[data-testid="see-also"][data-at="aktien.page"]');
      await expect(row).toBeVisible({ timeout: 25_000 });
      await expectAccessible(page, '[data-testid="see-also"][data-at="aktien.page"]', "Siehe auch");
    });

    test(`Karte Einführung & Hilfe mit Neu-in-der-App-Zeile (${theme})`, async ({ page }) => {
      await openUx(page, "cards", "", { theme });
      await themeSettled(page);
      const news = page.getByTestId("onboarding-news");
      await news.scrollIntoViewIfNeeded();
      await expect(news).toBeVisible({ timeout: 25_000 });
      await expectAccessible(page, '[data-testid="onboarding-news"]', "Neu in der App");
    });
  }
});

test.describe("Hinweis zur Zustellung", () => {
  test("a function without its page present says so in a toast (no dead end)", async ({ page }, info) => {
    test.skip(!UX_PROJECTS.includes(info.project.name), "runs on mobile + desktop");
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await seed(page);
    await openPage(page, "overview");
    const nav = await openNav(page);
    await nav.getByRole("searchbox", { name: "Was willst du tun?" }).fill("Ergebnisbeleg");
    const hits = nav.getByTestId("nav-finder-results").locator("[data-feature]");
    await expect(hits.first()).toHaveAttribute("data-feature", "ergebnisbeleg", { timeout: 15_000 });
    await hits.first().click();
    // without the cloud the place is not there: the page opens and one honest sentence says why
    await expect(page).toHaveURL(/#community$/);
    await expect(toast(page).filter({ hasText: /Cloud|Konto|nicht sichtbar|Stelle/ }).first()).toBeVisible({ timeout: 20_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
