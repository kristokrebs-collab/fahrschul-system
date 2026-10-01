import { animate, AnimatePresence, motion, type AnimationPlaybackControls } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export type StatusTone = "live" | "warn" | "error" | "muted";

/** Anything with Motion's `on("change")` – a `MotionValue` of any value type. */
export interface ChangeSource {
  on(event: "change", callback: () => void): () => void;
}

/** A refresh cycle for the countdown ring: it fills linearly until `endsAt` (epoch ms), `ms` long (default 30 s). */
export interface RingCycle {
  endsAt: number;
  ms?: number;
}

export interface StatusPillProps {
  tone: StatusTone;
  /** Label shown in the expanded pill (German UI string, e.g. `Live · alle 5 min`). */
  label?: ReactNode;
  /** `false` → 6 px dot, `true` → 28 px pill with label. */
  expanded: boolean;
  /**
   * Countdown ring that replaces the dot (14 px): a progress `0..1`, or a `RingCycle` that the ring runs by itself on
   * the compositor (no re-render per second needed – pass a new `endsAt` when the next cycle starts).
   */
  ring?: number | RingCycle | null;
  /** Spinner while refreshing (`animate-spin` on the ring). */
  spinning?: boolean;
  /** Feed id → `layoutId="status-{feed}"` so the pill can travel between header and card. */
  feed?: string;
  className?: string;
  title?: string;
  /** Every change fires one bright extra ping on the dot/ring (≤ 4 Hz) – e.g. a trade counter. */
  pingKey?: string | number;
  /** Same as `pingKey`, driven by a MotionValue's change events without any React render (e.g. `priceMv`). */
  pingOn?: ChangeSource;
  /** Extra layout dependency: changes of it (besides tone / expanded / ring / a string label) animate the size. */
  layoutKey?: string | number;
}

const TONE_DOT: Record<StatusTone, string> = { live: "bg-win", warn: "bg-warn", error: "bg-loss", muted: "bg-faint" };
const TONE_LAYER: Record<StatusTone, string> = {
  live: "border-win/25 bg-win/12",
  warn: "border-warn/25 bg-warn/12",
  error: "border-loss/25 bg-loss/12",
  muted: "border-line-2 bg-white/[0.04]",
};
const TONE_TEXT: Record<StatusTone, string> = { live: "text-win", warn: "text-warn", error: "text-loss", muted: "text-mute" };
const TONE_STROKE: Record<StatusTone, string> = { live: "text-win", warn: "text-warn", error: "text-signal", muted: "text-faint" };
const TONES: StatusTone[] = ["live", "warn", "error", "muted"];

/** Heartbeat reach: the 6 px dot grows to ≈ 14 px, the 14 px ring to ≈ 22 px (inside the 28 px pill). */
const PING_SCALE = { dot: 2.4, ring: 1.6 } as const;
/** Event pings reach a little further than the heartbeat (ring ≈ 25 px, still inside the pill). */
const PING_SCALE_BRIGHT = { dot: 2.8, ring: 1.8 } as const;
/** Trade pings: at most 4 per second; three pooled rings so overlapping pings read as sonar, not as a restart. */
const PING_MIN_INTERVAL_MS = 250;
const PING_POOL = 3;
const DEFAULT_RING_MS = 30_000;
/** Reduced motion: the cycle ring advances in discrete steps instead of sweeping. */
const RING_REDUCED_STEP_MS = 5_000;

/**
 * Dot ↔ labelled pill (Plan 3.3 "Status live/stale/fallback/offline"). The size change is ONE layout
 * spring (`spring.pill`, 0.42 s response) – interruptible, retargets with velocity, no width tween – and every
 * layout node carries a `layoutDependency`, so the many re-renders of a live header never measure.
 * Tone changes crossfade four pre-rendered layers (`tween.crossfade`); the label wipes in with
 * `tween.fade` and out with `tween.exit` (`AnimatePresence mode="popLayout"`).
 * Liveness: `tone="live"` breathes a heartbeat ring three times when it turns live (`tween.pingFew`, then it rests –
 * no endless loop on an idle page), `pingKey` / `pingOn` fire a brighter ping per event; the countdown `ring` is drawn
 * by two rotating half-rings (compositor transforms, no SVG repaint). All of it is static under reduced motion.
 * Not a live region (no `role="status"`); the root carries `data-status-pill`.
 */
