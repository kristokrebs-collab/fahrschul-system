import { useEffect, useRef } from "react";
import { observeInView } from "@/motion/inView";
import { createOrbLoop } from "@/motion/orbLoop";
import { bucketAlpha, bucketOf, ORB_BUCKETS, orbFrame, orbStill, type OrbDot, type OrbVariant } from "@/motion/orbMath";

export interface ThinkingOrbCanvasProps {
  variant: OrbVariant;
  /** Edge length in CSS px. */
  size: number;
  /** `false` freezes the orb on its still frame (the work is done / paused). */
  active: boolean;
  className?: string;
}

/** Draws `dots` into `ctx` (a `size × size` CSS-px box, already scaled for the pixel ratio): one fill per opacity bucket. */
export function paintOrb(ctx: CanvasRenderingContext2D, size: number, dots: readonly OrbDot[], color: string): void {
  ctx.clearRect(0, 0, size, size);
  const half = size / 2;
  ctx.fillStyle = color;
  for (let b = 0; b < ORB_BUCKETS; b++) {
    ctx.globalAlpha = bucketAlpha(b);
    ctx.beginPath();
    let any = false;
    for (const d of dots) {
      if (bucketOf(d.a) !== b) continue;
      const x = half + d.x * half;
      const y = half + d.y * half;
      const r = Math.max(0.6, d.r * half);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
      any = true;
    }
    if (any) ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * The animated orb (its own lazy chunk – `ThinkingOrb` loads it). One canvas, 2D, drawn with batched arcs; the frame loop
 * (`orbLoop`) asks for frames only while the orb is meant to run, on screen and in a visible tab. The colour is the text
 * colour of the element (`currentColor`), read when the loop (re)starts, so a theme switch shows at the next frame.
 */
export default function ThinkingOrbCanvas({ variant, size, active, className }: ThinkingOrbCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef<ReturnType<typeof createOrbLoop> | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d") ?? null;
    if (!canvas || !ctx) return;
    const dpr = Math.min(2.5, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let color = getComputedStyle(canvas).color || "#fff";
    const draw = (t: number): void => paintOrb(ctx, size, activeRef.current ? orbFrame(variant, t) : orbStill(variant), color);
    const loop = createOrbLoop(draw, undefined, { active: activeRef.current, inView: true });
    loopRef.current = loop;
    const onVisibility = (): void => {
      color = getComputedStyle(canvas).color || color;
      loop.visibility();
    };
    document.addEventListener("visibilitychange", onVisibility);
    // off screen: no frames at all (the shared observer of the motion kit, one for every orb)
    const stop = observeInView(canvas, (inView) => {
      if (inView) color = getComputedStyle(canvas).color || color;
      loop.set({ inView });
    });
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      loop.dispose();
      loopRef.current = null;
    };
  }, [variant, size]);

  useEffect(() => {
    loopRef.current?.set({ active });
  }, [active]);

  return <canvas ref={ref} width={size} height={size} style={{ width: size, height: size }} className={className} aria-hidden="true" data-orb-canvas="" />;
}
