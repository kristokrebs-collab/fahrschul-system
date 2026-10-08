import { animate, cancelFrame, frame, motion, useMotionValue, useSpring, useTransform, type AnimationPlaybackControls } from "motion/react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { observeInView } from "@/motion/inView";
import { dwell, spring, tween } from "@/motion/tokens";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import {
  createField,
  FIELD_DOT_OFFSET,
  FIELD_FPS,
  FIELD_PITCH,
  fieldSize,
  seedField,
  setBlocked,
  stepField,
  type BlockRect,
  type FieldPoint,
  type FlickerField,
} from "@/primitives/heroField";
import { HoverRectTracker } from "@/primitives/hoverRect";

const FINE_POINTER = "(hover: hover) and (pointer: fine)";
/** Diameter of the pointer spotlight window (px). */
const SPOT = 320;
const STEP_MS = 1000 / FIELD_FPS;
const DOT_RADIUS = 1.15;
const SIGNAL_RADIUS = 1.45;
/** The static grid in a brighter tint: shown only inside the spotlight window. */
const BRIGHT_GRID = "radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.3) 1px, transparent 0) 0 0 / 18px 18px";

const mod = (v: number, m: number) => ((v % m) + m) % m;
/** Fill styles per quantised brightness (0..100): no string building per dot. The signal dot is boosted to read. */
const WHITE = Array.from({ length: 101 }, (_, q) => `rgba(255, 255, 255, ${q / 100})`);
const RED = Array.from({ length: 101 }, (_, q) => `rgba(229, 32, 46, ${Math.min(1, (q / 100) * 1.6)})`);

/**
 * Flicker engine on a canvas: steps the field at `FIELD_FPS` (drawn in Motion's render phase) and redraws only the
 * dots a step changed. Sleeps while off-screen or the tab is hidden, and `dwell.heroFlicker` after mount or the last
 * pointer activity on `host` (the page goes fully idle at rest; the next pointer move wakes it). Sized by a
 * ResizeObserver (device-pixel sharp).
 */
interface Flicker {
  dispose(): void;
  /** re-applies `blocks.current` to the live field (text moved / resized) */
  reblock(): void;
}

function startFlicker(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  focus: { current: FieldPoint | null },
  host: HTMLElement | null,
  blocks: { current: readonly BlockRect[] },
): Flicker {
  let ctx: CanvasRenderingContext2D | null = null;
  let field: FlickerField | null = null;
  let dirty = new Int32Array(0);
  let dpr = 1;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let inView = false;
  let awake = true;
  let idle: ReturnType<typeof setTimeout> | null = null;

  const resize = () => {
    const w = root.clientWidth;
    const h = root.clientHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx = canvas.getContext("2d");
    const { cols, rows } = fieldSize(w, h);
    field = createField(cols, rows);
    setBlocked(field, blocks.current);
    seedField(field, Math.random);
    dirty = new Int32Array(cols * rows);
  };

  const draw = (count: number) => {
    if (!ctx || !field) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let k = 0; k < count; k++) {
      const i = dirty[k] as number;
      const x = FIELD_DOT_OFFSET + (i % field.cols) * FIELD_PITCH;
      const y = FIELD_DOT_OFFSET + Math.floor(i / field.cols) * FIELD_PITCH;
      ctx.clearRect(x - 2.5, y - 2.5, 5, 5);
      const q = field.drawn[i] as number;
      if (q < 1) continue;
      const red = field.signal[i] === 1;
      ctx.fillStyle = (red ? RED : WHITE)[q] as string;
      ctx.beginPath();
      ctx.arc(x, y, red ? SIGNAL_RADIUS : DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // one step per timer tick, drawn inside Motion's render phase: between steps the page stays idle (no rAF loop)
  const step = () => {
    if (field) draw(stepField(field, Math.random, focus.current, dirty));
  };
  const schedule = () => {
    timer = setTimeout(() => {
      frame.render(step);
      schedule();
    }, STEP_MS);
  };

  const update = () => {
    const want = inView && awake && !document.hidden;
    if (want === running) return;
    running = want;
    if (want) {
      if (!field) resize();
      schedule();
    } else {
      if (timer) clearTimeout(timer);
      timer = null;
      cancelFrame(step);
    }
  };

  const sleep = () => {
    idle = null;
    awake = false;
    update();
  };
  const wake = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(sleep, dwell.heroFlicker * 1000);
    if (awake) return;
    awake = true;
    update();
  };
  wake();
  host?.addEventListener("pointermove", wake, { passive: true });
  host?.addEventListener("pointerenter", wake, { passive: true });

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => field && resize()) : null;
  ro?.observe(root);
  const unobserve = observeInView(root, (v) => {
    inView = v;
    update();
  });
  document.addEventListener("visibilitychange", update);
  return {
    dispose: () => {
      unobserve();
      ro?.disconnect();
      document.removeEventListener("visibilitychange", update);
      host?.removeEventListener("pointermove", wake);
      host?.removeEventListener("pointerenter", wake);
      if (idle) clearTimeout(idle);
      if (timer) clearTimeout(timer);
      cancelFrame(step);
    },
    reblock: () => {
      // newly blocked cells are cleared on the next step (they report dirty); a sleeping field steps once now
      if (field && setBlocked(field, blocks.current) > 0 && !running) frame.render(step);
    },
  };
}

