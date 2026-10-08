import { AnimatePresence, animate, motion, useMotionValue, useTransform, type Variants } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/cn";
import { flingExit, useSwipeDismiss, type SwipeDismissInfo } from "@/motion/physics";
import { useTouchMoveGuard } from "@/motion/a11y";
import { gesture, radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { GlyphCheck, GlyphCross, GlyphInfo } from "@/primitives/icons";
import { formatRoll, parseRollValue } from "@/primitives/rollValue";
import { toastDuration, toastLane, useToastStore, type Toast, type ToastKind, type ToastLane } from "@/primitives/toastStore";

const KIND_DISC: Record<ToastKind, string> = { ok: "bg-win/20 text-win", error: "bg-loss/20 text-loss", warn: "bg-signal/25 text-signal" };
const KIND_BAR: Record<ToastKind, string> = { ok: "bg-win/70", error: "bg-loss/70", warn: "bg-signal/80" };

/** Swipe distance / speed that dismisses the island sideways (`gesture.toastSwipe` / `gesture.toastFlick`). */
export const TOAST_SWIPE_PX = gesture.toastSwipe;
export const TOAST_SWIPE_VELOCITY = gesture.toastFlick;

/** A toast as the island renders it; `duration` (ms) overrides the kind default, `0` keeps it until dismissed. */
export interface IslandToast extends Toast {
  duration?: number;
}

export interface ToastIslandProps {
  /** Override the store (tests, storybook, the app's ui store adapter). */
  toasts?: IslandToast[];
  onDismiss?: (id: number) => void;
  className?: string;
}

interface Fling {
  id: number;
  /** release info of the throw (null for a tap / timeout). */
  info: SwipeDismissInfo | null;
}

/** Minimum finger travel before a sideways throw can dismiss (px). */
export const TOAST_MIN_OFFSET = 12;

/**
 * Exit of a thrown island: x flies on the release velocity (critically damped physics spring, ≥ 900 px/s) far enough
 * to leave the screen, the opacity follows a beat later. Reduced motion: a plain fade.
 */
export function toastFlingExit(info: SwipeDismissInfo, reduced: boolean) {
  if (reduced) return { opacity: 0, transition: { duration: 0 } };
  const w = typeof window === "undefined" ? 800 : window.innerWidth;
  const fly = flingExit(info, { axis: "x", distance: Math.max(gesture.toastFling, w / 2 + 240) });
  return { ...fly, opacity: 0, transition: { ...(fly.transition as object), opacity: { ...tween.toastExit, delay: 0.08 } } };
}

/** Above every overlay: Sheet 60, MorphDialog 70, pulse select panels 75, Celebrate 80. */
export const TOAST_Z = 95;

/**
 * Toast island (Bundle `Ehe`, Plan 3.3 "Toast-Insel", 21st.dev "Dynamic Island"): fixed above the dock, the ONLY
 * `role="status" aria-live="polite"` region, one toast at a time (the next one waits in the queue). It floats above
 * every overlay (`TOAST_Z`); a toast that appears while a modal overlay is open takes the `top` lane (under the top
 * edge) so it never covers – or hides under – a sheet footer, and keeps that lane until it leaves.
 * - grows 44×44 → auto×50 on `spring.toast` (declared exception), exit `tween.toastExit`, text `delay .12`,
 *   check mark `pathLength` on `tween.checkToast`;
 * - remaining-time bar: compositor `scaleX` loop (`.fx-countdown`), paused together with the dismiss timer while
 *   hovered, focused, dragged or pressed by a finger / pen;
 * - swipe-x to dismiss (Apple physics, `useSwipeDismiss` axis x, either way): it tracks the finger 1:1, commits on
 *   the projected throw (`|x + project(vx)| > 80`, ≥ 12 px travel, a flick back cancels) and flies out the way it was
 *   thrown, keeping the finger's velocity; a released half-swipe springs back with that velocity (gentle when slow,
 *   a small bounce when thrown); mouse, touch and pen; a press squishes the island (`scale .97`, Dynamic Island);
 * - win toasts (`ok` + `valueTone: "win"`) roll their value up (`spring.number`) under a green glow;
 * - `+n` queue badge pops (`spring.pop`) and rolls when the queue changes.
 * Reduced motion: no roll, glow or bar; instant transitions. At rest the region is a 0×0 box (no empty full-viewport
 * fixed layer between toasts); Samsung-Internet-safe effects (`html[data-safe-fx]`) drop the blurred win glow.
 */
export function ToastIsland({ toasts, onDismiss, className }: ToastIslandProps) {
  const storeToasts = useToastStore((s) => s.toasts);
  const storeDismiss = useToastStore((s) => s.dismiss);
  const list = toasts ?? storeToasts;
  const dismiss = onDismiss ?? storeDismiss;
  const reduced = useReducedFx();
  const [fling, setFling] = useState<Fling | null>(null);
  const note = list[0];
  // At rest (no toast, no exit running) the live region shrinks to a 0×0 box: no empty full-viewport fixed layer sits
  // over the page between toasts (decision 7, Samsung Internet), while the region itself stays in the DOM and the
  // accessibility tree, so the next toast is announced. Derived during render (never one frame clipped).
  const noteId = note?.id ?? null;
  const [shownId, setShownId] = useState<number | null>(noteId);
  const [leaving, setLeaving] = useState(false);
  if (shownId !== noteId) {
    setShownId(noteId);
    if (shownId !== null && noteId === null) setLeaving(true);
  }
  const idle = noteId === null && !leaving;

  return (
    <div
      data-toast-island=""
      data-layer="Toast-Insel"
      data-idle={idle ? "" : undefined}
      className={cn(
        idle
          ? "pointer-events-none fixed bottom-0 left-0 size-0 overflow-hidden"
          : "pointer-events-none fixed inset-0 grid justify-items-center px-4 pb-[calc(92px+max(env(safe-area-inset-bottom,0px),var(--vv-bottom,0px)))] pt-[calc(10px+env(safe-area-inset-top,0px))]",
        className,
      )}
      style={{ zIndex: TOAST_Z }}
      aria-live="polite"
      role="status"
    >
      <AnimatePresence custom={fling} onExitComplete={() => setLeaving(false)}>
        {note && (
          <IslandCard
            key={note.id}
            note={note}
            queued={list.length - 1}
            reduced={reduced}
            onDismiss={(info) => {
              setFling(info ? { id: note.id, info } : null);
              dismiss(note.id);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

interface IslandCardProps {
  note: IslandToast;
  queued: number;
  reduced: boolean;
  /** Release info when swiped away, null for a tap or the timeout. */
  onDismiss: (info: SwipeDismissInfo | null) => void;
}

function IslandCard({ note, queued, reduced, onDismiss }: IslandCardProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(onDismiss);
  const hold = useRef<{ reasons: Set<string>; pause: () => void; resume: () => void } | null>(null);
  const ms = note.duration ?? toastDuration(note.kind);
  const win = note.kind === "ok" && note.valueTone === "win";
  const instant = { duration: 0 };
  // lane latched per toast: read at mount (render guess, corrected before paint – an overlay closing in this very
  // commit has released its lane by then) and kept until the toast leaves
  const [initialLane] = useState<ToastLane>(toastLane);
  const lane = useRef(initialLane);
  useLayoutEffect(() => {
    lane.current = toastLane();
    wrapper.current?.setAttribute("data-lane", lane.current);
  }, []);
  const rise = (dist: number) => (lane.current === "top" ? -dist : dist);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  // visible-time countdown: starts when the toast reaches the front, pauses while held (hover / focus / drag)
  useEffect(() => {
    if (ms <= 0) return;
    const reasons = new Set<string>();
    let remaining = ms;
    let startedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      startedAt = Date.now();
      timer = setTimeout(() => dismissRef.current(null), remaining);
    };
    hold.current = {
      reasons,
      pause: () => {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
        wrapper.current?.setAttribute("data-held", "");
      },
      resume: () => {
        if (timer !== undefined) return;
        wrapper.current?.removeAttribute("data-held");
        run();
      },
    };
    run();
    return () => {
      clearTimeout(timer);
      hold.current = null;
    };
  }, [ms]);

  const holdOn = (reason: string) => {
    const h = hold.current;
    if (!h) return;
    h.reasons.add(reason);
    h.pause();
  };
  const holdOff = (reason: string) => {
    const h = hold.current;
    if (!h) return;
    h.reasons.delete(reason);
    if (h.reasons.size === 0) h.resume();
  };

  const swipe = useSwipeDismiss({
    axis: "x",
    direction: 0,
    threshold: TOAST_SWIPE_PX,
    minOffset: TOAST_MIN_OFFSET,
    pointerTypes: ["mouse", "touch", "pen"],
    touchAction: "pan-y",
    reduced,
    target: wrapper,
    measure: () => wrapper.current?.offsetWidth || 240,
    onDismiss: (info) => {
      holdOff("drag");
      onDismiss(info);
    },
  });
  const touchGuard = useTouchMoveGuard(swipe.isDragging);
  const wrapperRef = useCallback(
    (el: HTMLDivElement | null) => {
      wrapper.current = el;
      return touchGuard(el);
    },
    [touchGuard],
  );
  // the countdown pauses while a finger / the mouse drags the island (the hook owns the gesture; zero state per move),
  // and while a finger or pen rests on it (the touch counterpart of the mouse's hover hold: a toast being read or
  // about to be swiped never times out under the finger)
  const h = swipe.handle;
  const handle = {
    ...h,
    onPointerDown: (e: ReactPointerEvent<Element>) => {
      h.onPointerDown(e);
      if (e.pointerType !== "mouse") holdOn("press");
    },
    onPointerMove: (e: ReactPointerEvent<Element>) => {
      h.onPointerMove(e);
      if (swipe.isDragging()) holdOn("drag");
    },
    onPointerUp: (e: ReactPointerEvent<Element>) => {
      h.onPointerUp(e);
      holdOff("drag");
      holdOff("press");
    },
    onPointerCancel: (e: ReactPointerEvent<Element>) => {
      h.onPointerCancel(e);
      holdOff("drag");
      holdOff("press");
    },
  };

  const exitTransition = reduced ? instant : tween.toastExit;
  const flung = (c: Fling | null | undefined) => c?.id === note.id && c.info != null;
  const wrapperVariants: Variants = {
    exit: (c: Fling | null | undefined) => (flung(c) && c?.info ? toastFlingExit(c.info, reduced) : { opacity: 1, transition: exitTransition }),
  };
  const islandVariants: Variants = {
    exit: (c: Fling | null | undefined) =>
      flung(c) ? { opacity: 0, transition: exitTransition } : { width: 44, opacity: 0, y: rise(16), scale: 0.7, transition: exitTransition },
  };

  return (
    <motion.div
      ref={wrapperRef}
      data-lane={initialLane}
      className="pointer-events-auto relative isolate self-end [grid-area:1/1] data-[lane=top]:self-start"
      {...handle}
      style={{ ...h.style, x: swipe.x }}
      onPointerEnter={(e) => e.pointerType === "mouse" && holdOn("hover")}
      onPointerLeave={(e) => e.pointerType === "mouse" && holdOff("hover")}
      onFocus={() => holdOn("focus")}
      onBlur={() => holdOff("focus")}
      variants={wrapperVariants}
      exit="exit"
    >
      {win && !reduced && (
        <motion.span
          aria-hidden="true"
          className="toast-glow pointer-events-none absolute -inset-2 -z-10 rounded-[32px] bg-win/25 blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.9, 0.4] }}
          transition={tween.burst}
        />
      )}
      <motion.button
        type="button"
        // a click that ends a drag is swallowed by the swipe handle (capture phase) before it gets here
        onClick={() => onDismiss(null)}
        whileTap={reduced ? undefined : { scale: 0.97, transition: spring.press }}
        layoutRoot
        className="relative flex items-center gap-3 overflow-hidden border border-line-2 bg-ink-800 pl-2 pr-4 text-left shadow-[0_18px_40px_rgb(0_0_0/0.35)]"
        style={{ maxWidth: "calc(100vw - 32px)" }}
        // motion-exception: toast-island — width/height/borderRadius animate as in the bundle (44×44 → auto×50), Plan 3.2 rule 1.
        initial={{ width: 44, height: 44, borderRadius: radius.toastStart, opacity: 0, y: initialLane === "top" ? -24 : 24, scale: 0.6 }}
        animate={{ width: "auto", height: 50, borderRadius: radius.toastEnd, opacity: 1, y: 0, scale: 1 }}
        variants={islandVariants}
        exit="exit"
        transition={reduced ? instant : spring.toast}
      >
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", KIND_DISC[note.kind])} aria-hidden="true">
          {note.kind === "ok" ? (
            <GlyphCheck className="size-3.5" strokeWidth="2.2" drawn transition={reduced ? instant : tween.checkToast} />
          ) : note.kind === "error" ? (
            <GlyphCross className="size-3.5" />
          ) : (
            <GlyphInfo className="size-3.5" />
          )}
        </span>
        <motion.span className="flex items-center gap-3 whitespace-nowrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={reduced ? instant : tween.toastText}>
          <span className="grid">
            <span className="text-[13px] font-medium text-fg">{note.title}</span>
            {note.detail && <span className="text-[11px] text-mute">{note.detail}</span>}
          </span>
          {note.value &&
            (win && !reduced ? (
              <RollingValue value={note.value} />
            ) : (
              <span className={cn("dot-num text-[15px]", note.valueTone === "win" ? "text-win" : note.valueTone === "loss" ? "text-loss" : "text-mute")}>{note.value}</span>
            ))}
        </motion.span>
        {ms > 0 && !reduced && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-5 bottom-[3px] h-[2px] overflow-hidden rounded-full bg-white/[0.06]">
            <span className={cn("fx-countdown absolute inset-0 rounded-full", KIND_BAR[note.kind])} style={{ "--fx-countdown": `${ms}ms` } as CSSProperties} />
          </span>
        )}
      </motion.button>
      <AnimatePresence>{queued > 0 && <QueueBadge count={queued} reduced={reduced} />}</AnimatePresence>
    </motion.div>
  );
}

/** Win value counting up from zero; screen readers get the final string once (the rolling digits are hidden). */
function RollingValue({ value }: { value: string }) {
  const [spec] = useState(() => parseRollValue(value));
  const n = useMotionValue(0);
  const text = useTransform(n, (v) => (spec && v !== spec.value ? formatRoll(spec, v) : value));

  useEffect(() => {
    if (!spec) return;
    // the island needs one beat to grow before the value starts rolling: the same delay as the text fade
    const controls = animate(n, spec.value, { ...spring.number, delay: tween.toastText.delay });
    return () => controls.stop();
  }, [n, spec]);

  return (
    <span className="relative dot-num text-[15px] text-win">
      <span className="sr-only">{value}</span>
      <motion.span aria-hidden="true">{spec ? text : value}</motion.span>
    </span>
  );
}

/** `+n` waiting toasts: pops in, rolls vertically when the count changes. Decorative (each toast is announced itself). */
function QueueBadge({ count, reduced }: { count: number; reduced: boolean }) {
  return (
    <motion.span
      aria-hidden="true"
      className="pointer-events-none absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center overflow-hidden rounded-full border border-line-2 bg-ink-750 px-1.5 font-mono text-[10px] font-semibold text-fg shadow-[0_4px_12px_rgb(0_0_0/0.4)]"
      initial={reduced ? false : { scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0, transition: reduced ? { duration: 0 } : tween.exit }}
      transition={reduced ? { duration: 0 } : spring.pop}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={count}
          className="block"
          initial={reduced ? false : { y: "-110%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "110%", opacity: 0, transition: reduced ? { duration: 0 } : tween.exit }}
          transition={reduced ? { duration: 0 } : spring.pop}
        >
          +{count}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}
