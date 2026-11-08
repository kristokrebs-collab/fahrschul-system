import { useEffect, useRef } from "react";
import { observeInView } from "@/motion/inView";
import { createOrbLoop } from "@/motion/orbLoop";
import { easeLook, RING_LOOK, RING_SETTLE_MS, RING_STILL_T, ringPoints, ringSpin, type RingLook, type RingMood, type RingPoint } from "@/motion/ringMath";

export interface VoiceRingCanvasProps {
  mood: RingMood;
  /** Edge length in CSS px. */
  size: number;
  /** `false` freezes the ring on its still frame (the work is done / paused). */
  active: boolean;
  className?: string;
}

export interface RingPalette {
  /** the text colour: the ring itself */
  fg: string;
  /** the one accent that runs round it */
  signal: string;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function trace(ctx: CanvasRenderingContext2D, half: number, pts: readonly RingPoint[], from = 0, count = pts.length, closed = true): void {
  ctx.beginPath();
  for (let k = 0; k < count; k++) {
    const p = pts[(from + k) % pts.length]!;
    const x = half + p.x * half;
    const y = half + p.y * half;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  if (closed) ctx.closePath();
}

/**
 * Paints one frame of the ring into `ctx` (a `size × size` CSS-px box, already scaled for the pixel ratio): per strand a soft halo (two
 * passes) and the line itself; then the accent – a short comet of the signal colour that runs round the core strand (three pieces with a fading tail).
 * Mono (no spin, no glow) is one plain strand in the text colour.
 */
export function paintRing(ctx: CanvasRenderingContext2D, size: number, look: RingLook, t: number, palette: RingPalette): void {
  ctx.clearRect(0, 0, size, size);
  const half = size / 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  let core: RingPoint[] = [];
  for (let l = look.layers - 1; l >= 0; l--) {
    const pts = ringPoints(look, t, l);
    if (l === 0) core = pts;
    trace(ctx, half, pts);
    ctx.strokeStyle = palette.fg;
    if (look.glow > 0.004) {
      // the halo falls off softly: a wide faint pass and a narrower stronger one (no blur filter – cheap, and the same in every browser)
      ctx.globalAlpha = look.glow * (l === 0 ? 0.45 : 0.25);
      ctx.lineWidth = look.core * half * 7;
      ctx.stroke();
      ctx.globalAlpha = look.glow * (l === 0 ? 0.8 : 0.45);
      ctx.lineWidth = look.core * half * 3.6;
      ctx.stroke();
    }
    ctx.globalAlpha = l === 0 ? 1 : 0.5;
    ctx.lineWidth = look.core * half * (l === 0 ? 1 : 0.75);
    ctx.stroke();
  }
  // the accent fades in with the spin (a ring that eases into mono loses it by itself)
  const accent = clamp01(look.spin * 9);
  if (accent > 0.02 && core.length > 0) {
    const n = core.length;
    const head = Math.floor(((ringSpin(look, t) / (Math.PI * 2)) % 1) * n + n) % n;
    const piece = Math.round(n * 0.1);
    ctx.strokeStyle = palette.signal;
    for (let k = 0; k < 3; k++) {
      // piece 0 is the tail end, piece 2 the head; neighbours share one point so the comet has no gaps
      const from = (head - (3 - k) * piece + n * 4) % n;
      ctx.globalAlpha = accent * (0.3 + 0.35 * k);
      ctx.lineWidth = look.core * half * (1.05 + 0.2 * k);
      trace(ctx, half, core, from, piece + 1, false);
      ctx.stroke();
    }
    if (look.glow > 0.004) {
      ctx.globalAlpha = accent * look.glow * 1.1;
      ctx.lineWidth = look.core * half * 4.4;
      trace(ctx, half, core, (head - piece + n * 4) % n, piece + 1, false);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * The animated ring (its own lazy chunk – `ThinkingOrb` loads it for `variant="ring"`). One canvas, 2D; the frame loop (`orbLoop`) asks for
 * frames only while the ring is meant to run, on screen and in a visible tab – nothing loops for a hidden tab or a scrolled-away card, and a
 * QUIET ring moves for a moment (`RING_SETTLE_MS`) and then rests. The look eases from one mood to the next (no jump). The colours are read
 * from the element when the loop (re)starts: the text colour and `--color-signal`.
 */
export default function VoiceRingCanvas({ mood, size, active, className }: VoiceRingCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef<ReturnType<typeof createOrbLoop> | null>(null);
  const moodRef = useRef(mood);
  const activeRef = useRef(active);
  const lookRef = useRef<{ look: RingLook; t: number }>({ look: RING_LOOK[mood], t: 0 });
  const settled = useRef(false);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d") ?? null;
    if (!canvas || !ctx) return;
    const dpr = Math.min(2.5, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const read = (): RingPalette => {
      const cs = getComputedStyle(canvas);
      return { fg: cs.color || "#fff", signal: cs.getPropertyValue("--color-signal").trim() || "#ff4d3d" };
    };
    let palette = read();
    // a canvas that cannot draw (a stubbed context, a lost GPU context) leaves the ring blank – never an error in the frame loop
    const draw = (t: number): void => {
      try {
        const target = RING_LOOK[moodRef.current];
        if (!activeRef.current || settled.current) {
          paintRing(ctx, size, target, RING_STILL_T[moodRef.current], palette);
          return;
        }
        const s = lookRef.current;
        s.look = easeLook(s.look, target, t - s.t);
        s.t = t;
        paintRing(ctx, size, s.look, t, palette);
      } catch {
        /* blank ring */
      }
    };
    const loop = createOrbLoop(draw, undefined, { active: activeRef.current, inView: true });
    loopRef.current = loop;
    const onVisibility = (): void => {
      palette = read();
      loop.visibility();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const stop = observeInView(canvas, (inView) => {
      if (inView) palette = read();
      loop.set({ inView });
    });
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      loop.dispose();
      loopRef.current = null;
    };
  }, [size]);

  // the mood and the host's `active` decide whether the loop runs: a quiet ring rests after its settle time, any other mood runs while active
  useEffect(() => {
    moodRef.current = mood;
    activeRef.current = active;
    settled.current = false;
    loopRef.current?.set({ active });
    if (!active || mood !== "quiet") return;
    const timer = setTimeout(() => {
      settled.current = true;
      loopRef.current?.set({ active: false });
    }, RING_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [mood, active]);

  return <canvas ref={ref} width={size} height={size} style={{ width: size, height: size }} className={className} aria-hidden="true" data-orb-canvas="" data-ring-canvas="" />;
}
