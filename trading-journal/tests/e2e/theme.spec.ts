/**
 * P13 themes end to end (dev harness `/dev/ux.html`, see `uxHarness.ts`):
 *   - dark stays the default (attributes, `color-scheme`, `theme-color`, the ink page),
 *   - `t` switches to light with the circular reveal, persists, and a reload paints light from the first React commit
 *     (applied in `main.tsx` before the render – no flash, no inline script),
 *   - the "Darstellung" card: Hell / System (follows the OS live) / an accent,
 *   - light-mode contrast of the text tokens on every plane, the overview hero as a dark island, the canvas charts on
 *     the light ink, no horizontal scroll, no console errors.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, stored } from "./helpers";
import { openUx, themeSettled, UX_PROJECTS, UX_SKIP } from "./uxHarness";

const css = (page: Page, name: string, sel = ":root") => page.evaluate(([n, s]) => getComputedStyle(document.querySelector(s!)!).getPropertyValue(n!).trim(), [name, sel] as const);

test.describe("Themes", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "P13 runs on mobile + desktop");
  });

  test("dark is the default: attributes, color-scheme, theme-color and the ink page", async ({ page }) => {
    const errors = collectErrors(page);
    test.skip(!(await openUx(page, "app", "overview")), UX_SKIP);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(html).toHaveAttribute("data-theme-pref", "dark");
    await expect(html).not.toHaveAttribute("data-accent", /.*/);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toContain("dark");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0a0a0a");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(10, 10, 10)");
    expect(errors).toEqual([]);
  });

  test("t switches to light with the reveal, persists, and the reload is light from the first commit", async ({ page }) => {
    const errors = collectErrors(page);
    // records whether the switch ran its transition and which theme the root had at React's first commit
    await page.addInitScript(() => {
      const w = window as unknown as {
        __switching?: boolean;
        __firstCommitTheme?: string;
      };
      // the View Transition marks the root; the fallback (no VT API, or safe-fx in a software-rendered browser) adds a disc
      // (observes the Document: an init script runs before the parser has created <html>)
      new MutationObserver((ms) => {
        for (const m of ms) {
          if (m.attributeName === "data-theme-switching" && document.documentElement.hasAttribute("data-theme-switching")) w.__switching = true;
          m.addedNodes.forEach((n) => {
            if (n instanceof HTMLElement && n.dataset.layer === "Theme-Wechsel") w.__switching = true;
          });
        }
      }).observe(document, {
        attributes: true,
        attributeFilter: ["data-theme-switching"],
        childList: true,
        subtree: true,
      });
      const watchRoot = () => {
        const root = document.getElementById("root");
        if (!root) return requestAnimationFrame(watchRoot);
        const mo = new MutationObserver(() => {
          w.__firstCommitTheme ??= document.documentElement.dataset.theme ?? "(none)";
          mo.disconnect();
        });
        mo.observe(root, { childList: true });
      };
      watchRoot();
    });
    test.skip(!(await openUx(page, "app", "overview")), UX_SKIP);
    await page.locator("body").press("t");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await themeSettled(page);
    expect(await page.evaluate(() => (window as unknown as { __switching?: boolean }).__switching)).toBe(true);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#ebebe9");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(235, 235, 233)");
    expect(await stored<{ pref: string }>(page, "tj2-theme")).toMatchObject({
      pref: "light",
    });
    // nothing of the switch is left behind
    expect(await page.locator('[data-layer="Theme-Wechsel"]').count()).toBe(0);

    await page.reload();
    await page.locator("main").waitFor();
    expect(await page.evaluate(() => (window as unknown as { __firstCommitTheme?: string }).__firstCommitTheme)).toBe("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    // and back
    await page.locator("body").press("t");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await themeSettled(page);
    expect(errors).toEqual([]);
  });

  test("Darstellung: Hell, System following the OS live, an accent", async ({ page }) => {
    const errors = collectErrors(page);
    test.skip(!(await openUx(page, "cards")), UX_SKIP);
    const modes = page.getByRole("radiogroup", { name: "Modus" });
    await modes.getByRole("radio", { name: "Hell" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await themeSettled(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await modes.getByRole("radio", { name: "System" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme-pref", "system");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await themeSettled(page);
    await expect(page.getByText(/Folgt der Einstellung deines Geräts\. Gerade: Dunkel\./)).toBeVisible();
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await themeSettled(page);
    await page.getByRole("radiogroup", { name: "Akzent" }).getByRole("radio", { name: "Kobalt" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-accent", "kobalt");
    await themeSettled(page);
    expect(await css(page, "--color-signal")).toBe("#2a55e6");
    expect(await stored(page, "tj2-theme")).toEqual({
      pref: "system",
      accent: "kobalt",
    });
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("light: text tokens keep their contrast on every plane", async ({ page }) => {
    test.skip(!(await openUx(page, "cards", "", { theme: "light" })), UX_SKIP);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const ratios = await page.evaluate(() => {
      const probe = document.createElement("span");
      document.body.appendChild(probe);
      const rgb = (v: string): number[] => {
        probe.style.color = `var(${v})`;
        return getComputedStyle(probe)
          .color.match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
      };
      const lum = ([r, g, b]: number[]) => {
        const f = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
      };
      const ratio = (a: string, b: string) => {
        const [x, y] = [lum(rgb(a)), lum(rgb(b))];
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const planes = ["--color-ink-900", "--color-ink-850", "--color-ink-950", "--color-ink-800"];
      const inks = ["--color-fg", "--color-mute", "--color-faint", "--color-win", "--color-loss", "--color-warn", "--color-danger-text"];
      const out: Record<string, number> = {};
      for (const i of inks) out[i] = Math.min(...planes.map((p) => ratio(i, p)));
      probe.remove();
      return out;
    });
    expect(ratios["--color-fg"]).toBeGreaterThanOrEqual(12);
    // body copy, hints, P&L: WCAG AA for normal text (the dark theme's faint is ~3 : 1 – light is stricter)
    for (const k of ["--color-mute", "--color-win", "--color-loss", "--color-warn", "--color-danger-text"]) expect(ratios[k], k).toBeGreaterThanOrEqual(4.5);
    expect(ratios["--color-faint"]).toBeGreaterThanOrEqual(4.4);
  });

  test("light overview: the hero stays an ink island, charts on the light ink, no horizontal scroll", async ({ page }) => {
    const errors = collectErrors(page);
    test.skip(!(await openUx(page, "app", "overview", { theme: "light" })), UX_SKIP);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const hero = page.locator(":has(> [data-hero-backdrop])").first();
    await hero.waitFor();
    expect(await hero.evaluate((el) => getComputedStyle(el).getPropertyValue("--color-fg").trim())).toBe("#f2f2f2");
    expect(await css(page, "--color-fg")).toBe("#121212");
    // the canvas charts read the light mirrors (chart bridge → applyInk)
    expect(await css(page, "--chart-ink-bg")).toBe("#fdfdfc");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});
