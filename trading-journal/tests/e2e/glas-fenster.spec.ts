/**
 * Runde 14 – Glas-Fenster und der Schalter „Glas-Look: Glas · Flach“ (mobile 390 + desktop 1440):
 *   - Vorgabe ist Glas: `html[data-glass="on"]` steht vor dem ersten Bild, jedes aufklappende Fenster (Menü, Assistent, Suche, Auswahlliste)
 *     ist dieselbe Glasfläche – Unschärfe dahinter, durchscheinende Tönung;
 *   - „Flach“ in den Einstellungen wirkt sofort (kein Neuladen), bleibt nach dem Neuladen und zeigt die Fenster deckend wie bisher;
 *   - Samsung-Internet-Modus (`?safefx=1`), „mehr Kontrast“ und erzwungene Farben schalten das Glas von selbst aus – die Wahl bleibt;
 *   - Text auf Glas hält den Kontrast (axe, hell und dunkel).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { seed } from "./helpers";
import { UX_PROJECTS } from "./uxHarness";

const html = (page: Page) => page.locator("html");
const paneStyle = (pane: Locator) =>
  pane.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { blur: cs.backdropFilter || (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter || "none", bg: cs.backgroundColor, image: cs.backgroundImage };
  });

async function open(page: Page, hash: string, extra: Record<string, string> = {}, query = ""): Promise<void> {
  await seed(page, { extra });
  await page.goto(`/${query}#${hash}`);
  await expect(page.locator(`[data-page="${hash}"][data-page-role="current"] h1`).first()).toBeAttached({ timeout: 40_000 });
}

async function openAssistant(page: Page): Promise<Locator> {
  await page.getByTestId("assistant-button").first().click();
  const dialog = page.getByRole("dialog", { name: "Assistent" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("assistant-input")).toBeVisible();
  return dialog;
}

async function openMenu(page: Page, mobile: boolean): Promise<Locator> {
  if (mobile) await page.locator('[data-layer="Dock"]').getByRole("button", { name: "Mehr" }).tap();
  else await page.keyboard.press("Control+k");
  const menu = page.locator("#command-nav");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link", { name: /Handelsplan/ }).first()).toBeVisible();
  return menu;
}

test.describe("Glas-Fenster", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "mobile + desktop");
  });

  test("Vorgabe Glas: Menü, Assistent, Suche und Auswahlliste sind dieselbe Glasfläche", async ({ page }, info) => {
    const mobile = info.project.name === "mobile";
    await open(page, "settings");
    await expect(html(page)).toHaveAttribute("data-glass", "on");

    const assistant = await openAssistant(page);
    const a = await paneStyle(assistant);
    expect(a.blur, "Assistent: Unschärfe dahinter").toMatch(/blur\(22px\)/);
    expect(a.image, "Assistent: Tönung als Verlauf, keine deckende Farbe").toContain("gradient");
    await page.keyboard.press("Escape");
    await expect(assistant).toBeHidden();

    const menu = await openMenu(page, mobile);
    const pane = mobile ? menu.locator(".glass-panel").first() : menu;
    // the phone's sheet is glass with blur; the full-screen menu from 768 px is the same pane without blur (never a full-screen backdrop filter)
    expect((await paneStyle(pane)).blur, "Menü").toMatch(mobile ? /blur\(22px\)/ : /none/);
    expect((await paneStyle(pane)).image, "Menü: Glasfläche").toContain("gradient");
    // the red hairline of the slanted opening is still there while the menu arrives
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    if (!mobile) {
      await page.keyboard.press("/");
      const search = page.getByRole("dialog", { name: "Suche" });
      await expect(search).toBeVisible();
      expect((await paneStyle(search.locator(".glass-panel").first())).blur, "Suche").toMatch(/blur\(22px\)/);
      await page.keyboard.press("Escape");
      await expect(search).toBeHidden();
    }

    const field = page.locator('[data-page="settings"][data-page-role="current"] button[aria-haspopup="listbox"]').first();
    await field.scrollIntoViewIfNeeded();
    await field.click();
    const list = page.locator('[data-pulse-select][data-state="open"]');
    await expect(list).toBeVisible();
    await expect(list).toHaveAttribute("data-gp", "sm");
    // small pane: the lens in Chromium, a plain blur elsewhere – never none
    expect((await paneStyle(list)).blur, "Auswahlliste").toMatch(/blur\(/);
    await page.keyboard.press("Escape");
  });

  test("„Flach“ wirkt sofort, bleibt nach dem Neuladen, und die Fenster sind deckend wie bisher", async ({ page }, info) => {
    const mobile = info.project.name === "mobile";
    await open(page, "settings");
    const section = page.getByTestId("glass-section");
    await section.scrollIntoViewIfNeeded();
    const group = section.getByRole("radiogroup", { name: "Glas-Look wählen" });
    await expect(group.getByRole("radio", { name: "Glas" })).toBeChecked();
    const flat = group.getByRole("radio", { name: "Flach" });
    const box = await flat.boundingBox();
    if (mobile) expect(box && box.width >= 44, `Tippfläche ${JSON.stringify(box)}`).toBe(true);
    await flat.click();
    // at once, no reload
    await expect(html(page)).toHaveAttribute("data-glass", "off");
    await expect(html(page)).not.toHaveAttribute("data-lg", "");
    await expect(flat).toBeChecked();
    await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("tj2-settings") ?? "{}") as { glass?: string }).glass)).toBe("off");

    const assistant = await openAssistant(page);
    const a = await paneStyle(assistant);
    expect(a.blur, "flach: keine Unschärfe").toBe("none");
    expect(a.bg, "flach: die deckende Fläche von früher (ink-850)").toBe("rgb(17, 17, 17)");
    expect(a.image).toBe("none");
    await page.keyboard.press("Escape");
    await expect(assistant).toBeHidden();
    const menu = await openMenu(page, mobile);
    const pane = mobile ? menu.locator(".glass-panel").first() : menu;
    const m = await paneStyle(pane);
    expect(m.blur).toBe("none");
    expect(m.bg, "flach: das schwarze Menü").toBe("rgb(0, 0, 0)");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // stays after a reload – and is there before the app renders (no flash of glass)
    await page.reload();
    await expect(html(page)).toHaveAttribute("data-glass", "off");
    await expect(page.locator('[data-page="settings"][data-page-role="current"] h1').first()).toBeAttached({ timeout: 40_000 });
    const again = page.getByTestId("glass-section").getByRole("radiogroup", { name: "Glas-Look wählen" });
    await page.getByTestId("glass-section").scrollIntoViewIfNeeded();
    await expect(again.getByRole("radio", { name: "Flach" })).toBeChecked();
    await again.getByRole("radio", { name: "Glas" }).click();
    await expect(html(page)).toHaveAttribute("data-glass", "on");
    const back = await openAssistant(page);
    expect((await paneStyle(back)).blur).toMatch(/blur\(22px\)/);
  });

  test("Rückfälle: Samsung-Modus, mehr Kontrast und erzwungene Farben schalten das Glas von selbst aus – die Wahl bleibt „Glas“", async ({ page }) => {
    await open(page, "settings", {}, "?safefx=1");
    await expect(html(page)).toHaveAttribute("data-glass", "off");
    await page.getByTestId("glass-section").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("glass-section").getByRole("radio", { name: "Glas" })).toBeChecked();
    await expect(page.getByTestId("glass-hint")).toContainText("automatisch aus");
    const assistant = await openAssistant(page);
    expect((await paneStyle(assistant)).blur).toBe("none");
    await page.keyboard.press("Escape");

    await page.goto("/#trades");
    await expect(html(page)).toHaveAttribute("data-glass", "on");
    // a system setting that changes while the app is open is followed live
    await page.emulateMedia({ contrast: "more" });
    await expect(html(page)).toHaveAttribute("data-glass", "off");
    await page.emulateMedia({ contrast: "no-preference" });
    await expect(html(page)).toHaveAttribute("data-glass", "on");
    await page.emulateMedia({ forcedColors: "active" });
    await expect(html(page)).toHaveAttribute("data-glass", "off");
  });

  for (const theme of ["dark", "light"] as const) {
    test(`Kontrast auf Glas (${theme}): Assistent, Menü und Tastenkürzel-Blatt ohne axe-Befund`, async ({ page }, info) => {
      const mobile = info.project.name === "mobile";
      await page.emulateMedia({ colorScheme: theme });
      await open(page, "trades", { "tj2-theme": JSON.stringify({ pref: theme }) });
      await expect(html(page)).toHaveAttribute("data-glass", "on");
      const scan = async (include: string, what: string) => {
        await page.waitForTimeout(1200);
        const res = await new AxeBuilder({ page }).include(include).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        const lines = res.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
        expect(lines, `${what} (${theme})`).toEqual([]);
      };
      await openAssistant(page);
      await page.getByTestId("assistant-input").fill("Wie ist meine Trefferquote?");
      await page.getByTestId("assistant-send").click();
      await expect(page.getByTestId("assistant-answer").first()).toBeVisible();
      await scan('[role="dialog"][aria-modal="true"]', "Assistent");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Assistent" })).toBeHidden();
      await openMenu(page, mobile);
      await scan("#command-nav", "Menü");
    });
  }
});
