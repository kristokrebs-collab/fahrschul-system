import type { ReactElement, ReactNode } from "react";
import { Tooltip } from "@/primitives/Tooltip";

export interface TapTooltipProps {
  content: ReactNode;
  /** the trigger; must accept a ref (button, span) */
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  delayDuration?: number;
  className?: string;
}

/**
 * Tooltip that also opens on touch (tablet audit 2a.2) – the overview's name for `@/primitives/Tooltip` with a calmer
 * 300 ms hover delay. The primitive toggles from the state at pointer-down, so a second tap on the trigger closes the
 * tooltip (Radix' dismissable layer closes on the trigger's own pointer-down; toggling from the live state re-opened
 * it). Mouse and keyboard keep Radix' hover / focus behaviour; same look (`.fx-pop`).
 */
export function TapTooltip({ content, children, side = "top", delayDuration = 300, className }: TapTooltipProps) {
  return (
    <Tooltip content={content} side={side} delayDuration={delayDuration} className={className}>
      {children}
    </Tooltip>
  );
}
