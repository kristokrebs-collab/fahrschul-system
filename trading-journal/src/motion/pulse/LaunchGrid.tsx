import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { expApproach, progressIn } from "@/motion/fx/curve";
import { useFxPlay } from "@/motion/fx/shared";
import { createTimeline, type Timeline } from "@/motion/pulse/textKit";
import { isSafeFx } from "@/motion/safeFx";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `product-launch-hero` (measured exponential steps) as an app launch stage – the pricing hero, the
 * onboarding start: a dark dot-grid panel lights up radially from black, an outline square marker turns in, the slot
 * in your headline (`<LaunchSlot />`) cuts through `slots` every 0.4 s and lands on the last one, a wall of cards flies
 * in from the left 60 ms apart (k 8.5) and collapses onto the hero card, the panel breathes a prismatic camera turn
 * (rotateY, k 8.5, back to flat), the `aside` panel flies in from the right (critically damped, ω 7.3) and the `hud`
 * line (CTA / install command) blurs in last. ≈ 4 s, then it rests – every layer at `transform: none` / `filter: none`.
 *
 * `render(v)` is a pure function of the run time v (s) (`launchAt`); one timeline (`createTimeline`: pauses off
 * screen) writes transform / opacity / clip-path / filter only on change. Responsive by layout (grid), not by
 * measuring. Safe-fx: no blur. Reduced motion: the rest frame. The panel content stays real, readable DOM.
 */
export const CONFIG = {
  intro: { t0: 0.1, dur: 0.31 },
  grid: { t0: 0.1, dur: 0.9 },
  square: { fadeFrom: 0.17, fadeTo: 0.55, rot0: 2, rotPerSec: 18.5, rotT0: 0.31, spinFor: 2.2 },
  slot: { firstAt: 0.2, every: 0.4, fade: 0.14 },
  cards: { spawn: 1.58, step: 0.06, flyK: 8.5, flyDx: 46, fadeIn: 0.22, collapseAt: 2.94, collapseDur: 0.38 },
  cam: { t0: 1.565, k: 8.483, rot: -9, backAt: 2.6, backK: 4.5 },
  aside: { t0: 2.02, omega: 7.3, from: 110, fade: 0.3 },
  hud: { t0: 3.2, dur: 0.7, kY: 6.6, dy: 38, blur: 14 },
  end: 4.1,
  /** wall card scatter (centre x / y in % of the wall box, rotation) – the first card is the hero */
  scatter: [
    [50, 50, 0],
    [18, 30, 4],
    [80, 26, -3],
    [30, 78, -6],
    [76, 74, 6],
    [10, 60, -4],
    [90, 52, 3],
  ] as const,
} as const;

export interface LaunchFrame {
  panel: number;
  grid: number;
  squareOpacity: number;
  squareRot: number;
  slot: number[];
  cards: { x: number; y: number; s: number; o: number }[];
  camRot: number;
  aside: { x: number; o: number };
  hud: { o: number; y: number; blur: number };
}

/** The whole choreography at run time `v` seconds for `slots` slot items and `cards` wall cards (pure). */
export function launchAt(v: number, slots: number, cards: number): LaunchFrame {
  const C = CONFIG;
  const slot = Array.from({ length: slots }, (_, i) => {
    const a = C.slot.firstAt + i * C.slot.every;
    const b = a + C.slot.every;
    const fin = progressIn(a, a + C.slot.fade, v);
    const fout = i === slots - 1 ? 0 : progressIn(b, b + C.slot.fade, v);
    return i === 0 && v < C.slot.firstAt ? 0 : Math.max(0, fin - fout);
  });
  const collapse = progressIn(C.cards.collapseAt, C.cards.collapseAt + C.cards.collapseDur, v);
  const ce = 1 - Math.pow(1 - collapse, 3);
  const cardFrames = Array.from({ length: cards }, (_, j) => {
    const s0 = C.cards.spawn + j * C.cards.step;
    const fly = v <= s0 ? C.cards.flyDx : C.cards.flyDx * Math.exp(-C.cards.flyK * (v - s0));
    const o = progressIn(s0, s0 + C.cards.fadeIn, v);
    if (j === 0) return { x: -fly, y: 0, s: 1 + 0.12 * ce, o };
    const [cx, cy] = C.scatter[j % C.scatter.length]!;
    const [hx, hy] = C.scatter[0]!;
    // collapse: the card slides onto the hero card and vanishes under it (wall units: cqw / cqh)
    return { x: -fly + (hx - cx) * ce, y: (hy - cy) * ce, s: 1 - 0.25 * ce, o: o * (1 - ce) };
  });
  const camIn = expApproach(v, C.cam.t0, C.cam.k, 1);
  const camOut = expApproach(v, C.cam.backAt, C.cam.backK, 1);
  const w = C.aside.omega;
  const ta = Math.max(0, v - C.aside.t0);
  const asideX = v <= C.aside.t0 ? C.aside.from : C.aside.from * (1 + w * ta) * Math.exp(-w * ta);
  const ht = v - C.hud.t0;
  const hp = progressIn(0, C.hud.dur, ht);
  return {
    panel: progressIn(C.intro.t0, C.intro.t0 + C.intro.dur, v),
    grid: 1 - Math.pow(1 - progressIn(C.grid.t0, C.grid.t0 + C.grid.dur, v), 3),
    squareOpacity: progressIn(C.square.fadeFrom, C.square.fadeTo, v),
    squareRot: C.square.rot0 + C.square.rotPerSec * Math.min(C.square.spinFor, Math.max(0, v - C.square.rotT0)),
    slot,
    cards: cardFrames,
    camRot: C.cam.rot * camIn * (1 - camOut),
    aside: { x: v >= C.end ? 0 : asideX, o: progressIn(C.aside.t0, C.aside.t0 + C.aside.fade, v) },
    hud: { o: 1 - (1 - hp) * (1 - hp), y: ht <= 0 ? C.hud.dy : v >= C.end ? 0 : C.hud.dy * Math.exp(-C.hud.kY * ht), blur: C.hud.blur * (1 - hp) },
  };
}

