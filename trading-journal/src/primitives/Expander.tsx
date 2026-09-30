import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/motion/tokens";

export interface ExpanderProps {
  open: boolean;
  onToggle: () => void;
  /** Subject for `aria-label` → `Details zeigen: {label}` / `Details schließen: {label}`. */
  label: string;
  /** id of the region this button controls. */
  controls?: string;
  className?: string;
}

/** Bundle `_g`: round `+` toggle, open `border-white bg-white text-ink-950`, icon rotates 45° on `spring.plus`. */
export function Expander({ open, onToggle, label, controls, className }: ExpanderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`${open ? "Details schließen" : "Details zeigen"}: ${label}`}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full border transition-colors duration-200",
        open ? "border-white bg-white text-ink-950" : "border-line-2 text-mute hover:border-white/50 hover:text-fg",
        className,
      )}
    >
      <motion.svg viewBox="0 0 12 12" className="size-2.5" animate={{ rotate: open ? 45 : 0 }} transition={spring.plus} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M6 1.5v9M1.5 6h9" />
      </motion.svg>
    </button>
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
 * `tween.collapse` (height is a one-off layout read, declared in Plan 3.3 "Collapsible-Explainer").
 */
export function Collapse({ open, children, className, id }: CollapseProps) {
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
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
