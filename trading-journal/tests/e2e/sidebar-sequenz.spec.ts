/**
 * Runde 12 – the sidebar's first-load sequence, measured in the real browser (frames, not just end states):
 *   - the rows wave in from the top, one after the other (≈ 52 ms apart, 300 ms each);
 *   - the glyphs draw STRICTLY one after the other: a glyph is finished before the next one starts (declared timing of the running animations
 *     AND the order the frames really show);
 *   - it waits while the intro's stage covers the app (it used to run under the stage, unseen) and starts when the app is in view;
 *   - once per page load: no restart on hover, on a route change or on a re-render; reduced motion: everything is simply there;
 *   - the phone's glass bar keeps its order (left to right) and its once-per-session entrance.
 */
import { expect, test, type Page } from "@playwright/test";
import { CHECKIN_PROMPT_OFF, collectErrors, fixture, seed } from "./helpers";
import { mockMarket } from "./mocks/market";

const mobile = (name: string) => name === "mobile";

interface SeqRec {
  runAt: number;
  coveredAtRun: boolean | null;
  sawWaitCovered: boolean;
  /** frames in the wait state in which a row was already visible or a first-load animation was running (must stay 0) */
  waitLeaks: number;
  /** the declared timing of the running animations, read in the first frame of the run (a run can be over before a test asks) */
  strokes: { delay: number; duration: number }[];
  waves: { delay: number; duration: number }[];
  /** ms after the start of the run: the first frame a row is visible */
  rowAt: number[];
  /** ms after the start of the run: the first frame a glyph's first stroke has started / the first frame all its strokes are drawn */
  glyphStart: number[];
  glyphEnd: number[];
  endAt: number;
}

/** Samples every frame from page start: when the run begins and when each row and glyph appears. */
async function installRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const rec: SeqRec = { runAt: -1, coveredAtRun: null, sawWaitCovered: false, waitLeaks: 0, strokes: [], waves: [], rowAt: [], glyphStart: [], glyphEnd: [], endAt: -1 };
    (window as unknown as { __sq: SeqRec }).__sq = rec;
    const SHAPES = ".sb-ico :is(path, circle, rect, line, polyline, ellipse)";
    const tick = () => {
      const state = document.querySelector(".sb")?.getAttribute("data-draw");
      const covered = !!document.getElementById("root")?.hasAttribute("data-intro-covered");
      const now = performance.now();
      if (state === "wait") {
        if (covered) rec.sawWaitCovered = true;
        const rows = Array.from(document.querySelectorAll<HTMLElement>(".sb-rows > li"));
        const animating = document.getAnimations().some((a) => a instanceof CSSAnimation && /^sb-(wave|draw|glint)$/.test(a.animationName));
        if (animating || rows.some((li) => Number(getComputedStyle(li).opacity) > 0.01)) rec.waitLeaks++;
      }
      if (state === "run") {
        if (rec.runAt < 0) {
          rec.runAt = now;
          rec.coveredAtRun = covered;
          const shapes = Array.from(document.querySelectorAll(SHAPES));
          const named = (name: string) =>
            document
              .getAnimations()
              .filter((a): a is CSSAnimation => a instanceof CSSAnimation && a.animationName === name && a.effect instanceof KeyframeEffect)
              .map((a) => ({ a, t: (a.effect as KeyframeEffect).getComputedTiming(), el: (a.effect as KeyframeEffect).target as Element }));
          rec.strokes = named("sb-draw")
            .filter((x) => shapes.includes(x.el))
            .sort((x, y) => shapes.indexOf(x.el) - shapes.indexOf(y.el))
            .map((x) => ({ delay: Number(x.t.delay), duration: Number(x.t.duration) }));
          rec.waves = named("sb-wave").map((x) => ({ delay: Number(x.t.delay), duration: Number(x.t.duration) }));
        }
        Array.from(document.querySelectorAll<HTMLElement>(".sb-rows > li"))
          .filter((li) => !li.closest('[data-fold="closed"]'))
          .forEach((li, i) => {
            if (rec.rowAt[i] === undefined && Number(getComputedStyle(li).opacity) > 0.05) rec.rowAt[i] = now - rec.runAt;
            const off = Array.from(li.querySelectorAll<SVGElement>(SHAPES)).map((s) => Number.parseFloat(getComputedStyle(s).strokeDashoffset));
            if (rec.glyphStart[i] === undefined && off.some((o) => o < 0.999)) rec.glyphStart[i] = now - rec.runAt;
            if (rec.glyphEnd[i] === undefined && off.length > 0 && off.every((o) => o <= 0.01)) rec.glyphEnd[i] = now - rec.runAt;
          });
      } else if (rec.runAt >= 0 && rec.endAt < 0) rec.endAt = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const record = (page: Page) => page.evaluate(() => (window as unknown as { __sq: SeqRec }).__sq);

/** The running first-load animations by name (`sb-wave` on rows, `sb-draw` on strokes, `sb-glint` on icons). */
const running = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a instanceof CSSAnimation && /^sb-(wave|draw|glint)$/.test(a.animationName))
      .map((a) => (a as CSSAnimation).animationName),
  );

