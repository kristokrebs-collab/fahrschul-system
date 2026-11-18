import { useRef } from "react";
import { cn } from "@/lib/cn";
import { useIdleGate } from "@/motion/rich/idle";
import "./flame.css";

export interface FlameGlyphProps {
  /** A streak at its best burns in the signal red, otherwise the flame is white. */
  record?: boolean;
  className?: string;
}

/**
 * The flame of a running streak (rich Wachstum page): a small SVG flame whose body and hot core flicker out of step
 * (`flame.css`: transform only, 1.3 s / 1.9 s). It pauses while it is off screen or the tab is hidden (`useIdleGate`) and
 * stands still under reduced motion. 26 × 32 px – inside the 38 px of the count it sits next to. Decorative: the count
 * carries the meaning.
 */
export function FlameGlyph({ record = false, className }: FlameGlyphProps) {
  const ref = useRef<SVGSVGElement>(null);
  useIdleGate(ref);
  return (
    <svg ref={ref} aria-hidden="true" focusable="false" viewBox="0 0 24 30" width={26} height={32} className={cn("flame", record && "flame--record", className)} data-testid="streak-flame">
      <path className="flame__body" d="M12 1C13 7 20 10 20 19A8 8 0 0 1 4 19C4 15 6.5 13 8 11C8.5 13.5 10 14.5 11 14.5C10.5 10 10.5 5 12 1Z" />
      <path className="flame__core" d="M12 17C13.5 19 16 20 16 23A4 4 0 0 1 8 23C8 20.5 10.5 19.5 12 17Z" />
    </svg>
  );
}
