/**
 * PendingCard / PendingBlock – the place of a card (or a whole section of cards) that is still on its way (a lazy chunk,
 * a worker, candles that are loading), in the size the finished card will have: nothing below it moves when it arrives.
 * `size` is the Tailwind `min-h-*` class string of the measured final height (mobile first, then the breakpoint the card
 * changes at); the body is a calm skeleton. Local to the pages that need it until the shell offers a shared reservation
 * (Feinschliff Runde 8).
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card } from "@/primitives/Card";
import { Skeleton } from "@/primitives/Skeleton";

export function PendingCard({ title, note, testId, size, className }: { title: ReactNode; note?: ReactNode; testId?: string; size: string; className?: string }) {
  return (
    <Card title={title} note={note} data-testid={testId} aria-busy="true" className={className} innerClassName={size}>
      <Skeleton className="min-h-[96px] flex-1" />
    </Card>
  );
}

/** The same reservation for a whole section of cards: one calm block in its final height. */
export function PendingBlock({ size, className }: { size: string; className?: string }) {
  return <Skeleton className={cn("w-full rounded-2xl", size, className)} />;
}
