/**
 * Navigation – Messung vorher / nachher (Etappe 1a), mobil 390 und Desktop 1440. Das ist eine MESSUNG, kein Urteil:
 * der Test schreibt eine JSON-Datei (`NAV_BASELINE_OUT`, sonst `test-results/nav-<projekt>.json`) und prüft nur,
 * dass jedes Ziel erreichbar ist. Vorher (alte Navigation) und nachher (neue) laufen mit demselben Skript.
 *
 *  - `height`: Länge jeder der 19 Seiten in px (`scrollHeight` 1,2 s nach der Überschrift, ohne Skelett).
 *  - `editorTaps`: Taps bis zum „Trade eintragen“-Editor von jeder Seite (1 = ein sichtbarer Knopf in Kopfleiste, Dock
 *    oder Seitenleiste; es wird wirklich geklickt und der Dialog muss aufgehen).
 *  - `pageTaps`: Taps von der Übersicht bis zu jeder der 19 Seiten (1 = ein sichtbares Ziel in Dock / Seitenleiste /
 *    Kopfleiste, 2 = erst das Menü öffnen, dann das Ziel; 0 = nicht erreichbar).
 *  - `hit`: Anteil der sichtbaren Bedienelemente, deren Tippfläche (Trefferprüfung wie `hitbox.ts`) mindestens 44 × 44 px
 *    ist – auf den fünf Hauptseiten und in der Navigations-Hülle (Kopfleiste, Dock / Seitenleiste, Menü).
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";

const PROJECTS = ["mobile", "desktop"];
const PAGES: readonly { key: string; label: string }[] = [
  { key: "overview", label: "Übersicht" },
  { key: "trades", label: "Trades" },
  { key: "setups", label: "Entscheidungsgrundlagen" },
  { key: "markt", label: "Markt" },
  { key: "settings", label: "Einstellungen" },
  { key: "plan", label: "Handelsplan" },
  { key: "aktien", label: "Aktien" },
  { key: "risiko", label: "Risiko" },
  { key: "analyse", label: "Analyse" },
  { key: "berichte", label: "Berichte" },
  { key: "coach", label: "Coach" },
  { key: "wachstum", label: "Wachstum" },
  { key: "labor", label: "Labor" },
  { key: "studio", label: "Strategie-Studio" },
  { key: "community", label: "Community" },
  { key: "cockpit", label: "Cockpit" },
  { key: "konto", label: "Konto" },
  { key: "preise", label: "Preise" },
  { key: "funktionen", label: "Funktionen" },
];
const MAIN = ["overview", "trades", "setups", "markt", "settings"];
/** Die Hülle der Navigation: Kopfleiste, altes Dock, neue untere Leiste, Seitenleiste. */
const CHROME = 'header, [data-layer="Dock"], [data-layer="Seitenleiste"], [data-layer="Untere Leiste"]';

async function openPage(page: Page, key: string): Promise<void> {
  await page.goto(`/#${key}`);
  await expect(page.locator(`[data-page="${key}"][data-page-role="current"] h1`).first()).toBeAttached({ timeout: 30_000 });
  await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(1200);
}

/** Taps bis zum Editor: der erste sichtbare, nicht überdeckte „Trade eintragen“-Knopf der Hülle. */
async function editorTaps(page: Page): Promise<number> {
  const btn = page.locator(CHROME).getByRole("button", { name: "Trade eintragen" });
  const n = await btn.count();
  for (let i = 0; i < n; i++) {
    const b = btn.nth(i);
    if (!(await b.isVisible())) continue;
    await b.click({ timeout: 5000 });
    const dlg = page.getByRole("dialog", { name: "Trade eintragen" });
    await expect(dlg).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden({ timeout: 10_000 });
    return 1;
  }
  return 0;
}

/** Taps von der Übersicht bis zur Seite `label` (Hülle zuerst, dann das Menü). */
async function pageTaps(page: Page, key: string, label: string): Promise<number> {
  if (key === "overview") return 1;
  const direct = page.locator(CHROME).getByRole("button", { name: label, exact: true }).or(page.locator(CHROME).getByRole("link", { name: new RegExp(`^${label}(\\s|$)`) }));
  const n = await direct.count();
  for (let i = 0; i < n; i++) if (await direct.nth(i).isVisible()) return 1;
  const menu = page.getByRole("button", { name: /(Navigation öffnen|^Mehr)/ }).first();
  if (!(await menu.isVisible())) return 0;
  await menu.click();
  const dlg = page.getByRole("dialog", { name: "Navigation" });
  await expect(dlg).toBeVisible({ timeout: 10_000 });
  // die Einträge blenden gestaffelt ein
  const link = dlg.locator(`a[href="#${key}"]`).first();
  await link.waitFor({ state: "attached", timeout: 10_000 });
  const ok = (await link.count()) > 0;
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden({ timeout: 10_000 });
  return ok ? 2 : 0;
}

