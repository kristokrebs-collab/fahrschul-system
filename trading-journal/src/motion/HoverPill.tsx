import { AnimatePresence, motion } from "motion/react";
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type FocusEvent } from "react";
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

/**
 * The hovered id of one list OUTSIDE React state (perf-120 phase B): `useHoverGroup` keeps it in the list's state, so
 * every hover re-rendered the whole list (6–12 rows of motion components) twice per row change. With a hover store the
 * list never re-renders on hover: rows spread the store's cached `bind(id)` (stable per id) and render
 * `<HoverPillFor store id group />`, which subscribes to its own row – a hover change re-renders the pill that leaves
 * and the one that arrives, in one commit (the shared `hover-{group}` layoutId still glides between them).
 * Same rules as `useHoverGroup`: no claim while the page scrolls or from touch / pen taps, `:focus-visible` only,
 * pointer speed sampled per claim.
 * ```tsx
 * const hover = useHoverStore<string>();
 * <li className="relative" {...hover.bind(id)}><HoverPillFor store={hover} id={id} group="recent" />…</li>
 * ```
 */
export interface HoverStore<T extends string | number = string> {
  get(): T | null;
  subscribe(listener: () => void): () => void;
  /** Cached per id: the same object for every render. */
  bind(id: T): HoverGroupBinding;
  clear(): void;
}

export function createHoverStore<T extends string | number = string>(): HoverStore<T> {
  let hovered: T | null = null;
  const listeners = new Set<() => void>();
  const binds = new Map<T, HoverGroupBinding>();
  const set = (id: T | null) => {
    if (Object.is(id, hovered)) return;
    hovered = id;
    for (const l of [...listeners]) l();
  };
  const claim = (id: T) => {
    // a claim (the pill moves here) re-samples the pointer speed; a move on the row that holds the pill does nothing
    if (!Object.is(hovered, id)) lastHoverSpeed = pointerSpeed();
    set(id);
  };
  return {
    get: () => hovered,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear: () => set(null),
    bind: (id) => {
      let b = binds.get(id);
      if (!b) {
        b = {
          onMouseEnter: () => {
            if (isScrolling() || !isRealHover()) return;
            lastHoverSpeed = pointerSpeed();
            set(id);
          },
          onMouseMove: () => {
            if (isScrolling() || !isRealHover()) return;
            claim(id);
          },
          onMouseLeave: () => {
            if (Object.is(hovered, id)) set(null);
          },
          onFocus: (e) => {
            let visible = true;
            try {
              visible = e.currentTarget.matches(":focus-visible");
            } catch {
              /* selector unsupported → treat as visible */
            }
            if (!visible) return;
            lastHoverSpeed = 0;
            set(id);
          },
          onBlur: () => {
            if (Object.is(hovered, id)) set(null);
          },
        };
        binds.set(id, b);
      }
      return b;
    },
  };
}

/** One hover store per list for the component's lifetime. */
export function useHoverStore<T extends string | number = string>(): HoverStore<T> {
  const [store] = useState(() => createHoverStore<T>());
  return store;
}

/** True while `id` holds the pill of `store`; re-renders only when that changes. */
export function useHovered<T extends string | number>(store: HoverStore<T>, id: T): boolean {
  return useSyncExternalStore(
    store.subscribe,
    () => Object.is(store.get(), id),
    () => false,
  );
}

/** `HoverPill` that follows its own row in a hover store (see `createHoverStore`). */
export function HoverPillFor<T extends string | number>({ store, id, group, className }: { store: HoverStore<T>; id: T; group: string; className?: string }) {
  const show = useHovered(store, id);
  return <HoverPill show={show} group={group} className={className} />;
}
