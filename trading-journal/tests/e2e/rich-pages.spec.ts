/**
 * Runde 10 – the rich pages (`[data-rich]`: every page except the Übersicht and the Cockpit): header aura / ghost word, pulled-up
 * title words, empty-state art, tile wave, tilt that lets go again. The same spec proves what must NOT change: the Übersicht
 * and the Cockpit carry none of it, reduced motion mounts none of it, and a touch device gets no pointer spotlight.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, seed, waitForStableLayout } from "./helpers";

const layer = (key: string) => `[data-page="${key}"][data-page-role="current"]`;

async function open(page: import("@playwright/test").Page, key: string, opts: Parameters<typeof seed>[1] = {}): Promise<void> {
  await seed(page, opts);
  await page.goto(`/#${key}`);
  await expect(page.locator(`${layer(key)} h1`).first()).toBeAttached({ timeout: 30_000 });
  await waitForStableLayout(page);
}

test.describe("Übersicht und Cockpit bleiben, wie sie waren", () => {
  for (const key of ["overview", "cockpit"] as const) {
    test(`${key}: kein Seitenlicht, kein Geisterwort, keine hochgezogenen Wörter, kein data-rich`, async ({ page }) => {
      await open(page, key);
      await expect(page.locator(layer(key))).not.toHaveAttribute("data-rich", /.*/);
      await expect(page.locator(`${layer(key)} [data-testid="rich-aura"]`)).toHaveCount(0);
      await expect(page.locator(`${layer(key)} [data-testid="empty-art"]`)).toHaveCount(0);
      await expect(page.locator(`${layer(key)} .rich-float`)).toHaveCount(0);
      await expect(page.locator(`${layer(key)} h1 [class*="clip-path"]`)).toHaveCount(0);
    });
  }
});

