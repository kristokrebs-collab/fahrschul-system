import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { tooltipClass } from "@/primitives/Tooltip";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/tooltip";

export interface TapTooltipProps {
  content: ReactNode;
  /** the trigger; must accept a ref (button, span) */
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  delayDuration?: number;
  className?: string;
}

/**
 * Tooltip that also opens on touch (tablet audit 2a.2): Radix tooltips close on pointer-down and never open from a
 * tap, so a touch / pen tap toggles a controlled `open` instead (a tap outside closes it via the dismissable layer).
 * Mouse and keyboard keep Radix' hover / focus behaviour. Same look as `@/primitives/Tooltip` (`.fx-pop`).
 */
export function TapTooltip({ content, children, side = "top", delayDuration = 300, className }: TapTooltipProps) {
  const [open, setOpen] = useState(false);
  const touch = useRef(false);
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <UiTooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          asChild
          onPointerDown={(e) => {
            touch.current = e.pointerType !== "mouse";
            // skip Radix' "close on pointer-down" for touch: the click below decides
            if (touch.current) e.preventDefault();
          }}
          onClick={(e) => {
            if (!touch.current) return;
            e.preventDefault();
            setOpen((o) => !o);
          }}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent side={side} sideOffset={6} collisionPadding={12} className={cn(tooltipClass, "fx-pop max-w-[min(280px,calc(100vw-24px))]", className)}>
          {content}
        </TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  );
}
