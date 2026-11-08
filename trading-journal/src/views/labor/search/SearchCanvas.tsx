/**
 * The stage of the strategy search: a canvas that replays the REAL curves of a finished search (cumulative R after costs of each of
 * the 1.000 variants), a scanner that visits every variant in its real order, a mint flash whenever the best score so far changes,
 * the others stepping back, and the winner's thick line running dashed into the final-test zone. One finite replay (`REPLAY_MS`),
 * no loop; reduced motion and „Überspringen“ jump to the end state. The picture is built from `timeline.ts` (data, tested); this file
 * only owns the canvas, the clock and the colours of the active theme. `data-state` ("playing" | "done") is written to the DOM directly.
 */
import { useEffect, useRef } from "react";
import { useReducedFx } from "@/motion/useReducedFx";
import { drawFrame, framePlan, geometryOf, rangeOf, REPLAY_MS, type Palette, type Scene } from "./timeline";

/** Fixed stage height (px): the space is reserved before anything is drawn – no layout shift on any width. */
export const STAGE_H = 260;

function paletteOf(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fb: string): string => cs.getPropertyValue(name).trim() || fb;
  const veil = v("--veil-rgb", "255 255 255");
  return {
    fg: v("--color-fg", "#f2f2f2"),
    mute: v("--color-mute", "#9b9b9b"),
    faint: v("--color-faint", "#5f5f5f"),
    line: v("--color-faint-line", "#5f5f5f"),
    win: v("--color-win", "#3ddc84"),
    loss: v("--color-loss", "#ff4d4f"),
    zone: `rgb(${veil} / 0.045)`,
  };
}

export interface SearchCanvasProps {
  scene: Scene;
  /** a new value starts the replay again (one per finished search / „Wiedergabe wiederholen“) */
  playKey: number;
  /** a new value jumps to the end state */
  skipKey?: number;
  label: string;
  /** called once per replay when its end state is on screen, with the `playKey` it belongs to */
  onDone?: (playKey: number) => void;
  className?: string;
}

export function SearchCanvas({ scene, playKey, skipKey = 0, label, onDone, className }: SearchCanvasProps) {
  const reduced = useReducedFx();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const paintAt = useRef<((t: number) => void) | null>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  const skipSeen = useRef(skipKey);

  useEffect(() => {
    const box = wrap.current;
    const cv = canvas.current;
    if (!box || !cv) return;
    const ctx = typeof cv.getContext === "function" ? cv.getContext("2d") : null;
    const range = rangeOf(scene);
    let width = 0;
    let pal: Palette | null = null;
    let now = 0;
    const paint = (t: number): void => {
      now = t;
      if (!ctx || width <= 0) return;
      pal ??= paletteOf(cv);
      drawFrame(ctx, geometryOf(width, STAGE_H), scene, framePlan(scene, t), pal, range);
    };
    paintAt.current = paint;
    const finish = (): void => {
      box.dataset.state = "done";
      doneRef.current?.(playKey);
    };
    const size = (): void => {
      const w = Math.round(box.clientWidth);
      if (w <= 0) return;
      const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
      width = w;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(STAGE_H * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${STAGE_H}px`;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(now);
    };
    // theme changes repaint with the new colours
    const mo =
      typeof MutationObserver === "function"
        ? new MutationObserver(() => {
            pal = null;
            paint(now);
          })
        : null;
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(size) : null;
    ro?.observe(box);
    size();
    if (reduced) {
      paint(REPLAY_MS);
      finish();
    } else {
      box.dataset.state = "playing";
      let start = 0;
      const tick = (stamp: number): void => {
        if (!start) start = stamp;
        const t = Math.min(REPLAY_MS, stamp - start);
        paint(t);
        if (t >= REPLAY_MS) {
          finish();
          return;
        }
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(raf.current);
      ro?.disconnect();
      mo?.disconnect();
      paintAt.current = null;
    };
  }, [scene, playKey, reduced]);

  // „Überspringen“: straight to the end state
  useEffect(() => {
    if (skipKey === skipSeen.current) return;
    skipSeen.current = skipKey;
    const box = wrap.current;
    if (!box || box.dataset.state === "done") return;
    cancelAnimationFrame(raf.current);
    paintAt.current?.(REPLAY_MS);
    box.dataset.state = "done";
    doneRef.current?.(playKey);
  }, [skipKey, playKey]);

  return (
    <div ref={wrap} className={className} style={{ height: STAGE_H }} data-testid="search-stage" data-curves={scene.n} data-flashes={scene.flashes.length} data-winner={scene.winner ?? ""}>
      <canvas ref={canvas} role="img" aria-label={label} data-testid="search-canvas" style={{ display: "block", maxWidth: "100%" }} />
    </div>
  );
}
