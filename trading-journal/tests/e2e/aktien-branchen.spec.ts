/**
 * Aktien › Branchen-Trend end to end on the routed page `/#aktien` of the production build, with the one function answered from the spec
 * (`mocks/industry.ts`) and the shipped REAL lab result (`public/branchen-trend/beispiel-megatest.json`, served by the preview):
 *
 * - nothing is asked before the section is on screen; then the Ampel of the 48 industries (green / red as a colour AND a word), the stand of
 *   the data with „kein Echtzeit“, sort and search; the grid is as high before the data as after it (placeholders of the tile's size);
 * - the paper protocol (what was written, `.jsonl` download, nothing „gesendet“);
 * - the result of a lab run: the example says VERWORFEN with its checks as ✓/✗, the charts really draw (canvas pixels), the file picker accepts
 *   the real file and refuses nonsense; the command to run the lab is offered with the note on the factor data;
 * - Pine: the script, the honest sentence, the payload, the way to n8n; a library that is down is named with its reason and a click retries;
 * - mobile + desktop: no horizontal scroll, touch targets ≥ 44 px on a coarse pointer, no console errors, axe (WCAG 2.1 A + AA, dark and light).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { EXITED, GREEN, LAST_DAY, mockIndustry, type Industry } from "./mocks/industry";

const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = process.env.AKTIEN_SHOTS_DIR;
const EXAMPLE_FILE = new URL("../../public/branchen-trend/beispiel-megatest.json", import.meta.url).pathname;

async function open(page: Page, info: TestInfo, extra: Record<string, unknown> = {}): Promise<{ errors: string[]; mock: Industry }> {
  test.skip(!PROJECTS.includes(info.project.name), "Branchen-Trend runs on mobile + desktop");
  const errors = collectErrors(page);
  await seed(page, { extra });
  const mock = await mockIndustry(page);
  return { errors, mock };
}

/** the page, then the section through the strip – the way a trader gets there */
async function go(page: Page): Promise<void> {
  await openRoute(page, "/#aktien", "Aktien");
  await expect(page.getByTestId("aktien-scanner")).toBeVisible();
  await page.getByRole("navigation", { name: "Inhalt dieser Seite" }).getByRole("button", { name: "Branchen-Trend" }).click();
  await expect(page.getByTestId("branchen-honest")).toBeVisible();
}
const ready = (page: Page) => expect(page.getByTestId("branchen-ampel-body")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
const tiles = (page: Page) => page.getByTestId("branchen-tile");

async function shot(page: Page, info: TestInfo, name: string, id: string): Promise<void> {
  if (!SHOTS) return;
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total + 800; y += 600) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
    await page.waitForTimeout(50);
  }
  const el = page.getByTestId(id);
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1800);
  await el.screenshot({ path: `${SHOTS}/${name}-${info.project.use.viewport?.width ?? 0}.png` });
}