interface SlotCtx {
  slots: readonly ReactNode[];
  register: (i: number, el: HTMLElement | null) => void;
}
const LaunchSlotContext = createContext<SlotCtx | null>(null);

/** The cycling slot inside the headline (renders the `slots` of the surrounding `LaunchGrid`, stacked). */
export function LaunchSlot({ className }: { className?: string }) {
  const ctx = useContext(LaunchSlotContext);
  if (!ctx || ctx.slots.length === 0) return null;
  const last = ctx.slots.length - 1;
  return (
    <span className={cn("relative inline-grid align-middle [grid-template-areas:'s']", className)}>
      {ctx.slots.map((s, i) => (
        <span
          key={i}
          ref={(el) => ctx.register(i, el)}
          aria-hidden={i === last ? undefined : true}
          className="inline-flex items-center [grid-area:s]"
          style={{ opacity: i === last ? 1 : 0 }}
        >
          {s}
        </span>
      ))}
    </span>
  );
}

export interface LaunchGridProps {
  /** Panel content (headline with an optional `<LaunchSlot />`, sub line). */
  children: ReactNode;
  slots?: readonly ReactNode[];
  /** Wall cards; the first one is the hero card that stays. */
  cards?: readonly ReactNode[];
  /** Second panel flying in from the right. */
  aside?: ReactNode;
  /** Last line (CTA, command) – blurs in at the end. */
  hud?: ReactNode;
  play?: number | boolean;
  playOnView?: boolean;
  label: string;
  className?: string;
  onDone?: () => void;
}

