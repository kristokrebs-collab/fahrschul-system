/**
 * Selbstprüfung der ganzen App (mobil 390 + Desktop): was der Nutzer verlangt hat, als Messung auf jeder Seite –
 *  - der ruhige Satz „Keine professionelle Finanzberatung.“ steht auf jeder Seite, die analysiert, simuliert oder
 *    vorschlägt, einmal am Seitenende (und als Dauerzeile unter dem Eingabefeld des Assistenten), und NIE auf der
 *    Startseite oder dem Cockpit; die Kleinschrift der Startseite behält ihren Wert, außerhalb ist sie lesbar;
 *  - Quelle und Stand stehen bei den Marktzahlen (Markt, Korrelation, Benchmark), und was fehlt, heißt „keine Daten“;
 *  - kein seitliches Scrollen, axe (WCAG 2.1 A + AA, Kontrast eingeschlossen) in beiden Themen, Touch-Ziele ≥ 44 px bei
 *    grobem Zeiger – jeweils auf dem Inhalt der Seite (die Startseite und das Cockpit bleiben, wie sie sind).
 * Keine Uhr-Sprünge, nichts, das an der Zeit der Markt-Mocks hängt.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { openUx, themeSettled } from "./uxHarness";

const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** The pages that analyse, simulate or suggest – each ends with the note. */
const NOTE_PAGES = ["markt", "analyse", "risiko", "coach", "berichte", "wachstum", "labor", "studio", "setups"] as const;
/** The start page and its family: never. */
const NO_NOTE_PAGES = ["overview", "cockpit"] as const;
/** Every other page the self check walks (the start page and the cockpit stay as they are). */
const AUDIT_PAGES = [...NOTE_PAGES, "trades", "settings", "funktionen", "konto", "preise", "community"] as const;

const layer = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"]`);

async function ready(page: Page, key: string): Promise<void> {
  await expect(layer(page, key).locator("h1").first()).toBeAttached({ timeout: 30_000 });
  await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
}

/** scrolls through the page once so lazy and revealed cards are mounted */
async function mountEverything(page: Page): Promise<void> {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h + 1200; y += 600) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
    await page.waitForTimeout(50);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(400);
}

