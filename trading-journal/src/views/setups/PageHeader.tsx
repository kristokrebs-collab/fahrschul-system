import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PageHeaderProps {
  title: string;
  lead: string;
  /** Right-aligned actions (segmented controls, primary button). */
  action?: ReactNode;
  className?: string;
}

/**
 * Bundle `aT`: page title with the signal dot + lead paragraph + action slot
 * (`flex flex-wrap items-end justify-between gap-4`). Shared by the setups and settings pages.
 */
export function PageHeader({ title, lead, action, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-[clamp(22px,7.2vw,28px)] font-semibold tracking-tight [text-wrap:balance] [overflow-wrap:anywhere]">
          <span className="mr-2 inline-block size-2 -translate-y-1 rounded-full bg-signal align-middle" aria-hidden="true" />
          {title}
        </h1>
        <p className="mt-1 max-w-[62ch] text-[13.5px] text-mute">{lead}</p>
      </div>
      {action}
    </div>
  );
}
