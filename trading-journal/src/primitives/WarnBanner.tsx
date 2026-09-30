import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { radius, spring, tween } from "@/motion/tokens";

export interface WarnBannerProps {
  /** Mount/unmount with exit `{opacity:0}` (`tween.exit`); siblings with `layout` move up on `spring.layout`. */
  open?: boolean;
  children: ReactNode;
  /** Right-aligned action (e.g. close button `aria-label="Schließen"`). */
  action?: ReactNode;
  className?: string;
}

/** `Lokaler Modus` banner: `rounded-2xl border border-warn/30 bg-warn/[0.07] px-4 py-3 text-[13px] text-warn`. */
export function WarnBanner({ open = true, children, action, className }: WarnBannerProps) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          layout
          role="status"
          style={{ borderRadius: radius.card }}
          transition={{ layout: spring.layout }}
          exit={{ opacity: 0, transition: tween.exit }}
          className={cn("flex items-start justify-between gap-3 rounded-2xl border border-warn/30 bg-warn/[0.07] px-4 py-3 text-[13px] text-warn", className)}
        >
          <div className="min-w-0">{children}</div>
          {action}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