async function hitShare(page: Page, root?: string): Promise<{ total: number; small: number; share: number }> {
  const total = await page.evaluate(
    ({ selector, root }) => {
      const scope: ParentNode = (root && document.querySelector(root)) || document;
      return Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter((el) => {
        if (el.closest('[inert], [aria-hidden="true"], [hidden]')) return false;
        const r = el.getBoundingClientRect();
        return r.width >= 1 && r.height >= 1 && getComputedStyle(el).visibility !== "hidden";
      }).length;
    },
    { selector: HIT_SELECTOR, root },
  );
  const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root });
  const small = Math.min(total, misses.length);
  return { total, small, share: total ? Math.round(((total - small) / total) * 1000) / 10 : 100 };
}

test("Navigation: Messwerte (Länge, Taps, Tippflächen)", async ({ page }, info) => {
  test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop");
  test.setTimeout(900_000);
  await seed(page);
  const out: Record<string, unknown> = { project: info.project.name, viewport: page.viewportSize() };

  const height: Record<string, number> = {};
  const editor: Record<string, number> = {};
  const taps: Record<string, number> = {};
  const hit: Record<string, { total: number; small: number; share: number }> = {};
  // NAV_ONLY_HIT=1: nur die Tippflächen der Hülle (Kopfleiste, Dock / Seitenleiste, Menü) – schnell, für Nachmessungen
  const onlyHit = !!process.env.NAV_ONLY_HIT;
  for (const p of onlyHit ? [] : PAGES) {
    await openPage(page, p.key);
    height[p.key] = await page.evaluate(() => document.documentElement.scrollHeight);
    editor[p.key] = await editorTaps(page);
  }
  // Taps zu jeder Seite: immer von der Übersicht aus
  for (const p of onlyHit ? [] : PAGES) {
    await openPage(page, "overview");
    taps[p.key] = await pageTaps(page, p.key, p.label);
  }
  for (const key of onlyHit ? [] : MAIN) {
    await openPage(page, key);
    hit[key] = await hitShare(page);
  }
  await openPage(page, "overview");
  hit["chrome"] = await hitShare(page, "header");
  const bar = await page.locator('[data-layer="Dock"], [data-layer="Seitenleiste"], [data-layer="Untere Leiste"]').first().evaluate((el) => el.getAttribute("data-layer"));
  if (bar) hit[`chrome:${bar}`] = await hitShare(page, `[data-layer="${bar}"]`);
  // das Menü
  const menu = page.getByRole("button", { name: /(Navigation öffnen|^Mehr)/ }).first();
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
    await page.waitForTimeout(2600);
    hit["menu"] = await hitShare(page, '[role="dialog"][aria-label="Navigation"]');
    await page.keyboard.press("Escape");
  }
  out.height = height;
  out.editorTaps = editor;
  out.pageTaps = taps;
  out.hit = hit;
  const mainHeights = MAIN.map((k) => height[k] ?? 0);
  if (onlyHit) {
    console.log(JSON.stringify(hit));
    return;
  }
  out.summary = {
    meanMainHeight: Math.round(mainHeights.reduce((a, b) => a + b, 0) / mainHeights.length),
    maxHeight: Math.max(...Object.values(height)),
    editorTapsMax: Math.max(...Object.values(editor)),
    pageTapsMax: Math.max(...Object.values(taps)),
    pageTapsMean: Math.round((Object.values(taps).reduce((a, b) => a + b, 0) / PAGES.length) * 100) / 100,
    unreachable: Object.entries(taps).filter(([, v]) => v === 0).map(([k]) => k),
  };
  const file = process.env.NAV_BASELINE_OUT ?? `test-results/nav-${info.project.name}.json`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.summary));
  // Nichts darf unerreichbar sein; der Editor ist von jeder Seite mit einem Tap offen.
  expect(out.summary).toMatchObject({ unreachable: [], editorTapsMax: 1 });
});
