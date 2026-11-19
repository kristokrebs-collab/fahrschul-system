/**
 * Funktionsfinder, mit echten Klicks (Selbstprüfung): fünfzehn typische Ziele plus die vier Aufgaben „Trade suchen“, „Screenshot finden“, „Alarm konfigurieren“, „Simulation öffnen“ (Runde 12), gesucht in den Worten des Traders – einmal im
 * Suchfeld der Seite „Funktionen“, einmal im Finder der Befehlsnavigation (Menü). Der erste Treffer ist die erwartete
 * Funktion, ein Klick öffnet ihren Ort, und der Zielabschnitt steht danach wirklich im sichtbaren Bereich (oder, bei
 * Sheets, der Dialog ist offen). Ein Abschnitt, der erst nach einem Lauf entsteht, sagt das ehrlich im Fundort-Hinweis (A4: kein
 * Toast). Keine Uhr-Sprünge, nichts, das an der Zeit der Markt-Mocks hängt.
 *
 * A4 (Suche bis zur Aufgabe), im Menü-Finder mit echten Klicks:
 *   - zwanzig Alltagsfragen (`tests/fixtures/everydayQuestions.ts`): erster Treffer, Landung, kein Toast;
 *   - Seiten als Treffer ("Einstellungen" → Seite, Fokus auf der Überschrift);
 *   - Tastatur: ↑ ↓ Enter Esc, Combobox-Zustände (aria-activedescendant, aria-expanded);
 *   - verdecktes Ziel: zugeklappte Karte (Fold) und eine Auswahl, die erst den Baukasten zeigt, werden geöffnet und fokussiert;
 *   - Touch-Ziele des Finders ≥ 44 px (mobil).
 * Die Rückführung nach dem Login steht in `funktionsfinder-rueckkehr.spec.ts` (Cloud-Build mit Supabase-Mock).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { EVERYDAY_QUESTIONS } from "../fixtures/everydayQuestions";
import { collectErrors, hasTouch, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";

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
  /** the section only exists after an action (or here): the arrival note ("Fundort-Hinweis", no toast) says so */
  note?: RegExp;
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
  { name: "Stresstest", query: "Stresstest", feature: "belastungstest", page: "labor", note: /Belastung/ },
  { name: "Vorwärtstest", query: "Vorwärtstest", feature: "forward-test", page: "labor", testid: "forward-section" },
  { name: "Assistent", query: "Assistent", feature: "assistent", dialog: "Assistent" },
  { name: "Trainings-Modus", query: "Trainings-Modus", feature: "ueben", dialog: "Üben" },
  { name: "Backup", query: "Backup", feature: "backup", page: "settings", testid: "settings-data" },
  // Runde 12: die vier Aufgaben des Auftrags (Abschnitt 5) – gesucht als Tätigkeit, gelandet am Ziel
  { name: "Trade suchen", query: "Trade suchen", feature: "trade-filter", page: "trades", testid: "trades-search" },
  { name: "Screenshot finden", query: "Screenshot finden", feature: "bild-originale", page: "settings", note: /Screenshot/ },
  { name: "Alarm konfigurieren", query: "Alarm konfigurieren", feature: "alarme", page: "markt", testid: "alerts-card" },
  { name: "Simulation öffnen", query: "Simulation öffnen", feature: "zeitmaschine", page: "labor", testid: "tm-section" },
];

const layer = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"]`);

/** Where a hit must land: a sheet, a section of a page, the page itself (its heading takes the focus), or a page + the arrival note. */
interface Place {
  page?: string;
  testid?: string;
  heading?: string;
  dialog?: string;
  note?: RegExp;
}

const arrivalNote = (page: Page) => page.getByTestId("arrival-note");

/** The toast island is one live region that is always in the DOM (empty at rest; pages have live regions of their own, so it is addressed by its marker): "no toast" means it says nothing. */
const noToast = (page: Page, what = "kein Toast") => expect(page.locator("[data-toast-island]").filter({ hasText: /\S/ }), what).toHaveCount(0);

