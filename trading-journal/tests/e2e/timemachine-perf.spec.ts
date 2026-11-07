/**
 * A3 measurement: the frame time of the canvas mode „alle 10 000 Pfade“ on a CPU slowed down ×4 (Chrome DevTools Protocol,
 * `Emulation.setCPUThrottlingRate`) – once with the worker on an OffscreenCanvas (the page does no drawing) and once with the page
 * drawing in slices (OffscreenCanvas removed). Per run: how long the drawing took, the longest slice the painter measured itself, the
 * long tasks (≥ 50 ms, PerformanceObserver `longtask`) and the frame gaps (requestAnimationFrame) while it ran. The numbers are written
 * to `/tmp/shots/tm-perf-<variant>.json` and into the test annotations; the README of `src/views/timemachine` quotes them.
 *
 * The assertions are the promises, with room for a machine that is busy with other work: no slice of the painter longer than 50 ms and
 * frames keep coming. Long tasks and frame gaps are reported, not asserted – they depend on what else the machine does.
 */
import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openRoute, seed } from "./helpers";

const PLAN = { entry: "82.900", stop: "80.500", target: "87.700" };

async function prepare(page: Page, mode: "all" | "sample", noOffscreen: boolean): Promise<void> {
  await seed(page, { boxes: true });
  await page.addInitScript((m) => localStorage.setItem("tj2-tm-paths-mode", JSON.stringify(m)), mode);
  if (noOffscreen) await page.addInitScript(() => void delete (window as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas);
  await openRoute(page, "/#labor", "Labor");
  await page.getByTestId("tm-section").scrollIntoViewIfNeeded();
  await page.getByTestId("tm-entry").fill(PLAN.entry);
  await page.getByTestId("tm-stop").fill(PLAN.stop);
  await page.getByTestId("tm-target").fill(PLAN.target);
  await page.getByTestId("tm-load-start").click();
  await expect(page.getByTestId("tm-card")).toHaveAttribute("data-status", "done", { timeout: 120_000 });
  await page.getByTestId("tm-fan-block").scrollIntoViewIfNeeded();
}

interface Sample {
  engine: string;
  drawn: number;
  computed: number;
  paintMs: number;
  maxSliceMs: number;
  batches: number;
  batch: number;
  longTasks: number[];
  maxLongTaskMs: number;
  frames: number;
  maxFrameGapMs: number;
  p95FrameGapMs: number;
  /** the same window of 1.5 s on the same page WITHOUT drawing (bands view, same CPU rate): what the machine itself costs */
  baseline: { longTasks: number[]; maxFrameGapMs: number; p95FrameGapMs: number };
}

/** Switches to „Alle Pfade“ under the throttle and reports what the page and the painter measured. */
async function measure(page: Page, rate: number): Promise<Sample> {
  const cdp = await page.context().newCDPSession(page);
  // warm-up: load the lazy chunk (and the inline worker) once, unthrottled, then back to the bands
  await page.getByRole("radio", { name: "Alle Pfade (Alpha)" }).click();
  await expect(page.getByTestId("tm-paths")).toHaveAttribute("data-state", "done", { timeout: 120_000 });
  await page.getByRole("radio", { name: "Bänder" }).click();
  await expect(page.getByTestId("tm-fan")).toBeVisible();

  await page.evaluate(() => {
    const w = window as unknown as { __perf: { long: number[]; frames: number[]; stop: boolean } };
    w.__perf = { long: [], frames: [], stop: false };
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__perf.long.push(e.duration))).observe({ type: "longtask", buffered: false });
    } catch {
      /* no longtask support */
    }
    let last = performance.now();
    const tick = (t: number) => {
      w.__perf.frames.push(t - last);
      last = t;
      if (!w.__perf.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  // baseline: 1.5 s of the idle page at this CPU rate (other work on the machine shows up here, not in the drawing)
  await page.waitForTimeout(1_500);
  const base = await page.evaluate(() => {
    const w = window as unknown as { __perf: { long: number[]; frames: number[]; stop: boolean } };
    const out = { long: [...w.__perf.long], frames: [...w.__perf.frames] };
    w.__perf.long.length = 0;
    w.__perf.frames.length = 0;
    return out;
  });
  await page.getByRole("radio", { name: "Alle Pfade (Alpha)" }).click();
  const box = page.getByTestId("tm-paths");
  await expect(box).toHaveAttribute("data-state", "done", { timeout: 180_000 });
  await page.waitForTimeout(300);
  const raw = await page.evaluate(() => {
    const w = window as unknown as { __perf: { long: number[]; frames: number[]; stop: boolean } };
    w.__perf.stop = true;
    return w.__perf;
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const attr = async (n: string): Promise<number> => Number((await box.getAttribute(n)) ?? "NaN");
  const frames = raw.frames.slice(1).sort((a, b) => a - b);
  const bf = base.frames.slice(1).sort((a, b) => a - b);
  return {
    engine: (await box.getAttribute("data-engine")) ?? "",
    drawn: await attr("data-drawn"),
    computed: await attr("data-computed"),
    paintMs: await attr("data-paint-ms"),
    maxSliceMs: await attr("data-max-slice-ms"),
    batches: await attr("data-batches"),
    batch: await attr("data-batch"),
    longTasks: raw.long.map((d) => Math.round(d)),
    maxLongTaskMs: Math.round(Math.max(0, ...raw.long)),
    frames: frames.length,
    maxFrameGapMs: Math.round(frames[frames.length - 1] ?? 0),
    p95FrameGapMs: Math.round(frames[Math.floor(frames.length * 0.95)] ?? 0),
    baseline: { longTasks: base.long.map((d) => Math.round(d)), maxFrameGapMs: Math.round(bf[bf.length - 1] ?? 0), p95FrameGapMs: Math.round(bf[Math.floor(bf.length * 0.95)] ?? 0) },
  };
}

for (const variant of [
  { name: "worker", noOffscreen: false },
  { name: "page", noOffscreen: true },
]) {
  for (const rate of [1, 4]) {
    test(`Bildzeit „alle Pfade“, ${variant.name === "worker" ? "Worker + OffscreenCanvas" : "Seite in Scheiben"}, CPU ×${rate}`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "the measurement runs once, on the desktop project (Chromium)");
      test.setTimeout(300_000);
      await prepare(page, "all", variant.noOffscreen);
      const s = await measure(page, rate);
      const line = `tm-perf ${variant.name} x${rate}: ${JSON.stringify(s)}`;
      console.log(line);
      info.annotations.push({ type: "tm-perf", description: line });
      writeFileSync(`/tmp/shots/tm-perf-${variant.name}-x${rate}.json`, JSON.stringify(s, null, 2));
      expect(s.engine).toBe(variant.name === "worker" ? "worker" : "main");
      expect(s.drawn).toBe(s.computed);
      expect(s.computed).toBe(10_000);
      // the promise: no slice of work on the page (or in the worker) comes near a long task
      expect(s.maxSliceMs).toBeLessThan(50);
      // and the page kept producing frames while it drew (the gaps are reported, not asserted: on a machine shared with other work one
      // stall of the whole browser is not the drawing's doing)
      expect(s.frames).toBeGreaterThan(5);
    });
  }
}