export function LaunchGrid({ children, slots = [], cards = [], aside, hud, play, playOnView = true, label, className, onDone }: LaunchGridProps) {
  const reduced = useReducedFx();
  const [safe] = useState(isSafeFx);
  const rootRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLSpanElement>(null);
  const squareRef = useRef<HTMLSpanElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const asideRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<(HTMLElement | null)[]>([]);
  const tl = useRef<Timeline | null>(null);
  const cache = useRef<Record<string, string>>({});
  const live = useRef({ ns: slots.length, nc: cards.length, onDone, safe });
  useLayoutEffect(() => {
    live.current = { ns: slots.length, nc: cards.length, onDone, safe };
  });
  const register = useCallback((i: number, el: HTMLElement | null) => {
    slotRefs.current[i] = el;
  }, []);
  const ctx = useMemo<SlotCtx>(() => ({ slots, register }), [slots, register]);

  const set = (key: string, el: HTMLElement | null | undefined, prop: "transform" | "opacity" | "clipPath" | "filter", value: string) => {
    if (!el || cache.current[key] === value) return;
    cache.current[key] = value;
    el.style[prop] = value;
  };
  const render = (v: number) => {
    const { ns, nc, safe: sf } = live.current;
    const f = launchAt(v, ns, nc);
    const done = v >= CONFIG.end;
    set("p", panelRef.current, "opacity", f.panel.toFixed(3));
    set("pt", panelRef.current, "transform", done || Math.abs(f.camRot) < 0.01 ? "none" : `perspective(1200px) rotateY(${f.camRot.toFixed(3)}deg)`);
    set("g", gridRef.current, "clipPath", done || f.grid >= 1 ? "none" : `circle(${(f.grid * 120).toFixed(2)}% at 30% 40%)`);
    set("so", squareRef.current, "opacity", f.squareOpacity.toFixed(3));
    set("sr", squareRef.current, "transform", `rotate(${f.squareRot.toFixed(2)}deg)`);
    f.slot.forEach((o, i) => set(`s${i}`, slotRefs.current[i], "opacity", (done && i === ns - 1 ? 1 : o).toFixed(3)));
    f.cards.forEach((c, j) => {
      const el = cardRefs.current[j];
      const [, , rot] = CONFIG.scatter[j % CONFIG.scatter.length]!;
      set(`c${j}`, el, "transform", `translate(calc(-50% + ${c.x.toFixed(2)}cqw), calc(-50% + ${c.y.toFixed(2)}cqh)) rotate(${rot}deg) scale(${c.s.toFixed(4)})`);
      set(`co${j}`, el, "opacity", c.o.toFixed(3));
    });
    set("a", asideRef.current, "transform", f.aside.x <= 0.01 ? "none" : `translate3d(${f.aside.x.toFixed(2)}%,0,0)`);
    set("ao", asideRef.current, "opacity", f.aside.o.toFixed(3));
    set("h", hudRef.current, "transform", f.hud.y <= 0.05 ? "none" : `translate3d(0,${f.hud.y.toFixed(2)}px,0)`);
    set("ho", hudRef.current, "opacity", f.hud.o.toFixed(3));
    set("hf", hudRef.current, "filter", sf || f.hud.blur < 0.05 || done ? "none" : `blur(${f.hud.blur.toFixed(2)}px)`);
  };

  const start = () => {
    const root = rootRef.current;
    if (!root) return;
    tl.current?.stop();
    cache.current = {};
    const timeline = createTimeline(root, (ms) => {
      const v = Math.min(CONFIG.end, ms / 1000);
      render(v);
      if (v >= CONFIG.end) {
        live.current.onDone?.();
        return false;
      }
      return true;
    });
    tl.current = timeline;
    timeline.start();
  };

  useLayoutEffect(() => {
    cache.current = {};
    render(reduced || !playOnView ? CONFIG.end : 0);
    // render only touches refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, slots.length, cards.length]);

  useFxPlay(rootRef, play, playOnView, !reduced, start);
  useEffect(() => () => tl.current?.stop(), []);

  return (
    <LaunchSlotContext.Provider value={ctx}>
      <section ref={rootRef} aria-label={label} data-pulse="launch-grid" className={cn("grid gap-4 overflow-x-clip", className)}>
        <div className={cn("grid gap-4", aside != null && "md:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]")}>
          <div ref={panelRef} className="relative isolate overflow-hidden rounded-[28px] border border-line bg-ink-950" style={{ transformOrigin: "100% 50%" }}>
            <span
              ref={gridRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{ backgroundImage: "radial-gradient(rgb(255 255 255 / 0.085) 1px, transparent 1.4px)", backgroundSize: "24px 24px", backgroundPosition: "12px 12px" }}
            />
            <span aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(70% 60% at 30% 40%, rgb(229 32 46 / 0.07), transparent 70%)" }} />
            <span ref={squareRef} aria-hidden="true" className="pointer-events-none absolute right-[9%] top-[14%] size-[clamp(38px,6vw,64px)] rounded-[6px] border border-white/25 max-sm:top-auto max-sm:bottom-[5%] max-sm:right-[7%]" />
            <div className={cn("relative grid min-h-[300px] gap-6 p-6 sm:p-9", cards.length > 0 && "md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]")}>
              <div className="relative z-[1] grid content-center gap-4">{children}</div>
              {cards.length > 0 && (
                <div aria-hidden="true" className="relative min-h-[200px] [container-type:size]">
                  {cards.map((card, j) => {
                    const [x, y] = CONFIG.scatter[j % CONFIG.scatter.length]!;
                    return (
                      <div
                        key={j}
                        ref={(el) => {
                          cardRefs.current[j] = el;
                        }}
                        className="absolute w-[38cqw] max-w-[180px] overflow-hidden rounded-[6px] border border-white/10 bg-ink-800 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.7)]"
                        style={{ left: `${x}%`, top: `${y}%`, zIndex: j === 0 ? cards.length + 1 : cards.length - j }}
                      >
                        {card}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          {aside != null && (
            <div ref={asideRef} className="relative overflow-hidden rounded-[28px] border border-line bg-ink-900">
              {aside}
            </div>
          )}
        </div>
        {hud != null && <div ref={hudRef}>{hud}</div>}
      </section>
    </LaunchSlotContext.Provider>
  );
}
