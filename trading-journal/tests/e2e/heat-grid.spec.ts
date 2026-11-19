/**
 * Dense grids as touch targets (round 5). The weekday × time heat map (Analyse and the Cockpit widget: 21 px cells on a 24 px
 * pitch) cannot give every cell a 44 px area next to its neighbours, so on coarse pointers the GRID is the target
 * (`data-hit-grid`, audited by `hitbox.ts`): its gaps and an invisible 12 px halo around it belong to it, and a tap there picks the
 * cell whose centre is nearest. These are real taps (`page.touchscreen.tap`), on the touch projects.
 * No clock, no dependence on the market mock.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { hasTouch, seed, settledBox } from "./helpers";

const cell = (page: Page, i: number): Locator => page.locator(`[data-testid="heat-cell"][data-cell="${i}"]`);

async function open(page: Page, route: "analyse" | "cockpit"): Promise<void> {
  await seed(page);
  await page.goto(`/#${route}`);
  await expect(page.locator(`[data-page="${route}"][data-page-role="current"] h1`).first()).toBeAttached({ timeout: 30_000 });
  const first = cell(page, 0);
  await expect(first).toBeAttached({ timeout: 30_000 });
  await first.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  // the cells cascade in (opacity + scale) – the grid is ready when the last cell rests
  await settledBox(cell(page, 83));
  await expect(page.locator('[data-fx="heat-grid"][data-hit-grid]').first()).toHaveAttribute("data-hit-grid", "24");
}

/** Taps the point `at(box)` computed from cell `from`'s settled box and expects cell `expected` to be the pressed one afterwards. */
async function tapBeside(page: Page, from: number, at: (b: { x: number; y: number; width: number; height: number }) => { x: number; y: number }, expected: number) {
  const box = await settledBox(cell(page, from));
  const p = at(box);
  await page.touchscreen.tap(p.x, p.y);
  await expect(cell(page, expected), `a tap at ${Math.round(p.x)}, ${Math.round(p.y)} picks cell ${expected}`).toHaveAttribute("aria-pressed", "true");
}

for (const route of ["analyse", "cockpit"] as const) {
  test.describe(`weekday × time heat map – ${route}`, () => {
    test.beforeEach(({ page }, info) => {
      void page;
      test.skip(!hasTouch(info), "coarse pointer: touch projects only (the halo exists for `pointer: coarse`)");
    });

    test("the grid is the target: 24 px pitch, a tap in a gap or in the halo picks the nearest cell, a tap on a cell picks it", async ({ page }) => {
      await open(page, route);
      // WCAG 2.5.8: the pitch of neighbouring cells (21 px cell + 3 px gap) is at least 24 px both ways
      const a = await settledBox(cell(page, 30));
      const right = await settledBox(cell(page, 31));
      const below = await settledBox(cell(page, 42));
      expect(right.x - a.x, "column pitch").toBeGreaterThanOrEqual(23.5);
      expect(below.y - a.y, "row pitch").toBeGreaterThanOrEqual(23.5);
      // on the cell itself
      await tapBeside(page, 31, (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }), 31);
      // in the gap 0,8 px beyond its right edge: nearer to 30 than to 31
      await tapBeside(page, 30, (b) => ({ x: b.x + b.width + 0.8, y: b.y + b.height / 2 }), 30);
      // in the gap 0,8 px below its bottom edge
      await tapBeside(page, 31, (b) => ({ x: b.x + b.width / 2, y: b.y + b.height + 0.8 }), 31);
      // the halo: 6 px left of the first column (row 3), 6 px above the first row (column 6), 6 px right of the last column, 6 px below the last row
      await tapBeside(page, 36, (b) => ({ x: b.x - 6, y: b.y + b.height / 2 }), 36);
      await tapBeside(page, 6, (b) => ({ x: b.x + b.width / 2, y: b.y - 6 }), 6);
      await tapBeside(page, 47, (b) => ({ x: b.x + b.width + 6, y: b.y + b.height / 2 }), 47);
      await tapBeside(page, 78, (b) => ({ x: b.x + b.width / 2, y: b.y + b.height + 6 }), 78);
    });
  });
}
