/**
 * The short trade form (Etappe 1b), mobile + desktop: a trade with the six core fields only, an accordion group, moving a
 * field into the core (kept after a reload), `Zurücksetzen`, `Letzten Trade duplizieren` (in the form and on the trades
 * page), an error that opens the group and jumps to the field, the save bar staying put, touch targets ≥ 44 px.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { collectErrors, hasTouch, isMobile, screenshot, seed, stored, toast } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR, type HitBoxMiss } from "./hitbox";

const fab = (page: Page) => page.locator('[data-layer="Dock"], [data-layer="Seitenleiste"]').getByRole("button", { name: "Trade eintragen" });
const LAYOUT_KEY = "tj2-trade-form-layout";

interface StoredTrade {
  id: string;
  pair: string;
  side: string;
  entry: number;
  exit: number | null;
  stop: number | null;
  size: number | null;
  setups: string[];
  timeframe: string;
  notes: string;
  reason: string;
  conviction: number | null;
  tags?: string[];
}

async function openEditor(page: Page): Promise<Locator> {
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  await fab(page).click();
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });
  await expect(editor).toBeVisible();
  await expect(editor.locator("[inert] #f-entry")).toHaveCount(0); // the open morph has lifted `inert`
  await expect(editor.locator("#f-entry")).toBeVisible();
  await page.waitForTimeout(500);
  return editor;
}

const group = (editor: Locator, title: string) => editor.getByRole("button", { name: new RegExp(`^${title}`) });

/** Scrolls the sheet body until `target` is in view (a tap or fill would do it too; this keeps the checks explicit). */
async function toView(target: Locator) {
  await target.scrollIntoViewIfNeeded();
}

