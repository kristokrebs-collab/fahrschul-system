/**
 * Runde 11, A5 „Rahmen“ – the frame the way a reader meets it (mobile 390 + desktop 1440):
 *   - the sidebar is COMPACT at every width (no auto-open from 1,624 px); „Anheften“ keeps it open and the page makes room; the pin survives a reload;
 *   - the search sits on top (a combobox: pages and functions), ↑ ↓ Home End move between rows, Esc closes the peek;
 *   - the rows wave in from the top ONCE per session (45–60 ms apart, 260–340 ms, 8–12 px, opacity) – measured with the Animations API;
 *   - the logo draws stroke after stroke STRICTLY one after the other, in ≤ 1.2 s, once per session, replayable from Einstellungen › Darstellung;
 *   - the motion setting (Wie das Gerät / Reduziert / Volles Profil) is kept and takes the motion away;
 *   - the plan's motion profile comes from the confirmed plan only (Free without payments – a browser flag changes nothing);
 *   - the phone's bar is a floating glass pill: inside the screen, every tab a 44 px target, the glass plate glides to the tab you open.
 * Frames are not compared pixel by pixel here – only end states, geometry and timing facts (`document.getAnimations()`).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, seed, waitForStableLayout } from "./helpers";
import { UX_PROJECTS } from "./uxHarness";

const side = (page: Page) => page.locator('[data-layer="Seitenleiste"]');
const mobile = (name: string) => name === "mobile";

/**
 * Records every animation of the page from its first frame on (a loop started before the app: the one-time effects are over within 1.3 s – a probe
 * that starts after `load` would miss them): the sidebar's row wave (CSS `sb-wave`), the header logo's strokes (WAAPI on `path[data-logo-stroke]`), with the
 * timing the page gave them AND what was observed per frame – how many logo strokes were drawing at the same moment.
 */
