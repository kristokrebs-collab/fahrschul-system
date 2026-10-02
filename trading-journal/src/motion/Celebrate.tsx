import { animate, frame, type AnimationPlaybackControls } from "motion/react";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useUi, type Celebration, type CelebrateKind, type CelebrateTone } from "@/store/uiStore";

/**
 * Confetti burst overlay (21st.dev "Confetti burst", Nothing variant): round glyph dots only, white + win-green,
 * plus ONE red signal dot for a record. Mounted once in the app shell; bursts are queued through
 * `uiStore.celebrate({x, y, tone, kind})` or `celebrateFrom(element)`.
 *
 * Every particle is a DOM dot animated with transform/opacity keyframes (WAAPI via `animate(el, …)`), so the
 * burst stays smooth on the compositor even while saving a trade keeps the main thread busy. The physics
 * (gravity + air drag) is sampled into the keyframes; the overlay is `fixed inset-0 overflow-hidden`, so
 * particles can never create scroll overflow. Reduced motion: no particles, a single fading ring at the origin.
 */

/* ------------------------------------------------------------------ pure particle model */

/** Deterministic PRNG (mulberry32) – particles derive from the burst seed, so rendering stays pure. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MAX_PARTICLES = 40;
const COUNT: Record<CelebrateKind, number> = { win: 28, streak: 36, record: 40 };
/** Half-angle of the upward cone (degrees). */
const SPREAD: Record<CelebrateKind, number> = { win: 55, streak: 62, record: 70 };
// Physics constants of the sampled trajectories (not motion tokens): px/s² gravity, 1/s linear air drag.
const GRAVITY = 800;
const DRAG = 1;
const SAMPLES = 12;

export const PARTICLE_COLORS = { white: "#f2f2f2", win: "#3ddc84", signal: "#e5202e" } as const;

export interface Particle {
  size: number;
  color: string;
  /** `translate3d(…) scale(…)` keyframes in viewport px (evenly spaced). */
  transform: string[];
  opacity: number[];
  /** seconds */
  duration: number;
  delay: number;
  record: boolean;
}

/** Position after `t` seconds for launch velocity `(vx, vy)` under gravity with linear drag (closed form). */
export function ballistic(vx: number, vy: number, t: number): { x: number; y: number } {
  const e = 1 - Math.exp(-DRAG * t);
  const terminal = GRAVITY / DRAG;
  return { x: (vx / DRAG) * e, y: ((vy - terminal) / DRAG) * e + terminal * t };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Particles of one burst. Speeds 250–600 px/s in an upward cone (`−90° ± spread`), life ≈ `tween.burst` (±15 %),
 * scale-in over the first 10 %, fade over the last 40 %. `record` adds one larger red dot that shoots straight up.
 */
export function burstParticles({ x, y, tone, kind, seed }: Pick<Celebration, "x" | "y" | "tone" | "kind" | "seed">): Particle[] {
  const rand = mulberry32(seed);
  const count = Math.min(MAX_PARTICLES, COUNT[kind]);
  const greenShare = tone === "win" ? 0.6 : 0.2;
  const spread = (SPREAD[kind] * Math.PI) / 180;
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const record = kind === "record" && i === 0;
    const angle = -Math.PI / 2 + (record ? (rand() - 0.5) * 0.14 : (rand() * 2 - 1) * spread);
    const speed = record ? 560 : 250 + rand() * 350;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const duration = tween.burst.duration * (record ? 1.15 : 0.85 + rand() * 0.3);
    const size = record ? 8 : Math.round(3 + rand() * 3);
    const color = record ? PARTICLE_COLORS.signal : rand() < greenShare ? PARTICLE_COLORS.win : PARTICLE_COLORS.white;
    const transform: string[] = [];
    const opacity: number[] = [];
    for (let s = 0; s <= SAMPLES; s++) {
      const p = s / SAMPLES;
      const pos = ballistic(vx, vy, p * duration);
      const scale = p < 0.1 ? 0.3 + 7 * p : 1 - 0.5 * Math.max(0, (p - 0.5) / 0.5);
      transform.push(`translate3d(${r1(x + pos.x - size / 2)}px, ${r1(y + pos.y - size / 2)}px, 0) scale(${r1(scale * 100) / 100})`);
      opacity.push(p < 0.6 ? 1 : r1((1 - (p - 0.6) / 0.4) * 100) / 100);
    }
    out.push({ size, color, transform, opacity, duration, delay: record ? 0 : rand() * 0.06, record });
  }
  return out;
}

/* ------------------------------------------------------------------ imperative trigger */

