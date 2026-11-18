import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { observeInView } from "@/motion/inView";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * The calm stand-in for a chart that has nothing to draw yet (Runde 10): a flat hairline that breathes (opacity + a little
 * height, compositor only) and an honest sentence – instead of an empty box. The breathing pauses while the card is off
 * screen (`data-idle`) and is a still line under reduced motion. Rendered only where the caller knows it is on a rich page,
 * or inside `[data-rich]` through `EmptyState chart` (hidden everywhere else, so the Übersicht and the Cockpit keep their picture).
 */
export function ChartPlaceholder({ text, className, lineClassName }: { text?: string; className?: string; lineClassName?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedFx();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return observeInView(el, (inView) => el.toggleAttribute("data-idle", !inView));
  }, []);
  return (
    <div ref={ref} data-chart-ph data-still={reduced ? "" : undefined} className={cn("grid w-full justify-items-center gap-2", className)}>
      <svg aria-hidden="true" viewBox="0 0 200 24" preserveAspectRatio="none" className={cn("chart-ph__line h-6 w-full max-w-[26rem] text-mute", lineClassName)}>
        <path d="M0 12 C 28 12, 36 9, 64 11 S 112 15, 140 12 S 180 9, 200 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {text && <span className="text-[12px] text-faint">{text}</span>}
    </div>
  );
}
