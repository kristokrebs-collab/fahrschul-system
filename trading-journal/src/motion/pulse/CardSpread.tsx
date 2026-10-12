import { Children, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { smoothstep } from "@/motion/fx/curve";
import { useFxPlay } from "@/motion/fx/shared";
import { createFrameLoop } from "@/motion/pulse/engine";
import { springRests, stepSpring } from "@/motion/pulse/springStep";
import { watchActivity } from "@/motion/pulse/textKit";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `slanted-spread-hero` (measured) in two flavours:
 *
 * - `variant="deal"` (default) – for real card grids (tariffs, best setups, strategy comparisons, a challenge deck,
 *   the sync inbox): your cards keep THEIR layout; on first view (and every new `play` key) they start as a slanted
 *   deck in the middle of the group – each one translated to the deck centre, fanned ±4°, scale .86 – and are dealt
 *   out one after the other (`stagger.deal`) on `spring.deal` into their places. One layout read per deal (the card
 *   offsets), transform / opacity per frame, every card ends at `transform: none` (fixed descendants and hover lifts
 *   keep working).
 * - `variant="fan"` – the pack hero: a compact, tilted (−13°) stack fans out diagonally on the pack's slow spring
 *   (14 / 7.5, ≈ 1.8 s, no overshoot) while the headline behind it fades up (10 % → 80 % of the progress, sub +12 %).
 *   Tap / Enter / Space toggles stack ↔ fan (`aria-expanded`). Decorative cards (aria-hidden), the headline is the
 *   content. Geometry in container units (the stage is a size container).
 *
 * Reduced motion: final layout / open fan at once.
 */
export const CONFIG = {
  deal: { rotate: 4, scale: 0.86 },
  fan: {
    spring: { stiffness: 14, damping: 7.5, mass: 1 },
    delay: 1500,
    /** px at a 1234 px wide stage → cqw (÷ 12.34) */
    collapsed: { scale: 0.68, stepX: 20, stepY: -8 },
    spread: { scale: 1, stepX: 112, stepY: -54.4, offX: -32, offY: 9 },
    rot: -13,
    tilt: [1.5, -2.5, 2, -1.5, 2.5, -2, 1.5, -2] as const,
    card: { w: 172, h: 128 },
    textFrom: 0.1,
    textTo: 0.8,
    subLag: 0.12,
  },
} as const;

/** px of the 1234 px reference stage → cqw. */
const U = (px: number) => px / 12.34;

/** Fan pose of card `i` of `n` at progress `p` (cqw offsets from the stage centre, scale, rotation). */
export function fanPose(i: number, n: number, p: number): { x: number; y: number; scale: number; rotate: number } {
  const { collapsed: c, spread: s, rot, tilt } = CONFIG.fan;
  const k = i - (n - 1) / 2;
  const lerp = (a: number, b: number) => a + (b - a) * p;
  return {
    x: U(lerp(c.stepX, s.stepX) * k + lerp(0, s.offX)),
    y: U(lerp(c.stepY, s.stepY) * k + lerp(0, s.offY)),
    scale: lerp(c.scale, s.scale),
    rotate: rot + (tilt[i % tilt.length] ?? 0) * p,
  };
}

/** Deal start pose of card `i` of `n`: rotation (deg) of the deck fan. */
export function dealRotation(i: number, n: number): number {
  return (i - (n - 1) / 2) * CONFIG.deal.rotate;
}

export interface CardSpreadProps {
  variant?: "deal" | "fan";
  /** deal: the cards (one child = one card). fan: the headline content behind the cards. */
  children?: ReactNode;
  /** fan: the card faces (decorative). */
  cards?: readonly ReactNode[];
  /** deal: replay key. */
  play?: number | boolean;
  /** deal: deal on first view (default true). */
  playOnView?: boolean;
  /** fan: controlled open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** fan: open by itself `CONFIG.fan.delay` ms after the first view (default true). */
  autoplay?: boolean;
  /** Accessible name (fan: the toggle). */
  label?: string;
  className?: string;
  /** deal: classes of each card wrapper. */
  itemClassName?: string;
}

/* ------------------------------------------------------------------ deal */

function Deal({ children, play, playOnView = true, className, itemClassName, label }: CardSpreadProps) {
  const reduced = useReducedFx();
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const items = Children.toArray(children);
  const n = items.length;
  const [hidden, setHidden] = useState(!reduced && playOnView);
  const loopRef = useRef<ReturnType<typeof createFrameLoop> | null>(null);

  useEffect(() => () => loopRef.current?.stop(), []);

  useFxPlay(rootRef, play, playOnView, !reduced, () => {
    const root = rootRef.current;
    if (!root) return;
    loopRef.current?.stop();
    const els = itemRefs.current.slice(0, n).filter((e): e is HTMLDivElement => !!e);
    // one read per deal: where each card sits relative to the group centre
    const cx = root.offsetWidth / 2;
    const cy = root.offsetHeight / 2;
    const from = els.map((el, i) => ({ dx: cx - (el.offsetLeft + el.offsetWidth / 2), dy: cy - (el.offsetTop + el.offsetHeight / 2), rot: dealRotation(i, els.length) }));
    const springs = els.map(() => ({ x: 0, v: 0 }));
    const t0 = performance.now();
    const delays = els.map((_, i) => Math.min(i, stagger.max) * stagger.deal * 1000);
    const write = (i: number, k: number) => {
      const el = els[i]!;
      const f = from[i]!;
      const r = 1 - k;
      el.style.transform = k >= 1 ? "none" : `translate3d(${(f.dx * r).toFixed(2)}px,${(f.dy * r).toFixed(2)}px,0) rotate(${(f.rot * r).toFixed(3)}deg) scale(${(CONFIG.deal.scale + (1 - CONFIG.deal.scale) * k).toFixed(4)})`;
      el.style.opacity = String(Math.min(1, 0.35 + k * 2));
    };
    els.forEach((el, i) => {
      el.style.willChange = "transform";
      el.style.zIndex = String(n - i);
      write(i, 0);
    });
    setHidden(false);
    const loop = createFrameLoop((dt) => {
      const now = performance.now() - t0;
      let busy = false;
      springs.forEach((s, i) => {
        if (now < delays[i]!) {
          busy = true;
          return;
        }
        if (s.x === 1 && s.v === 0) return;
        stepSpring(s, 1, spring.deal, dt);
        if (springRests(s, 1, 0.001, 0.01)) {
          s.x = 1;
          s.v = 0;
          const el = els[i]!;
          write(i, 1);
          el.style.willChange = "";
          el.style.zIndex = "";
          el.style.opacity = "";
          return;
        }
        busy = true;
        write(i, s.x);
      });
      return busy;
    });
    loopRef.current = loop;
    loop.wake();
  });

  return (
    <div ref={rootRef} data-pulse="card-spread" data-variant="deal" aria-label={label} className={cn("relative", className)}>
      {items.map((item, i) => (
        <div
          key={i}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          className={cn("relative", itemClassName)}
          style={hidden ? { opacity: 0 } : undefined}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ fan (pack hero) */

function Fan({ children, cards = [], open: controlled, onOpenChange, autoplay = true, label = "Karten auffächern", className }: CardSpreadProps) {
  const reduced = useReducedFx();
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const titleRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const [own, setOwn] = useState(reduced);
  const open = controlled ?? own;
  const n = cards.length;
  const st = useRef({ p: { x: reduced ? 1 : 0, v: 0 }, target: open ? 1 : 0, n, active: true });
  const loopRef = useRef<ReturnType<typeof createFrameLoop> | null>(null);

  useLayoutEffect(() => {
    const s = st.current;
    s.n = n;
    const write = () => {
      const p = s.p.x;
      for (let i = 0; i < s.n; i++) {
        const el = cardRefs.current[i];
        if (!el) continue;
        const pose = fanPose(i, s.n, p);
        el.style.transform = `translate(calc(-50% + ${pose.x.toFixed(3)}cqw), calc(-50% + ${pose.y.toFixed(3)}cqw)) rotate(${pose.rotate.toFixed(3)}deg) scale(${pose.scale.toFixed(4)})`;
      }
      const { textFrom, textTo, subLag } = CONFIG.fan;
      if (titleRef.current) titleRef.current.style.opacity = smoothstep(textFrom, textTo, p).toFixed(3);
      if (subRef.current) subRef.current.style.opacity = smoothstep(textFrom + subLag, textTo + subLag, p).toFixed(3);
    };
    const loop = createFrameLoop((dt) => {
      if (!s.active) return false;
      stepSpring(s.p, s.target, CONFIG.fan.spring, dt);
      const rest = springRests(s.p, s.target, 0.0008, 0.005);
      if (rest) {
        s.p.x = s.target;
        s.p.v = 0;
      }
      write();
      return !rest;
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
  }, [n]);

  useEffect(() => {
    const s = st.current;
    s.target = open ? 1 : 0;
    if (reduced) {
      s.p.x = s.target;
      s.p.v = 0;
    }
    loopRef.current?.wake();
    if (reduced) loopRef.current?.stop();
  }, [open, reduced]);

  // autoplay: open CONFIG.fan.delay after the first view
  const seenRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useFxPlay(stageRef, undefined, autoplay && controlled === undefined, !reduced, () => {
    if (seenRef.current) return;
    seenRef.current = true;
    const id = setTimeout(() => setOwn(true), CONFIG.fan.delay);
    timer.current = id;
  });
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const toggle = () => {
    if (timer.current) clearTimeout(timer.current);
    const next = !open;
    if (controlled === undefined) setOwn(next);
    onOpenChange?.(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggle();
  };

  const kids = Children.toArray(children);
  return (
    <div
      ref={stageRef}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={label}
      data-pulse="card-spread"
      data-variant="fan"
      onClick={toggle}
      onKeyDown={onKeyDown}
      className={cn("relative isolate aspect-[16/10] w-full cursor-pointer touch-manipulation overflow-hidden rounded-2xl bg-ink-950 outline-none [container-type:size] focus-visible:ring-2 focus-visible:ring-steel/60", className)}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(60% 55% at 50% 45%, rgb(229 32 46 / 0.09), transparent 70%)" }} />
      <div className="pointer-events-none absolute inset-x-[6%] top-[14%] grid justify-items-center gap-[1.2cqw] text-center">
        <div ref={titleRef} style={{ opacity: 0 }}>
          {kids[0]}
        </div>
        <div ref={subRef} style={{ opacity: 0 }}>
          {kids.slice(1)}
        </div>
      </div>
      {cards.map((card, i) => (
        <div
          key={i}
          ref={(el) => {
            cardRefs.current[i] = el;
          }}
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[62%] overflow-hidden rounded-[1cqw] border border-white/10 bg-ink-800 shadow-[0_1.1cqw_2.8cqw_rgb(0_0_0/0.45)]"
          style={{ width: `${U(CONFIG.fan.card.w)}cqw`, height: `${U(CONFIG.fan.card.h)}cqw`, transform: "translate(-50%,-50%)" }}
        >
          {card}
        </div>
      ))}
    </div>
  );
}

export function CardSpread(props: CardSpreadProps) {
  return props.variant === "fan" ? <Fan {...props} /> : <Deal {...props} />;
}