test.describe("Selbstprüfung", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  for (const key of NOTE_PAGES) {
    test(`Hinweis „Keine professionelle Finanzberatung.“ am Ende von ${key}`, async ({ page }) => {
      const errors = collectErrors(page);
      await seed(page);
      await page.goto(`/#${key}`);
      await ready(page, key);
      const notes = layer(page, key).getByTestId("analysis-note");
      await expect(notes).toHaveCount(1);
      await expect(notes).toContainText("Keine professionelle Finanzberatung.");
      // one calm sentence at the END of the page: nothing but the overlays host comes after it
      const last = await layer(page, key).evaluate((root) => {
        const note = root.querySelector('[data-testid="analysis-note"]') as HTMLElement;
        const rest = Array.from(root.querySelectorAll<HTMLElement>("*")).filter((el) => note.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && !note.contains(el) && el.offsetHeight > 0 && !el.closest('[data-layer], [role="dialog"]'));
        return rest.length;
      });
      expect(last, "visible content after the note").toBe(0);
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }

  for (const key of NO_NOTE_PAGES) {
    test(`kein Hinweis auf ${key} (die Startseite bleibt, wie sie ist)`, async ({ page }) => {
      await seed(page);
      await page.goto(`/#${key}`);
      await ready(page, key);
      await page.waitForTimeout(800);
      await expect(page.getByTestId("analysis-note")).toHaveCount(0);
    });
  }

  test("Kleinschrift: auf der Startseite wie bisher (#5f5f5f), auf den anderen Seiten lesbar (#8c8c8c)", async ({ page }) => {
    await openUx(page, "app", "overview", { theme: "dark" });
    const faint = (key: string) => layer(page, key).evaluate((el) => getComputedStyle(el).getPropertyValue("--color-faint").trim().toLowerCase());
    expect(await faint("overview")).toBe("#5f5f5f");
    await page.goto("/#markt");
    await ready(page, "markt");
    expect(await faint("markt")).toBe("#8c8c8c");
    await page.goto("/#cockpit");
    await expect(layer(page, "cockpit").locator("h1").first()).toBeAttached({ timeout: 30_000 });
    expect(await faint("cockpit")).toBe("#5f5f5f");
  });

  test("Kleinschrift im hellen Thema: der eigene Wert bleibt auf jeder Seite (#6b6b6b)", async ({ page }) => {
    await openUx(page, "app", "markt", { theme: "light" });
    await ready(page, "markt");
    expect(await layer(page, "markt").evaluate((el) => getComputedStyle(el).getPropertyValue("--color-faint").trim().toLowerCase())).toBe("#6b6b6b");
  });

  test("der Assistent trägt den Satz als Dauerzeile unter dem Eingabefeld, nicht in jeder Antwort", async ({ page }) => {
    await seed(page);
    await page.goto("/#settings");
    await ready(page, "settings");
    await page.getByTestId("assistant-button").click();
    await expect(page.getByRole("dialog", { name: "Assistent" })).toBeVisible({ timeout: 20_000 });
    const sheet = page.getByTestId("assistant-sheet");
    await expect(sheet).toBeVisible();
    const note = sheet.getByTestId("analysis-note");
    await expect(note).toHaveCount(1);
    await expect(note).toHaveText("Antworten rechnet die App aus deinen Daten; keine professionelle Finanzberatung.");
    // directly under the field: same sticky block as the input
    const sameBlock = await sheet.evaluate((el) => {
      const input = el.querySelector('[data-testid="assistant-input"]')!;
      const n = el.querySelector('[data-testid="analysis-note"]')!;
      const blockOf = (x: Element) => x.closest(".sticky");
      return blockOf(input) === blockOf(n) && blockOf(n) != null;
    });
    expect(sameBlock).toBe(true);
    await sheet.getByTestId("assistant-input").fill("Wie war letzte Woche?");
    await sheet.getByTestId("assistant-send").click();
    await expect(sheet.getByTestId("assistant-answer").first()).toBeVisible({ timeout: 20_000 });
    await expect(sheet.getByTestId("analysis-note")).toHaveCount(1);
  });

  test("Markt: Quelle und Stand in einer Zeile, fehlende Zeit heißt „keine Daten“", async ({ page }) => {
    await seed(page);
    await page.goto("/#markt");
    await ready(page, "markt");
    const stand = layer(page, "markt").getByTestId("markt-stand");
    await expect(stand).toBeVisible({ timeout: 20_000 });
    await expect(stand).toHaveText(/^Quelle: (Binance USDⓈ-M|Zwischenspeicher dieses Browsers|keine Daten)/);
    await expect(stand).toContainText("letzter Schluss 4h");
    await expect(stand).toContainText("letzter Schluss 1D");
    await expect(stand).toContainText("letzter Schluss 1W");
    // every part is a time or says so – never an empty slot
    const text = (await stand.textContent()) ?? "";
    for (const part of text.split(" · ").slice(1)) expect(part, part).toMatch(/\d{2}\.\d{2}\. \d{2}:\d{2}$|keine Daten$/);
  });

  for (const key of AUDIT_PAGES) {
    test(`${key}: kein seitliches Scrollen, nichts ragt aus dem Bild`, async ({ page }) => {
      await seed(page);
      await page.goto(`/#${key}`);
      await ready(page, key);
      await page.waitForTimeout(700);
      await mountEverything(page);
      await expectNoHorizontalScroll(page);
    });

    for (const theme of ["dark", "light"] as const) {
      test(`${key}: axe (WCAG 2.1 A + AA, Kontrast) im ${theme === "dark" ? "dunklen" : "hellen"} Thema`, async ({ page }) => {
        test.setTimeout(120_000);
        await openUx(page, "app", key, { theme });
        await themeSettled(page);
        await ready(page, key);
        await page.waitForTimeout(1200);
        await mountEverything(page);
        await page.waitForTimeout(800);
        const res = await new AxeBuilder({ page }).include(`[data-page="${key}"][data-page-role="current"]`).withTags(TAGS).analyze();
        const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
        expect(lines, `${key} ${theme}: axe`).toEqual([]);
      });
    }
  }

  test("Touch-Ziele ≥ 44 px bei grobem Zeiger auf den Seiten mit Auswertungen", async ({ page }, info) => {
    test.skip(!hasTouch(info), "touch projects");
    test.setTimeout(240_000);
    await seed(page);
    // dense heat-map cells (15–22 px, one grid, the grid takes the nearest hit), the horizontally scrolling
    // „Inhalt“ strip (chips beyond the edge) and file inputs that only a button opens are not tap targets of their own
    const exempt = (m: { name: string; where: string; w: number }) => m.where === "heat-cell" || m.where === "section-nav" || m.w <= 1;
    const problems: string[] = [];
    for (const key of ["markt", "analyse", "risiko", "coach", "berichte", "wachstum", "labor", "studio", "funktionen"] as const) {
      await page.goto(`/#${key}`);
      await ready(page, key);
      await page.waitForTimeout(900);
      await mountEverything(page);
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: `[data-page="${key}"][data-page-role="current"]` });
      for (const m of misses) if (!exempt(m)) problems.push(`${key} · ${m.where} · ${m.name} ${m.w}×${m.h} → ${m.ew}×${m.eh} (taken by ${m.stolenBy})`);
    }
    expect(problems).toEqual([]);
  });
});
