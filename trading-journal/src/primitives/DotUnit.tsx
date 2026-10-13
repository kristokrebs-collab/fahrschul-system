import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The unit beside a Doto figure (`%`, `R`, `×`): IBM Plex Sans, medium, muted, a step smaller than the figure – the rule
 * of the overview hero („Einheit daneben in Plex Sans gedämpft“, DESIGN.md). Doto draws these glyphs as dot blocks
 * (its `%` reads as a checkerboard ⊠ at card sizes). Put it INSIDE the `dot-num` span, right after the number; a
 * leading space belongs in `children` when the text content must keep it (`" %"`).
 */
export function DotUnit({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("ml-[0.08em] font-sans text-[length:max(9.5px,0.62em)] font-medium tracking-normal text-mute", className)}>{children}</span>;
}
