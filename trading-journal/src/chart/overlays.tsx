/**
 * DOM overlays of the candle chart: the live price pulse, the "Folgen" pill and the new-trade marker ripple.
 * They animate transform/opacity only (compositor), so the chart canvas never repaints for them. The pulse and the
 * ripples are decorative (`aria-hidden`, no pointer events); the pill is a real button.
 */
import { AnimatePresence, animate, motion, type AnimationPlaybackControls } from "motion/react";
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { cn } from "@/lib/cn";
import { pingAllowed } from "@/motion/PulseDot";
import { FLASH_MIN_INTERVAL_MS } from "@/motion/ValueFlash";
import { spring, tween } from "@/motion/tokens";

export interface PulsePoint {
  x: number;
  y: number;
}

export interface PulseHandle {
  /** Chart-relative px of the live price, or `null` to hide it (no data, bar scrolled off, collapsed). */
  place(point: PulsePoint | null): void;
  /**
   * One print: a win/loss tint decaying on `tween.flash`, at most one per `FLASH_MIN_INTERVAL_MS` (a direction flip
   * inside the gap only cuts the tint), and a bright ping ≤ 4 Hz.
   */
  tick(dir: number): void;
  /** The rings breathe only while active (chart on screen and expanded). */
  setActive(active: boolean): void;
}

/** Without a print for this long the rings stop breathing (an honest liveness cue); the next print restarts them. */
export const PULSE_STALE_MS = 6000;
/** Ring scale at the end of one breath (21st.dev "pinging dot": 1 → 3.2). */
const RING_SCALE = 3.2;
const PING_SCALE = 2.6;

interface PulseNodes {
  root: HTMLElement;
  rings: HTMLElement[];
  pingUp: HTMLElement | null;
  pingDown: HTMLElement | null;
  tintUp: HTMLElement | null;
  tintDown: HTMLElement | null;
}

/** Imperative state of one pulse: position, ring loop, tick tint and ping. No React state anywhere. */
export class PulseDriver implements PulseHandle {
  private shown = false;
  private active = false;
  private live = false;
  private reduced: boolean;
  private x = Number.NaN;
  private y = Number.NaN;
  private loops: AnimationPlaybackControls[] = [];
  private tint: AnimationPlaybackControls | null = null;
  private dir = 0;
  private lastPrint = 0;
  private lastFlash = -Infinity;
  private lastPing = -Infinity;
  private stale: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly n: PulseNodes,
    reduced: boolean,
  ) {
    this.reduced = reduced;
  }

  place(p: PulsePoint | null): void {
    const root = this.n.root;
    if (!p) {
      if (!this.shown) return;
      this.shown = false;
      root.style.opacity = "0";
      this.sync();
      return;
    }
    if (p.x !== this.x || p.y !== this.y) {
      this.x = p.x;
      this.y = p.y;
      root.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    }
    if (this.shown) return;
    this.shown = true;
    root.style.opacity = "1";
    this.sync();
  }

  tick(dir: number): void {
    const now = performance.now();
    this.lastPrint = now;
    if (!this.live) {
      this.live = true;
      this.sync();
    }
    this.armStale();
    if (dir === 0) return;
    const flip = dir !== this.dir;
    this.dir = dir;
    if (this.reduced || !this.shown || !this.active) return;
    if (now - this.lastFlash >= FLASH_MIN_INTERVAL_MS) {
      const on = dir > 0 ? this.n.tintUp : this.n.tintDown;
      const off = dir > 0 ? this.n.tintDown : this.n.tintUp;
      this.tint?.stop();
      if (off) off.style.opacity = "0";
      if (on) this.tint = animate(on, { opacity: [1, 0] }, tween.flash);
      this.lastFlash = now;
    } else if (flip) {
      // a flip inside the gap: cut the stale colour, never light the opposite one early
      this.tint?.stop();
      this.tint = null;
      if (this.n.tintUp) this.n.tintUp.style.opacity = "0";
      if (this.n.tintDown) this.n.tintDown.style.opacity = "0";
    }
    if (pingAllowed(this.lastPing, now)) {
      const ping = dir > 0 ? this.n.pingUp : this.n.pingDown;
      if (ping) animate(ping, { transform: ["scale(1)", `scale(${PING_SCALE})`], opacity: [0.6, 0] }, tween.ripple);
      this.lastPing = now;
    }
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.sync();
  }

  setReduced(reduced: boolean): void {
    if (reduced === this.reduced) return;
    this.reduced = reduced;
    this.sync();
  }

  destroy(): void {
    if (this.stale) clearTimeout(this.stale);
    this.stale = null;
    this.stopLoops();
    this.tint?.stop();
    this.tint = null;
  }

  /** The rings run only while there is something live to show: on screen, expanded, placed and printing. */
  private sync(): void {
    const run = !this.reduced && this.shown && this.active && this.live;
    if (!run) {
      this.stopLoops();
      return;
    }
    if (this.loops.length > 0) return;
    const half = tween.ping.duration / 2;
    this.loops = this.n.rings.map((el, i) =>
      animate(el, { transform: ["scale(1)", `scale(${RING_SCALE})`], opacity: [0.5, 0] }, { ...tween.ping, delay: i * half }),
    );
  }

  private stopLoops(): void {
    // cancel (not stop): the rings fall back to their class opacity 0 instead of freezing mid-breath
    for (const loop of this.loops) loop.cancel();
    this.loops = [];
  }

  private armStale(): void {
    if (this.stale) return;
    this.stale = setTimeout(this.checkStale, PULSE_STALE_MS);
  }

  private readonly checkStale = (): void => {
    this.stale = null;
    const idle = performance.now() - this.lastPrint;
    if (idle < PULSE_STALE_MS) {
      this.stale = setTimeout(this.checkStale, PULSE_STALE_MS - idle);
      return;
    }
    this.live = false;
    this.sync();
  };
}