interface Fx {
  wave: { row: number; delay: number; duration: number; from: { opacity: string; translate: string } }[];
  logo: { mark: number; stroke: number; delay: number; duration: number; firstSeen: number }[];
  maxConcurrent: number;
  /** frames in which exactly one stroke was drawing */
  frames: number;
}
async function recordFx(page: Page) {
  await page.addInitScript(() => {
    const fx = { wave: [] as unknown[], logo: [] as unknown[], maxConcurrent: 0, frames: 0 };
    (window as unknown as { __fx: typeof fx }).__fx = fx;
    const seen = new WeakSet<Animation>();
    const strokes: Animation[] = [];
    const tick = () => {
      for (const a of document.getAnimations()) {
        if (seen.has(a)) continue;
        seen.add(a);
        const eff = a.effect as KeyframeEffect | null;
        const target = eff?.target as HTMLElement | SVGElement | null;
        if (!eff || !target) continue;
        const t = eff.getComputedTiming();
        if (a instanceof CSSAnimation && a.animationName === "sb-wave") {
          const k = eff.getKeyframes()[0] as unknown as { opacity: string; translate: string };
          fx.wave.push({ row: Number(getComputedStyle(target).getPropertyValue("--i")), delay: Number(t.delay), duration: Number(t.duration), from: { opacity: String(k.opacity), translate: String(k.translate) } });
        } else if (target instanceof SVGPathElement && target.matches("path[data-logo-stroke]")) {
          fx.logo.push({ mark: Number(target.dataset.mark), stroke: Number(target.dataset.stroke), delay: Number(t.delay), duration: Number(t.duration), firstSeen: performance.now() });
          strokes.push(a);
        }
      }
      const drawing = strokes.filter((a) => {
        const lt = Number(a.currentTime ?? 0);
        const c = a.effect!.getComputedTiming();
        return a.playState === "running" && lt > Number(c.delay) && lt < Number(c.delay) + Number(c.duration);
      }).length;
      if (drawing > fx.maxConcurrent) fx.maxConcurrent = drawing;
      if (drawing === 1) fx.frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const fxOf = (page: Page): Promise<Fx> => page.evaluate(() => (window as unknown as { __fx: Fx }).__fx);
const resetFx = (page: Page) =>
  page.evaluate(() => {
    const f = (window as unknown as { __fx: Fx }).__fx;
    f.wave = [];
    f.logo = [];
    f.maxConcurrent = 0;
    f.frames = 0;
  });

/** A fresh session that has NOT seen the one-time effects (the seed marks the intro as seen only), with the recorder running from the first frame. */
async function freshSession(page: Page, hash = "overview") {
  await recordFx(page);
  await seed(page);
  await page.goto(`/#${hash}`);
}

test.describe("Rahmen: Seitenleiste (Computer)", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "mobile + desktop");
  });

  test("kompakt auf jeder Breite – auch breit öffnet sie nicht von selbst; Anheften rückt die Seite und bleibt nach dem Neuladen", async ({ page }, info) => {
    test.skip(mobile(info.project.name), "from 768 px");
    const errors = collectErrors(page);
    await seed(page);
    await page.setViewportSize({ width: 1800, height: 900 });
    await page.goto("/#trades");
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    await waitForStableLayout(page);
    const aside = side(page);
    // 1,800 px used to open the wide sidebar by itself – now it is the rail
    await expect(aside).not.toHaveAttribute("data-expanded", "");
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--sidebar-w"))).toBe("64px");
    const h1 = page.locator('[data-page="trades"][data-page-role="current"] h1').first();
    const x0 = (await h1.boundingBox())!.x;
    await aside.getByTestId("sidebar-toggle").click();
    await expect(aside).toHaveAttribute("data-expanded", "");
    await expect(aside.getByTestId("sidebar-toggle")).toHaveAttribute("aria-pressed", "true");
    // at 1,800 px the 1,320 px column is centred, so it gives way by half of the 192 px the panel adds
    await expect.poll(async () => (await h1.boundingBox())!.x - x0, { timeout: 5000 }).toBeGreaterThan(80);
    // the pin is the reader's choice and survives a reload
    await page.reload();
    await expect(page.locator('[data-layer="Seitenleiste"]')).toHaveAttribute("data-expanded", "");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tj2-ui") ?? "{}").sidebar)).toBe("open");
    await page.locator('[data-layer="Seitenleiste"]').getByTestId("sidebar-toggle").click();
    await expect(page.locator('[data-layer="Seitenleiste"]')).not.toHaveAttribute("data-expanded", "");
    await expectNoHorizontalScroll(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Migration: ein früher gespeichertes „closed“ ist die Leiste, „open“ bleibt angeheftet", async ({ page }, info) => {
    test.skip(mobile(info.project.name), "from 768 px");
    await seed(page, { extra: { "tj2-ui": { sidebar: "open" } } });
    await page.goto("/#overview");
    await expect(side(page)).toHaveAttribute("data-expanded", "");
    await page.evaluate(() => localStorage.setItem("tj2-ui", JSON.stringify({ sidebar: "closed" })));
    await page.reload();
    await expect(side(page)).not.toHaveAttribute("data-expanded", "");
    await expect(side(page).getByTestId("sidebar-toggle")).toHaveAttribute("aria-label", "Seitenleiste anheften");
  });

  test("Suche oben: ein Kombinationsfeld, Treffer über der Leiste, Enter öffnet die Seite; Pfeile, Home, End und Esc auf den Zeilen", async ({ page }, info) => {
    test.skip(mobile(info.project.name), "from 768 px");
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const aside = side(page);
    const search = aside.getByRole("combobox", { name: "Seiten und Funktionen suchen" });
    await expect(search).toBeAttached();
    // a click on the rail's tile opens the panel with the field
    await search.click({ force: true });
    await expect(aside).toHaveAttribute("data-open", "", { timeout: 5000 });
    await search.fill("einstellungen");
    const hits = aside.getByRole("option");
    await expect(hits.first()).toBeVisible({ timeout: 15_000 });
    await expect(aside.getByTestId("sidebar-search-results").getByText("Seite", { exact: true }).first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Einstellungen", level: 1 })).toBeVisible({ timeout: 15_000 });
    // arrows on the rows: ↓ next, End last, Home first (the first stop is the title of the first group once the sidebar is pinned)
    await aside.getByTestId("sidebar-toggle").click();
    const first = aside.getByTestId("sidebar-group-toggle").first();
    await first.focus();
    await page.keyboard.press("ArrowDown");
    await expect(aside.locator("a[data-nav-page]:focus")).toHaveAttribute("data-nav-page", "trades");
    await page.keyboard.press("End");
    await expect(aside.locator(":focus")).toBeVisible();
    const last = await aside.locator(":focus").getAttribute("data-nav-page");
    expect(last).toBe("funktionen");
    await page.keyboard.press("Home");
    await expect(first).toBeFocused();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("die Zeilen wellen einmal von oben nach unten ein: 45–60 ms Abstand, 260–340 ms, 8–12 px, Deckkraft – danach nie wieder in dieser Sitzung", async ({ page }, info) => {
    test.skip(mobile(info.project.name), "from 768 px");
    await freshSession(page);
    await expect(page.locator(".sb")).not.toHaveAttribute("data-draw", /.+/, { timeout: 15_000 });
    const w = [...(await fxOf(page)).wave].sort((x, y) => x.row - y.row);
    expect(w.length).toBeGreaterThanOrEqual(19);
    expect(w[0]!.row).toBe(0);
    for (let i = 1; i < w.length; i++) {
      const step = w[i]!.delay - w[i - 1]!.delay;
      expect(step, `row ${i}`).toBeGreaterThanOrEqual(45);
      expect(step, `row ${i}`).toBeLessThanOrEqual(60);
    }
    for (const a of w) {
      expect(a.duration).toBeGreaterThanOrEqual(260);
      expect(a.duration).toBeLessThanOrEqual(340);
    }
    // the keyframe: 8–12 px and opacity 0 → 1
    expect(Number(w[0]!.from.opacity)).toBe(0);
    const px = Math.abs(parseFloat(w[0]!.from.translate.split(" ")[1] ?? "0"));
    expect(px).toBeGreaterThanOrEqual(8);
    expect(px).toBeLessThanOrEqual(12);
    // the same session: never again
    await resetFx(page);
    await page.reload();
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.waitForTimeout(800);
    // (the recorder is an init script: it runs again after the reload and records from its first frame)
    expect((await fxOf(page)).wave).toEqual([]);
  });

  test("Bewegung „Reduziert“: nichts wellt, nichts zeichnet sich – die Wahl bleibt nach dem Neuladen", async ({ page }, info) => {
    test.skip(mobile(info.project.name), "from 768 px");
    await recordFx(page);
    await seed(page, { extra: { "tj2-motion": { v: 1, mode: "reduced" } } });
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    await page.waitForTimeout(1500);
    const fx = await fxOf(page);
    expect(fx.wave).toEqual([]);
    expect(fx.logo).toEqual([]);
    await expect(page.locator(".sb")).not.toHaveAttribute("data-draw", /.+/);
    // the transitions are cut short by `html[data-motion="reduced"]` (base.css), like the device flag does
    const dur = await page.evaluate(() => getComputedStyle(document.querySelector(".sb-aside")!).transitionDuration);
    expect(parseFloat(dur)).toBeLessThan(0.01);
  });
});

test.describe("Rahmen: Logo-Sequenz und Bewegung (Kopfleiste, Einstellungen)", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "mobile + desktop");
  });

  test("das Logo zeichnet sich Strich für Strich strikt nacheinander, in höchstens 1,2 s, einmal je Sitzung; der Knopf in den Einstellungen spielt es wieder ab", async ({ page }) => {
    const errors = collectErrors(page);
    await freshSession(page);
    await expect.poll(async () => (await fxOf(page)).logo.length, { timeout: 15_000 }).toBe(3);
    const t = [...(await fxOf(page)).logo].sort((x, y) => x.delay - y.delay);
    // strictly one after the other: each stroke starts when the one before has finished (no overlap) – and the whole fits 1.2 s
    expect(t[0]!.delay).toBe(0);
    for (let i = 1; i < t.length; i++) expect(t[i]!.delay).toBeGreaterThanOrEqual(t[i - 1]!.delay + t[i - 1]!.duration);
    expect(t[t.length - 1]!.delay + t[t.length - 1]!.duration).toBeLessThanOrEqual(1200);
    expect(t.map((x) => x.stroke)).toEqual([0, 1, 2]);
    // observed frame by frame: never two strokes drawing at the same moment, and single strokes were really seen drawing
    await page.waitForTimeout(1500);
    const seen = await fxOf(page);
    expect(seen.maxConcurrent, "two strokes at once").toBeLessThanOrEqual(1);
    expect(seen.frames, "frames with a stroke drawing").toBeGreaterThanOrEqual(1);
    await expect(page.locator('svg[data-logo]').first()).toHaveAttribute("data-logo", "rest");
    // once per session
    await resetFx(page);
    await page.reload();
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.waitForTimeout(600);
    expect((await fxOf(page)).logo).toEqual([]);
    expect(await page.evaluate(() => sessionStorage.getItem("tj2-logo-seq"))).toBe("1");
    // the replay in Einstellungen › Darstellung
    await page.goto("/#settings");
    const replay = page.getByTestId("motion-logo");
    await replay.scrollIntoViewIfNeeded();
    await resetFx(page);
    await replay.click();
    await expect.poll(async () => (await fxOf(page)).logo.length, { timeout: 10_000 }).toBe(3);
    const again = [...(await fxOf(page)).logo].sort((x, y) => x.delay - y.delay);
    for (let i = 1; i < again.length; i++) expect(again[i]!.delay).toBeGreaterThanOrEqual(again[i - 1]!.delay + again[i - 1]!.duration);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Einstellungen › Darstellung › Bewegung: drei Profile, die Wahl bleibt, „Reduziert“ setzt das Dokument, die Vorschau läuft", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#settings");
    const sec = page.getByTestId("motion-section");
    await sec.scrollIntoViewIfNeeded();
    await expect(sec.getByRole("radio")).toHaveCount(3);
    await expect(page.locator("html")).not.toHaveAttribute("data-motion", /.+/);
    await sec.getByRole("radio", { name: "Reduziert" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tj2-motion") ?? "null"))).toEqual({ v: 1, mode: "reduced" });
    // reduced: the preview has nothing to play
    await sec.getByTestId("motion-preview").click();
    expect(await page.evaluate(() => document.getAnimations().filter((a) => ((a.effect as KeyframeEffect | null)?.target as Element | null)?.closest?.('[data-testid="motion-strip"]')).length)).toBe(0);
    await sec.getByRole("radio", { name: "Volles Profil" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
    await sec.getByTestId("motion-preview").click();
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => ((a.effect as KeyframeEffect | null)?.target as Element | null)?.closest?.('[data-testid="motion-strip"]')).length), { timeout: 3000 }).toBeGreaterThanOrEqual(5);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
    await page.getByTestId("motion-section").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("motion-section").getByRole("radio", { name: "Volles Profil" })).toBeChecked();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("das Tarif-Profil kommt aus dem bestätigten Tarif: ohne Zahlung ist es Free – ein Browser-Schalter ändert nichts", async ({ page }) => {
    await seed(page, { extra: { "tj2-motion-tier": "premium", "tj2-tier": "team" } });
    await page.addInitScript(() => {
      (window as unknown as { __tjTier: string }).__tjTier = "premium";
      document.documentElement.setAttribute("data-motion-tier", "premium");
    });
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    // the host overwrites a planted attribute with the confirmed plan (Free: payments are off in this build)
    await expect(page.locator("html")).toHaveAttribute("data-motion-tier", "free");
    const flags = await page.evaluate(() => {
      const ui = (window as unknown as { __tjUi: { getState(): { flags: Record<string, boolean> }; setState(p: unknown): void } }).__tjUi;
      ui.setState({ flags: { premium: true, tier: true, motionTier: true } });
      return Object.keys(ui.getState().flags);
    });
    expect(flags.length).toBeGreaterThan(0);
    await page.waitForTimeout(400);
    await expect(page.locator("html")).toHaveAttribute("data-motion-tier", "free");
  });
});

test.describe("Rahmen: schwebende Glas-Leiste (Handy)", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!mobile(info.project.name), "phone only");
  });

  test("eine Pille im Bild: innerhalb der Ränder, mit Abstand zum unteren Rand, fünf Ziele ≥ 44 px, die Glas-Platte gleitet zum geöffneten Tab", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await waitForStableLayout(page);
    const bar = page.getByRole("toolbar", { name: "Navigation" });
    await expect(bar.getByRole("button")).toHaveCount(5);
    const vp = page.viewportSize()!;
    const box = (await bar.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    // floating: the pill leaves a gap under it (12 px + the safe area), not glued to the screen edge
    expect(vp.height - (box.y + box.height)).toBeGreaterThanOrEqual(10);
    // one glass pill: fully rounded, translucent, blurred where the browser can
    const glass = await page.locator(".dock-glass").evaluate((el) => {
      const cs = getComputedStyle(el);
      return { radius: parseFloat(cs.borderTopLeftRadius), h: el.getBoundingClientRect().height, blur: cs.backdropFilter, bg: cs.backgroundColor };
    });
    expect(glass.radius).toBeGreaterThanOrEqual(glass.h / 2 - 1);
    // every tab and the centre button: a 44 px target
    for (const b of await bar.getByRole("button").all()) {
      const r = (await b.boundingBox())!;
      expect(r.width, "target width").toBeGreaterThanOrEqual(44);
      expect(r.height, "target height").toBeGreaterThanOrEqual(44);
    }
    // the plate sits on the active tab and glides to the next one
    const plate = page.locator('[data-dock-marker="bg"]');
    await expect(plate).toHaveCount(1);
    await expect(bar.getByRole("button", { name: "Übersicht" }).locator('[data-dock-marker="bg"]')).toHaveCount(1);
    await bar.getByRole("button", { name: "Markt" }).click();
    await expect(page).toHaveURL(/#markt$/);
    await expect(bar.getByRole("button", { name: "Markt" }).locator('[data-dock-marker="bg"]')).toHaveCount(1);
    await expect(bar.getByRole("button", { name: "Markt" })).toHaveAttribute("aria-current", "page");
    // the active caption is the one in full ink and weight
    const weights = await bar.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>("[data-dock-caption]")).map((c) => ({ t: c.textContent, w: Number(getComputedStyle(c).fontWeight) })));
    expect(weights.find((x) => x.t === "Markt")!.w).toBeGreaterThanOrEqual(600);
    expect(weights.find((x) => x.t === "Trades")!.w).toBeLessThan(600);
    // room for the page: its last content ends above the bar
    await expectNoHorizontalScroll(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("der Tipp auf „Trade“ öffnet den Editor aus der Pille, Escape bringt ihn zurück", async ({ page }) => {
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const bar = page.getByRole("toolbar", { name: "Navigation" });
    await bar.getByRole("button", { name: "Trade eintragen" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(bar.getByRole("button", { name: "Trade eintragen" })).toBeVisible();
  });
});

/* ------------------------------------------------------------------ Kontrast und Barrierefreiheit des Glases */

/** sRGB → relative luminance (WCAG 2.1) */
const lum = ([r, g, b]: number[]): number => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
};
const ratio = (a: number[], b: number[]): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const mix = (top: number[], alpha: number, under: number[]): number[] => top.map((c, i) => c * alpha + under[i]! * (1 - alpha));

/** The theme's tokens as plain rgb triples (read the way the browser resolves them). */
const tokens = (page: Page, names: string[]) =>
  page.evaluate((ns) => {
    const probe = document.createElement("span");
    document.body.append(probe);
    const out: Record<string, number[]> = {};
    for (const n of ns) {
      probe.style.color = `var(${n})`;
      const m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/.exec(getComputedStyle(probe).color);
      out[n] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [NaN, NaN, NaN];
    }
    probe.remove();
    return out;
  }, names);

for (const theme of ["dark", "light"] as const) {
  test.describe(`Rahmen: Glas – Kontrast und axe (${theme})`, () => {
    test.setTimeout(120_000);
    test.beforeEach(({ page }, info) => {
      void page;
      test.skip(!UX_PROJECTS.includes(info.project.name), "mobile + desktop");
    });

    test("das Glas verschlechtert die Lesbarkeit nie: Worst-Case-Rechnung (Hintergrund hinter dem Glas ganz hell bzw. ganz dunkel) ≥ AA, und axe ist sauber", async ({ page }, info) => {
      await seed(page);
      await page.addInitScript((t) => localStorage.setItem("tj2-theme", JSON.stringify({ pref: t, accent: "signal" })), theme);
      await page.goto("/#trades");
      await expect(page.getByText("Alle Trades").first()).toBeVisible();
      await waitForStableLayout(page);
      const t = await tokens(page, ["--color-ink-900", "--color-ink-850", "--color-mute", "--color-fg"]);
      // behind the glass could be the extreme of the page: the opposite pole of the theme (white text over dark glass, black ink over light glass)
      const behind = theme === "dark" ? [255, 255, 255] : [0, 0, 0];
      if (mobile(info.project.name)) {
        const bar = mix(t["--color-ink-850"]!, 0.9, behind);
        expect(ratio(t["--color-mute"]!, bar), "inactive caption on the pill").toBeGreaterThanOrEqual(4.5);
        expect(ratio(t["--color-fg"]!, bar), "active caption on the pill").toBeGreaterThanOrEqual(4.5);
        await page.waitForTimeout(1500);
        const res = await new AxeBuilder({ page }).include('[data-layer="Dock"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
      } else {
        const glass = mix(t["--color-ink-900"]!, 0.9, behind);
        expect(ratio(t["--color-mute"]!, glass), "hint text on the peeking panel").toBeGreaterThanOrEqual(4.5);
        expect(ratio(t["--color-fg"]!, glass), "names on the peeking panel").toBeGreaterThanOrEqual(4.5);
        const aside = side(page);
        await page.mouse.move(30, 300);
        await expect(aside).toHaveAttribute("data-open", "", { timeout: 5000 });
        await aside.getByRole("combobox", { name: "Seiten und Funktionen suchen" }).fill("einst");
        await expect(aside.getByRole("option").first()).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(1200);
        const res = await new AxeBuilder({ page }).include('[data-layer="Seitenleiste"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
      }
    });
  });
}
