import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";
import { useReducedFx } from "@/motion/useReducedFx";

export interface ExpanderProps {
  open: boolean;
  onToggle: () => void;
  /** Subject for `aria-label` → `Details zeigen: {label}` / `Details schließen: {label}`. */
  label: string;
  /** id of the region this button controls. */
  controls?: string;
  className?: string;
}

/** A 24 px target needs a firmer squeeze than a card to read as a press. */
const PRESS_SCALE = 0.88;

/**
 * Bundle `_g`: round `+` toggle. Open = a pre-rendered white disc that pops in (`spring.pop`, scale + opacity)
 * under an ink icon; closed = hairline ring. The icon rotates 45° on `spring.plus`; press squeezes the button
 * (`spring.press`). Reduced motion: the disc fades, no squeeze or rotation.
 */
export function Expander({ open, onToggle, label, controls, className }: ExpanderProps) {
  const reduced = useReducedFx();
  const press = usePressable({ scale: PRESS_SCALE, disabled: reduced });
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`${open ? "Details schließen" : "Details zeigen"}: ${label}`}
      whileTap={press.whileTap}
      transition={press.transition}
      className={cn(
        // `touch-hit`: the 24 px disc keeps its look, coarse pointers get a 44 × 44 tap area (no layout change)
        "touch-hit relative isolate grid size-6 shrink-0 place-items-center rounded-full border transition-colors duration-200",
        open ? "border-white text-ink-950" : "border-line-2 text-mute hover:border-white/50 hover:text-fg",
        className,
      )}
    >
      <motion.span
        aria-hidden="true"
        className="absolute -inset-px -z-10 rounded-full bg-white"
        initial={false}
        animate={open ? { opacity: 1, scale: 1 } : { opacity: 0, scale: reduced ? 1 : 0.4 }}
        transition={reduced ? tween.crossfade : { default: tween.fade, scale: spring.pop }}
      />
      <motion.svg viewBox="0 0 12 12" className="size-2.5" animate={{ rotate: open ? 45 : 0 }} transition={spring.plus} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M6 1.5v9M1.5 6h9" />
      </motion.svg>
    </motion.button>
  );
}

export interface CollapseProps {
  open: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
}

/**
 * Bundle `Mg`: `AnimatePresence initial={false}`, `{height:0,opacity:0}` ↔ `{height:"auto",opacity:1}` on
 * `tween.collapse` (height is a one-off layout read, declared in Plan 3.3 "Collapsible-Explainer"). The content
 * itself settles from 6 px above while the box opens, so it reads as unfolding rather than being uncovered.
 */
export function Collapse({ open, children, className, id }: CollapseProps) {
  const reduced = useReducedFx();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="x"
          id={id}
          className={cn("overflow-hidden", className)}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={tween.collapse}
        >
          <motion.div initial={reduced ? false : { y: -6 }} animate={{ y: 0 }} exit={reduced ? undefined : { y: -6 }} transition={tween.collapse}>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
