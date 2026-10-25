/**
 * Section „Termine“ of the Markt page (F43): „Heute wichtig“ (the Morgenbriefing), „Termine“ (calendar) and „Ereignisphasen“
 * (the strategy filter). One lazy chunk, loaded when the Markt page is open – the first load never imports it. The cards are
 * found by their `data-testid` (`briefing-card`, `termine-card`, `phasen-card`) for the page's „Inhalt“ strip.
 */
import { Reveal } from "@/motion/Reveal";
import { BriefingCard } from "./BriefingCard";
import { PhasenCard } from "./PhasenCard";
import { TermineCard } from "./TermineCard";

export default function TermineSection() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12" data-testid="termine-section">
      <Reveal index={0} className="min-w-0 lg:col-span-5">
        <BriefingCard />
      </Reveal>
      <Reveal index={1} className="min-w-0 lg:col-span-7">
        <TermineCard />
      </Reveal>
      <Reveal index={2} className="min-w-0 lg:col-span-12">
        <PhasenCard />
      </Reveal>
    </div>
  );
}
