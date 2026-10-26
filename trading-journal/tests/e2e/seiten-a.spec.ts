/**
 * Feinschliff Runde 8, Seiten A (Trades, Grundlagen, Einstellungen, Berichte, Wachstum, Funktionen, Konto, Preise, Community):
 *  - Layout-Verschiebung (CLS) je Seite nach dem Laden ≤ 0,02, ohne Uhr-Sprünge (nur der Browser misst, 2,5 s Ruhe);
 *  - Barrierefreiheit (axe, WCAG 2.1 A + AA, Dunkel und Hell) je Seite – die Seite selbst, ohne Kopf und Dock;
 *  - Touch-Ziele ≥ 44 px der neuen Bausteine (Einstellungen: aufklappbares Kleingedrucktes, Gruppenleiste);
 *  - Einstellungen in fünf Gruppen (Leiste, aufgeklappt lesbar), Berichte ohne leere Spalte neben dem Wochenreview,
 *    Leerzustand der Trades ohne Filterleiste, Konto-/Community-Leiste, die „Siehe auch“-Zeilen.
 * Läuft auf dem Standard-Build (`/`) und – Konto, Preise, Community – auf dem Cloud-Build gegen die Supabase-Mocks.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { cloudUrl, collectErrors, expectNoHorizontalScroll, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { mockBilling, mockSubscription } from "./mocks/billing";
import { mockSocial } from "./mocks/social";
import { mockSupabase } from "./mocks/supabase";

const PROJECTS = ["mobile", "desktop"];
const THEMES = ["dark", "light"] as const;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const LOCAL_PAGES = ["trades", "setups", "settings", "berichte", "wachstum", "funktionen"] as const;
const CLOUD_PAGES = ["konto", "preise", "community"] as const;
/** CLS budget of a page after it came up (Auftrag: ≤ 0,02) */
const CLS_MAX = 0.02;

const layer = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"]`);

/** Installs the layout-shift collector before the first script of the page runs; `ready` starts the count. */
async function collectShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: { all: number; after: number; ready: boolean } };
    w.__cls = { all: 0, after: 0, ready: false };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (e.hadRecentInput) continue;
        w.__cls.all += e.value;
        if (w.__cls.ready) w.__cls.after += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function shiftsAfterReady(page: Page, rest = 2500): Promise<number> {
  await page.evaluate(() => {
    (window as unknown as { __cls: { ready: boolean } }).__cls.ready = true;
  });
  await page.waitForTimeout(rest);
  return page.evaluate(() => (window as unknown as { __cls: { after: number } }).__cls.after);
}

async function mountEverything(page: Page): Promise<void> {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h + 1200; y += 600) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(400);
}