/** the canvas has real pixels, not an empty rectangle */
async function drawn(page: Page, testId: string): Promise<number> {
  return page.getByTestId(testId).locator("canvas").evaluate((c: HTMLCanvasElement) => {
    // read a copy made for reading (the chart's own context is not asked to read back again and again)
    const copy = document.createElement("canvas");
    copy.width = c.width;
    copy.height = c.height;
    const ctx = copy.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(c, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
    return n;
  });
}

test.describe("Branchen-Trend", () => {
  test.setTimeout(120_000);

  test("nichts wird geladen, bevor der Abschnitt zu sehen ist; dann die Ampel mit Stand, Wörtern und Gewichten", async ({ page }, info) => {
    const { errors, mock } = await open(page, info);
    await openRoute(page, "/#aktien", "Aktien");
    await expect(page.getByTestId("aktien-scanner")).toBeVisible();
    expect(mock.calls).toBe(0);
    await page.getByRole("navigation", { name: "Inhalt dieser Seite" }).getByRole("button", { name: "Branchen-Trend" }).click();
    await ready(page);
    expect(mock.calls).toBe(1);
    await expect(tiles(page)).toHaveCount(48);
    const stand = page.getByTestId("branchen-stand");
    await expect(stand).toContainText("Quelle: Ken French Data Library (Dartmouth)");
    await expect(stand).toContainText(`Daten bis ${String(LAST_DAY).slice(6, 8)}.${String(LAST_DAY).slice(4, 6)}.${String(LAST_DAY).slice(0, 4)}`);
    await expect(stand).toContainText("Datenbank 202609");
    await expect(stand).toContainText("monatlich aktualisiert, kein Echtzeit");
    await expect(page.getByTestId("branchen-count-kauf")).toContainText(`${GREEN.length} von 48`);
    // a colour is always a word too
    const green = page.locator('[data-testid="branchen-tile"][data-state="kauf"]');
    await expect(green).toHaveCount(GREEN.length);
    await expect(green.first()).toContainText("Kauf");
    await expect(green.first().getByTestId("branchen-tile-weight")).toContainText("Zielgewicht");
    const red = page.locator('[data-testid="branchen-tile"][data-state="cash"]').first();
    await expect(red).toContainText("Cash");
    // the honest points are on screen all the time
    const honest = page.getByTestId("branchen-honest");
    await expect(honest).toContainText("Rückblick, keine Prognose");
    await expect(honest).toContainText("Nur US-Branchen");
    await expect(honest).toContainText("nichts an eine Börse oder einen Broker gesendet");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "branchen-1-ampel", "branchen-ampel");
    expect(errors).toEqual([]);
  });

  test("Sortieren und Suchen: Federn ohne Sprung, die Kachelgröße bleibt, das Raster wächst nicht", async ({ page }, info) => {
    const { errors } = await open(page, info);
    await go(page);
    await ready(page);
    const grid = page.getByTestId("branchen-grid");
    const before = await grid.boundingBox();
    await page.getByRole("radio", { name: "A–Z" }).click();
    await expect(tiles(page).first()).toHaveAttribute("data-code", "Autos");
    const after = await grid.boundingBox();
    expect(Math.abs(after!.height - before!.height)).toBeLessThan(2);
    await page.getByTestId("branchen-search").fill("rüstung");
    await expect(tiles(page)).toHaveCount(1);
    await expect(tiles(page).first()).toHaveAttribute("data-code", "Guns");
    await page.getByTestId("branchen-search").fill("zzz");
    await expect(page.getByTestId("branchen-none")).toBeVisible();
    await page.getByTestId("branchen-search").fill("");
    await page.getByTestId("branchen-only-buy").click();
    await expect(tiles(page)).toHaveCount(GREEN.length);
    // the choice survives a reload (kept on this device)
    await page.reload();
    await expect(page.getByTestId("aktien-scanner")).toBeVisible();
    await page.getByRole("navigation", { name: "Inhalt dieser Seite" }).getByRole("button", { name: "Branchen-Trend" }).click();
    await ready(page);
    await expect(tiles(page)).toHaveCount(GREEN.length);
    expect(errors).toEqual([]);
  });

  test("während die Daten kommen, stehen 48 Platzhalter in Kachelgröße – danach ändert sich die Höhe kaum", async ({ page }, info) => {
    const { errors, mock } = await open(page, info);
    mock.delayMs = 1500;
    await go(page);
    const loading = page.getByTestId("branchen-grid-loading");
    await expect(loading).toBeVisible();
    await expect(loading.locator("li")).toHaveCount(48);
    const h0 = (await loading.boundingBox())!.height;
    const top0 = (await loading.boundingBox())!.y + (await page.evaluate(() => window.scrollY));
    await ready(page);
    const grid = page.getByTestId("branchen-grid");
    const h1 = (await grid.boundingBox())!.height;
    const top1 = (await grid.boundingBox())!.y + (await page.evaluate(() => window.scrollY));
    expect(Math.abs(h1 - h0), `Platzhalter ${h0} px, Raster ${h1} px`).toBeLessThan(12);
    // everything above the grid (status row, stand line, figures) was there before the data: the grid starts where the placeholders started
    expect(Math.abs(top1 - top0)).toBeLessThan(24);
    expect(errors).toEqual([]);
  });

  test("das Papier-Protokoll: eine Zeile je Wechsel, DEMO/PAPIER, nicht gesendet; Export als .jsonl", async ({ page }, info) => {
    const { errors } = await open(page, info);
    await go(page);
    await ready(page);
    await expect(page.getByTestId("branchen-log-count")).toContainText(`${EXITED.length} Einträge`);
    const row = page.getByTestId("branchen-log-row").first();
    await expect(row).toContainText("DEMO/PAPIER");
    await expect(row).toContainText("nicht gesendet");
    await expect(row).toContainText("Verkauf");
    const dl = page.waitForEvent("download");
    await page.getByTestId("branchen-log-export").click();
    const file = await dl;
    expect(file.suggestedFilename()).toBe("protokoll.jsonl");
    const text = await (await import("node:fs/promises")).readFile((await file.path())!, "utf8");
    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(EXITED.length);
    for (const l of lines) {
      const o = JSON.parse(l) as Record<string, unknown>;
      expect(Object.keys(o)).toEqual(["erfasst", "datum", "branche", "signal", "strategie", "modus", "gesendet", "hinweis"]);
      expect(o).toMatchObject({ signal: "VERKAUF", strategie: "s-20-40-2.8-0.02-2.0", modus: "DEMO/PAPIER", gesendet: false });
    }
    // nothing but the one function was asked – no order, no broker
    await expect(page.getByTestId("branchen-forward")).toContainText("Offen:");
    expect(errors).toEqual([]);
  });

  test("Beispiel laden: VERWORFEN, die Prüfungen als ✓ und ✗, Kennzahlen, drei Diagramme mit echten Pixeln", async ({ page }, info) => {
    const { errors } = await open(page, info);
    await go(page);
    await page.getByTestId("branchen-example").click();
    await expect(page.getByTestId("branchen-result")).toBeVisible();
    const v = page.getByTestId("branchen-verdict");
    await expect(v).toHaveAttribute("data-state", "verworfen");
    await expect(page.getByTestId("branchen-verdict-word")).toHaveText("VERWORFEN");
    await expect(page.getByTestId("branchen-verdict-lead")).toContainText("Die Basis bleibt (20/40");
    await expect(page.getByTestId("branchen-verdict-lead")).toContainText("wird nicht übernommen");
    const checks = page.getByTestId("branchen-check");
    await expect(checks).toHaveCount(5);
    await expect(page.locator('[data-testid="branchen-check"][data-ok="false"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="branchen-check"][data-ok="true"]')).toHaveCount(3);
    await expect(checks.nth(1)).toContainText("✗");
    await expect(checks.nth(1)).toContainText("0.39 gegen 0.54");
    await expect(page.getByTestId("branchen-result")).not.toContainText(/Gewinner|Sieger/);
    const end = page.getByTestId("branchen-kz-endtest");
    await expect(end).toContainText("Sharpe 0,54");
    await expect(end).toContainText("Sharpe 0,39");
    await expect(page.getByTestId("branchen-scatter-note")).toContainText("700 von 12.096 Varianten (Stichprobe)");
    await expect(page.getByTestId("branchen-fan-title")).toContainText("10.000 simulierte Pfade, 5 Jahre");
    // the canvases really drew (the fan draws in over 1.5 s, once it is on screen)
    await page.getByTestId("branchen-fan").scrollIntoViewIfNeeded();
    await expect.poll(() => drawn(page, "branchen-scatter"), { timeout: 10_000 }).toBeGreaterThan(2000);
    await expect.poll(() => drawn(page, "branchen-hist"), { timeout: 10_000 }).toBeGreaterThan(2000);
    await expect.poll(() => drawn(page, "branchen-fan"), { timeout: 10_000 }).toBeGreaterThan(20_000);
    await expectNoHorizontalScroll(page);
    await shot(page, info, "branchen-2-ergebnis", "branchen-ergebnis");
    expect(errors).toEqual([]);
  });

  test("das Fadenkreuz des Fächers: Zeiger und Pfeiltasten zeigen P05, Median und P95", async ({ page }, info) => {
    const { errors } = await open(page, info);
    await go(page);
    await page.getByTestId("branchen-example").click();
    const canvas = page.getByTestId("branchen-fan-canvas");
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2300); // the draw-in is over
    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("branchen-fan-live")).toContainText(/^0,\d J: P05 \d,\d\d×, Median \d,\d\d×, P95 \d,\d\d×$/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("branchen-fan-live")).toHaveText("");
    expect(errors).toEqual([]);
  });

  test("ruhige Bewegung: mit „weniger Bewegung“ steht der Fächer sofort fertig da", async ({ page }, info) => {
    const { errors } = await open(page, info);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await go(page);
    await page.getByTestId("branchen-example").click();
    await page.getByTestId("branchen-fan").scrollIntoViewIfNeeded();
    // no draw-in: the finished picture within a few frames, not after 1.5 s
    await expect.poll(() => drawn(page, "branchen-fan"), { timeout: 700 }).toBeGreaterThan(20_000);
    expect(errors).toEqual([]);
  });

  test("eine eigene Datei: die echte megatest.json wird gelesen, Unsinn nennt die erste fehlerhafte Stelle", async ({ page }, info) => {
    const { errors } = await open(page, info);
    await go(page);
    const input = page.getByTestId("branchen-file");
    await input.setInputFiles({ name: "kaputt.json", mimeType: "application/json", buffer: Buffer.from('{"entscheidung":"VERWORFEN"}') });
    await expect(page.getByTestId("branchen-result-error")).toContainText("kein Ergebnis eines Labor-Laufs");
    await input.setInputFiles({ name: "text.json", mimeType: "application/json", buffer: Buffer.from("das ist kein json") });
    await expect(page.getByTestId("branchen-result-error")).toContainText("keine gültige JSON-Datei");
    await input.setInputFiles({ name: "zu-gross.json", mimeType: "application/json", buffer: Buffer.alloc(4 * 1024 * 1024 + 10, 32) });
    await expect(page.getByTestId("branchen-result-error")).toContainText("größer als 4 MB");
    await expect(page.getByTestId("branchen-result")).toHaveCount(0);
    await input.setInputFiles(EXAMPLE_FILE);
    await expect(page.getByTestId("branchen-result")).toHaveAttribute("data-name", "beispiel-megatest.json");
    await expect(page.getByTestId("branchen-result-error")).toHaveCount(0);
    await page.getByTestId("branchen-clear").click();
    await expect(page.getByTestId("branchen-result")).toHaveCount(0);
    // the file went nowhere: only the one data function was ever asked
    expect(errors).toEqual([]);
  });

  test("der Befehl für den Lauf, mit dem ehrlichen Hinweis auf die Faktor-Daten", async ({ page, context }, info) => {
    const { errors } = await open(page, info);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    await go(page);
    const cmd = page.getByTestId("branchen-command");
    await expect(cmd).toContainText("python3 megatest.py --industry");
    await expect(cmd).toContainText("--factors");
    await expect(cmd).toContainText("Faktor-Daten sind nötig");
    await expect(page.getByTestId("branchen-ergebnis-lead")).toContainText("außerhalb des Browsers");
    await page.getByTestId("branchen-command-copy").click();
    const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (copied !== null) expect(copied).toContain("megatest.py --industry 48_Industry_Portfolios_daily_CSV.zip --factors");
    expect(errors).toEqual([]);
  });

  test("Pine: das Skript, der ehrliche Satz, die Nachricht und der Weg zu n8n", async ({ page }, info) => {
    const { errors } = await open(page, info);
    await go(page);
    await expect(page.getByTestId("branchen-pine-honest")).toContainText("nicht in TradingView kompiliert");
    await page.getByTestId("branchen-pine-toggle").click();
    const code = page.getByTestId("branchen-pine-code");
    await expect(code).toBeVisible();
    await expect(code).toHaveValue(/^\/\/@version=5\n/);
    await expect(code).toHaveValue(/alertcondition\(buySig/);
    await expect(page.getByTestId("branchen-payload-example")).toContainText('"signal":"KAUF"');
    await page.getByTestId("branchen-payload").locator("summary").click();
    await expect(page.getByTestId("branchen-schema")).toContainText('"required"');
    await expect(page.getByTestId("branchen-webhook")).toContainText("bewusst keinen Empfänger");
    const dl = page.waitForEvent("download");
    await page.getByTestId("branchen-pine-save").click();
    expect((await dl).suggestedFilename()).toBe("Branchen-Trend_s-20-40-2.8-0.02-2.0.pine");
    await expectNoHorizontalScroll(page);
    await shot(page, info, "branchen-3-pine", "branchen-pine");
    expect(errors).toEqual([]);
  });

  test("eine Bibliothek, die nicht antwortet, wird mit Grund benannt – ein Klick versucht es noch einmal; die Auswertung geht trotzdem", async ({ page }, info) => {
    const { errors, mock } = await open(page, info);
    mock.fail = { status: 502, code: "industry_upstream", message: "Die Ken-French-Datenbibliothek antwortete mit einem Fehler (HTTP 503)." };
    await go(page);
    const err = page.getByTestId("branchen-error");
    await expect(err).toBeVisible({ timeout: 20_000 });
    await expect(err).toContainText("Die Branchendaten konnten nicht geladen werden");
    await expect(err).toContainText("HTTP 503");
    await expect(err).toContainText("Es wird keine Ampel erfunden");
    await expect(tiles(page)).toHaveCount(0);
    await page.getByTestId("branchen-example").click();
    await expect(page.getByTestId("branchen-verdict")).toBeVisible();
    mock.fail = null;
    await page.getByTestId("branchen-retry").click();
    await ready(page);
    await expect(err).toHaveCount(0);
    await expect(tiles(page)).toHaveCount(48);
    expect(errors.filter((e) => !/503|502/.test(e))).toEqual([]);
  });

  test("Touch-Ziele ≥ 44 px bei grobem Zeiger", async ({ page }, info) => {
    test.skip(!hasTouch(info), "touch projects");
    const { errors } = await open(page, info);
    await go(page);
    await ready(page);
    await page.getByTestId("branchen-example").click();
    await expect(page.getByTestId("branchen-result")).toBeVisible();
    await page.getByTestId("branchen-pine-toggle").click();
    await page.getByTestId("branchen-payload").locator("summary").click();
    await page.waitForTimeout(600);
    const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="aktien-branchen"]' });
    const problems = misses.filter((m) => m.w > 1).map((m) => `${m.where} · ${m.name} ${m.w}×${m.h} → ${m.ew}×${m.eh} (taken by ${m.stolenBy})`);
    expect(problems).toEqual([]);
    expect(errors).toEqual([]);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`Barrierefreiheit mit Ampel, Ergebnis, Pine und Protokoll (axe, ${theme === "dark" ? "dunkles" : "helles"} Thema)`, async ({ page }, info) => {
      const { errors } = await open(page, info, { "tj2-theme": JSON.stringify(theme) });
      await go(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await ready(page);
      await page.getByTestId("branchen-example").click();
      await expect(page.getByTestId("branchen-result")).toBeVisible();
      await page.getByTestId("branchen-pine-toggle").click();
      await expect(page.getByTestId("branchen-pine-code")).toBeVisible();
      await page.waitForTimeout(2400);
      const results = await new AxeBuilder({ page }).include('[data-testid="aktien-branchen"]').withTags(TAGS).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
});
