import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "win" | "loss" | "warn" | "mute" | "steel" | "teal";

export const badgeTone: Record<BadgeTone, string> = {
  win: "bg-win/12 text-win border-win/25",
  loss: "bg-loss/12 text-loss border-loss/25",
  warn: "bg-warn/12 text-warn border-warn/25",
  mute: "bg-white/[0.04] text-mute border-line-2",
  steel: "bg-steel/12 text-steel border-steel/25",
  teal: "bg-teal/12 text-aqua border-teal/25",
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}

/** Bundle `Un`: `inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold` + tone. */
export function Badge({ tone = "mute", children, className, title }: BadgeProps) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", badgeTone[tone], className)}>
      {children}
    </span>
  );
}