async function expectAccessible(page: Page, key: string): Promise<void> {
  await page.waitForTimeout(900);
  const res = await new AxeBuilder({ page }).include(`[data-page="${key}"][data-page-role="current"]`).withTags(TAGS).analyze();
  const lines = res.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} → ${v.nodes
        .slice(0, 4)
        .map((n) => n.target.join(" "))
        .join(" | ")}`,
  );
  expect(lines, `${key}: axe violations`).toEqual([]);
}

async function signIn(page: Page): Promise<void> {
  await page.locator('[data-cloud-pill="signin"]').click();
  const sheet = page.getByRole("dialog", { name: "Anmelden" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[inert]")).toHaveCount(0);
  await sheet.getByLabel("E-Mail").fill("trader@example.com");
  await sheet.getByLabel("Passwort", { exact: true }).fill("richtig-geheim-42");
  await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page.getByText("Alles synchron.", { exact: false })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Los geht’s" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

/** The cloud mocks, a signed-in session (stored by the first sign-in), then a fresh load of `hash`. */
async function openSignedIn(page: Page, hash: string, theme: "dark" | "light" = "dark"): Promise<void> {
  await mockSupabase(page);
  await mockBilling(page, { plan: { plan: "pro", status: "active", trialEnd: null }, subscription: mockSubscription({ plan: "pro", status: "active" }) });
  await mockSocial(page, { optIn: true });
  await seed(page, { extra: { "tj2-theme": JSON.stringify(theme) } });
  await page.goto(cloudUrl(hash));
  await expect(layer(page, hash).locator("h1").first()).toBeVisible({ timeout: 30_000 });
  await signIn(page);
  await page.reload();
  await expect(layer(page, hash).locator("h1").first()).toBeVisible({ timeout: 30_000 });
}

test.describe("Seiten A: Feinschliff", () => {
  test.setTimeout(180_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  for (const key of LOCAL_PAGES) {
    test(`${key}: keine Layout-Verschiebung nach dem Laden, kein Seitwärts-Scrollen`, async ({ page }) => {
      const errors = collectErrors(page);
      await collectShifts(page);
      await seed(page);
      await page.goto(`/#${key}`);
      await expect(layer(page, key).locator("h1").first()).toBeVisible({ timeout: 30_000 });
      const cls = await shiftsAfterReady(page);
      expect(cls, `${key}: CLS ${cls}`).toBeLessThanOrEqual(CLS_MAX);
      await expectNoHorizontalScroll(page);
      expect(errors, errors.join("\n")).toEqual([]);
    });

    for (const theme of THEMES) {
      test(`${key}: axe (${theme})`, async ({ page }) => {
        await seed(page, { extra: { "tj2-theme": JSON.stringify(theme) } });
        await page.goto(`/#${key}`);
        await expect(layer(page, key).locator("h1").first()).toBeVisible({ timeout: 30_000 });
        await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
        await mountEverything(page);
        await expectAccessible(page, key);
      });
    }
  }

  test("trades: ein Journal ohne Trades zeigt keine Filterleiste, eine ruhige Anleitung und die anderen Wege hinein", async ({ page }) => {
    await seed(page, { empty: true });
    await page.goto("/#trades");
    const view = layer(page, "trades");
    await expect(view.getByText("Noch keine Trades", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(view.getByTestId("journal-filters")).toHaveCount(0);
    await expect(view.getByText("Bereit für den ersten Eintrag.")).toHaveCount(0);
    await expect(view.getByRole("button", { name: "Trade eintragen" })).toBeVisible();
    await expect(view.getByTestId("feature-links").getByRole("button", { name: /CSV-Import/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("trades: die Zahl steht in der Kopfzeile, die Filterleiste und die Anschlüsse (Replay, Berichte) sind da", async ({ page }) => {
    await seed(page);
    await page.goto("/#trades");
    const view = layer(page, "trades");
    await expect(view.getByRole("heading", { level: 1, name: /Alle Trades/ })).toBeVisible({ timeout: 30_000 });
    await expect(view.getByTestId("journal-filters")).toBeVisible();
    const links = view.getByTestId("feature-links");
    await expect(links.getByRole("button", { name: /Trade-Replay/ })).toBeVisible();
    await expect(links.getByRole("button", { name: /Berichte/ })).toBeVisible();
  });

  test("einstellungen: fünf Gruppen, die Leiste führt dorthin, das Kleingedruckte klappt auf und bleibt lesbar", async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page);
    await page.goto("/#settings");
    const view = layer(page, "settings");
    await expect(view.locator("h1").first()).toBeVisible({ timeout: 30_000 });
    const groups = view.locator("section[data-section]");
    await expect(groups).toHaveCount(5);
    await expect(groups.locator("h2").first()).toHaveText("Grundlagen");
    const nav = view.getByTestId("section-nav");
    await expect(nav).toBeVisible({ timeout: 20_000 });
    await expect(nav.locator("[data-section-chip]")).toHaveCount(5);
    await nav.locator('[data-section-chip="s-sichern"]').click();
    await expect.poll(async () => groups.nth(3).evaluate((el) => Math.round(el.getBoundingClientRect().top)), { timeout: 8000 }).toBeLessThan(260);
    // the archive: its small print is one tap away – in the DOM closed, readable open
    const card = view.getByTestId("settings-archive-card");
    await card.scrollIntoViewIfNeeded();
    const limit = card.getByTestId("archive-limit");
    await expect(limit).toContainText("Kein Server-Archiv");
    await expect(limit).toBeHidden();
    await card.getByText("Was gespeichert wird – und was nicht").click();
    await expect(limit).toBeVisible();
    await expectNoHorizontalScroll(page);
    if (info.project.name === "mobile") {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="settings-archive-card"]' });
      expect(misses.map((m) => `${m.name} ${m.ew}×${m.eh}`)).toEqual([]);
    }
  });

  test("berichte: eine vergangene Woche ohne Experiment lässt keine Lücke neben dem Wochenreview und keinen toten Chip", async ({ page }) => {
    await seed(page);
    await page.goto("/#berichte");
    const view = layer(page, "berichte");
    await expect(view.getByTestId("berichte-view")).toHaveAttribute("data-kind", "week", { timeout: 30_000 });
    await expect(view.getByTestId("week-review")).toBeVisible({ timeout: 30_000 });
    await expect(view.getByTestId("week-experiment")).toHaveCount(0);
    await page.waitForTimeout(3600); // the strip drops the chips of sections that are not there
    const nav = view.getByTestId("section-nav");
    await expect(nav.locator('[data-section-chip="week-experiment"]')).toHaveCount(0);
    // without the experiment card the review takes the whole row
    const [review, container] = await Promise.all([view.getByTestId("week-review").boundingBox(), view.getByTestId("berichte-view").boundingBox()]);
    if (review && container && container.width > 1000) expect(review.width).toBeGreaterThan(container.width * 0.9);
    // the report has its ways to the analysis
    await expect(view.getByTestId("feature-links").getByRole("button", { name: /Kennzahlen/ })).toBeVisible();
  });

  for (const key of CLOUD_PAGES) {
    test(`${key} (angemeldet): keine Layout-Verschiebung nach dem Laden, kein Seitwärts-Scrollen`, async ({ page }) => {
      const errors = collectErrors(page);
      await collectShifts(page);
      await openSignedIn(page, key);
      await page.waitForTimeout(600);
      const cls = await shiftsAfterReady(page);
      expect(cls, `${key}: CLS ${cls}`).toBeLessThanOrEqual(CLS_MAX);
      await expectNoHorizontalScroll(page);
      expect(errors, errors.join("\n")).toEqual([]);
    });

    for (const theme of THEMES) {
      test(`${key} (angemeldet): axe (${theme})`, async ({ page }) => {
        await openSignedIn(page, key, theme);
        await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
        await mountEverything(page);
        await expectAccessible(page, key);
      });
    }
  }

  test("konto (angemeldet): die Leiste führt zu Sicherheit, Daten, Tarif; Preise liegen daneben", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openSignedIn(page, "konto");
    const view = layer(page, "konto");
    const nav = view.getByTestId("section-nav");
    await expect(nav).toBeVisible({ timeout: 20_000 });
    for (const id of ["konto-login", "konto-sicherheit", "konto-daten", "konto-tarif"]) await expect(nav.locator(`[data-section-chip="${id}"]`)).toHaveCount(1);
    await nav.locator('[data-section-chip="konto-daten"]').click();
    await expect.poll(async () => view.locator('[data-section="konto-daten"]').evaluate((el) => Math.round(el.getBoundingClientRect().top)), { timeout: 8000 }).toBeLessThan(260);
    const links = view.getByTestId("feature-links");
    await links.scrollIntoViewIfNeeded();
    await expect(links.getByRole("button", { name: /Tarife im Vergleich/ })).toBeVisible();
  });

  test("community (angemeldet): Leiste und Anschlüsse zu Ergebnisbeleg, Chartfällen und Reviews", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openSignedIn(page, "community");
    const view = layer(page, "community");
    const nav = view.getByTestId("section-nav");
    await expect(nav).toBeVisible({ timeout: 20_000 });
    await expect(nav.locator("[data-section-chip]")).toHaveCount(5);
    await nav.locator('[data-section-chip="shares-card"]').click();
    await expect.poll(async () => view.getByTestId("shares-card").evaluate((el) => Math.round(el.getBoundingClientRect().top)), { timeout: 8000 }).toBeLessThan(300);
    const links = view.getByTestId("feature-links");
    for (const name of [/Ergebnisbeleg/, /Chartfälle/, /Reviews/]) await expect(links.getByRole("button", { name })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("preise (angemeldet): der Weg zu Konto und Abo steht unter den Tarifen", async ({ page }) => {
    await openSignedIn(page, "preise");
    const view = layer(page, "preise");
    const links = view.getByTestId("feature-links");
    await links.scrollIntoViewIfNeeded();
    await expect(links.getByRole("button", { name: /Konto und Abo verwalten/ })).toBeVisible();
  });
});
