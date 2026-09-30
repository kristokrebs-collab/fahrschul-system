import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Bundle `Qr`: dashed box, e.g. `Noch keine Trades`. */
export function EmptyState({ title, text, action, className }: EmptyStateProps) {
  return (
    <div className={cn("grid h-full min-h-[180px] place-items-center rounded-xl border border-dashed border-line-2 p-6 text-center", className)}>
      <div className="grid justify-items-center gap-2">
        <strong className="text-[14px] font-semibold text-fg">{title}</strong>
        {text && <span className="max-w-[38ch] text-[13px] text-mute">{text}</span>}
        {action}
      </div>
    </div>
  );
}
