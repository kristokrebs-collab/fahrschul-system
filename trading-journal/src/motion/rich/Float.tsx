import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useRichFx } from "@/motion/rich";
import { useIdleGate } from "./idle";

export interface FloatProps {
  children: ReactNode;
  className?: string;
  /** Seconds to start later – two floating pills side by side should not bob in step. */
  delay?: number;
}

/**
 * A pill that floats: 2 px up and down on a 5.4 s breath (`.rich-float`, CSS transform on the compositor), for the pills of
 * the marketing-like pages (plan, "Empfohlen", "Dein Tarif"). Rich pages only, and only while it is on screen in a visible tab
 * (`useIdleGate` pauses it); reduced motion: still. The wrapper is an inline-flex box exactly as large as the pill – nothing
 * around it moves.
 */
export function Float({ children, className, delay = 0 }: FloatProps) {
  const fx = useRichFx();
  const ref = useRef<HTMLSpanElement>(null);
  useIdleGate(ref);
  if (!fx) return <>{children}</>;
  return (
    <span ref={ref} className={cn("rich-float inline-flex", className)} style={delay ? { animationDelay: `${-delay}s` } : undefined}>
      {children}
    </span>
  );
}