async function expectSequence(page: Page): Promise<SeqRec> {
  // the sequence ran and ended (the recorder saw its first frame and its end; the attribute is gone again)
  await expect.poll(async () => (await record(page)).endAt, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.locator(".sb")).not.toHaveAttribute("data-draw", /.+/);
  const rec = await record(page);
  // the declared timing of the running animations (read in the first frame of the run): strokes in DOM order never overlap …
  expect(rec.strokes.length).toBeGreaterThan(19);
  for (let i = 1; i < rec.strokes.length; i++) expect(rec.strokes[i]!.delay, `stroke ${i} starts after stroke ${i - 1} ended`).toBeGreaterThanOrEqual(rec.strokes[i - 1]!.delay + rec.strokes[i - 1]!.duration - 0.05);
  // … and the rows follow 45–60 ms apart, 260–340 ms each
  expect(rec.waves.length).toBe(19);
  for (const w of rec.waves) {
    expect(w.duration).toBeGreaterThanOrEqual(260);
    expect(w.duration).toBeLessThanOrEqual(340);
  }
  const delays = rec.waves.map((w) => w.delay).sort((x, y) => x - y);
  for (let i = 1; i < delays.length; i++) {
    expect(delays[i]! - delays[i - 1]!).toBeGreaterThanOrEqual(45);
    expect(delays[i]! - delays[i - 1]!).toBeLessThanOrEqual(60);
  }
  // the frames show the same order: rows top to bottom …
  expect(rec.rowAt.length).toBe(19);
  for (let i = 1; i < rec.rowAt.length; i++) expect(rec.rowAt[i]!, `row ${i} after row ${i - 1}`).toBeGreaterThanOrEqual(rec.rowAt[i - 1]!);
  // … and each glyph finished before the next one started
  expect(rec.glyphStart.length).toBe(19);
  expect(rec.glyphEnd.length).toBe(19);
  for (let i = 1; i < rec.glyphStart.length; i++) {
    expect(rec.glyphStart[i]!, `glyph ${i} starts after glyph ${i - 1} started`).toBeGreaterThanOrEqual(rec.glyphStart[i - 1]!);
    expect(rec.glyphEnd[i - 1]!, `glyph ${i - 1} is finished before glyph ${i} starts`).toBeLessThanOrEqual(rec.glyphStart[i]!);
  }
  // the pace itself is the declared timing above (frames are coarse on a loaded machine); the whole thing is a first look, not a show
  expect(rec.glyphEnd[rec.glyphEnd.length - 1]!).toBeLessThan(6000);
  return rec;
}

