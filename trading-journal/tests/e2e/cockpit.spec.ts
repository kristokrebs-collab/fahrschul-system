/**
 * P13 Cockpit end to end on the fixture journal (dev harness `/dev/ux.html?view=cockpit`, see `uxHarness.ts`; once P14
 * routes the page: `PW_COCKPIT_URL=/#cockpit`). Covered: `h1 Cockpit` with the real cards of the starter board, a
 * widget from the catalog (filter, add, the "NEU" entrance settles), "Anordnen" (wider by button, moved by keyboard:
 * Space, arrow, Space – the WidgetGrid drag), the layout written to `tj2-cockpit` and still there after a reload, a
 * second dashboard (empty state → a widget), no horizontal scroll at 390 px, no console errors.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, stored } from "./helpers";
import { openUx, UX_PROJECTS, UX_SKIP } from "./uxHarness";

interface Layout {
  active: string;
  boards: { id: string; name: string; items: { id: string; span: number }[] }[];
}

const layout = async (page: Page) => (await stored<Layout>(page, "tj2-cockpit"))!;
const tile = (page: Page, id: string) => page.locator(`[data-widget="${id}"]`);

test.describe("Cockpit", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "P13 runs on mobile + desktop");
  });

  test("starter board with the real cards; a widget from the catalog enters and stays after a reload", async ({ page }) => {
    const errors = collectErrors(page);
    test.skip(!(await openUx(page, "cockpit")), UX_SKIP);
    await expect(page.getByRole("heading", { level: 1, name: "Cockpit" })).toBeVisible();
    // the existing cards, unchanged, inside the tiles
    await expect(tile(page, "ov-equity")).toBeVisible();
    await expect(tile(page, "ov-winrate")).toBeVisible();
    await expect(tile(page, "ov-ranking").getByRole("heading").first()).toBeVisible();
    await expect(page.getByRole("radio", { name: "Mein Cockpit" })).toHaveAttribute("aria-checked", "true");
    await expectNoHorizontalScroll(page);

    await page.getByTestId("cockpit-add").click();
    const catalog = page.getByTestId("widget-catalog");
    await expect(catalog).toBeVisible();
    await expect(catalog.locator('[data-widget-add="ov-equity"]')).toBeDisabled();
    await catalog.getByRole("searchbox", { name: "Widgets filtern" }).fill("unterwasser");
    await catalog.locator('[data-widget-add="in-drawdown"]').click();
    await expect(catalog.locator('[data-widget-add="in-drawdown"]')).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(catalog).toBeHidden();
    await expect(tile(page, "in-drawdown")).toBeVisible();
    // the "NEU" cover dives through and is gone
    await expect(tile(page, "in-drawdown").locator('[aria-label="Neues Widget"]')).toHaveCount(0, { timeout: 8_000 });
    expect((await layout(page)).boards[0]!.items.at(-1)).toEqual({ id: "in-drawdown", span: 7 });

    await page.reload();
    await expect(tile(page, "in-drawdown")).toBeVisible({ timeout: 20_000 });
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("Anordnen: wider by button, moved by keyboard, written through", async ({ page }) => {
    const errors = collectErrors(page);
    test.skip(!(await openUx(page, "cockpit")), UX_SKIP);
    await page.getByTestId("cockpit-arrange").click();
    const grid = page.getByRole("list", { name: "Widgets" });
    await expect(grid).toBeVisible();
    await expect(page.getByText("Gedrückt halten und ziehen – oder Leertaste, Pfeiltasten, Leertaste.")).toBeVisible();

    await page.getByRole("button", { name: "Win-Rate: Breiter" }).click();
    expect((await layout(page)).boards[0]!.items[1]).toEqual({ id: "ov-winrate", span: 5 });

    // keyboard drag: Space lifts, → moves one slot, Space drops
    const first = grid.getByRole("listitem").first();
    await first.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await expect.poll(async () => (await layout(page)).boards[0]!.items.slice(0, 2).map((i) => i.id)).toEqual(["ov-winrate", "ov-equity"]);

    await page.getByRole("button", { name: "Win-Rate: Entfernen" }).click();
    await expect.poll(async () => (await layout(page)).boards[0]!.items.some((i) => i.id === "ov-winrate")).toBe(false);
    await expectNoHorizontalScroll(page);

    await page.getByTestId("cockpit-arrange").click();
    await expect(page.getByTestId("cockpit-grid")).toBeVisible();
    await expect(tile(page, "ov-winrate")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a second dashboard starts empty, gets a widget from the empty state, and the switch is remembered", async ({ page }) => {
    const errors = collectErrors(page);
    test.skip(!(await openUx(page, "cockpit")), UX_SKIP);
    await page.getByTestId("cockpit-new-board").click();
    await expect(page.getByText("Noch keine Widgets")).toBeVisible();
    const name = page.getByRole("textbox", { name: "Name des Dashboards" });
    await name.fill("Nur Scalps");
    await name.press("Enter");
    await expect(page.getByRole("radio", { name: "Nur Scalps" })).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("cockpit-arrange").click();

    await page.getByRole("button", { name: "Widget hinzufügen" }).last().click();
    const catalog = page.getByTestId("widget-catalog");
    await catalog.locator('[data-widget-add="ov-recent"]').click();
    await page.keyboard.press("Escape");
    await expect(catalog).toBeHidden();
    await expect(tile(page, "ov-recent")).toBeVisible();

    const l = await layout(page);
    expect(l.boards).toHaveLength(3);
    expect(l.boards.find((b) => b.id === l.active)).toMatchObject({ name: "Nur Scalps", items: [{ id: "ov-recent", span: 7 }] });

    await page.getByRole("radio", { name: "Risiko" }).click();
    await expect(tile(page, "risk-limits")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("radio", { name: "Risiko" })).toHaveAttribute("aria-checked", "true", { timeout: 20_000 });
    expect(errors).toEqual([]);
  });
});