const DOT = "absolute -left-[3.5px] -top-[3.5px] size-[7px] rounded-full";

export interface LivePulseProps {
  ref?: Ref<PulseHandle>;
  reduced: boolean;
}

/**
 * Pinging dot at the live price (21st.dev "Pinging live dot"): a solid core with a dark halo, two breathing rings
 * (`tween.ping`, the second half a period later) and per-print win/loss feedback. Reduced motion: the static core.
 */
export function LivePulse({ ref, reduced }: LivePulseProps) {
  const root = useRef<HTMLDivElement>(null);
  const ringA = useRef<HTMLSpanElement>(null);
  const ringB = useRef<HTMLSpanElement>(null);
  const pingUp = useRef<HTMLSpanElement>(null);
  const pingDown = useRef<HTMLSpanElement>(null);
  const tintUp = useRef<HTMLSpanElement>(null);
  const tintDown = useRef<HTMLSpanElement>(null);
  const driver = useRef<PulseDriver | null>(null);
  const reducedAtMount = useRef(reduced);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const rings = [ringA.current, ringB.current].filter((n): n is HTMLSpanElement => n !== null);
    const d = new PulseDriver(
      { root: el, rings, pingUp: pingUp.current, pingDown: pingDown.current, tintUp: tintUp.current, tintDown: tintDown.current },
      reducedAtMount.current,
    );
    driver.current = d;
    return () => {
      d.destroy();
      if (driver.current === d) driver.current = null;
    };
  }, []);

  useEffect(() => {
    driver.current?.setReduced(reduced);
  }, [reduced]);

  useImperativeHandle(
    ref,
    () => ({
      place: (p) => driver.current?.place(p),
      tick: (dir) => driver.current?.tick(dir),
      setActive: (a) => driver.current?.setActive(a),
    }),
    [],
  );

  return (
    <div ref={root} aria-hidden="true" data-fx="price-pulse" className="pointer-events-none absolute left-0 top-0 opacity-0 will-change-transform">
      <span ref={ringA} className={cn(DOT, "bg-fg/35 opacity-0")} />
      <span ref={ringB} className={cn(DOT, "bg-fg/35 opacity-0")} />
      <span ref={pingUp} className={cn(DOT, "bg-win opacity-0")} />
      <span ref={pingDown} className={cn(DOT, "bg-loss opacity-0")} />
      <span className={cn(DOT, "bg-fg shadow-[0_0_0_2px_var(--color-ink-900)]")} />
      <span ref={tintUp} className={cn(DOT, "bg-win opacity-0")} />
      <span ref={tintDown} className={cn(DOT, "bg-loss opacity-0")} />
    </div>
  );
}