/** After the run: everything rests in its drawn state, nothing stays hidden or dashed, and nothing starts again. */
async function expectAtRestAndOnce(page: Page, runAt: number): Promise<void> {
  const rest = await page.evaluate(() => ({
    hidden: Array.from(document.querySelectorAll<HTMLElement>(".sb-rows > li")).filter((li) => !li.closest('[data-fold="closed"]') && Number(getComputedStyle(li).opacity) < 0.99).length,
    dashed: Array.from(document.querySelectorAll(".sb-ico :is(path, circle, rect, line, polyline, ellipse)")).filter((s) => getComputedStyle(s).strokeDasharray !== "none").length,
  }));
  expect(rest).toEqual({ hidden: 0, dashed: 0 });
  // hover (the peek opens and closes) …
  await page.mouse.move(30, 300);
  await expect(page.locator('[data-layer="Seitenleiste"]')).toHaveAttribute("data-open", "", { timeout: 5000 });
  await page.mouse.move(900, 500);
  await expect(page.locator('[data-layer="Seitenleiste"]')).not.toHaveAttribute("data-open", "", { timeout: 5000 });
  // … a route change and back …
  await page.locator('[data-layer="Seitenleiste"]').getByRole("link", { name: "Trades", exact: true }).click();
  await expect(page).toHaveURL(/#trades$/);
  await page.locator('[data-layer="Seitenleiste"]').getByRole("link", { name: "Übersicht", exact: true }).click();
  await expect(page).toHaveURL(/#overview$/);
  await page.waitForTimeout(900);
  // … none of it plays the sequence again
  expect(await running(page)).toEqual([]);
  await expect(page.locator(".sb")).not.toHaveAttribute("data-draw", /.+/);
  expect((await record(page)).runAt).toBe(runAt);
}

test.describe("Seitenleiste: Einblend-Folge beim Öffnen", () => {
  test.setTimeout(120_000);

  test("Computer: mit Intro wartet sie unter der Bühne, läuft danach von oben nach unten, Glyphen strikt nacheinander, einmal", async ({ page }, info) => {
    test.skip(mobile(info.project.name), "from 768 px");
    const errors = collectErrors(page);
    // the intro plays on a fresh session (the one spec family that does not set the session flag)
    await mockMarket(page, "live");
    await page.addInitScript(
      (fx) => {
        for (const [k, v] of Object.entries(fx as Record<string, unknown>)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      },
      { ...fixture, ...CHECKIN_PROMPT_OFF },
    );
    await installRecorder(page);
    await page.goto("/#overview");
    await expect(page.locator(".sb")).toBeAttached();
    const rec = await expectSequence(page);
    expect(rec.sawWaitCovered, "it waited while the stage covered the app").toBe(true);
    expect(rec.waitLeaks, "nothing was visible or running while it waited").toBe(0);
    expect(rec.coveredAtRun, "it started when the app was in view").toBe(false);
    await expectAtRestAndOnce(page, rec.runAt);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Computer: ohne Intro (gesehen oder anderer Einstieg) startet sie beim ersten Blick – einmal", async ({ page }, info) => {
    test.skip(mobile(info.project.name), "from 768 px");
    const errors = collectErrors(page);
    await seed(page);
    await installRecorder(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const rec = await expectSequence(page);
    expect(rec.coveredAtRun).toBe(false);
    await expectAtRestAndOnce(page, rec.runAt);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("weniger Bewegung: sofort alles da, nichts wartet, nichts läuft", async ({ page }, info) => {
    test.skip(mobile(info.project.name), "from 768 px");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page);
    await installRecorder(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.locator(".sb")).not.toHaveAttribute("data-draw", /.+/);
    expect(await running(page)).toEqual([]);
    expect((await record(page)).runAt).toBe(-1);
    const hidden = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".sb-rows > li")).filter((li) => Number(getComputedStyle(li).opacity) < 0.99).length);
    expect(hidden).toBe(0);
  });

  test("Handy: die Glas-Leiste bleibt, ihre Symbole kommen von links nach rechts – einmal je Sitzung", async ({ page }, info) => {
    test.skip(!mobile(info.project.name), "phone only");
    await seed(page);
    await page.addInitScript(() => {
      const first: number[] = [];
      const start = performance.now();
      (window as unknown as { __dock: { first: number[]; start: number } }).__dock = { first, start };
      const tick = () => {
        const icons = Array.from(document.querySelectorAll<HTMLElement>('[data-layer="Dock"] button .sb-ico'));
        icons.forEach((ico, i) => {
          const own = ico.parentElement as HTMLElement;
          if (first[i] === undefined) first[i] = Number(getComputedStyle(own).opacity) > 0.05 ? performance.now() - start : -1;
          else if (first[i]! < 0 && Number(getComputedStyle(own).opacity) > 0.05) first[i] = performance.now() - start;
        });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const bar = page.getByRole("toolbar", { name: "Navigation" });
    await expect(bar).toBeVisible();
    await page.waitForTimeout(1500);
    const times = await page.evaluate(() => (window as unknown as { __dock: { first: number[] } }).__dock.first);
    expect(times.length).toBe(5);
    expect(times.every((t) => t >= 0)).toBe(true);
    // left to right: no icon appears before the one on its left
    for (let i = 1; i < times.length; i++) expect(times[i]!, `icon ${i} after icon ${i - 1}`).toBeGreaterThanOrEqual(times[i - 1]!);
    // the same session, a reload: the bar is simply there (every icon visible at the first frame)
    await page.reload();
    await expect(bar).toBeVisible();
    await page.waitForTimeout(600);
    const again = await page.evaluate(() => (window as unknown as { __dock: { first: number[] } }).__dock.first);
    expect(Math.max(...again) - Math.min(...again), "every icon is visible from the first frame it exists").toBeLessThan(60);
  });
});