export function StatusPill({ tone, label, expanded, ring, spinning, feed, className, title, pingKey, pingOn, layoutKey }: StatusPillProps) {
  const reduced = useReducedFx();
  const hasRing = ring != null;
  const labelKey = typeof label === "string" || typeof label === "number" ? label : "";
  const dependency = `${tone}|${expanded}|${hasRing}|${labelKey}|${layoutKey ?? ""}`;
  const pings = useRef<(HTMLSpanElement | null)[]>([]);
  usePings(pings, pingKey, pingOn, hasRing ? PING_SCALE_BRIGHT.ring : PING_SCALE_BRIGHT.dot, reduced);

  return (
    <motion.div
      layout
      layoutId={feed ? `status-${feed}` : undefined}
      layoutDependency={dependency}
      transition={{ layout: spring.pill }}
      style={{ borderRadius: radius.pill }}
      title={title}
      // deliberately no role="status": the pill is plain text in reading order. A live LivePill label ticks every
      // second ("vor 3s"), and the toast island is the app's only live region
      data-status-pill=""
      className={cn(
        "relative inline-flex shrink-0 items-center whitespace-nowrap",
        // the label is clipped by the pill while it grows; a bare dot lets its ping breathe past its 6 px box
        expanded ? "h-7 gap-1.5 overflow-hidden pl-2.5 pr-3 text-[11px] font-semibold" : hasRing ? "size-3.5" : "size-1.5",
        TONE_TEXT[tone],
        className,
      )}
    >
      {TONES.map((t) => (
        <motion.span
          key={t}
          aria-hidden="true"
          className={cn("pointer-events-none absolute inset-0 rounded-[inherit] border", TONE_LAYER[t])}
          initial={false}
          animate={{ opacity: expanded && t === tone ? 1 : 0 }}
          transition={tween.crossfade}
        />
      ))}
      <motion.span
        layout
        layoutDependency={dependency}
        className={cn("relative grid shrink-0 place-items-center", hasRing ? "size-3.5" : "size-1.5")}
        aria-hidden="true"
      >
        {tone === "live" && !reduced && <Heartbeat ring={hasRing} />}
        {Array.from({ length: PING_POOL }, (_, i) => (
          <span
            key={i}
            data-fx="ping"
            ref={(el) => {
              pings.current[i] = el;
            }}
            className={cn("pointer-events-none absolute inset-0 rounded-full opacity-0", hasRing ? cn("border-[1.5px] border-current", TONE_STROKE[tone]) : TONE_DOT[tone])}
          />
        ))}
        {hasRing ? (
          <LiveRing ring={ring} reduced={reduced} className={cn("size-3.5", TONE_STROKE[tone], spinning && "animate-spin")} />
        ) : (
          TONES.map((t) => (
            <motion.span
              key={t}
              className={cn("absolute inset-0 rounded-full", TONE_DOT[t])}
              initial={false}
              animate={{ opacity: t === tone ? 1 : 0 }}
              transition={tween.crossfade}
            />
          ))
        )}
      </motion.span>
      <AnimatePresence mode="popLayout" initial={false}>
        {expanded && label != null && (
          <motion.span
            key="label"
            layout="position"
            layoutDependency={dependency}
            className="relative transition-colors duration-200"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: tween.fade }}
            exit={{ opacity: 0, y: -4, transition: tween.exit }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * Live heartbeat: a soft disc (dot mode) or halo (ring mode) that grows and fades on `tween.pingFew` – three beats
 * when the pill turns live, then it rests (the per-event pings carry the liveness from there).
 * Animated as `transform` + `opacity` keyframes, which Motion hands to WAAPI → runs on the compositor.
 */
const HEARTBEAT = {
  dot: { transform: ["scale(1)", `scale(${PING_SCALE.dot})`], opacity: [0.55, 0] },
  ring: { transform: ["scale(1)", `scale(${PING_SCALE.ring})`], opacity: [0.7, 0] },
};

function Heartbeat({ ring }: { ring: boolean }) {
  return (
    <motion.span
      aria-hidden="true"
      data-fx="heartbeat"
      className={cn("pointer-events-none absolute inset-0 rounded-full", ring ? "border border-win/70" : "bg-win")}
      animate={ring ? HEARTBEAT.ring : HEARTBEAT.dot}
      transition={tween.pingFew}
    />
  );
}

/** Pooled bright pings for `pingKey` / `pingOn`, throttled to `PING_MIN_INTERVAL_MS`. */
function usePings(pool: RefObject<(HTMLSpanElement | null)[]>, pingKey: string | number | undefined, pingOn: ChangeSource | undefined, scale: number, reduced: boolean): void {
  const state = useRef({ at: -Infinity, next: 0, controls: [] as (AnimationPlaybackControls | undefined)[], scale, reduced });
  useEffect(() => {
    state.current.scale = scale;
    state.current.reduced = reduced;
  }, [scale, reduced]);

  const fire = useCallback(() => {
    const s = state.current;
    if (s.reduced) return;
    const now = performance.now();
    if (now - s.at < PING_MIN_INTERVAL_MS) return;
    const i = s.next;
    const el = pool.current[i];
    if (!el) return;
    s.at = now;
    s.next = (i + 1) % PING_POOL;
    s.controls[i]?.stop();
    s.controls[i] = animate(el, { transform: ["scale(1)", `scale(${s.scale})`], opacity: [0.9, 0] }, tween.ripple);
  }, [pool]);

  // React-driven pings: every change of `pingKey` after mount (StrictMode-safe: compares with the last seen key)
  const lastKey = useRef(pingKey);
  useEffect(() => {
    if (lastKey.current === pingKey) return;
    lastKey.current = pingKey;
    fire();
  }, [pingKey, fire]);

  // MotionValue-driven pings: no React render per event
  useEffect(() => {
    if (!pingOn) return;
    return pingOn.on("change", fire);
  }, [pingOn, fire]);

  useEffect(() => {
    const s = state.current;
    return () => s.controls.forEach((c) => c?.stop());
  }, []);
}

/**
 * 14 px countdown ring drawn by two half-rings that rotate into view inside two half-width windows – a pure
 * `transform` animation, so the ring never repaints. Track at 20 % opacity. A number shows that progress (short
 * `tween.fade` step per change); a `RingCycle` runs itself (`tween.hold`'s linear ease over the cycle, seeked to
 * the elapsed time) and restarts when `endsAt` / `ms` change. Reduced motion: the cycle advances in 5-s steps.
 */
function LiveRing({ ring, reduced, className }: { ring: number | RingCycle; reduced: boolean; className?: string }) {
  const rightRef = useRef<HTMLSpanElement>(null);
  const leftRef = useRef<HTMLSpanElement>(null);
  const isCycle = typeof ring !== "number";
  const endsAt = isCycle ? ring.endsAt : 0;
  const ms = isCycle ? (ring.ms ?? DEFAULT_RING_MS) : 0;
  const progress = isCycle ? null : Math.max(0, Math.min(1, ring));

  // layout effect: the halves are placed at the current progress before the first paint (no unrotated flash)
  useLayoutEffect(() => {
    if (!isCycle) return;
    const right = rightRef.current;
    const left = leftRef.current;
    if (!right || !left) return;
    const elapsed = () => Math.max(0, Math.min(ms, ms - (endsAt - Date.now())));
    const place = (p: number) => {
      right.style.transform = halfTransform("right", p);
      left.style.transform = halfTransform("left", p);
    };
    place(elapsed() / ms);
    if (reduced) {
      const id = setInterval(() => place(elapsed() / ms), RING_REDUCED_STEP_MS);
      return () => clearInterval(id);
    }
    const options = { ...tween.hold, duration: ms / 1000, times: [0, 0.5, 1] };
    const a = animate(right, { transform: [halfTransform("right", 0), halfTransform("right", 0.5), halfTransform("right", 1)] }, options);
    const b = animate(left, { transform: [halfTransform("left", 0), halfTransform("left", 0.5), halfTransform("left", 1)] }, options);
    a.time = b.time = elapsed() / 1000;
    return () => {
      a.stop();
      b.stop();
    };
  }, [isCycle, endsAt, ms, reduced]);

  const half = (side: "right" | "left", ref: RefObject<HTMLSpanElement | null>) => (
    <span className={cn("absolute inset-y-0 w-1/2 overflow-hidden", side === "right" ? "right-0" : "left-0")}>
      <motion.span
        ref={ref}
        className={cn("absolute top-0 block size-3.5", side === "right" ? "right-0" : "left-0")}
        initial={false}
        animate={progress === null ? undefined : { transform: halfTransform(side, progress) }}
        transition={tween.fade}
      >
        <span className="absolute inset-[1px] rounded-full border-[1.75px]" style={{ borderColor: "currentColor currentColor transparent transparent" }} />
      </motion.span>
    </span>
  );

  return (
    <span data-fx="ring" className={cn("relative block", className)} aria-hidden="true">
      <span className="absolute inset-[1px] rounded-full border-[1.75px] border-current opacity-20" />
      {half("right", rightRef)}
      {half("left", leftRef)}
    </span>
  );
}

/**
 * Rotation of one half-ring for progress `p`. The half-ring (top + right border, i.e. an arc centred at 45°) sits at
 * −135° (hidden behind its window) and sweeps clockwise to 45° (right window, first half of the cycle) or from 45° to
 * 225° (left window, second half).
 */
function halfTransform(side: "right" | "left", p: number): string {
  const deg = side === "right" ? -135 + 360 * Math.min(p, 0.5) : 45 + 360 * Math.max(0, p - 0.5);
  return `rotate(${deg}deg)`;
}
