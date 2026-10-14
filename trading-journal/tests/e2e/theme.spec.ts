/**
 * P13 themes end to end (the integrated app, see `uxHarness.ts`):
 *   - dark stays the default (attributes, `color-scheme`, `theme-color`, the ink page),
 *   - `t` switches to light with the circular reveal, persists, and a reload paints light from the first React commit
 *     (applied in `main.tsx` before the render – no flash, no inline script),
 *   - the "Darstellung" card: Hell / System (follows the OS live) / an accent,
 *   - light-mode contrast of the text tokens on every plane, the overview hero as a dark island, the canvas charts on
 *     the light ink, no horizontal scroll, no console errors,
 *   - every page of the app (P14 light-mode pass) in BOTH themes: no horizontal scroll, no console errors; in light the
 *     page's text passes axe `color-contrast` (WCAG AA – the dark theme's faint ink is ~3 : 1 by design and stays out),
 *   - the canvas charts follow a theme switch made while they are on screen (the chart palette is read live).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, stored } from "./helpers";
import { openUx, themeSettled, UX_PROJECTS } from "./uxHarness";

/** Every page of the app (`PAGES` in `src/store/uiStore.ts` – the store module itself cannot be imported here). */
const PAGES = ["overview", "trades", "setups", "settings", "markt", "analyse", "risiko", "coach", "berichte", "labor", "wachstum", "community", "cockpit", "konto", "preise"] as const;

const css = (page: Page, name: string, sel = ":root") => page.evaluate(([n, s]) => getComputedStyle(document.querySelector(s!)!).getPropertyValue(n!).trim(), [name, sel] as const);

test.describe("Themes", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "P13 runs on mobile + desktop");
  });

  test("dark is the default: attributes, color-scheme, theme-color and the ink page", async ({ page }) => {
    const errors = collectErrors(page);
    await openUx(page, "app", "overview");
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
    await openUx(page, "app", "overview");
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
    await openUx(page, "cards");
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
    await openUx(page, "cards", "", { theme: "light" });
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
    await openUx(page, "app", "overview", { theme: "light" });
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

  // Every page in both themes (the light pass of P14): the page comes up in the stored theme, the layout never scrolls
  // sideways, nothing logs an error; light-mode text is readable (axe colour contrast, WCAG AA) once the entrances ran.
  for (const name of PAGES) {
    for (const theme of ["dark", "light"] as const) {
      test(`${name} (${theme}): no horizontal scroll, no console errors${theme === "light" ? ", readable text" : ""}`, async ({ page }) => {
        test.setTimeout(90_000);
        const errors = collectErrors(page);
        await openUx(page, "app", name, theme === "light" ? { theme: "light" } : {});
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await settlePage(page);
        await expectNoHorizontalScroll(page);
        if (theme === "light") {
          const res = await new AxeBuilder({ page }).include(`[data-page="${name}"][data-page-role="current"]`).withRules(["color-contrast"]).analyze();
          const lines = res.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary ?? v.help}`));
          expect(lines, `${name}: light-mode colour contrast`).toEqual([]);
        }
        expect(errors).toEqual([]);
      });
    }
  }

  test("a theme switch repaints the canvas charts that are on screen (live chart palette)", async ({ page }) => {
    const errors = collectErrors(page);
    await openUx(page, "app", "markt");
    const ink = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--chart-ink-veil").trim());
    // (the CSS minifier may shorten the hex)
    expect(await ink()).toMatch(/^#fff(fff)?$/i);
    // the box chart's pane canvas – not just the page's first canvas: a „Beste Setups“ card above it carries its own
    // canvas once the seeded market yields a setup (Box-zu-Box reads Top Trader like the Einstiegs-Check since MM-4)
    const chart = page.locator('[data-page="markt"][data-page-role="current"] [data-testid="markt-chart"] canvas').first();
    await chart.waitFor();
    await chart.scrollIntoViewIfNeeded();
    // the pane canvas in the ink theme: candles in near-white ink, the volume bars as a faint WHITE veil (low alpha)
    const ink2 = () =>
      chart.evaluate((c: HTMLCanvasElement) => {
        if (!c.width || !c.height) return null;
        // read a copy (one readback per throwaway canvas – repeated reads of the chart's own canvas make Chrome warn)
        const copy = document.createElement("canvas");
        copy.width = c.width;
        copy.height = c.height;
        const ctx = copy.getContext("2d", { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(c, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        const n = { solidLight: 0, solidDark: 0, veilLight: 0, veilDark: 0 };
        for (let i = 0; i < d.length; i += 4) {
          const a = d[i + 3]!;
          const l = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
          if (a >= 200) {
            if (l > 200) n.solidLight++;
            else if (l < 60) n.solidDark++;
          } else if (a >= 10 && a <= 90) {
            if (l > 200) n.veilLight++;
            else if (l < 60) n.veilDark++;
          }
        }
        return n;
      });
    await expect.poll(async () => (await ink2())?.solidLight ?? 0, { timeout: 15_000 }).toBeGreaterThan(50);
    expect((await ink2())?.veilLight ?? 0).toBeGreaterThan(50);
    await page.locator("body").press("t");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await themeSettled(page);
    expect(await ink()).toBe("#0b0b0b");
    // the same canvas, repainted in the paper theme: candles in ink, and the volume veil (per-bar colours) dark too
    await expect.poll(async () => (await ink2())?.solidDark ?? 0, { timeout: 15_000 }).toBeGreaterThan(50);
    await expect.poll(async () => (await ink2())?.veilDark ?? 0, { timeout: 15_000 }).toBeGreaterThan(50);
    expect((await ink2())?.veilLight ?? 0).toBeLessThan(20);
    expect(errors).toEqual([]);
  });
});

/** Lets a page's entrances play: a walk to the bottom (in-view reveals) and back, then a short rest. */
async function settlePage(page: Page): Promise<void> {
  await page.waitForTimeout(800);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 700) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
}