test.describe("short trade form", () => {
  test("a trade with the six core fields only: nothing else is on screen, the save bar stays at the bottom", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { shortForm: true });
    const editor = await openEditor(page);

    // six core fields visible, the six groups closed (their controls are not visible, not focusable)
    await expect(editor.getByTestId("form-core")).toBeVisible();
    await expect(editor.locator("#f-pair")).toBeVisible();
    await expect(editor.getByRole("radiogroup", { name: "Richtung" })).toBeVisible();
    for (const id of ["#f-date", "#f-entry", "#f-exit", "#f-size"]) await expect(editor.locator(id)).toBeVisible();
    for (const id of ["#f-stop", "#f-target", "#f-lev", "#f-fees", "#f-pnl", "#f-reason", "#f-notes", "#f-chart", "#f-tf"]) await expect(editor.locator(id)).toBeHidden();
    const visibleFields = await editor.evaluate((d) => Array.from(d.querySelectorAll("form [data-field]")).filter((el) => el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== "hidden").length);
    expect(visibleFields).toBe(6);
    for (const title of ["Details", "Ziele und Ausstieg", "Ausführung", "Setup und Einstiegs-Check", "Disziplin und Psyche", "Notizen und Bewertung"]) await expect(group(editor, title)).toHaveAttribute("aria-expanded", "false");

    // the short form fits: the first three fields need no long scroll (before: Einstieg 1.446 px, Größe 1.705 px under the top on a phone)
    const dims = await editor.evaluate((d) => {
      const body = d.querySelector("form")!.closest<HTMLElement>(".overflow-y-auto")!;
      const form = d.querySelector("form")!;
      return { form: Math.round(form.getBoundingClientRect().height), body: body.clientHeight, sizeBottom: Math.round(d.querySelector("#f-size")!.getBoundingClientRect().bottom - form.getBoundingClientRect().top) };
    });
    console.log(`SHORT-FORM ${info.project.name}: Formular ${dims.form} px, Sichtfenster ${dims.body} px, Größe endet ${dims.sizeBottom} px unter dem Anfang`);
    expect(dims.form).toBeLessThan(1100);
    expect(dims.sizeBottom).toBeLessThan(dims.body + 120);
    await screenshot(page, info, "editor-short");

    // the save bar is the sheet's footer: in the viewport, at the bottom of the panel, before and after scrolling the body
    const save = editor.getByRole("button", { name: "Speichern", exact: true });
    const bottomGap = async () => page.evaluate(() => innerHeight - document.querySelector('[role="dialog"] button[type="submit"]')!.getBoundingClientRect().bottom);
    const before = await bottomGap();
    await editor.locator("#f-size").fill("4000");
    await editor.evaluate((d) => d.querySelector("form")!.closest<HTMLElement>(".overflow-y-auto")!.scrollTo({ top: 400, behavior: "instant" }));
    expect(Math.abs((await bottomGap()) - before)).toBeLessThan(1);
    await expect(save).toBeInViewport();

    await editor.locator("#f-entry").fill("80000");
    await editor.locator("#f-exit").fill("81500");
    await save.click();
    await expect(editor).toBeHidden();
    await expect(toast(page)).toContainText("Trade gespeichert");
    const trades = (await stored<StoredTrade[]>(page, "tj2-trades")) ?? [];
    const t = trades.find((x) => x.entry === 80000 && x.exit === 81500);
    expect(t, "the trade saved with six fields").toBeTruthy();
    expect(t).toMatchObject({ size: 4000, side: "long", stop: null, notes: "" });
    expect(trades).toHaveLength(14);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a group opens by its header, its field takes input and is saved; closing it keeps the input", async ({ page }, info) => {
    await seed(page, { shortForm: true });
    const editor = await openEditor(page);
    const head = group(editor, "Ziele und Ausstieg");
    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await expect(editor.locator("#f-stop")).toBeVisible();
    await editor.locator("#f-stop").fill("79200");
    await expect(editor.getByTestId("form-group-targets-filled")).toHaveText("1 ausgefüllt");
    await head.click();
    await expect(editor.locator("#f-stop")).toBeHidden();
    await head.click();
    await expect(editor.locator("#f-stop")).toHaveValue("79200");
    await screenshot(page, info, "editor-group-open");
    await editor.locator("#f-entry").fill("80000");
    await editor.locator("#f-exit").fill("81500");
    await editor.locator("#f-size").fill("4000");
    await editor.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(editor).toBeHidden();
    const t = ((await stored<StoredTrade[]>(page, "tj2-trades")) ?? []).find((x) => x.entry === 80000 && x.exit === 81500);
    expect(t?.stop).toBe(79200);
  });

  test("Felder anpassen: Stop-Loss into the core, kept after a reload; Zurücksetzen puts it back", async ({ page }, info) => {
    await seed(page, { shortForm: true });
    let editor = await openEditor(page);
    await editor.getByTestId("customize-open").click();
    const custom = editor.getByTestId("field-customizer");
    await expect(custom).toBeVisible();
    await expect(editor.getByTestId("customize-core-count")).toHaveText("Kern: 6 Felder");
    await expect(editor.getByTestId("customize-reset")).toBeDisabled();
    await screenshot(page, info, "editor-customize");
    await editor.getByTestId("cz-stop").selectOption("core");
    await expect(editor.getByTestId("customize-core-count")).toHaveText("Kern: 7 Felder");
    expect(await stored<{ v: number; moved: Record<string, string> }>(page, LAYOUT_KEY)).toEqual({ v: 1, moved: { stop: "core" } });
    await editor.getByTestId("customize-done").click();
    await expect(custom).toBeHidden();
    await expect(editor.getByTestId("form-core").locator("#f-stop")).toBeVisible();
    // a field of the core that moves out disappears from it
    await editor.getByTestId("customize-open").click();
    await editor.getByTestId("cz-size").selectOption("targets");
    await editor.getByTestId("customize-done").click();
    await expect(editor.locator("#f-size")).toBeHidden();
    await group(editor, "Ziele und Ausstieg").click();
    await expect(editor.locator("#f-size")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();

    // reload: the layout of this device is still there
    await page.reload();
    editor = await openEditor(page);
    await expect(editor.getByTestId("form-core").locator("#f-stop")).toBeVisible();
    await expect(editor.getByTestId("form-core").locator("#f-size")).toHaveCount(0);

    // reset
    await editor.getByTestId("customize-open").click();
    await expect(editor.getByTestId("customize-core-count")).toHaveText("Kern: 6 Felder");
    await editor.getByTestId("customize-reset").click();
    await expect(editor.getByTestId("customize-note")).toHaveText("Auf die Voreinstellung zurückgesetzt.");
    expect(await stored(page, LAYOUT_KEY)).toBeNull();
    await editor.getByTestId("customize-done").click();
    await expect(editor.locator("#f-stop")).toBeHidden();
    await expect(editor.getByTestId("form-core").locator("#f-size")).toBeVisible();
  });

  test("Letzten Trade duplizieren: setting taken over, one sentence says so, the prices stay empty", async ({ page }, info) => {
    await seed(page, { shortForm: true });
    const editor = await openEditor(page);
    const trades0 = (await stored<StoredTrade[]>(page, "tj2-trades")) ?? [];
    const last = [...trades0].sort((a, b) => String((b as unknown as { date: string }).date).localeCompare(String((a as unknown as { date: string }).date)))[0]!;
    await editor.getByTestId("duplicate-last").click();
    const note = editor.getByTestId("duplicate-note");
    await expect(note).toContainText("Vom letzten Trade übernommen:");
    await expect(note).toContainText(`Symbol ${last.pair}`);
    await expect(note).toContainText("ohne Preise, Ergebnis, Zeiten und Notizen");
    await expect(editor.locator("#f-pair")).toHaveValue(last.pair);
    await expect(editor.locator("#f-entry")).toHaveValue("");
    await expect(editor.locator("#f-exit")).toHaveValue("");
    await screenshot(page, info, "editor-duplicated");
    await editor.locator("#f-entry").fill("80000");
    await editor.locator("#f-exit").fill("81000");
    if (last.size == null) await editor.locator("#f-size").fill("1000");
    else await expect(editor.locator("#f-size")).not.toHaveValue("");
    await editor.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(editor).toBeHidden();
    const saved = ((await stored<StoredTrade[]>(page, "tj2-trades")) ?? []).find((x) => x.entry === 80000 && x.exit === 81000);
    expect(saved).toMatchObject({ pair: last.pair, side: last.side, setups: last.setups, timeframe: last.timeframe });
    expect(saved?.notes).toBe("");
    expect(saved?.reason).toBe("");
    expect(saved?.conviction).toBeNull();
  });

  test("Letzten Trade duplizieren on the trades page opens a pre-filled new trade and says what was taken", async ({ page }, info) => {
    await seed(page, { shortForm: true });
    await page.goto("/#trades");
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    await page.waitForTimeout(800);
    await page.getByTestId("trades-duplicate-last").click();
    const editor = page.getByRole("dialog", { name: "Trade eintragen" });
    await expect(editor).toBeVisible();
    await expect(editor.locator("#f-entry")).toBeVisible();
    await expect(editor.locator("#f-entry")).toHaveValue("");
    await expect(toast(page)).toContainText("Vom letzten Trade übernommen");
    await screenshot(page, info, "trades-duplicate");
  });

  test("an error in a closed group: the group opens, the field is focused, the page does not jump", async ({ page }, info) => {
    await seed(page, { shortForm: true });
    const editor = await openEditor(page);
    // Einstieg moves into a group the trader keeps closed
    await editor.getByTestId("customize-open").click();
    await editor.getByTestId("cz-entry").selectOption("details");
    await editor.getByTestId("customize-done").click();
    await expect(editor.locator("#f-entry")).toBeHidden();
    await editor.locator("#f-exit").fill("81000");
    await editor.locator("#f-size").fill("1000");
    const y0 = await page.evaluate(() => window.scrollY);
    await editor.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("Bitte einen Einstiegspreis angeben.");
    await expect(group(editor, "Details")).toHaveAttribute("aria-expanded", "true");
    await expect(editor.locator("#f-entry")).toBeVisible();
    await expect(editor.locator("#f-entry")).toBeFocused();
    await expect(editor.locator("#f-entry")).toHaveAttribute("aria-invalid", "true");
    // the field is in view inside the sheet body; the page behind the sheet did not scroll
    await expect(editor.locator("#f-entry")).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBe(y0);
    await screenshot(page, info, "editor-error-jump");
    // fixing it saves
    await editor.locator("#f-entry").fill("80000");
    await editor.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(editor).toBeHidden();
  });

  test("touch targets: every tappable thing in the short form takes a 44 × 44 px tap (core, headers, customiser)", async ({ page }, info) => {
    test.skip(!hasTouch(info), "touch projects (a coarse pointer)");
    await seed(page, { shortForm: true });
    const editor = await openEditor(page);
    const report = (misses: HitBoxMiss[]) => misses.map((m) => `${m.where} · ${m.name} ${m.w}×${m.h} → tappable ${m.ew}×${m.eh} (taken by ${m.stolenBy})`).join("\n");
    const audit = async () => (await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[role="dialog"]' })).filter((m) => m.w > 1);
    let misses = await audit();
    expect(misses, `core + closed groups:\n${report(misses)}`).toEqual([]);
    for (const title of ["Details", "Ziele und Ausstieg", "Setup und Einstiegs-Check", "Disziplin und Psyche", "Notizen und Bewertung"]) await group(editor, title).click();
    await page.waitForTimeout(700);
    misses = await audit();
    expect(misses, `groups open:\n${report(misses)}`).toEqual([]);
    await editor.getByTestId("customize-open").click();
    await page.waitForTimeout(500);
    misses = await audit();
    expect(misses, `customiser:\n${report(misses)}`).toEqual([]);
  });

  test("keyboard: a group header opens with Enter, the customiser select works without a mouse", async ({ page }, info) => {
    test.skip(isMobile(info), "keyboard path (desktop)");
    await seed(page, { shortForm: true });
    const editor = await openEditor(page);
    const head = group(editor, "Notizen und Bewertung");
    await head.focus();
    await page.keyboard.press("Enter");
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await toView(editor.locator("#f-notes"));
    await expect(editor.locator("#f-notes")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(head).toHaveAttribute("aria-expanded", "false");
  });
});
