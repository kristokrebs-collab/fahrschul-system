import type { ComponentProps, ReactNode } from "react";
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

/** Wrapper over `@/ui/tooltip` with the bundle tooltip class string. The child must accept a ref (button, span). */
export function Tooltip({ content, children, side = "top", sideOffset = 6, className, delayDuration = 150 }: TooltipProps) {
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <UiTooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} sideOffset={sideOffset} className={cn(tooltipClass, className)}>
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
