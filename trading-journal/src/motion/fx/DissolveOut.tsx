import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { playWaapi } from "@/motion/fx/shared";
import { seeded } from "@/motion/pulse/engine";
import { createTimeline, type Timeline } from "@/motion/pulse/textKit";
import { fxTiming, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * DissolveOut – a deleted card / row / account dissolves into pixels: a seeded random order removes cells of a pixel
 * grid in `tween.dissolve` (≈ 10 `clip-path: path()` steps at `fxTiming.dissolveFps`, the remaining cells merged into
 * row runs), the element dims and sinks 4 px meanwhile, then `onDone` fires so the owner removes it.
 *
 * One layout read per dissolve (the element's size at the start), clip-path / transform / opacity writes only on a
 * step change, no React renders. Without `clip-path: path()` support (or under reduced motion) it simply fades
 * (`tween.exit`). Use the wrapper `<DissolveOut active onDone>` or the imperative `dissolveElement(el)` (Promise).
 */
export const DISSOLVE = {
  /** target pixel size (px); grown so a dissolve never builds more than `maxCells` cells */
  cell: 9,
  maxCells: 900,
  sink: 4,
  /** opacity at the end of the dissolve */
  dim: 0.35,
} as const;

/** Grid of a `w × h` element (cell size grown until ≤ maxCells). */
export function dissolveGrid(w: number, h: number, cell: number = DISSOLVE.cell): { cols: number; rows: number; cell: number } {
  let c = Math.max(2, cell);
  for (;;) {
    const cols = Math.max(1, Math.ceil(w / c));
    const rows = Math.max(1, Math.ceil(h / c));
    if (cols * rows <= DISSOLVE.maxCells || c > 256) return { cols, rows, cell: c };
    c *= 1.25;
  }
}

/** Seeded removal order of `n` cells (Fisher–Yates). */
export function dissolveOrder(n: number, seed = 1): Uint32Array {
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const rand = seeded(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i]!;
    order[i] = order[j]!;
    order[j] = t;
  }
  return order;
}

/** `path()` of the cells still present after removing the first `removed` cells of `order` (row runs merged). */
export function dissolvePath(order: Uint32Array, removed: number, cols: number, rows: number, cell: number): string {
  const gone = new Uint8Array(cols * rows);
  for (let i = 0; i < Math.min(removed, order.length); i++) gone[order[i]!] = 1;
  let d = "";
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (gone[r * cols + c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < cols && !gone[r * cols + c]) c++;
      const x = start * cell;
      const y = r * cell;
      d += `M${+x.toFixed(2)} ${+y.toFixed(2)}h${+((c - start) * cell).toFixed(2)}v${+cell.toFixed(2)}h${-((c - start) * cell).toFixed(2)}z`;
    }
  }
  return d || "M0 0z";
}

function supportsPathClip(): boolean {
  try {
    return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("clip-path", 'path("M0 0H1V1Z")');
  } catch {
    return false;
  }
}

function prefersReduced(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export interface DissolveOptions {
  cell?: number;
  seed?: number;
  /** seconds (default `tween.dissolve`) */
  duration?: number;
  reduced?: boolean;
}

const running = new WeakMap<Element, Timeline>();

/** Dissolves `el` (resolves when done; the element is left fully clipped / transparent for its owner to remove). */
export function dissolveElement(el: HTMLElement, { cell = DISSOLVE.cell, seed = 1, duration = tween.dissolve.duration, reduced = prefersReduced() }: DissolveOptions = {}): Promise<void> {
  running.get(el)?.stop();
  return new Promise((resolve) => {
    if (reduced || !supportsPathClip()) {
      const a = playWaapi(el, [{ opacity: 1 }, { opacity: 0 }], { ...tween.exit, fill: "forwards" });
      el.style.opacity = "0";
      if (!a) resolve();
      else a.onfinish = () => resolve();
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const grid = dissolveGrid(w, h, cell);
    const order = dissolveOrder(grid.cols * grid.rows, seed);
    const steps = Math.max(2, Math.round(duration * fxTiming.dissolveFps));
    const ms = duration * 1000;
    let last = -1;
    el.style.willChange = "clip-path, transform, opacity";
    const tl = createTimeline(el, (e) => {
      const p = Math.min(1, e / ms);
      const step = Math.min(steps, Math.floor(p * steps + 1e-9));
      if (step !== last) {
        last = step;
        const k = step / steps;
        // ease-in: few pixels first, then the rest crumbles
        const removed = Math.round(order.length * k * k * (3 - 2 * k));
        el.style.clipPath = step >= steps ? "inset(50%)" : `path("${dissolvePath(order, removed, grid.cols, grid.rows, grid.cell)}")`;
        el.style.transform = `translateY(${(DISSOLVE.sink * k).toFixed(2)}px)`;
        el.style.opacity = String(1 - (1 - DISSOLVE.dim) * k);
      }
      if (p >= 1) {
        el.style.opacity = "0";
        el.style.willChange = "";
        running.delete(el);
        resolve();
        return false;
      }
      return true;
    });
    running.set(el, tl);
    tl.start();
  });
}

export interface DissolveOutProps {
  /** Start the dissolve (once per false → true). */
  active: boolean;
  onDone?: () => void;
  cell?: number;
  seed?: number;
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "section" | "article";
}

export function DissolveOut({ active, onDone, cell, seed, children, className, as = "div" }: DissolveOutProps) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  useLayoutEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let live = true;
    void dissolveElement(el, { cell, seed, reduced }).then(() => {
      if (live) done.current?.();
    });
    return () => {
      live = false;
    };
  }, [active, cell, seed, reduced]);
  const Tag = as as "div";
  return (
    <Tag ref={ref} data-fx="dissolve" data-dissolving={active ? "" : undefined} aria-hidden={active ? true : undefined} className={cn(active && "pointer-events-none", className)}>
      {children}
    </Tag>
  );
}
