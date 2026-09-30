import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState, type FocusEvent } from "react";
import { cn } from "@/lib/cn";
import { radius, spring, tween } from "@/motion/tokens";

export interface HoverPillProps {
  /** Render the pill on this row. */
  show: boolean;
  /** One group per list (`bt`, `rank`, `recent`) → `layoutId="hover-{group}"`. */
  group: string;
  className?: string;
}

/**
 * Moving hover highlight (Bundle `Rg`): `absolute inset-0 rounded-xl bg-white/[0.055] ring-1
 * ring-white/[0.08]`, travels between rows of the same group via `layoutId="hover-{group}"` on
 * `spring.hover`; opacity in .15 s, out .15 s with .15 s delay. The parent row must be `relative`.
 */
export function HoverPill({ show, group, className }: HoverPillProps) {
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
          transition={spring.hover}
        />
      )}
    </AnimatePresence>
  );
}

export interface HoverGroupBinding {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
}

/**
 * Tracks the hovered/focused row id of one group (Bundle `Dg`, NEW: also `:focus-visible`).
 * ```tsx
 * const { hovered, bind } = useHoverGroup();
 * <button className="relative" {...bind(id)}><HoverPill show={hovered === id} group="recent" />…</button>
 * ```
 */
export function useHoverGroup<T extends string | number = string>() {
  const [hovered, setHovered] = useState<T | null>(null);
  const bind = useCallback(
    (id: T): HoverGroupBinding => ({
      onMouseEnter: () => setHovered(id),
      onMouseLeave: () => setHovered((h) => (h === id ? null : h)),
      onFocus: (e) => {
        let visible = true;
        try {
          visible = e.currentTarget.matches(":focus-visible");
        } catch {
          /* selector unsupported → treat as visible */
        }
        if (visible) setHovered(id);
      },
      onBlur: () => setHovered((h) => (h === id ? null : h)),
    }),
    [],
  );
  return { hovered, bind, clear: () => setHovered(null) };
}
