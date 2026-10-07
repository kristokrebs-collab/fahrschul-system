import { AnimatePresence, motion } from "motion/react";
import { useCallback, useLayoutEffect, useRef, useState, type FocusEvent } from "react";
import { cn } from "@/lib/cn";
import { contextSpring, lastPointerType, pointerSpeed } from "@/motion/physics";
import { isScrolling } from "@/motion/scrollGate";
import { radius, spring, tween } from "@/motion/tokens";

export interface HoverPillProps {
  /** Render the pill on this row. */
  show: boolean;
  /** One group per list (`bt`, `rank`, `recent`) → `layoutId="hover-{group}"`. */
  group: string;
  className?: string;
  /**
   * Pointer speed (px/s) of the hover that moved the pill here, sampled in the event handler. Default: the speed the
   * last `useHoverGroup` handler sampled (0 for focus / keyboard).
   */
  speed?: number;
}

/**
 * Pointer speed sampled by the last hover / focus handler of any group (event time, never during render). The pill's
 * layout transition is resolved when the row re-renders right after that handler, so it reads the matching value.
 */
let lastHoverSpeed = 0;

/**
 * True when a mouse-family `mouseenter` / `mousemove` is a real hover: after a touch or pen TAP the browser emulates
 * mouse events at the tap point, which would leave the pill stuck on the tapped row (sticky hover). The global tempo
 * probe (installed by `MotionRoot`) knows the kind of the last pointer; before any pointer event (tests, very first
 * move) the event is trusted.
 */
export function isRealHover(): boolean {
  const kind = lastPointerType();
  return kind === null || kind === "mouse";
}

/**
 * Moving hover highlight (Bundle `Rg`): `absolute inset-0 rounded-xl bg-white/[0.055] ring-1
 * ring-white/[0.08]`, travels between rows of the same group via `layoutId="hover-{group}"` on
 * `spring.hover`; opacity in .15 s, out .15 s with .15 s delay. The parent row must be `relative`.
 * Physics (additive): a fast sweep (> 400 px/s) travels on `contextSpring(spring.hover, speed)` – a little shorter and
 * bouncier; normal hovers, focus and keyboard get `spring.hover` itself.
 */
export function HoverPill({ show, group, className, speed }: HoverPillProps) {
  const transition = contextSpring(spring.hover, speed ?? lastHoverSpeed);
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          layoutId={`hover-${group}`}
          aria-hidden="true"
          className={cn("pointer-events-none absolute inset-0 -z-0 rounded-xl bg-white/[0.055] ring-1 ring-white/[0.08]", className)}
          style={{ borderRadius: radius.hover }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: tween.hoverPill }}
          exit={{ opacity: 0, transition: { ...tween.hoverPill, delay: 0.15 } }}
          transition={transition}
        />
      )}
    </AnimatePresence>
  );
}

export interface HoverGroupBinding {
  onMouseEnter: () => void;
  /** Self-heal after a scroll: the first real move over a row claims the pill (React bails out when it is already set). */
  onMouseMove: () => void;
  onMouseLeave: () => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
}

/**
 * Tracks the hovered/focused row id of one group (Bundle `Dg`, NEW: also `:focus-visible`). Pointer hover is ignored
 * while the page scrolls (`isScrolling()`, rows passing under a resting pointer fire `mouseenter`); the next real
 * `mousemove` picks the row up. Touch / pen taps never claim the pill (their emulated mouse events are ignored,
 * `isRealHover`), so nothing stays highlighted after a tap. Each claim samples the pointer speed for the pill's context
 * spring (focus: 0).
 * ```tsx
 * const { hovered, bind } = useHoverGroup();
 * <button className="relative" {...bind(id)}><HoverPill show={hovered === id} group="recent" />…</button>
 * ```
 */
export function useHoverGroup<T extends string | number = string>() {
  const [hovered, setHovered] = useState<T | null>(null);
  const current = useRef<T | null>(null);
  useLayoutEffect(() => {
    current.current = hovered;
  }, [hovered]);
  const bind = useCallback(
    (id: T): HoverGroupBinding => ({
      onMouseEnter: () => {
        if (isScrolling() || !isRealHover()) return;
        lastHoverSpeed = pointerSpeed();
        setHovered(id);
      },
      onMouseMove: () => {
        if (isScrolling() || !isRealHover()) return;
        // React bails out when the row already holds the pill; only a claim re-samples the speed
        if (current.current !== id) lastHoverSpeed = pointerSpeed();
        setHovered(id);
      },
      onMouseLeave: () => setHovered((h) => (h === id ? null : h)),
      onFocus: (e) => {
        let visible = true;
        try {
          visible = e.currentTarget.matches(":focus-visible");
        } catch {
          /* selector unsupported → treat as visible */
        }
        if (!visible) return;
        lastHoverSpeed = 0;
        setHovered(id);
      },
      onBlur: () => setHovered((h) => (h === id ? null : h)),
    }),
    [],
  );
  return { hovered, bind, clear: () => setHovered(null) };
}
