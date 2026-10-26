import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { clamp01, createFrameLoop, prefersReducedMotion } from "@/motion/pulse/engine";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `parallax-strip-slider` (measured): the new image grows over the old one in 10 vertical strips,
 * strip i starting 26·i ms after the previous, each widening from its left edge over 420 ms (easeOutQuart) while
 * its height runs top → bottom (1 − e^(−t/45), full at 420 ms). Here the NEW image is the live content beneath
 * and the OLD snapshot sits on top: every strip of the snapshot is split into two pieces (the column right of the
 * revealed rectangle and the block under it) that slide away by transform, with their pixels counter-translated
 * so the picture itself never moves – compositor-only, no clip-path.
 */
export const CONFIG = {
  strips: 10,
  colStagger: 26, // ms between strip starts
  colWidthMs: 420, // easeOutQuart width
  colHeightTau: 45, // ms, 1 - exp(-t/τ)
  colHeightEnd: 420, // ms, height snaps to full here
  zIndex: 5, // same layer as the chart's screenshot crossfade
} as const;

export type StripDirection = "ltr" | "rtl";

const easeOutQuart = (p: number) => 1 - Math.pow(1 - clamp01(p), 4);

/** Total run time of a wipe with `n` strips (last strip start + its width ease). */
export function stripWipeDuration(n: number = CONFIG.strips): number {
  return CONFIG.colStagger * Math.max(0, n - 1) + CONFIG.colWidthMs;
}

/** Revealed fraction (width `sx`, height `sy`) of strip `i` at `e` ms (strip 0 is the first to start). */
export function stripReveal(e: number, i: number): { sx: number; sy: number } {
  const le = e - i * CONFIG.colStagger;
  if (le <= 0) return { sx: 0, sy: 0 };
  return {
    sx: easeOutQuart(le / CONFIG.colWidthMs),
    sy: le >= CONFIG.colHeightEnd ? 1 : 1 - Math.exp(-le / CONFIG.colHeightTau),
  };
}

export interface StripWipeOptions {
  strips?: number;
  direction?: StripDirection;
  onDone?: () => void;
  /** Skip the wipe (reduced motion): `onDone` runs at once. */
  reduced?: boolean;
}

interface Piece {
  outer: HTMLElement;
  inner: HTMLElement;
}

function fill(src: HTMLCanvasElement | string, left: number, sw: number, w: number, h: number): HTMLElement {
  if (typeof src === "string") {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:0;top:0;width:${sw}px;height:${h}px;background:url("${src.replace(/"/g, "%22")}") ${-left}px 0/${w}px ${h}px no-repeat`;
    return d;
  }
  const kx = src.width / Math.max(1, w);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * kx));
  c.height = Math.max(1, src.height);
  c.style.cssText = `position:absolute;left:0;top:0;width:${sw}px;height:${h}px`;
  try {
    c.getContext("2d")?.drawImage(src, left * kx, 0, sw * kx, src.height, 0, 0, c.width, c.height);
  } catch {
    /* tainted / unavailable canvas: the piece stays empty */
  }
  return c;
}

/**
 * Plays one wipe inside `host` (positioned; the overlay is `absolute inset-0`) from the OLD picture `from` to
 * whatever is rendered beneath. Returns a cancel function (removes the overlay, no `onDone`).
 */