async function expectPlace(page: Page, g: Place & { name?: string; q?: string }): Promise<void> {
  const what = g.name ?? g.q ?? "Ziel";
  if (g.dialog) {
    await expect(page.getByRole("dialog", { name: g.dialog }), `${what}: Dialog offen`).toBeVisible({ timeout: 20_000 });
    await noToast(page, `${what}: kein Toast`);
    return;
  }
  await expect(page).toHaveURL(new RegExp(`#${g.page}$`));
  await expect(layer(page, g.page!).locator("h1").first()).toBeAttached({ timeout: 30_000 });
  if (g.note) {
    // the card is not there (after a run, needs an account …): the person stands on the page, the note says why, and it is no toast
    await expect(arrivalNote(page).filter({ hasText: g.note }), `${what}: Fundort-Hinweis`).toBeVisible({ timeout: 20_000 });
    await noToast(page, `${what}: kein Toast`);
    return;
  }
  if (!g.testid && !g.heading) {
    // a page as target: its heading has the focus (a screen reader starts there)
    await expect(layer(page, g.page!).locator("h1").first(), `${what}: Fokus auf der Seitenüberschrift`).toBeFocused({ timeout: 20_000 });
    await noToast(page, `${what}: kein Toast`);
    return;
  }
  const target = g.testid ? layer(page, g.page!).locator(`[data-testid="${g.testid}"]`).first() : layer(page, g.page!).locator("h2, h3").filter({ hasText: new RegExp(`^\\s*${g.heading}`) }).first();
  await expect(target, `${what}: Zielabschnitt sichtbar`).toBeInViewport({ timeout: 20_000 });
  await noToast(page, `${what}: kein Toast`);
}

