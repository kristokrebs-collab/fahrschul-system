/**
 * Runde 12 – the search field the reader sees (the sidebar's „Seiten suchen“) answers by task and takes the cursor to the target:
 *   - „Trade suchen“ → Enter → the Trades page with the cursor IN its search field;
 *   - „Simulation öffnen“ → the Zeitmaschine section of the lab;
 *   - the glass / clay field: a tile in the rail, the full field in the panel;
 *   - `/` opens the search with the cursor in its field, Escape clears it and then closes it (keyboard shortcut and way out);
 *   - on a phone the finder behind „Mehr“ is always within reach.
 * The ordering of the hits for the four tasks of the brief is also pinned for the page „Funktionen“ and the menu finder in
 * `funktionsfinder.spec.ts` (GOALS).
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, seed } from "./helpers";

const PROJECTS = ["mobile", "desktop"];
const layer = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"]`);

test.describe("Suche nach Tätigkeiten", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop");
  });

  test("Computer: „Trade suchen“ in der Seitenleiste → Enter → die Trades-Seite, der Cursor steht im Suchfeld", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "from 768 px");
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const field = page.getByRole("combobox", { name: "Seiten und Funktionen suchen" });
    await field.click();
    await field.fill("Trade suchen");
    const hit = page.getByRole("option").first();
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await expect(hit).toHaveAttribute("data-feature", "trade-filter");
    await field.press("Enter");
    await expect(page).toHaveURL(/#trades$/);
    await expect(layer(page, "trades").locator("h1").first()).toBeAttached({ timeout: 30_000 });
    const target = layer(page, "trades").getByTestId("trades-search");
    await expect(target).toBeInViewport({ timeout: 20_000 });
    await expect(target, "der Cursor steht im Suchfeld").toBeFocused({ timeout: 20_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Computer: „Simulation öffnen“ → das Labor, die Zeitmaschine im Bild", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "from 768 px");
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const field = page.getByRole("combobox", { name: "Seiten und Funktionen suchen" });
    await field.click();
    await field.fill("Simulation öffnen");
    const hit = page.getByRole("option").first();
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await expect(hit).toHaveAttribute("data-feature", "zeitmaschine");
    await field.press("Enter");
    await expect(page).toHaveURL(/#labor$/);
    await expect(layer(page, "labor").getByTestId("tm-section")).toBeInViewport({ timeout: 30_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Computer: das Suchfeld ist eine Glas-Kachel in der Schiene und ein volles Feld im Panel; der erste Escape leert es", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "from 768 px");
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const aside = page.locator('[data-layer="Seitenleiste"]');
    const field = aside.getByRole("combobox", { name: "Seiten und Funktionen suchen" });
    // the rail: a 48 px tile; the surface is the soft clay + frosted glass of the field (blur over a translucent ink, inner light and shade, a rounded plate)
    expect(Math.round((await aside.locator(".sb-search").boundingBox())!.width)).toBe(48);
    const look = await aside.locator(".sf-box").evaluate((el) => {
      const cs = getComputedStyle(el);
      return { blur: cs.backdropFilter || cs.getPropertyValue("-webkit-backdrop-filter"), shadow: cs.boxShadow, radius: parseFloat(cs.borderTopLeftRadius) };
    });
    expect(look.blur).toMatch(/blur/);
    expect(look.shadow).toMatch(/inset/);
    expect(look.radius).toBeGreaterThanOrEqual(12);
    // opened (focus peeks the panel open): the field is as wide as the panel
    await field.focus();
    await expect(aside).toHaveAttribute("data-open", "", { timeout: 5000 });
    await expect.poll(async () => Math.round((await aside.locator(".sb-search").boundingBox())!.width), { timeout: 5000 }).toBeGreaterThan(200);
    await field.fill("Alarm");
    await expect(page.getByRole("option").first()).toBeVisible({ timeout: 15_000 });
    await field.press("Escape");
    await expect(field).toHaveValue("");
  });

  test("„/“ öffnet die Suche mit dem Cursor im Feld, Escape schließt sie – auf dem Computer und am Handy", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.locator("body").press("/");
    const dialog = page.getByRole("dialog", { name: /Suche/ });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const input = dialog.getByRole("combobox").or(dialog.getByRole("searchbox")).or(dialog.locator("input")).first();
    await expect(input, "der Cursor steht im Feld").toBeFocused();
    await input.fill("Alarm konfigurieren");
    const first = dialog.getByRole("option").first();
    await expect(first).toBeVisible({ timeout: 15_000 });
    await expect(first).toContainText(/Alarme/);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Handy: das Menü hat den Finder; „Alarm konfigurieren“ führt zur Alarm-Karte", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "phone only");
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.getByRole("button", { name: /Navigation öffnen|Menü|Mehr/ }).first().click();
    const nav = page.getByRole("dialog", { name: "Navigation" });
    await expect(nav).toBeVisible();
    const field = nav.getByRole("combobox", { name: "Was willst du tun?" });
    await field.fill("Alarm konfigurieren");
    const hits = nav.getByTestId("nav-finder-results").locator("[data-feature]");
    await expect(hits.first()).toBeVisible({ timeout: 15_000 });
    await expect(hits.first()).toHaveAttribute("data-feature", "alarme");
    await hits.first().click();
    await expect(page).toHaveURL(/#markt$/);
    await expect(layer(page, "markt").getByTestId("alerts-card")).toBeInViewport({ timeout: 30_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