export function playStripWipe(host: HTMLElement, from: HTMLCanvasElement | string, opts: StripWipeOptions = {}): () => void {
  const n = Math.max(1, Math.round(opts.strips ?? CONFIG.strips));
  const rtl = opts.direction === "rtl";
  if (opts.reduced || prefersReducedMotion()) {
    opts.onDone?.();
    return () => {};
  }
  const w = host.clientWidth;
  const h = host.clientHeight;
  if (!w || !h) {
    opts.onDone?.();
    return () => {};
  }
  const overlay = document.createElement("div");
  overlay.setAttribute("aria-hidden", "true");
  overlay.dataset.stripWipe = "";
  overlay.style.cssText = `position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:${CONFIG.zIndex};contain:strict`;
  const strips: { el: HTMLElement; sw: number; a: Piece; b: Piece; done: boolean }[] = [];
  const build = (src: HTMLCanvasElement | string) => {
    for (let i = 0; i < n; i++) {
      const left = Math.round((i * w) / n);
      const sw = Math.round(((i + 1) * w) / n) - left;
      const el = document.createElement("div");
      el.style.cssText = `position:absolute;top:0;left:${left}px;width:${sw}px;height:${h}px;overflow:hidden`;
      const piece = (): Piece => {
        const outer = document.createElement("div");
        outer.style.cssText = `position:absolute;left:0;top:0;width:${sw}px;height:${h}px;overflow:hidden;will-change:transform`;
        const inner = fill(src, left, sw, w, h);
        inner.style.willChange = "transform";
        outer.appendChild(inner);
        el.appendChild(outer);
        return { outer, inner };
      };
      const a = piece();
      const b = piece();
      // block under the revealed rectangle starts outside the strip
      b.outer.style.transform = `translate3d(${rtl ? sw : -sw}px,0,0)`;
      strips.push({ el, sw, a, b, done: false });
      overlay.appendChild(el);
    }
  };

  const total = stripWipeDuration(n);
  let t0 = performance.now();
  let finished = false;
  let cancelled = false;
  let objectUrl = "";
  const render = (e: number) => {
    for (let i = 0; i < n; i++) {
      const s = strips[i]!;
      if (s.done) continue;
      const { sx, sy } = stripReveal(e, rtl ? n - 1 - i : i);
      if (sx >= 1 && sy >= 1) {
        s.done = true;
        s.el.style.visibility = "hidden";
        continue;
      }
      if (sx <= 0) continue;
      const dx = sx * s.sw;
      const dy = sy * h;
      const ax = rtl ? -dx : dx;
      const bx = rtl ? s.sw - dx : dx - s.sw;
      s.a.outer.style.transform = `translate3d(${ax.toFixed(2)}px,0,0)`;
      s.a.inner.style.transform = `translate3d(${(-ax).toFixed(2)}px,0,0)`;
      s.b.outer.style.transform = `translate3d(${bx.toFixed(2)}px,${dy.toFixed(2)}px,0)`;
      s.b.inner.style.transform = `translate3d(${(-bx).toFixed(2)}px,${(-dy).toFixed(2)}px,0)`;
    }
  };
  const cleanup = () => {
    loop.stop();
    overlay.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
  const loop = createFrameLoop(() => {
    const e = performance.now() - t0;
    if (e >= total) {
      finished = true;
      cleanup();
      opts.onDone?.();
      return false;
    }
    render(e);
    return true;
  });
  if (typeof requestAnimationFrame !== "function") {
    opts.onDone?.();
    return () => {};
  }
  const run = () => {
    t0 = performance.now();
    loop.wake();
  };
  const canEncode = typeof from !== "string" && typeof from.toBlob === "function" && typeof URL.createObjectURL === "function" && typeof Image === "function";
  if (canEncode) {
    // Splitting a canvas into 20 canvases costs several long frames; instead the snapshot itself covers the host
    // while it is encoded off-thread, then the strips share one decoded image URL (no per-strip canvas raster).
    const cover = from;
    cover.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px`;
    overlay.appendChild(cover);
    host.appendChild(overlay);
    const fallback = () => {
      if (cancelled) return;
      cover.remove();
      build(from);
      run();
    };
    try {
      from.toBlob((blob) => {
        if (cancelled) return;
        if (!blob) return fallback();
        objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.src = objectUrl;
        img
          .decode()
          .catch(() => undefined)
          .then(() => {
            if (cancelled) return;
            build(objectUrl);
            cover.remove();
            run();
          });
      });
    } catch {
      fallback();
    }
  } else {
    build(from);
    host.appendChild(overlay);
    run();
  }
  return () => {
    cancelled = true;
    if (!finished) cleanup();
  };
}

export interface StripWipeProps {
  /** Every change (after mount) plays one wipe from `from` to the live content beneath. */
  trigger: unknown;
  /** The OLD picture: a canvas snapshot (e.g. chart.takeScreenshot()) or an image URL; `null` = no wipe. */
  from: HTMLCanvasElement | string | null;
  strips?: number;
  direction?: StripDirection;
  onDone?: () => void;
  className?: string;
}

/**
 * Overlay host for `playStripWipe`: `absolute inset-0`, `pointer-events: none`, placed over the live content in a
 * positioned parent. The wipe starts in a layout effect, so the snapshot covers the new content before its first
 * paint. A new trigger cancels a running wipe. Reduced motion: instant (`onDone` at once).
 */
export function StripWipe({ trigger, from, strips = CONFIG.strips, direction = "ltr", onDone, className }: StripWipeProps) {
  const reduced = useReducedFx();
  const hostRef = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const cancel = useRef<(() => void) | null>(null);
  const latest = useRef({ from, strips, direction, onDone, reduced });

  useLayoutEffect(() => {
    latest.current = { from, strips, direction, onDone, reduced };
  });

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const host = hostRef.current;
    const o = latest.current;
    cancel.current?.();
    cancel.current = null;
    if (!host || !o.from) return;
    cancel.current = playStripWipe(host, o.from, {
      strips: o.strips,
      direction: o.direction,
      reduced: o.reduced,
      onDone: () => {
        cancel.current = null;
        latest.current.onDone?.();
      },
    });
  }, [trigger]);

  useLayoutEffect(
    () => () => {
      cancel.current?.();
    },
    [],
  );

  return <div ref={hostRef} aria-hidden="true" data-strip-wipe-host="" className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} style={{ zIndex: CONFIG.zIndex }} />;
}
