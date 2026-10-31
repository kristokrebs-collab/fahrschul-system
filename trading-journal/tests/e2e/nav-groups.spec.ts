/**
 * Etappe 1a, der Nutzerweg mit echten Klicks (mobil 390 + Desktop 1440):
 *  - mobil: die untere Leiste (Übersicht, Trades, + Trade, Markt, Mehr), „Mehr“ öffnet das Menü mit dem Suchfeld und den vier Gruppen;
 *    eine Seite hinter „Mehr“ lässt „Mehr“ aufleuchten;
 *  - Desktop: die Seitenleiste mit vier Gruppen und allen 19 Seiten, „Trade eintragen“ oben, einklappen und ausklappen bleibt nach dem Neuladen;
 *    eine Gruppe falten / entfalten;
 *  - „Lokaler Modus“ ist ein Schild in der Kopfleiste, das beim Antippen erklärt – kein Banner;
 *  - Barrierefreiheit (axe) der Leiste / Seitenleiste, dunkel und hell;
 *  - keine Tippfläche der Navigation ist kleiner als 44 px, keine überlappt (Trefferprüfung wie `hitbox.ts`).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openTradeEditor, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { UX_PROJECTS } from "./uxHarness";

const current = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"]`);
const mobile = (name: string) => name === "mobile";

test.describe("Navigation in vier Gruppen", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "mobile + desktop");
  });

  test("mobil: „Mehr“ öffnet das Menü mit Suche und vier Gruppen; „Mehr“ leuchtet auf Seiten hinter ihm", async ({ page }, info) => {
    test.skip(!mobile(info.project.name), "phone only");
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const bar = page.getByRole("toolbar", { name: "Navigation" });
    await expect(bar.getByRole("button")).toHaveCount(5);
    // every item says its word under the icon
    for (const word of ["Übersicht", "Trades", "Trade", "Markt", "Mehr"]) await expect(bar.getByText(word, { exact: true })).toBeVisible();
    await bar.getByRole("button", { name: "Mehr" }).click();
    const menu = page.getByRole("dialog", { name: "Navigation" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("searchbox", { name: "Was willst du tun?" })).toBeVisible();
    await expect(menu.getByTestId("cmd-group")).toHaveCount(4);
    await menu.getByRole("link", { name: /^Handelsplan/ }).click();
    await expect(page).toHaveURL(/#plan$/);
    await expect(current(page, "plan").locator("h1").first()).toBeAttached({ timeout: 30_000 });
    await expect(menu).toBeHidden({ timeout: 10_000 });
    // a page behind „Mehr“: no tab is current, „Mehr“ carries the disc
    await expect(bar.locator('[aria-current="page"]')).toHaveCount(0);
    await expect(bar.getByRole("button", { name: "Mehr" }).locator('[data-dock-marker="bg"]')).toHaveCount(1);
    await expectNoHorizontalScroll(page);
    // the bar's „+ Trade“ opens the editor from this page too (one tap)
    await openTradeEditor(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Desktop: Seitenleiste mit vier Gruppen und 19 Seiten, Einklappen bleibt nach dem Neuladen, eine Gruppe lässt sich falten", async ({ page }, info) => {
    test.skip(mobile(info.project.name), "from 768 px");
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const side = page.locator('[data-layer="Seitenleiste"]');
    await expect(page.getByRole("toolbar", { name: "Navigation" })).toHaveCount(0);
    await expect(side.getByTestId("sidebar-group")).toHaveCount(4);
    await expect(side.getByTestId("sidebar-group").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).resolves.toEqual(["Erfassen", "Prüfen", "Auswerten", "Konto & Rechtliches"]);
    // 1440 px: the narrow rail by default (the pages keep their 1320 px column) – every page is there by name, the primary action on top
    await expect(side).not.toHaveAttribute("data-expanded", "");
    for (const name of ["Trades", "Handelsplan", "Übersicht", "Markt", "Analyse", "Einstellungen", "Konto", "Funktionen"]) await expect(side.getByRole("link", { name, exact: true })).toBeAttached();
    await expect(side.getByRole("button", { name: "Trade eintragen" })).toBeVisible();
    await openTradeEditor(page);
    await page.keyboard.press("Escape");
    // open it: titles and plain words; 900 px high → Erfassen and Prüfen open, Auswerten and Konto folded, the Trades one tap away
    await side.getByTestId("sidebar-toggle").click();
    await expect(side).toHaveAttribute("data-expanded", "");
    await expect(side.getByRole("link", { name: /^Trades\s+Deine Einträge/ })).toBeVisible();
    await expect(side.getByRole("button", { name: /^Auswerten/ })).toHaveAttribute("aria-expanded", "false");
    await side.getByRole("button", { name: /^Auswerten/ }).click();
    await side.getByRole("link", { name: /^Analyse/ }).click();
    await expect(page).toHaveURL(/#analyse$/);
    await expect(side.getByRole("link", { name: /^Analyse/ })).toHaveAttribute("aria-current", "page");
    // the choice (open) and the folded groups survive a reload
    await page.reload();
    await expect(page.locator('[data-layer="Seitenleiste"]')).toHaveAttribute("data-expanded", "");
    await expect(page.locator('[data-layer="Seitenleiste"]').getByRole("button", { name: /^Auswerten/ })).toHaveAttribute("aria-expanded", "true");
    await page.locator('[data-layer="Seitenleiste"]').getByTestId("sidebar-toggle").click();
    await expect(page.locator('[data-layer="Seitenleiste"]')).not.toHaveAttribute("data-expanded", "");
    await expectNoHorizontalScroll(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("„Lokaler Modus“ ist ein Schild in der Kopfleiste, kein Banner; ein Tipp erklärt es", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await expect(page.getByText("Lokaler Modus.", { exact: true })).toHaveCount(0);
    const badge = page.locator("header").getByTestId("local-badge");
    await expect(badge).toBeVisible();
    await badge.click();
    const panel = page.getByTestId("local-badge-panel");
    await expect(panel).toContainText("Trades bleiben nur in diesem Browser");
    await expect(panel.getByRole("button", { name: "Backup öffnen" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(badge).toBeFocused();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("320 px: Kopfleiste und Leiste passen, „Trade eintragen“ ist erreichbar", async ({ page }, info) => {
    test.skip(!mobile(info.project.name), "phone only");
    await seed(page);
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const cta = page.locator("header").getByRole("button", { name: "Trade eintragen" });
    const box = await cta.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 320, `CTA ${JSON.stringify(box)} inside 320`).toBe(true);
    const bar = await page.getByRole("toolbar", { name: "Navigation" }).boundingBox();
    expect(bar && bar.x >= 0 && bar.x + bar.width <= 320, `bar ${JSON.stringify(bar)} inside 320`).toBe(true);
    await expectNoHorizontalScroll(page);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`Barrierefreiheit der Leiste / Seitenleiste und der Kopfleiste (${theme})`, async ({ page }) => {
      await seed(page, { extra: { "tj2-theme": JSON.stringify(theme) } });
      await page.goto("/#overview");
      await expect(page.getByText("Netto-P&L").first()).toBeVisible();
      await page.waitForTimeout(3200);
      const res = await new AxeBuilder({ page }).include('[data-layer="Dock"], [data-layer="Seitenleiste"], header').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
      expect(lines).toEqual([]);
    });
  }

  test("keine Tippfläche der Navigation unter 44 px und keine überlappt (Kopfleiste, Leiste / Seitenleiste, Menü)", async ({ page }, info) => {
    await seed(page);
    // tall enough for the whole rail: a row cut by the end of the scrolling list is not a small target
    if (!mobile(info.project.name)) await page.setViewportSize({ width: 1440, height: 1500 });
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.waitForTimeout(2000);
    // the sidebar scrolls on a short screen: its rows beyond the foot are reached by scrolling, so the audit looks at what is shown
    for (const root of ["header", '[data-layer="Dock"], [data-layer="Seitenleiste"]']) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root });
      // rows hidden behind the sidebar's foot are scrolled out of view, not too small
      const real = misses.filter((m) => !(m.eh === 0 && m.ew === 0));
      expect(real.map((m) => `${m.where}: ${m.name} ${m.w}×${m.h} → ${m.ew}×${m.eh} (${m.stolenBy})`), root).toEqual([]);
    }
    await page.getByRole("button", { name: /(Navigation öffnen|^Mehr)/ }).first().click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
    await page.waitForTimeout(2800);
    const menu = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[role="dialog"][aria-label="Navigation"]' });
    expect(menu.map((m) => `${m.name} ${m.w}×${m.h} → ${m.ew}×${m.eh} (${m.stolenBy})`)).toEqual([]);
  });
});
