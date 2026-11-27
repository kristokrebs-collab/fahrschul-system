/**
 * "Mehr dazu": the small print of a settings card, folded away (Feinschliff, Runde 8) so a card reads in one glance and
 * the precise sentences stay one tap away. A native `details`: the text stays in the DOM (readers, find-in-page and the
 * tests read it closed), the keyboard works, and nothing moves but the chevron's quarter turn (a 150 ms transform
 * transition, none under reduced motion).
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function MoreInfo({ summary, children, className }: { summary: string; children: ReactNode; className?: string }) {
  return (
    <details className={cn("group/more text-[12px] leading-relaxed text-mute", className)}>
      <summary className="touch-hit flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md py-1 text-[12px] text-mute transition-colors hover:text-fg focus-visible:text-fg pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <svg viewBox="0 0 12 12" className="size-2.5 transition-transform duration-150 group-open/more:rotate-90 motion-reduce:transition-none" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 2l4 4-4 4" />
        </svg>
        {summary}
      </summary>
      <div className="grid gap-1.5 pt-1">{children}</div>
    </details>
  );
}
