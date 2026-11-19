/**
 * PendingCard / PendingBlock – the place of a card (or a whole section of cards) that is still on its way, in the size the
 * finished card will have, built on the shell's `Reserve` (`@/primitives/Reserve`): the floor is a plain `min-height` per
 * breakpoint from measured px, the body a calm skeleton. `PendingCard` keeps the card's title (so the strip and the finder
 * still find its place by name); `PendingBlock` stands for several cards.
 */
import type { ReactNode } from "react";
import { Card } from "@/primitives/Card";
import { CardSkeleton, RESERVE_CLASS, reserveStyle, type ReserveHeight } from "@/primitives/Reserve";
import { Skeleton } from "@/primitives/Skeleton";

export function PendingCard({ title, note, testId, height }: { title: ReactNode; note?: ReactNode; testId?: string; height: ReserveHeight }) {
  return (
    <div className={RESERVE_CLASS} style={reserveStyle(height)}>
      <Card title={title} note={note} data-testid={testId} aria-busy="true" innerClassName={RESERVE_CLASS}>
        <Skeleton className="min-h-[96px] flex-1" />
      </Card>
    </div>
  );
}

/** The same reservation for a whole section of cards: one card-shaped skeleton in its final height. */
export function PendingBlock({ height }: { height: ReserveHeight }) {
  return (
    <div className={RESERVE_CLASS} style={reserveStyle(height)} aria-busy="true">
      <CardSkeleton rows={3} />
    </div>
  );
}
