/**
 * Runde 13 (Funktionsprüfung): defects found by walking the production build as a user, each pinned here –
 *  - leerer Zustand „Trades“ (390 px, grober Zeiger): the CTA „Trade eintragen“ had a 30-px tap area (the shine of the empty state
 *    overrides the Button's 44-px `touch-hit` area),
 *  - Coach ohne Trades: a `div[aria-label]` without a role (axe `aria-prohibited-attr`, serious),
 *  - Rechtliches (Impressum … Widerruf): Tab left the dialog every third press (the focus trap took a `tabindex="-1"` radio for the last
 *    stop of the sheet), and the same walk through the Backup-Import and the navigation,
 *  - Backup importieren: a wrong file is refused in German (empty, `[]`, a wrong field) – never zod's English.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectErrors, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";

const PROJECTS = ["mobile", "desktop"];

/** Presses Tab `n` times; returns the stops outside the topmost dialog (or on <body>). */
async function escapes(page: Page, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const top = Array.from(document.querySelectorAll('[role="dialog"]')).at(-1);
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body) return "BODY";
      return top && top.contains(a) ? "" : `${a.tagName} „${(a.getAttribute("aria-label") || a.innerText || "").trim().slice(0, 25)}“`;
    });
    if (stop) out.push(`Tab ${i + 1}: ${stop}`);
  }
  return out;
}

test.describe("Funktionsprüfung Runde 13", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop");
  });

  test("Trades ohne Einträge: „Trade eintragen“ und „Filter zurücksetzen“ haben eine Tippfläche von 44 px", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "coarse pointer (390 px)");
    const errors = collectErrors(page);
    await seed(page, { empty: true });
    await page.goto("/#trades");
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    await page.waitForTimeout(1200);
    const misses = (await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR })).filter((m) => m.where !== "section-nav" && m.w > 1);
    expect(misses.map((m) => `${m.where} · ${m.name} ${m.w}×${m.h} → ${m.ew}×${m.eh}`)).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Coach ohne Trades: axe findet keine Verstöße (die Vorschlags-Chips sind eine benannte Gruppe)", async ({ page }) => {
    await seed(page, { empty: true });
    await page.goto("/#coach");
    await expect(page.locator('[data-page="coach"][data-page-role="current"] h1').first()).toBeAttached({ timeout: 30_000 });
    await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).disableRules(["color-contrast"]).analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    await expect(page.locator("[aria-label=\"Vorschläge\"]").first()).toHaveAttribute("role", "group");
  });

  test("Rechtliches: Tab bleibt im Fenster (Impressum, AGB, Hinweise), vorwärts und rückwärts", async ({ page }) => {
    test.setTimeout(300_000);
    const errors = collectErrors(page);
    await seed(page);
    for (const doc of ["impressum", "agb", "hinweise"]) {
      await page.goto(`/?rechtliches=${doc}#overview`);
      await page.getByRole("radiogroup", { name: "Rechtliches" }).waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForTimeout(900);
      expect(await escapes(page, 10), `${doc} vorwärts`).toEqual([]);
      for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+Tab");
      const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
      expect(inside, `${doc} rückwärts`).toBe(true);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Backup importieren und Navigation: Tab bleibt im Fenster", async ({ page }) => {
    test.setTimeout(120_000);
    await seed(page);
    await page.goto("/#settings");
    await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "Backup importieren" }).click();
    await page.getByRole("dialog", { name: "Backup importieren" }).waitFor({ state: "visible" });
    await page.waitForTimeout(1000);
    expect(await escapes(page, 30), "Backup importieren").toEqual([]);
  });

  test("Backup importieren: eine falsche Datei wird auf Deutsch abgelehnt (leer, [], falsches Feld)", async ({ page }) => {
    await seed(page, { empty: true });
    await page.goto("/#settings");
    await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
    const dir = mkdtempSync(join(tmpdir(), "tj-wrong-"));
    const cases: [string, string, string][] = [
      ["leer.json", "", "Die Datei ist leer."],
      ["liste.json", "[]", "Keine Trades oder Einstellungen in der Datei"],
      ["feld.json", JSON.stringify({ settings: 5 }), "settings: muss ein Objekt sein (gefunden: eine Zahl)"],
    ];
    for (const [name, text, said] of cases) {
      const file = join(dir, name);
      writeFileSync(file, text);
      await page.getByRole("button", { name: "Backup importieren" }).click();
      const dialog = page.getByRole("dialog", { name: "Backup importieren" });
      await dialog.getByLabel("Backup-Datei").setInputFiles(file);
      await expect(dialog.getByRole("alert")).toHaveText(`Import fehlgeschlagen: ${said}`);
      await expect(dialog.getByRole("button", { name: "Importieren", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  });
});