async function openMenuFinder(page: Page): Promise<Locator> {
  await page.goto("/#overview");
  await expect(layer(page, "overview").locator("h1").first()).toBeAttached({ timeout: 25_000 });
  await page.getByRole("button", { name: /Navigation öffnen|Menü/ }).first().click();
  const nav = page.getByRole("dialog", { name: "Navigation" });
  await expect(nav).toBeVisible();
  return nav;
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
      await nav.getByRole("combobox", { name: "Was willst du tun?" }).fill(g.query);
      const hits = nav.getByTestId("nav-finder-results").locator("[data-feature]");
      await expect(hits.first()).toBeVisible({ timeout: 15_000 });
      await expect(hits.first()).toHaveAttribute("data-feature", g.feature);
      await hits.first().click();
      await expectPlace(page, g);
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------------------------------------------ A4: Alltagsfragen */

test.describe("Funktionsfinder A4: zwanzig Alltagsfragen im Menü", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  for (const g of EVERYDAY_QUESTIONS) {
    test(`„${g.q}“`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = collectErrors(page);
      await seed(page);
      const nav = await openMenuFinder(page);
      const field = nav.getByRole("combobox", { name: "Was willst du tun?" });
      await field.fill(g.q);
      const hits = nav.getByTestId("nav-finder-results").locator("[data-feature]");
      await expect(hits.first()).toBeVisible({ timeout: 15_000 });
      await expect(hits.first(), "erster Treffer").toHaveAttribute("data-feature", g.first);
      await expect(field).toHaveAttribute("aria-expanded", "true");
      // Enter opens the first hit (the one the field marks as active)
      await field.press("Enter");
      await expectPlace(page, g);
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }
});

test.describe("Funktionsfinder A4: Tastatur, Seiten, verdeckte Ziele", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("Tastatur: ↓ ↑ wählen (aria-activedescendant), Enter öffnet die gewählte Zeile, Esc leert erst das Feld und schließt dann das Menü", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await seed(page);
    const nav = await openMenuFinder(page);
    const field = nav.getByRole("combobox", { name: "Was willst du tun?" });
    await expect(field).toHaveAttribute("aria-expanded", "false");
    await field.fill("Einstellungen");
    const options = nav.getByRole("option");
    await expect(options.first()).toBeVisible({ timeout: 15_000 });
    const n = await options.count();
    expect(n).toBeGreaterThan(2);
    const ids = await options.evaluateAll((els) => els.map((e) => e.id));
    await expect(field).toHaveAttribute("aria-activedescendant", ids[0]!);
    await field.press("ArrowDown");
    await expect(field).toHaveAttribute("aria-activedescendant", ids[1]!);
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await field.press("ArrowUp");
    await field.press("ArrowUp");
    // wraps to the last one
    await expect(field).toHaveAttribute("aria-activedescendant", ids[n - 1]!);
    // the status line says it (a polite live region, no toast)
    await expect(nav.getByTestId("nav-finder-status")).toContainText("Treffer");
    // the focus stayed in the field: the arrows did not leave it for a page link
    await expect(field).toBeFocused();
    // Esc 1: empties the field and keeps the menu; Esc 2: closes it
    await field.press("Escape");
    await expect(field).toHaveValue("");
    await expect(nav).toBeVisible();
    await expect(field).toHaveAttribute("aria-expanded", "false");
    await field.press("Escape");
    await expect(nav).toBeHidden({ timeout: 10_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Tastatur: Enter auf der zweiten Zeile öffnet genau diese", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await seed(page);
    const nav = await openMenuFinder(page);
    const field = nav.getByRole("combobox", { name: "Was willst du tun?" });
    await field.fill("Einstellungen");
    const options = nav.getByRole("option");
    await expect(options.nth(1)).toBeVisible({ timeout: 15_000 });
    const second = await options.nth(1).getAttribute("data-feature");
    await field.press("ArrowDown");
    await field.press("Enter");
    if (second!.startsWith("page:")) await expect(page).toHaveURL(new RegExp(`#${second!.slice(5)}$`));
    else await expect(page.locator('[data-page-role="current"]')).toHaveAttribute("data-page", /./);
    await expect(nav).toBeHidden({ timeout: 10_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Seiten sind Treffer: „Einstellungen“ → Seite zuerst, Chips teilen in Seiten und Funktionen, Klick öffnet die Seite", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await seed(page);
    const nav = await openMenuFinder(page);
    await nav.getByRole("combobox", { name: "Was willst du tun?" }).fill("Einstellungen");
    const first = nav.getByRole("option").first();
    await expect(first).toHaveAttribute("data-feature", "page:settings", { timeout: 15_000 });
    await expect(first).toContainText("Seite");
    const chips = nav.getByRole("group", { name: "Treffer eingrenzen" });
    await expect(chips.getByRole("button", { name: /^Seiten/ })).toHaveAttribute("aria-pressed", "false");
    await chips.getByRole("button", { name: /^Funktionen/ }).click();
    await expect(chips.getByRole("button", { name: /^Funktionen/ })).toHaveAttribute("aria-pressed", "true");
    await expect(nav.getByRole("option").first()).toHaveAttribute("data-kind", "feature");
    await chips.getByRole("button", { name: /^Seiten/ }).click();
    await expect(nav.getByRole("option")).toHaveCount(1);
    await nav.getByRole("option").first().click();
    await expectPlace(page, { page: "settings", name: "Einstellungen" });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("kein Treffer endet in einem Toast: der Finder bleibt stehen und bietet die Liste und den Assistenten an", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await seed(page);
    const nav = await openMenuFinder(page);
    const field = nav.getByRole("combobox", { name: "Was willst du tun?" });
    await field.fill("zzzqqq");
    await expect(nav.getByTestId("nav-finder-none")).toBeVisible({ timeout: 15_000 });
    await expect(nav.getByTestId("nav-finder-status")).toHaveText("Kein Treffer");
    await field.press("Enter");
    await expect(nav).toBeVisible();
    await noToast(page);
    await nav.getByTestId("nav-finder-ask").click();
    await expect(page.getByRole("dialog", { name: "Assistent" })).toBeVisible({ timeout: 20_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("verdecktes Ziel: eine zugeklappte Karte (Fold) wird geöffnet, die Karte steht im Bild und hat den Fokus", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await seed(page, { foldsClosed: true });
    const nav = await openMenuFinder(page);
    await nav.getByRole("combobox", { name: "Was willst du tun?" }).fill("Historie sammeln");
    const first = nav.getByRole("option").first();
    await expect(first).toHaveAttribute("data-feature", "datenarchiv", { timeout: 15_000 });
    await first.click();
    await expect(page).toHaveURL(/#settings$/);
    const card = layer(page, "settings").locator('[data-testid="settings-archive-card"]');
    await expect(card).toBeInViewport({ timeout: 20_000 });
    await expect(layer(page, "settings").locator('details[data-fold="settings-archive"], details[data-fold]:has([data-testid="settings-archive-card"])')).toHaveJSProperty("open", true);
    await expect(card).toBeFocused();
    await noToast(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("verdecktes Ziel: der Baukasten gehört zur Auswahl „Eigene Idee“ – der Finder trifft sie selbst und zeigt ihn", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await seed(page, { foldsClosed: true });
    const nav = await openMenuFinder(page);
    await nav.getByRole("combobox", { name: "Was willst du tun?" }).fill("Bedingungen zusammenklicken");
    const first = nav.getByRole("option").first();
    await expect(first).toHaveAttribute("data-feature", "indikator-bausteine", { timeout: 15_000 });
    await first.click();
    await expect(page).toHaveURL(/#labor$/);
    const builder = layer(page, "labor").locator('[data-testid="labor-builder"]');
    await expect(builder).toBeInViewport({ timeout: 25_000 });
    await expect(layer(page, "labor").getByTestId("labor-strategy-custom")).toHaveAttribute("aria-checked", "true");
    await noToast(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Fundort-Hinweis statt Toast: eine Karte nach dem Lauf – Landung im Versuchsaufbau, Hinweis mit Grund und Weg zum Assistenten", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await seed(page);
    const nav = await openMenuFinder(page);
    await nav.getByRole("combobox", { name: "Was willst du tun?" }).fill("Stresstest");
    await expect(nav.getByRole("option").first()).toHaveAttribute("data-feature", "belastungstest", { timeout: 15_000 });
    await nav.getByRole("option").first().click();
    await expect(page).toHaveURL(/#labor$/);
    const note = arrivalNote(page);
    await expect(note).toBeVisible({ timeout: 20_000 });
    await expect(note).toHaveAttribute("data-tone", "warn");
    await expect(note).toContainText("sobald ein Test fertig ist");
    // landing place: the always-present card, in view and focused
    await expect(layer(page, "labor").getByTestId("labor-config")).toBeInViewport({ timeout: 20_000 });
    await expect(layer(page, "labor").getByTestId("labor-config")).toBeFocused();
    // the note never takes the focus, closes with its button, and leaving the page ends it
    await note.getByTestId("arrival-close").click();
    await expect(note).toBeHidden();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Touch-Ziele des Finders (Feld, Leeren, Chips, Treffer) ≥ 44 px", async ({ page }, info) => {
    test.skip(!hasTouch(info), "Touch-Ziele nur mobil");
    test.setTimeout(90_000);
    await seed(page);
    const nav = await openMenuFinder(page);
    await nav.getByRole("combobox", { name: "Was willst du tun?" }).fill("Einstellungen");
    await expect(nav.getByRole("option").first()).toBeVisible({ timeout: 15_000 });
    await expect(nav.getByTestId("nav-finder-panel")).toHaveAttribute("data-open", "", { timeout: 5000 });
    await page.waitForTimeout(500);
    const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="nav-finder"]' });
    expect(misses, misses.map((m) => `${m.name} ${m.w}×${m.h} (${m.where})`).join("\n")).toEqual([]);
  });
});
