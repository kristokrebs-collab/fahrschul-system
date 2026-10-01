import { animate, cancelFrame, frame, motion, useMotionValue, useSpring, useTransform, type AnimationPlaybackControls } from "motion/react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { observeInView } from "@/motion/inView";
import { dwell, spring, tween } from "@/motion/tokens";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { createField, FIELD_DOT_OFFSET, FIELD_FPS, FIELD_PITCH, fieldSize, seedField, stepField, type FieldPoint, type FlickerField } from "@/primitives/heroField";
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
function startFlicker(root: HTMLElement, canvas: HTMLCanvasElement, focus: { current: FieldPoint | null }, host: HTMLElement | null): () => void {
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
  return () => {
    unobserve();
    ro?.disconnect();
    document.removeEventListener("visibilitychange", update);
    host?.removeEventListener("pointermove", wake);
    host?.removeEventListener("pointerenter", wake);
    if (idle) clearTimeout(idle);
    if (timer) clearTimeout(timer);
    cancelFrame(step);
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
  const focus = useRef<FieldPoint | null>(null);

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
    return startFlicker(root, canvas, focus, root.parentElement);
  }, [reduced]);

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
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.07) 1px, transparent 0) 0 0 / 18px 18px" }} />
      {!reduced && <canvas ref={canvasRef} className="absolute inset-0 size-full [mask-image:radial-gradient(130%_100%_at_15%_0%,#000_35%,transparent_85%)]" />}
      {spot && (
        <motion.div
          className="absolute left-0 top-0 overflow-hidden rounded-full will-change-transform [mask-image:radial-gradient(closest-side,#000_30%,transparent)]"
          style={{ width: SPOT, height: SPOT, x, y, opacity }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(closest-side,rgb(255_255_255/0.06),transparent)]" />
          <motion.div className="absolute left-0 top-0 will-change-transform" style={{ width: SPOT + FIELD_PITCH, height: SPOT + FIELD_PITCH, x: gridX, y: gridY, background: BRIGHT_GRID }} />
        </motion.div>
      )}
    </div>
  );
}
