import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/tooltip";

/** Chart tooltip recipe (Plan 2.5) – also used by Recharts custom tooltips. */
export const tooltipClass = "rounded-xl border border-line-2 bg-ink-850/95 px-3 py-2 text-xs shadow-[0_12px_32px_rgb(0_0_0/0.45)] backdrop-blur-sm";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: ComponentProps<typeof TooltipContent>["side"];
  sideOffset?: number;
  className?: string;
  delayDuration?: number;
}

/**
 * Wrapper over `@/ui/tooltip` with the bundle tooltip class string. The child must accept a ref (button, span).
 * Enters with `.fx-pop` (opacity + 4 px nudge away from the trigger + scale .96 → 1, 0.2 s `ease.out`, origin at the
 * trigger) and leaves in 0.12 s – CSS keyframes on transform/opacity, so Radix' presence waits for the exit.
 * Touch (tablet audit 2a.2, rule "no hover-only information"): Radix closes on pointer-down and never opens from a
 * tap, so a touch / pen tap toggles a controlled `open` instead; a tap outside closes it (dismissable layer). Mouse and
 * keyboard keep Radix' hover / focus behaviour. The trigger's own `onClick` still runs (before the toggle).
 */
export function Tooltip({ content, children, side = "top", sideOffset = 6, className, delayDuration = 150 }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const touch = useRef(false);
  // the dismissable layer closes an open tooltip on ANY pointer-down outside its content – the trigger included – so
  // the toggle decides from the state at pointer-down
  const wasOpen = useRef(false);
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <UiTooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          asChild
          onPointerDown={(e) => {
            touch.current = e.pointerType !== "mouse";
            wasOpen.current = open;
            // skip Radix' "close on pointer-down" for touch: the click below toggles
            if (touch.current) e.preventDefault();
          }}
          onClick={(e) => {
            // the child's own onClick has already run (Slot calls it first); a submit button keeps its default
            if (!touch.current || (e.currentTarget as HTMLButtonElement).type === "submit") return;
            // keeps Radix' close-on-click from undoing the toggle
            e.preventDefault();
            setOpen(!wasOpen.current);
          }}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent side={side} sideOffset={sideOffset} collisionPadding={12} className={cn(tooltipClass, "fx-pop max-w-[min(280px,calc(100vw-24px))]", className)}>
          {content}
        </TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  );
}

/** Static tooltip box for Recharts `content` renderers (no Radix, positioned by the chart). */
export function TooltipBox({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(tooltipClass, className)}>{children}</div>;
}

/** Label/value row inside a chart tooltip: `text-mute` label / `num font-mono font-medium` value. */
export function TooltipRow({ label, value, valueClassName }: { label: ReactNode; value: ReactNode; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-mute">{label}</span>
      <span className={cn("num font-mono font-medium", valueClassName)}>{value}</span>
    </div>
  );
}
