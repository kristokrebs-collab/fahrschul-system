import { Children, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { monotoneCurve } from "@/motion/fx/curve";
import { createFrameLoop, easeInOutSine, latestPointer } from "@/motion/pulse/engine";
import { springRests, stepSpring } from "@/motion/pulse/springStep";
import { canHoverNow, watchActivity } from "@/motion/pulse/textKit";
import { useFirstInView } from "@/motion/inView";
import { isScrolling } from "@/motion/scrollGate";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `cinematic-orbit-hero` (measured) as a reusable orbit: 6–10 cards rest as a slanted fan (−12°) in the
 * middle, then open along the pack's measured progress curve (slow start, peak ≈ 1.4 s, long run-out, 2.8 s) into a
 * flat elliptical ring around your copy – small at the back, large at the front, z-ordered by depth – while the copy
 * fades in linearly and grows .9 → 1 (sine). Afterwards the cards drift towards the pointer by depth (critically
 * damped 20 / 9 spring) and ←/→ turn the ring by one slot (70 / 15 spring). A coach profile around its headline, a
 * team ring, an album wall.
 *
 * Every pose is a pure function (`orbitPose`) of progress, slot angle and pointer; one frame loop writes transforms
 * (and z-index only when the order changes) and sleeps at rest / off screen. Geometry in container units (the stage
 * is a size container): no measuring. The cards are a real list (readable in order); the stage is a focusable group.
 * Reduced motion: the open ring at once, no drift; turning jumps.
 */
export const CONFIG = {
  /** opening progress p(t), t in ms after the start (pack, measured) */
  curve: [[0, 0], [300, 0.004], [500, 0.015], [700, 0.04], [900, 0.075], [1050, 0.15], [1200, 0.28], [1300, 0.39], [1400, 0.52], [1500, 0.625], [1600, 0.7], [1700, 0.76], [1850, 0.82], [2000, 0.88], [2150, 0.93], [2300, 0.962], [2500, 0.988], [2800, 1]] as const,
  openMs: 2800,
  /** pack waits 2.5 s in the fan; the app opens sooner after the first view (remix) */
  startDelay: 600,
  text: { delay: 700, duration: 1650, scaleFrom: 0.9, scaleDelay: 650, scaleDuration: 2000 },
  /** fan: centre (share of W / H), diagonal step (cqw), scale of a fan card, rotation */
  fan: { cx: 0.4846, cy: 0.4875, dx: 4.04, dy: 1.67, scale: 0.436, rot: -12 },
  /** ring: centre, radii (shares of W / H), perspective side / k (scale = side / (1 − k·sinθ)) */
  ring: { cx: 0.5, cy: 0.578, rx: 0.419, ry: 0.149, side: 0.513, k: 0.309, tilt: 16 },
  /** card width (cqw) at scale 1; 5 : 4 */
  card: 21,
  parallax: { x: 8.5, y: 4.05, spring: { stiffness: 20, damping: 9, mass: 1 } },
  spin: { stiffness: 70, damping: 15, mass: 1 },
} as const;

const curve = monotoneCurve(CONFIG.curve);

/** Opening progress at `ms` after the start. */
export function orbitProgress(ms: number): number {
  return curve(ms);
}

export interface OrbitPose {
  /** offset from the stage centre in cqw / cqh */
  x: number;
  y: number;
  scale: number;
  rotate: number;
  /** 0 back … 1 front */
  depth: number;
  z: number;
}

/** Pose of card `i` of `n` at progress `p`, ring turned by `spin` slots, pointer `(px, py)` in −1..1. */
export function orbitPose(i: number, n: number, p: number, spin = 0, px = 0, py = 0): OrbitPose {
  const { fan, ring } = CONFIG;
  const k = i - (n - 1) / 2;
  const fx = (fan.cx - 0.5) * 100 + fan.dx * k;
  const fy = (fan.cy - 0.5) * 100 + fan.dy * k * (100 / 56.25); // dy in cqw → cqh on a 16:9 stage
  const theta = ((-90 + ((i + spin) * 360) / Math.max(1, n)) * Math.PI) / 180;
  const sin = Math.sin(theta);
  const depth = (sin + 1) / 2;
  const rx = (ring.cx - 0.5) * 100 + ring.rx * 100 * Math.cos(theta);
  const ry = (ring.cy - 0.5) * 100 + ring.ry * 100 * sin;
  const rs = ring.side / (1 - ring.k * sin);
  const drift = 0.15 + 0.85 * depth;
  const q = Math.min(1, Math.max(0, p));
  const lerp = (a: number, b: number) => a + (b - a) * q;
  return {
    x: lerp(fx, rx) + CONFIG.parallax.x * px * drift * q,
    y: lerp(fy, ry) + CONFIG.parallax.y * py * drift * q * (100 / 56.25),
    scale: lerp(fan.scale, rs),
    rotate: lerp(fan.rot, ring.tilt * Math.cos(theta)),
    depth,
    z: q < 0.5 ? 100 - Math.round(Math.abs(k) * 10) : 10 + Math.round(depth * 100),
  };
}

export interface OrbitSpreadProps {
  /** The cards (6–10 read best). */
  items: readonly ReactNode[];
  /** The copy in the middle (headline, sub line). */
  children: ReactNode;
  /** `view` (default): opens after the first view; `click`: tap / Enter toggles; `manual`: follows `open`. */
  trigger?: "view" | "click" | "manual";
  open?: boolean;
  /** Accessible name of the group. */
  label: string;
  /** Accessible name of the card list. */
  listLabel?: string;
  className?: string;
}

export function OrbitSpread({ items, children, trigger = "view", open: openProp, label, listLabel, className }: OrbitSpreadProps) {
  const reduced = useReducedFx();
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLLIElement | null)[]>([]);
  const copyRef = useRef<HTMLDivElement>(null);
  const n = items.length;
  const [own, setOwn] = useState(false);
  const seen = useFirstInView(stageRef, trigger === "view" && !reduced);
  const open = reduced ? true : trigger === "manual" ? !!openProp : own;
  const st = useRef({ ms: reduced ? CONFIG.openMs : 0, dir: 0, last: 0, n, ptr: { x: { x: 0, v: 0 }, y: { x: 0, v: 0 } }, ptrT: { x: 0, y: 0 }, spin: { x: 0, v: 0 }, spinT: 0, z: [] as number[], active: true, reduced, rect: null as DOMRect | null });
  const loopRef = useRef<ReturnType<typeof createFrameLoop> | null>(null);

  useLayoutEffect(() => {
    const s = st.current;
    s.n = n;
    s.reduced = reduced;
    const write = () => {
      const p = orbitProgress(s.ms);
      for (let i = 0; i < s.n; i++) {
        const el = cardRefs.current[i];
        if (!el) continue;
        const pose = orbitPose(i, s.n, p, s.spin.x, s.ptr.x.x, s.ptr.y.x);
        el.style.transform = `translate(calc(-50% + ${pose.x.toFixed(3)}cqw), calc(-50% + ${pose.y.toFixed(3)}cqh)) rotate(${pose.rotate.toFixed(3)}deg) scale(${pose.scale.toFixed(4)})`;
        if (s.z[i] !== pose.z) {
          s.z[i] = pose.z;
          el.style.zIndex = String(pose.z);
        }
      }
      const { delay, duration, scaleFrom, scaleDelay, scaleDuration } = CONFIG.text;
      const o = Math.min(1, Math.max(0, (s.ms - delay) / duration));
      const sc = scaleFrom + (1 - scaleFrom) * easeInOutSine((s.ms - scaleDelay) / scaleDuration);
      const copy = copyRef.current;
      if (copy) {
        copy.style.opacity = o.toFixed(3);
        copy.style.transform = sc >= 0.9999 ? "none" : `scale(${sc.toFixed(4)})`;
      }
    };
    const loop = createFrameLoop((dt) => {
      if (!s.active) return false;
      let busy = false;
      if (s.dir !== 0) {
        s.ms = Math.min(CONFIG.openMs, Math.max(0, s.ms + s.dir * dt * 1000));
        if ((s.dir > 0 && s.ms >= CONFIG.openMs) || (s.dir < 0 && s.ms <= 0)) s.dir = 0;
        else busy = true;
      }
      stepSpring(s.ptr.x, s.ptrT.x, CONFIG.parallax.spring, dt);
      stepSpring(s.ptr.y, s.ptrT.y, CONFIG.parallax.spring, dt);
      stepSpring(s.spin, s.spinT, CONFIG.spin, dt);
      const rest = springRests(s.ptr.x, s.ptrT.x, 0.001, 0.01) && springRests(s.ptr.y, s.ptrT.y, 0.001, 0.01) && springRests(s.spin, s.spinT, 0.001, 0.01);
      if (rest) {
        s.ptr.x.x = s.ptrT.x;
        s.ptr.y.x = s.ptrT.y;
        s.spin.x = s.spinT;
      } else busy = true;
      write();
      return busy;
    });
    loopRef.current = loop;
    write();
    const stage = stageRef.current;
    const unwatch = stage
      ? watchActivity(stage, (a) => {
          s.active = a;
          if (a) loop.wake();
        })
      : () => {};
    return () => {
      unwatch();
      loop.stop();
    };
  }, [n, reduced]);

  // open / close: run the measured curve forwards / backwards
  useEffect(() => {
    const s = st.current;
    if (reduced) {
      s.ms = CONFIG.openMs;
      s.dir = 0;
      loopRef.current?.wake();
      return;
    }
    s.dir = open ? 1 : -1;
    loopRef.current?.wake();
  }, [open, reduced]);

  // trigger "view": open CONFIG.startDelay after the first view
  useEffect(() => {
    if (trigger !== "view" || reduced || !seen) return;
    const id = setTimeout(() => setOwn(true), CONFIG.startDelay);
    return () => clearTimeout(id);
  }, [trigger, reduced, seen]);

  const turn = (by: number) => {
    const s = st.current;
    s.spinT += by;
    if (s.reduced) s.spin.x = s.spinT;
    loopRef.current?.wake();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      turn(e.key === "ArrowRight" ? 1 : -1);
    } else if (trigger === "click" && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
      e.preventDefault();
      setOwn((v) => !v);
    }
  };

  const kids = Children.toArray(children);
  return (
    <div
      ref={stageRef}
      role="group"
      aria-roledescription="Karussell"
      aria-label={label}
      tabIndex={0}
      data-pulse="orbit-spread"
      data-open={open ? "" : undefined}
      onKeyDown={onKeyDown}
      onClick={trigger === "click" ? () => setOwn((v) => !v) : undefined}
      onPointerMove={(e) => {
        if (reduced || e.pointerType !== "mouse" || !canHoverNow() || isScrolling()) return;
        const s = st.current;
        s.rect ??= e.currentTarget.getBoundingClientRect();
        const { x, y } = latestPointer(e.nativeEvent);
        s.ptrT = { x: ((x - s.rect.left) / s.rect.width) * 2 - 1, y: ((y - s.rect.top) / s.rect.height) * 2 - 1 };
        loopRef.current?.wake();
      }}
      onPointerLeave={() => {
        const s = st.current;
        s.rect = null;
        s.ptrT = { x: 0, y: 0 };
        loopRef.current?.wake();
      }}
      className={cn("relative isolate aspect-[4/3] w-full overflow-hidden sm:aspect-video rounded-2xl bg-ink-950 outline-none [container-type:size] focus-visible:ring-2 focus-visible:ring-steel/60", trigger === "click" && "cursor-pointer", className)}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(42cqw 42cqw at 50% 50%, rgb(229 32 46 / 0.1), transparent 72%)" }} />
      <div ref={copyRef} className="absolute inset-x-[10%] top-[30%] z-[60] grid justify-items-center gap-[1cqw] text-center" style={{ opacity: reduced ? 1 : 0 }}>
        {kids}
      </div>
      <ul aria-label={listLabel} className="absolute inset-0">
        {items.map((item, i) => (
          <li
            key={i}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            className="absolute left-1/2 top-1/2 aspect-[5/4] overflow-hidden rounded-[1.6cqw] border border-white/10 bg-ink-800 shadow-[0_2cqw_4cqw_-1.5cqw_rgb(0_0_0/0.6)]"
            style={{ width: `${CONFIG.card}cqw`, transform: "translate(-50%,-50%)" }}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