test.describe("reiche Seiten: Barrierefreiheit (axe, hell und dunkel)", () => {
  test.setTimeout(240_000);
  const CASES: readonly { key: string; empty?: boolean; what: string }[] = [
    { key: "coach", what: "Coach (Seitenlicht, Geisterwort, Karten)" },
    { key: "wachstum", what: "Wachstum (Flamme, Abschnittstitel)" },
    { key: "trades", empty: true, what: "leere Trades-Liste (laufendes Bild)" },
    { key: "funktionen", what: "Funktionen (Kacheln)" },
  ];
  for (const theme of ["dark", "light"] as const) {
    for (const c of CASES) {
      test(`${c.what} (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== "desktop", "one viewport is enough for the contrast of the new layers");
        await open(page, c.key, { empty: c.empty, extra: { "tj2-theme": JSON.stringify(theme) } });
        await page.waitForFunction(() => !document.documentElement.hasAttribute("data-theme-switching"), null, { timeout: 5_000 });
        // scroll through once, so the deferred cells and the revealed cards exist when axe looks
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < h + 1200; y += 600) {
          await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
          await page.waitForTimeout(60);
        }
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        await page.waitForTimeout(1200);
        const res = await new AxeBuilder({ page }).include(layer(c.key)).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
        expect(lines, `${c.what}: axe violations`).toEqual([]);
      });
    }
  }
});

test.describe("reiche Seiten", () => {
  test("Coach: Seitenlicht hinter der Kopfzeile, Titel bleibt der Titel, nichts läuft über den Rand", async ({ page }, info) => {
    await open(page, "coach");
    await expect(page.locator(layer("coach"))).toHaveAttribute("data-rich", "");
    const aura = page.locator(`${layer("coach")} [data-testid="rich-aura"]`);
    await expect(aura).toBeAttached({ timeout: 15_000 });
    await expect(aura).toHaveAttribute("aria-hidden", "true");
    // the title is the plain title for assistive technology and for the page's focus handling
    await expect(page.locator(`${layer("coach")} h1`)).toHaveText("Coach");
    await expect(page.getByRole("heading", { level: 1, name: "Coach" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    // a mouse gets the spotlight, a touch device does not
    const spot = aura.locator(".rich-aura__spot");
    if (info.project.name === "desktop") await expect(spot).toHaveCount(1);
    else await expect(spot).toHaveCount(0);
    // the aura takes no clicks and covers nothing: the segmented control of the header still answers
    await page.getByRole("radio", { name: "Makro" }).or(page.getByRole("button", { name: "Makro" })).first().click();
  });

  test("Coach: Reduced Motion – kein Seitenlicht, Wörter stehen sofort", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "coach");
    await expect(page.locator(`${layer("coach")} [data-testid="rich-aura"]`)).toHaveCount(0);
    await expect(page.locator(`${layer("coach")} h1 [class*="clip-path"]`)).toHaveCount(0);
    await expect(page.locator(`${layer("coach")} h1`)).toHaveText("Coach");
  });

  test("leere Trades-Liste: ein laufendes Bild in der reservierten Box, die Aktion bleibt", async ({ page }) => {
    await open(page, "trades", { empty: true });
    const art = page.locator(`${layer("trades")} [data-testid="empty-art"]`);
    await expect(art).toBeAttached({ timeout: 15_000 });
    await expect(art).toHaveAttribute("data-kind", "draw");
    const box = await art.boundingBox();
    expect(box?.width).toBeCloseTo(64, 0);
    expect(box?.height).toBeCloseTo(40, 0);
    await expect(page.locator(layer("trades")).getByRole("button", { name: "Trade eintragen" })).toBeVisible();
  });

  test("Funktionen: alle Kacheln da, eine Kachel lässt nach dem Hover wieder los (transform: none)", async ({ page }, info) => {
    await open(page, "funktionen");
    const tiles = page.locator(`${layer("funktionen")} [data-testid="funktionen-tile"]`);
    await expect(tiles).toHaveCount(12);
    await expect(tiles.last()).toBeVisible();
    if (info.project.name !== "desktop") return;
    const first = tiles.first();
    await first.scrollIntoViewIfNeeded();
    const box = (await first.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.2);
    await page.waitForTimeout(400);
    // the wrapper that tilts is the tile's parent; once the pointer is gone it rests on `none`
    await page.mouse.move(2, 2);
    await expect.poll(() => first.evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).transform), { timeout: 5000 }).toBe("none");
    await expectNoHorizontalScroll(page);
  });

  test("Funktionen: Treffer gleiten, die Liste zeigt genau die Treffer", async ({ page }) => {
    await open(page, "funktionen");
    const field = page.getByTestId("feature-search-input");
    await field.fill("risiko");
    const results = page.getByTestId("funktionen-results");
    await expect(results).toBeVisible();
    const rowsOf = () => page.locator(`${layer("funktionen")} [data-testid="funktionen-results"] li`).count();
    const settled = async (): Promise<boolean> => (await rowsOf()) === Math.min(12, Number(await results.getAttribute("data-n")));
    // the rows on the page are exactly the hits (at most 12) – for the first query and after the query changed (no leftover row of the old one)
    await expect.poll(settled).toBe(true);
    expect(await rowsOf()).toBeGreaterThan(0);
    await field.fill("Wochenbericht");
    await expect(results).toBeVisible();
    await expect.poll(settled).toBe(true);
    expect(await rowsOf()).toBeGreaterThan(0);
  });

  test("Wachstum: laufende Serien tragen eine Flamme, der Titel bleibt der Titel", async ({ page }) => {
    await open(page, "wachstum");
    await expect(page.locator(layer("wachstum"))).toHaveAttribute("data-rich", "");
    const live = page.locator(`${layer("wachstum")} [data-testid^="streak-"][data-current]:not([data-current="0"])`);
    const flames = page.locator(`${layer("wachstum")} [data-testid="streak-flame"]`);
    expect(await flames.count()).toBe(await live.count());
    await expect(page.locator(`${layer("wachstum")} h1`)).toHaveText("Wachstum");
  });
});