/** Elements whose text keeps the dots away: `data-hero-mask="text"` (its text lines) or `"box"` (its border box). */
export const HERO_MASK_SELECTOR = "[data-hero-mask]";
/** Dark margin around masked text (px). */
const MASK_PAD = 6;
/** Re-measures are coalesced to at most one per this many ms (a counting number resizes its row every frame). */
const MASK_THROTTLE_MS = 150;

/** Text-line boxes (and `box` elements) under `host`, relative to `root`, padded and clipped to it. */
export function collectMaskRects(host: HTMLElement, root: HTMLElement, pad = MASK_PAD): BlockRect[] {
  const base = root.getBoundingClientRect();
  const out: BlockRect[] = [];
  const push = (r: { left: number; top: number; width: number; height: number }) => {
    if (r.width <= 1 || r.height <= 1) return; // sr-only text
    const x = Math.max(0, r.left - base.left - pad);
    const y = Math.max(0, r.top - base.top - pad);
    const x2 = Math.min(base.width, r.left - base.left + r.width + pad);
    const y2 = Math.min(base.height, r.top - base.top + r.height + pad);
    if (x2 > x && y2 > y)
      out.push({
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(x2 - x),
        h: Math.round(y2 - y),
      });
  };
  const range = typeof document.createRange === "function" ? document.createRange() : null;
  for (const el of host.querySelectorAll<HTMLElement>(HERO_MASK_SELECTOR)) {
    if (el.dataset.heroMask === "box") {
      push(el.getBoundingClientRect());
      continue;
    }
    if (!range || typeof range.getClientRects !== "function") continue;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue?.trim()) continue;
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) push(r);
    }
  }
  return out;
}

