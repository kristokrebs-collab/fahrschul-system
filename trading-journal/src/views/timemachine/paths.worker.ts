/**
 * Module worker that draws the simulated paths onto an `OffscreenCanvas` (the page hands over the canvas once, `init`, then sends
 * `draw` requests). The painter is `pathPaint.ts` – the same code the page runs itself where there is no OffscreenCanvas. The work
 * is cut into slices with the thread given back in between, so an `abort` / a new `draw` is heard within a few milliseconds; the
 * page stays free whatever the worker does. Loaded as an inline worker (`?worker&inline`, no extra file) by `PathsCanvas`.
 */
import { PathPainter, runPaint, type PaintGeometry, type PaintStats, type PaintStyle, type PathData, type SamplePlan } from "./pathPaint";

export type PaintRequest =
  | { kind: "init"; canvas: OffscreenCanvas }
  | { kind: "draw"; id: number; geo: PaintGeometry; style: PaintStyle; plan: SamplePlan; dpr: number; paths: PathData }
  | { kind: "abort" };

export type PaintResponse = { kind: "ready" } | { kind: "progress"; id: number; done: number; total: number } | { kind: "done"; id: number; stats: PaintStats } | { kind: "error"; id: number; message: string };

const scope = self as unknown as { onmessage: ((e: MessageEvent<PaintRequest>) => void) | null; postMessage(m: PaintResponse): void };

let canvas: OffscreenCanvas | null = null;
let stop: { aborted: boolean } = { aborted: false };

scope.onmessage = (e) => {
  const m = e.data;
  if (m.kind === "init") {
    canvas = m.canvas;
    scope.postMessage({ kind: "ready" });
    return;
  }
  if (m.kind === "abort") {
    stop.aborted = true;
    return;
  }
  // a new request replaces the one in flight
  stop.aborted = true;
  const mine = { aborted: false };
  stop = mine;
  void (async () => {
    try {
      if (!canvas) throw new Error("no canvas");
      canvas.width = Math.max(1, Math.round(m.geo.w * m.dpr));
      canvas.height = Math.max(1, Math.round(m.geo.h * m.dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      const painter = new PathPainter(ctx, m.paths, m.geo, m.style, m.plan, m.dpr);
      let last = 0;
      const stats = await runPaint(painter, {
        signal: mine,
        onProgress: (done, total) => {
          const t = performance.now();
          if (t - last > 100) {
            last = t;
            scope.postMessage({ kind: "progress", id: m.id, done, total });
          }
        },
      });
      if (!mine.aborted) scope.postMessage({ kind: "done", id: m.id, stats });
    } catch (err) {
      if (!mine.aborted) scope.postMessage({ kind: "error", id: m.id, message: err instanceof Error ? err.message : String(err) });
    }
  })();
};
