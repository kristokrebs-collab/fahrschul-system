/**
 * The drawing engine of the path canvas: it owns a `<canvas>` inside a host element and paints `PathData` onto it.
 *
 * - **Worker** (where `OffscreenCanvas` and `transferControlToOffscreen` exist and a worker may run): the canvas is handed to an inline
 *   module worker (`paths.worker.ts`); the page does no drawing work at all.
 * - **Page** (everything else: no OffscreenCanvas, `file:` / single-file builds, a worker that fails): the same painter, in slices of a few
 *   milliseconds with the thread given back in between.
 * The canvas is created here (not by React) because a canvas can be handed to a worker only once: a remount makes a new one.
 */
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { PathPainter, runPaint, type PaintGeometry, type PaintStats, type PaintStyle, type PathData, type SamplePlan } from "./pathPaint";
import type { PaintRequest, PaintResponse } from "./paths.worker";

export type PaintEngineKind = "worker" | "main";

export interface DrawRequest {
  geo: PaintGeometry;
  style: PaintStyle;
  plan: SamplePlan;
  dpr: number;
  paths: PathData;
  onProgress?: (done: number, total: number) => void;
}

export interface PaintEngine {
  readonly kind: PaintEngineKind;
  readonly canvas: HTMLCanvasElement;
  /** Draws (a new request replaces the one in flight, whose promise rejects with an AbortError). */
  draw(req: DrawRequest): Promise<PaintStats>;
  dispose(): void;
}

const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });
export const isPaintAbort = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

/** Can this browser draw on an OffscreenCanvas in a worker? */
export function offscreenAllowed(): boolean {
  try {
    return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof HTMLCanvasElement !== "undefined" && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function" && !IS_FILE_BUILD && !isFileProtocol();
  } catch {
    return false;
  }
}

function newCanvas(host: HTMLElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.setAttribute("aria-hidden", "true");
  c.style.cssText = "position:absolute;left:0;top:0;display:block;width:100%;height:100%";
  host.append(c);
  return c;
}

function mainEngine(host: HTMLElement): PaintEngine {
  const canvas = newCanvas(host);
  let ctl: { aborted: boolean } | null = null;
  return {
    kind: "main",
    canvas,
    async draw(r) {
      if (ctl) ctl.aborted = true;
      const mine = { aborted: false };
      ctl = mine;
      canvas.width = Math.max(1, Math.round(r.geo.w * r.dpr));
      canvas.height = Math.max(1, Math.round(r.geo.h * r.dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Dieser Browser kann hier nicht zeichnen (kein 2D-Canvas).");
      const painter = new PathPainter(ctx, r.paths, r.geo, r.style, r.plan, r.dpr);
      const stats = await runPaint(painter, { signal: mine, ...(r.onProgress ? { onProgress: r.onProgress } : {}) });
      if (mine.aborted) throw abortError();
      return stats;
    },
    dispose() {
      if (ctl) ctl.aborted = true;
      canvas.remove();
    },
  };
}

async function workerEngine(host: HTMLElement): Promise<PaintEngine> {
  const W = (await import("./paths.worker?worker&inline")).default as new (o?: { name?: string }) => Worker;
  const canvas = newCanvas(host);
  let off: OffscreenCanvas;
  let w: Worker;
  try {
    off = canvas.transferControlToOffscreen();
    w = new W({ name: "tj-zeitmaschine-pfade" });
  } catch (e) {
    canvas.remove();
    throw e;
  }
  let pending: { id: number; resolve: (s: PaintStats) => void; reject: (e: unknown) => void; onProgress?: (d: number, t: number) => void } | null = null;
  let seq = 0;
  let dead = false;
  const failAll = (e: unknown) => {
    const p = pending;
    pending = null;
    p?.reject(e);
  };
  w.onmessage = (e: MessageEvent<PaintResponse>) => {
    const m = e.data;
    if (m.kind === "ready" || !pending || m.id !== pending.id) return;
    if (m.kind === "progress") pending.onProgress?.(m.done, m.total);
    else if (m.kind === "done") {
      const p = pending;
      pending = null;
      p.resolve(m.stats);
    } else failAll(new Error(m.message));
  };
  w.onerror = () => failAll(new Error("worker error"));
  const init: PaintRequest = { kind: "init", canvas: off };
  w.postMessage(init, [off]);
  return {
    kind: "worker",
    canvas,
    draw(r) {
      if (dead) return Promise.reject(abortError());
      failAll(abortError());
      const id = ++seq;
      return new Promise<PaintStats>((resolve, reject) => {
        pending = { id, resolve, reject, ...(r.onProgress ? { onProgress: r.onProgress } : {}) };
        // the typed arrays are copied (the page keeps its own for the next draw)
        const msg: PaintRequest = { kind: "draw", id, geo: r.geo, style: r.style, plan: r.plan, dpr: r.dpr, paths: { runs: r.paths.runs, stride: r.paths.stride, data: r.paths.data, kind: r.paths.kind, exit: r.paths.exit } };
        w.postMessage(msg);
      });
    },
    dispose() {
      dead = true;
      failAll(abortError());
      w.terminate();
      canvas.remove();
    },
  };
}

/**
 * Makes the engine for a host element: the worker when this browser can, else the page. `prefer: "main"` (tests, the CPU measurement
 * of the page path) skips the worker.
 */
export async function createPaintEngine(host: HTMLElement, opts: { prefer?: PaintEngineKind } = {}): Promise<PaintEngine> {
  if (opts.prefer !== "main" && offscreenAllowed()) {
    try {
      return await workerEngine(host);
    } catch {
      /* no worker after all: draw on the page */
    }
  }
  return mainEngine(host);
}