/** CSS mask (alpha) that hides a dot layer under `rects`: an SVG with the rects cut out of an opaque field. */
export function maskImageFor(rects: readonly BlockRect[], width: number, height: number): string {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const holes = rects.map((r) => `<rect x='${r.x}' y='${r.y}' width='${r.w}' height='${r.h}' rx='6' fill='black'/>`).join("");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'><defs><mask id='m'><rect width='${w}' height='${h}' fill='white'/>${holes}</mask></defs><rect width='${w}' height='${h}' fill='black' mask='url(#m)'/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

let fontsReady: Promise<unknown> | null = null;
let fontsSettled = false;

/**
 * `document.fonts.ready` the first time it is asked for in this page session (later: `null` once it has settled, the
 * same pending promise before). Reading the property forces a style + layout of the whole document.
 */
export function fontsReadyOnce(): Promise<unknown> | null {
  if (fontsSettled) return null;
  if (fontsReady) return fontsReady;
  const set = typeof document !== "undefined" ? document.fonts : undefined;
  if (!set) return null;
  fontsReady = set.ready.then(
    () => void (fontsSettled = true),
    () => void (fontsSettled = true),
  );
  return fontsReady;
}

/** Tests: forget the session's font state. */
export function resetFontsReadyForTests(): void {
  fontsReady = null;
  fontsSettled = false;
}

/**
 * Watches the hero's masked text (`HERO_MASK_SELECTOR` under `host`) and the backdrop size, and reports the dark
 * boxes whenever either resizes (throttled, measured in a frame – never per pointer move or per tick).
 */
function watchMask(root: HTMLElement, host: HTMLElement, onRects: (rects: BlockRect[], w: number, h: number) => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => undefined;
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = 0;
  const observed = new Set<Element>();
  const measure = () => {
    raf = 0;
    last = performance.now();
    for (const el of host.querySelectorAll(HERO_MASK_SELECTOR)) {
      if (observed.has(el)) continue;
      observed.add(el);
      ro.observe(el);
    }
    onRects(collectMaskRects(host, root), root.clientWidth, root.clientHeight);
  };
  const schedule = () => {
    if (raf || timer) return;
    const wait = Math.max(0, last + MASK_THROTTLE_MS - performance.now());
    timer = setTimeout(() => {
      timer = null;
      raf = requestAnimationFrame(measure);
    }, wait);
  };
  const ro = new ResizeObserver(schedule);
  ro.observe(root);
  schedule();
  // the hero text re-measures once the web fonts are in – read once per session: `document.fonts.ready` forces a style
  // + layout of the whole document, which on every re-show of the kept-alive Übersicht cost 25–37 ms in the reveal
  // frame (trace); afterwards the fonts are loaded and the ResizeObserver covers any change
  const fonts = fontsReadyOnce();
  if (fonts) fonts.then(schedule, () => undefined);
  return () => {
    ro.disconnect();
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
  };
}

/**
 * Hero backdrop (Bundle `d2`): three gradients + 18 px dot grid `rgb(255 255 255/.07)` – brought to life as a
 * Nothing dot matrix:
 * - a sparse flicker of the grid dots on a canvas (≈ 1 % of the cells re-roll per step at 12 fps, phosphor fade,
 *   a rare red signal dot), denser and brighter around the pointer, sleeping off-screen, in hidden tabs and
 *   `dwell.heroFlicker` after mount / the last pointer activity on the hero;
 * - a pointer spotlight (fine pointers): a soft glow plus a window onto a brighter copy of the grid, both moved only
 *   by transform – the window follows on `spring.smooth` while its grid is counter-shifted by the window offset
 *   modulo the pitch, so its dots stay locked to the static grid.
 * Decorative (`aria-hidden`, `pointer-events-none`); pointer events are read from the host element. Reduced motion:
 * the static bundle backdrop. Inline gradient styles are verbatim from the bundle (`.hero-backdrop` is the CSS twin).
 */
export function HeroBackdrop({ className }: { className?: string }) {
  const reduced = useReducedFx();
  const fine = useMediaQuery(FINE_POINTER, false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const spotWrapRef = useRef<HTMLDivElement>(null);
  const focus = useRef<FieldPoint | null>(null);
  const blocks = useRef<readonly BlockRect[]>([]);
  const flicker = useRef<Flicker | null>(null);

  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  const x = useSpring(tx, spring.smooth);
  const y = useSpring(ty, spring.smooth);
  const gridX = useTransform(x, (v) => -mod(v, FIELD_PITCH));
  const gridY = useTransform(y, (v) => -mod(v, FIELD_PITCH));
  const opacity = useMotionValue(0);
  const spot = fine && !reduced;

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (reduced || !root || !canvas) return;
    const f = startFlicker(root, canvas, focus, root.parentElement, blocks);
    flicker.current = f;
    return () => {
      f.dispose();
      flicker.current = null;
    };
  }, [reduced]);

  // dots never sit on text: the flicker skips masked cells, the static grid and the spotlight grid are masked by CSS
  useEffect(() => {
    const root = rootRef.current;
    const host = root?.parentElement;
    if (!root || !host) return;
    let lastUrl = "";
    return watchMask(root, host, (rects, w, h) => {
      blocks.current = rects;
      flicker.current?.reblock();
      const url = rects.length ? maskImageFor(rects, w, h) : "none";
      if (url === lastUrl) return;
      lastUrl = url;
      for (const el of [gridRef.current, spotWrapRef.current]) {
        if (!el) continue;
        el.style.maskImage = url;
        el.style.setProperty("-webkit-mask-image", url);
      }
    });
  }, []);

  useEffect(() => {
    const host = rootRef.current?.parentElement;
    if (!spot || !host) return;
    const rect = new HoverRectTracker();
    let fade: AnimationPlaybackControls | null = null;
    const local = (e: PointerEvent): FieldPoint | null => {
      const r = rect.read();
      return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
    };
    const show = (to: number) => {
      fade?.stop();
      fade = animate(opacity, to, tween.fade);
    };
    const enter = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      rect.enter(host);
      const p = local(e);
      if (!p) return;
      focus.current = p;
      // appear where the pointer is instead of sweeping in from the last position
      x.jump(p.x - SPOT / 2);
      y.jump(p.y - SPOT / 2);
      tx.jump(p.x - SPOT / 2);
      ty.jump(p.y - SPOT / 2);
      show(1);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !rect.tracks(host)) return;
      const p = local(e);
      if (!p) return;
      focus.current = p;
      tx.set(p.x - SPOT / 2);
      ty.set(p.y - SPOT / 2);
    };
    const leave = () => {
      focus.current = null;
      rect.leave();
      show(0);
    };
    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    return () => {
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      rect.leave();
      fade?.stop();
      focus.current = null;
    };
  }, [spot, x, y, tx, ty, opacity]);

  return (
    <div ref={rootRef} className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(110% 90% at 0% 0%, #2c2c2c 0%, transparent 55%), radial-gradient(80% 70% at 100% 100%, #222 0%, transparent 60%), linear-gradient(160deg, #151515, #0d0d0d)",
        }}
      />
      <div
        ref={gridRef}
        className="absolute inset-0 [mask-repeat:no-repeat] [mask-size:100%_100%]"
        style={{
          background: "radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.07) 1px, transparent 0) 0 0 / 18px 18px",
        }}
      />
      {!reduced && <canvas ref={canvasRef} className="absolute inset-0 size-full [mask-image:radial-gradient(130%_100%_at_15%_0%,#000_35%,transparent_85%)]" />}
      <div ref={spotWrapRef} className="absolute inset-0 [mask-repeat:no-repeat] [mask-size:100%_100%]">
        {spot && (
          <motion.div
            className="absolute left-0 top-0 overflow-hidden rounded-full will-change-transform [mask-image:radial-gradient(closest-side,#000_30%,transparent)]"
            style={{ width: SPOT, height: SPOT, x, y, opacity }}
          >
            <div className="absolute inset-0 bg-[radial-gradient(closest-side,rgb(255_255_255/0.06),transparent)]" />
            <motion.div
              className="absolute left-0 top-0 will-change-transform"
              style={{
                width: SPOT + FIELD_PITCH,
                height: SPOT + FIELD_PITCH,
                x: gridX,
                y: gridY,
                background: BRIGHT_GRID,
              }}
            />
          </motion.div>
        )}
      </div>
    </div>
  );
}