function prefersReduced(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface CelebrateFromOptions {
  tone?: CelebrateTone;
  kind?: CelebrateKind;
  /** Squash the trigger (`.9 → overshoot → 1` on `spring.pop`); default true, never under reduced motion. */
  squash?: boolean;
}

const onScreen = (r: DOMRect): boolean =>
  r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;

/**
 * Bursts from the centre of `el` (e.g. the Save button). The rect is read in `frame.read` and the burst queued in
 * the same frame's update step, so it never forces a synchronous layout in the middle of a React commit.
 * Given a list, the burst comes from the first candidate that is on screen (e.g. the figure that just changed,
 * then a fallback), else the first one still in the document, else the last one.
 */
export function celebrateFrom(target: Element | readonly (Element | null | undefined)[] | null | undefined, { tone, kind, squash = true }: CelebrateFromOptions = {}): void {
  const list = (Array.isArray(target) ? target : [target]).filter((e): e is Element => !!e);
  if (list.length === 0) return;
  frame.read(() => {
    const rects = list.map((e) => e.getBoundingClientRect());
    let i = rects.findIndex((r, k) => (list[k] as Element).isConnected && onScreen(r));
    if (i < 0) i = list.findIndex((e) => e.isConnected);
    if (i < 0) i = list.length - 1;
    const el = list[i] as Element;
    const r = rects[i] as DOMRect;
    frame.update(() => {
      useUi.getState().celebrate({ x: r.left + r.width / 2, y: r.top + r.height / 2, tone, kind });
      if (squash && el.isConnected && !prefersReduced()) animate(el, { scale: [0.9, 1] }, spring.pop);
    });
  });
}

/* ------------------------------------------------------------------ overlay */

const RING = 24;

const Burst = memo(function Burst({ burst, reduced, onDone }: { burst: Celebration; reduced: boolean; onDone: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const particles = useMemo(() => (reduced ? [] : burstParticles(burst)), [burst, reduced]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const [ring, ...dots] = Array.from(root.children);
    const controls: AnimationPlaybackControls[] = [];
    const at = `translate3d(${burst.x - RING / 2}px, ${burst.y - RING / 2}px, 0)`;
    let total: number;
    if (ring) {
      if (reduced) {
        controls.push(animate(ring, { opacity: [0.9, 0] }, tween.flash));
        total = tween.flash.duration;
      } else {
        controls.push(animate(ring, { transform: [`${at} scale(0.4)`, `${at} scale(2.6)`], opacity: [0.9, 0] }, tween.ripple));
        total = tween.ripple.duration;
      }
    } else total = 0;
    particles.forEach((p, i) => {
      const el = dots[i];
      if (!el) return;
      // the trajectory (drag + gravity) is baked into evenly spaced samples, so the timeline itself is linear
      controls.push(animate(el, { transform: p.transform, opacity: p.opacity }, { ...tween.burst, duration: p.duration, delay: p.delay, ease: "linear" }));
      total = Math.max(total, p.delay + p.duration);
    });
    const done = setTimeout(() => onDone(burst.id), total * 1000 + 60);
    return () => {
      clearTimeout(done);
      for (const c of controls) c.stop();
    };
  }, [burst, particles, reduced, onDone]);

  const ringTone = burst.tone === "win" ? "border-win/70" : "border-white/60";
  return (
    <div ref={ref} className="absolute inset-0" data-burst={burst.id} data-kind={burst.kind}>
      <span
        className={`absolute left-0 top-0 rounded-full border-[1.5px] ${ringTone}`}
        style={{ width: RING, height: RING, opacity: 0, transform: `translate3d(${burst.x - RING / 2}px, ${burst.y - RING / 2}px, 0) scale(${reduced ? 1.3 : 0.4})` }}
      />
      {particles.map((p, i) => (
        <span
          key={i}
          data-record={p.record || undefined}
          className="absolute left-0 top-0 rounded-full will-change-transform"
          style={{ width: p.size, height: p.size, background: p.color, opacity: 0, transform: p.transform[0], boxShadow: p.record ? `0 0 10px ${PARTICLE_COLORS.signal}` : undefined }}
        />
      ))}
    </div>
  );
});

/**
 * Mount once (app shell, inside `MotionRoot`). Renders nothing until a burst is queued; then a
 * `fixed inset-0 z-[80] overflow-hidden pointer-events-none` layer, `aria-hidden` (purely decorative – the toast
 * carries the message).
 */
export function Celebrate() {
  const bursts = useUi((s) => s.celebrations);
  const end = useUi((s) => s.endCelebration);
  const reduced = useReducedFx();
  if (bursts.length === 0) return null;
  return (
    <div aria-hidden="true" data-celebrate="" className="pointer-events-none fixed inset-0 z-[80] overflow-hidden [contain:strict]">
      {bursts.map((b) => (
        <Burst key={b.id} burst={b} reduced={reduced} onDone={end} />
      ))}
    </div>
  );
}