const MAX_RIPPLES = 3;

/**
 * One-shot sonar at a freshly added trade marker: a ring (`tween.ripple`) and a soft disc (`tween.flash`) in the
 * marker colour. `layer` must be an empty, `aria-hidden`, clipped overlay; at most three ripples live at once.
 */
export function spawnMarkerRipple(layer: HTMLElement, at: PulsePoint, color: string): void {
  while (layer.childElementCount >= MAX_RIPPLES) layer.firstElementChild?.remove();
  const host = document.createElement("span");
  host.style.cssText = `position:absolute;left:0;top:0;transform:translate3d(${at.x}px,${at.y}px,0)`;
  const disc = document.createElement("span");
  disc.style.cssText = `position:absolute;left:-7px;top:-7px;width:14px;height:14px;border-radius:9999px;background:${color};opacity:0`;
  const ring = document.createElement("span");
  ring.style.cssText = `position:absolute;left:-10px;top:-10px;width:20px;height:20px;border-radius:9999px;border:1.5px solid ${color};opacity:0`;
  host.append(disc, ring);
  layer.appendChild(host);
  animate(ring, { transform: ["scale(0.4)", "scale(2.2)"], opacity: [0.75, 0] }, tween.ripple);
  animate(disc, { transform: ["scale(0.6)", "scale(1.5)"], opacity: [0.45, 0] }, tween.flash).then(() => host.remove());
}

export interface FollowPillProps {
  show: boolean;
  label: string;
  /** px from the right edge (left of the price scale) */
  right: number;
  reduced: boolean;
  onFollow: () => void;
}

/**
 * Floating "back to the live edge" pill, mounted only while the view is scrolled away from realtime: pops in on
 * `spring.pop` (scale .9 → 1) with an arrow nudge, unmounts (never parks at opacity 0) once the live bar is back.
 */
export function FollowPill({ show, label, right, reduced, onFollow }: FollowPillProps) {
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.button
          key="follow"
          type="button"
          data-fx="follow"
          onClick={onFollow}
          className="absolute bottom-9 z-[6] inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-ink-850/90 py-1 pl-3 pr-2.5 text-xs font-medium text-fg shadow-[0_10px_28px_rgb(0_0_0/0.5)] backdrop-blur-sm transition-colors hover:border-faint"
          style={{ right }}
          initial={reduced ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9, transition: tween.exit }}
          transition={{ ...spring.pop, opacity: tween.fade }}
          whileHover="nudge"
          whileTap={reduced ? undefined : { scale: 0.95 }}
        >
          {label}
          <motion.svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="size-3"
            initial={reduced ? false : { x: -4 }}
            animate={{ x: 0 }}
            variants={reduced ? undefined : { nudge: { x: 2 } }}
            transition={spring.pop}
          >
            <path d="M1.5 6h6.5M5 3l3 3-3 3M10.5 2.5v7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </motion.svg>
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}

/** `true` when the live bar (`lastIndex`) is outside the visible logical range: scrolled into history or the future. */
export function isAwayFromRealtime(range: { from: number; to: number } | null, lastIndex: number): boolean {
  if (!range || lastIndex < 0) return false;
  return range.to < lastIndex + 1 || range.from > lastIndex - 1;
}
